/**
 * Voice usage accounting — the parse + fold half.
 *
 * WHY THIS EXISTS: every voice session ever run in this project has been
 * unmeasured. Not because spend is high (server VAD means an idle-but-connected
 * mic generates no tokens, and `gpt-4o-transcribe` is cheap per minute) — because
 * it was *unknown*, and armed-mic work makes it a live design variable.
 *
 * LAYERING — the library EXPOSES, the app PERSISTS. Everything in this file is
 * pure: no `fetch`, no file writes, no cost arithmetic, no pricing policy. The
 * library's whole job is to surface what the data channel said and fold it into
 * per-session totals. Persistence, rates, and dollars live downstream in the
 * consuming app (same precedent as the phantom stripper).
 *
 * WIRE-SHAPE HONESTY: `parseSegmentUsage` is deliberately defensive. It tolerates
 * `usage` being absent entirely, tolerates both documented variants, and never
 * throws — see its doc comment for the exact shape assumed and where it came from.
 */

import type { SegmentUsage, VoiceCaptureEvent } from './types.js';

/** A finite number, or null. Rejects NaN/Infinity/strings/booleans. */
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Parse the `usage` field off an OpenAI Realtime
 * `conversation.item.input_audio_transcription.completed` event.
 *
 * ─── THE ASSUMED WIRE SHAPE, AND WHERE IT CAME FROM ─────────────────────────
 *
 * Source: the OpenAI Realtime API reference's
 * `ConversationItemInputAudioTranscriptionCompletedEvent`, which documents `usage`
 * as one of TWO variants (the same two the `POST /v1/audio/transcriptions`
 * reference documents for its own `usage` field):
 *
 *   tokens variant   { type: 'tokens',   input_tokens, output_tokens, total_tokens,
 *                      input_token_details?: { audio_tokens?, text_tokens? } }
 *   duration variant { type: 'duration', seconds }
 *
 * The tokens variant is what token-billed models (`gpt-4o-transcribe`,
 * `gpt-4o-mini-transcribe` — the models this project uses) are documented to
 * return; the duration variant is for duration-billed models (`whisper-1`).
 *
 * NOT VERIFIED AGAINST A LIVE SESSION. Confirming the live payload needs a real
 * mic pass, which is out of scope here — so this parser treats the documented
 * shape as a *hint*, not a contract:
 *
 *   - `usage` absent / null / not an object  → returns null (no usage event fires).
 *   - `type` is trusted when it is one of the two known strings, but is NOT
 *     required: the variant is otherwise sniffed from which fields are numbers.
 *     A payload that carries `seconds` under an unexpected `type` still parses.
 *   - Every field is independently optional. A tokens payload with no
 *     `input_token_details` yields `audioTokens: null`, not 0 — absent and zero
 *     are different facts and the journal must not conflate them.
 *   - Nothing throws, ever. An unexpected shape degrades to null and transcription
 *     is unaffected (usage is purely observational, like the drop instrument).
 *
 * A test fixture here can only assert *this parser's* behaviour on the documented
 * and the malformed shapes. It cannot verify what OpenAI actually sends.
 */
export function parseSegmentUsage(raw: unknown): SegmentUsage | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const u = raw as Record<string, unknown>;

  const declared = typeof u.type === 'string' ? u.type : null;
  const seconds = num(u.seconds);

  const inputTokens = num(u.input_tokens);
  const outputTokens = num(u.output_tokens);
  const totalTokens = num(u.total_tokens);

  const details =
    u.input_token_details != null && typeof u.input_token_details === 'object'
      ? (u.input_token_details as Record<string, unknown>)
      : null;
  const audioTokens = details ? num(details.audio_tokens) : null;
  const textTokens = details ? num(details.text_tokens) : null;

  const hasTokens =
    inputTokens != null || outputTokens != null || totalTokens != null || audioTokens != null || textTokens != null;

  // Variant resolution: trust a recognised `type`, otherwise sniff from the
  // fields that actually arrived. Bail only when nothing usable is present.
  let variant: SegmentUsage['variant'];
  if (declared === 'duration' && seconds != null) variant = 'duration';
  else if (declared === 'tokens' && hasTokens) variant = 'tokens';
  else if (seconds != null) variant = 'duration';
  else if (hasTokens) variant = 'tokens';
  else return null;

  return {
    variant,
    declaredType: declared,
    audioSeconds: seconds,
    audioTokens,
    textTokens,
    inputTokens,
    outputTokens,
    totalTokens,
  };
}

/**
 * Per-session running totals. Cumulative by construction: fold every event as it
 * arrives and the current value is always "the session so far", which is what
 * makes an append-per-event journal's LAST row for a session its total.
 *
 * Token/second fields are `null` until the wire supplies one, then accumulate as
 * numbers — so "the wire never told us" stays distinguishable from "the wire said
 * zero". The app must not print `$0.00` for the former.
 */
export interface VoiceUsageTotals {
  /** Voice sessionId the totals belong to; null before the first usage event. */
  sessionId: string | null;
  /** Count of usage-bearing segments folded in. */
  segments: number;
  audioTokens: number | null;
  textTokens: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  /** Summed `seconds` from duration-variant payloads (billed audio, not wall clock). */
  audioSeconds: number | null;
  /** Client `Date.now()` of the first event folded for this session. */
  firstEventT: number | null;
  /** Client `Date.now()` of the most recent event folded. */
  lastEventT: number | null;
  /** Session wall clock: lastEventT - firstEventT. 0 before two events land. */
  wallClockMs: number;
  /** Variants actually seen, so a consumer can tell which billing basis applies. */
  variants: ReadonlyArray<SegmentUsage['variant']>;
}

export const emptyVoiceUsageTotals: VoiceUsageTotals = Object.freeze({
  sessionId: null,
  segments: 0,
  audioTokens: null,
  textTokens: null,
  inputTokens: null,
  outputTokens: null,
  totalTokens: null,
  audioSeconds: null,
  firstEventT: null,
  lastEventT: null,
  wallClockMs: 0,
  variants: Object.freeze([]) as ReadonlyArray<SegmentUsage['variant']>,
});

/** null + n = n; m + n = m + n. Keeps "never reported" distinct from zero. */
function add(acc: number | null, next: number | null): number | null {
  if (next == null) return acc;
  return (acc ?? 0) + next;
}

/**
 * Fold one capture event into running totals. Pure: same inputs, same output, no
 * mutation of `totals`.
 *
 * Every event kind advances the wall clock (so a session's duration spans from its
 * first VAD onset to its last event, not just its usage events); only `usage`
 * events contribute tokens/seconds.
 *
 * SESSION BOUNDARY: a `usage` event whose `sessionId` differs from the totals'
 * starts a FRESH accumulation from that event. A reconnect mints a new voice
 * sessionId, and silently merging two sessions' spend into one row would make the
 * journal lie — so the boundary is handled here rather than requiring every
 * consumer to detect reconnects correctly.
 */
export function foldVoiceUsage(totals: VoiceUsageTotals, event: VoiceCaptureEvent): VoiceUsageTotals {
  if (event.kind === 'usage' && totals.sessionId != null && event.sessionId !== totals.sessionId) {
    return foldVoiceUsage({ ...emptyVoiceUsageTotals }, event);
  }

  const firstEventT = totals.firstEventT ?? event.t;
  const lastEventT = event.t;
  const base: VoiceUsageTotals = {
    ...totals,
    firstEventT,
    lastEventT,
    wallClockMs: Math.max(0, lastEventT - firstEventT),
  };

  if (event.kind !== 'usage') return base;

  const u = event.usage;
  return {
    ...base,
    sessionId: event.sessionId,
    segments: base.segments + 1,
    audioTokens: add(base.audioTokens, u.audioTokens),
    textTokens: add(base.textTokens, u.textTokens),
    inputTokens: add(base.inputTokens, u.inputTokens),
    outputTokens: add(base.outputTokens, u.outputTokens),
    totalTokens: add(base.totalTokens, u.totalTokens),
    audioSeconds: add(base.audioSeconds, u.audioSeconds),
    variants: base.variants.includes(u.variant) ? base.variants : [...base.variants, u.variant],
  };
}

/** Convenience: fold a whole event sequence. Same semantics as repeated `foldVoiceUsage`. */
export function accumulateVoiceUsage(events: readonly VoiceCaptureEvent[]): VoiceUsageTotals {
  let totals: VoiceUsageTotals = { ...emptyVoiceUsageTotals };
  for (const e of events) totals = foldVoiceUsage(totals, e);
  return totals;
}
