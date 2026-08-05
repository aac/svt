/**
 * Surface submission emission for the composition page.
 *
 * Neither library submits to surface directly — that is the consuming app's job
 * (cockpit calls onAction; voice calls onFinal). This module is the consuming
 * app's submission layer. It produces surface submission envelopes and POSTs
 * them to the surface server's /submit route.
 *
 * ─── itemId is a payload convention WE own, NOT a surface feature ───
 *
 * Surface's wire takes `{ id, payload }` where `payload` is opaque JSON. Surface
 * does not understand `itemId` and has no `?groupBy=item` query param. We encode `itemId` INSIDE the payload so it
 * survives the round-trip and can be read back out by the managing agent after a
 * flat drain. The managing agent groups submissions client-side by reading
 * `payload.itemId` from each entry — surface never sees or acts on it.
 *
 * The affordanceId convention (`<action>-<item>`, `voice-note-<item>`) matches
 * the design brief's submission contract. The server treats affordanceId as
 * opaque; only this app and the managing agent know its structure.
 */

/**
 * A surface submission envelope.
 *
 * `itemId` is an optional payload convention owned by this app layer. It is NOT
 * a surface wire field — it rides inside the opaque `payload` object that surface
 * passes through unchanged. After a flat drain, the managing agent reads
 * `payload.itemId` off each submission and groups them client-side. Surface itself
 * has no per-item grouping concept.
 */
export interface SubmissionEnvelope {
  affordanceId: string;
  value: unknown;
  /** Optional item reference. Our convention; surface treats this as opaque payload data. */
  itemId?: string;
}

/**
 * POST a submission to the surface server.
 *
 * The surface wire's /submit route takes `{ id, payload }`. We map our envelope
 * onto it: `id` = affordanceId, `payload` = the full envelope (so itemId + value
 * survive into the state file and the SUBMIT stdout line the agent drains).
 */
export async function postSubmission(env: SubmissionEnvelope): Promise<void> {
  const res = await fetch('/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: env.affordanceId, payload: env }),
  });
  // Gate on response.ok — a fetch promise resolves on any status (surface wire docs).
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`/submit failed (${res.status}): ${detail}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Downstream phantom-correction cleanup
//
// gpt-4o-transcribe (like Whisper) is biased to always emit words, so keyboard
// clicks, trackpad taps, and ambient noise occasionally produce PHANTOM text
// the operator never spoke. In a real dogfood session the operator mitigated this
// in the moment by
// SAYING a correction ("I didn't say that") right after the phantom appeared, so
// the phantom is flagged in the transcript.
//
// This cleanup is deliberately APP-SIDE, not in the voice library. Per the design
// brief non-goals, **v0 voice is dumb**: transcription only, no
// intent classification, no content inspection. Detecting a spoken correction and
// stripping the phantom it refers to is content-aware reasoning, so it lives here
// in the consuming app's submission layer — downstream of the drain — where the
// voice library stays content-agnostic. See docs/design-spec.md non-goals.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Spoken-correction phrases that flag the immediately-preceding voice note as a
 * phantom to strip. Extend this list as new correction habits surface — it is the
 * single place the vocabulary lives.
 *
 * Matching is whole-utterance and normalized (case-insensitive, punctuation- and
 * apostrophe-tolerant, whitespace-collapsed) — see `isCorrectionText`. Whole-
 * utterance (not substring) matching is intentional: it avoids false positives on
 * genuine speech that merely contains a phrase (e.g. "I didn't say that loudly
 * enough, resend it" must NOT be treated as a correction).
 */
export const PHANTOM_CORRECTION_PHRASES: readonly string[] = [
  "I didn't say that",
  "I didn't say",
  'scratch that',
  'ignore that',
  'delete that',
  "that's not what I said",
  'strike that',
];

/**
 * Normalize an utterance for correction matching: lowercase, drop punctuation and
 * apostrophes (keep letters/numbers/whitespace), collapse whitespace, trim.
 * "I DIDN'T say that!" → "i didnt say that"; "that's not what I said." → "thats
 * not what i said".
 */
function normalizeUtterance(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const NORMALIZED_CORRECTION_PHRASES: ReadonlySet<string> = new Set(
  PHANTOM_CORRECTION_PHRASES.map(normalizeUtterance),
);

/**
 * True when the whole utterance is one of the correction phrases (after
 * normalization). Whole-utterance equality — not substring — keeps genuine speech
 * that happens to contain a phrase from being misread as a correction.
 */
export function isCorrectionText(text: string): boolean {
  return NORMALIZED_CORRECTION_PHRASES.has(normalizeUtterance(text));
}

/**
 * A drained submission as it comes back from the flat surface drain. Mirrors
 * SurfaceSubmission in ./server/surface-store (id = affordanceId, payload = the
 * SubmissionEnvelope we POSTed, itemId extracted from the payload). Declared here
 * as a minimal structural shape so this cleanup depends on no server module.
 */
export interface DrainedSubmission {
  id: string;
  payload: unknown;
  itemId?: string;
  at?: string;
}

// ─── Detection is STRUCTURAL, not id-prefix-based (review finding A4) ───
//
// The first version keyed off `sub.id.startsWith('voice-note-') && typeof value
// === 'string'`. Both halves were shape assumptions about THIS app's payloads, so
// any consumer whose payloads differed got a SILENT NO-OP: the stripper returned
// the stream unchanged, every phantom survived, no error, no signal. That is not
// hypothetical — a second consumer app POSTs `env.value` (not the whole envelope)
// under an affordance id of `voice-<row>`, so its drained payload is the flat
// `{ text, itemId }` and the cleanup was switched off there from the day it
// shipped. A safety mechanism that fails silently and invisibly is worse than one
// that isn't there.
//
// So: a submission is a candidate voice note because it CARRIES TRANSCRIPT TEXT,
// not because its id matches a prefix. Two rules make that safe:
//
//   1. Action/marker envelopes are POSITIVELY EXCLUDED first (see
//      NON_VOICE_MARKER_KEYS). Stripping one is data loss, and some of them are
//      text-bearing — that consumer's disposition envelope carries the operator's spoken
//      reaction under `note` alongside `decision`. Exclusion wins over extraction.
//   2. Consumers whose shape the defaults don't know can override both halves
//      (see PhantomStripOptions) rather than getting a silent no-op.

/**
 * Keys whose presence marks a value as an ACTION/MARKER envelope, never a voice
 * note. Checked before text extraction, so a text-bearing action stays excluded.
 *
 * `cleared` (clearVoiceSubmission), `undo` (undoSubmission), `done`
 * (sessionDoneSubmission) are this module's own shapes; `decision` is
 * a second consumer's disposition envelope. `actionSubmission` needs no key —
 * its `value` is `true`, which is not text-bearing at all.
 */
const NON_VOICE_MARKER_KEYS: readonly string[] = ['cleared', 'undo', 'done', 'decision'];

/**
 * Keys a transcript can live under when the value is an object. `text` is
 * a second consumer's voice shape; `note` is the range-annotation shape;
 * `transcript` is the obvious sibling. (A bare string value — this app's own
 * `voiceSubmission` — is handled directly.)
 */
const TRANSCRIPT_KEYS: readonly string[] = ['text', 'transcript', 'note'];

/**
 * Unwrap a drained payload to the value the shape rules apply to.
 *
 * Two conventions are live across consumers: this app POSTs the whole
 * SubmissionEnvelope (so the text sits under `payload.value`), while
 * a second consumer POSTs `env.value` directly (so the payload IS the value).
 * Presence of a `value` key distinguishes them.
 */
function submissionValue(payload: unknown): unknown {
  if (payload && typeof payload === 'object' && 'value' in payload) {
    return (payload as { value: unknown }).value;
  }
  return payload;
}

/**
 * Default transcript extraction: the submission's text, or `''` when it carries
 * none (including every excluded action/marker envelope).
 */
function defaultVoiceText(sub: DrainedSubmission): string {
  const value = submissionValue(sub.payload);
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';

  const record = value as Record<string, unknown>;
  // Exclusion first: an action envelope is never a voice note, text or not.
  for (const key of NON_VOICE_MARKER_KEYS) {
    if (key in record) return '';
  }
  for (const key of TRANSCRIPT_KEYS) {
    const text = record[key];
    if (typeof text === 'string') return text;
  }
  return '';
}

/**
 * Consumer overrides for `stripCorrectedPhantoms`. Both are optional; the
 * defaults cover this app's envelopes, a second consumer's flat payloads, and
 * object values carrying `text` / `transcript` / `note`.
 *
 * A consumer whose payloads look like none of those should pass `getText` rather
 * than accept a no-op — the whole point of finding A4 is that the no-op was
 * invisible. (There is deliberately no `kind` discriminator on
 * SubmissionEnvelope; that is the submissions-package extraction's design call.)
 */
export interface PhantomStripOptions {
  /**
   * True when this submission is a voice note — a candidate phantom, or a spoken
   * correction. Defaults to "`getText` returns non-empty text", which is the
   * structural test. Returning `false` guarantees the submission is neither
   * stripped nor treated as a phantom to pair against.
   */
  isVoice?: (sub: DrainedSubmission) => boolean;
  /**
   * The submission's transcript text, or `''` if it has none. Also drives the
   * default `isVoice`, so supplying just this fixes detection too.
   */
  getText?: (sub: DrainedSubmission) => string;
}

/**
 * Remove spoken-correction phantoms from a drained submission stream.
 *
 * Given the ordered flat drain, when a voice note IS a correction phrase (see
 * PHANTOM_CORRECTION_PHRASES) this removes BOTH that correction note AND the voice
 * note immediately preceding it ON THE SAME ITEM (the phantom the correction
 * refers to). Run it BEFORE groupByItem:
 *
 *   const clean = stripCorrectedPhantoms(flatDrain);
 *   const { items } = groupByItem(clean);
 *
 * Detection is structural — a submission is a voice note because it carries
 * transcript text, not because its id matches a prefix. Consumers with an unusual
 * payload shape pass `options` (see PhantomStripOptions) instead of silently
 * getting a stream back unchanged.
 *
 * Scoping rules (deliberately conservative — we only delete when confident):
 *   - Same item only. The phantom must share the correction's itemId. Corrections
 *     never strip across items, and submissions without an itemId are left as-is
 *     (nothing to scope a phantom to).
 *   - Text-bearing voice notes only. Action/marker submissions are never stripped
 *     (they are excluded positively — NON_VOICE_MARKER_KEYS), and they are skipped
 *     when locating the "immediately-preceding voice note", so an action between a
 *     phantom and its correction does not shield the phantom.
 *   - Pair-only. A correction with no preceding voice note on its item is a NO-OP:
 *     the lone correction is left untouched rather than deleting data we cannot
 *     confidently pair. (Removing a phantom+correction pair is the whole point;
 *     an unpaired correction is more likely genuine speech.)
 *
 * Order is otherwise preserved. Pure: the input array and its elements are not
 * mutated; a new filtered array is returned.
 */
export function stripCorrectedPhantoms<T extends DrainedSubmission>(
  stream: readonly T[],
  options: PhantomStripOptions = {},
): T[] {
  const voiceText = options.getText ?? defaultVoiceText;
  const isVoiceSubmission = options.isVoice ?? ((sub: DrainedSubmission) => voiceText(sub).trim() !== '');

  const removed = new Set<number>();
  // Per-item index of the most recent still-present (un-removed) voice note.
  const lastVoiceIdxByItem = new Map<string, number>();

  for (let i = 0; i < stream.length; i++) {
    const sub = stream[i]!;
    if (!isVoiceSubmission(sub)) continue; // actions: never stripped, never tracked
    const itemId = sub.itemId;

    if (isCorrectionText(voiceText(sub))) {
      // Only strip when we can pair the correction with a preceding phantom on the
      // same item. Uncorrelated (no itemId) corrections have nothing to scope to.
      if (itemId != null && lastVoiceIdxByItem.has(itemId)) {
        removed.add(i); // the correction itself
        removed.add(lastVoiceIdxByItem.get(itemId)!); // the phantom it refers to
        lastVoiceIdxByItem.delete(itemId); // phantom consumed; not a candidate again
      }
      // Unpaired correction: left in place (no-op) and NOT tracked as a phantom.
      continue;
    }

    // A normal voice note becomes the item's newest phantom candidate.
    if (itemId != null) lastVoiceIdxByItem.set(itemId, i);
  }

  return stream.filter((_, i) => !removed.has(i)) as T[];
}

/** Build the envelope for a cockpit action invocation on an item. */
export function actionSubmission(actionId: string, itemId: string): SubmissionEnvelope {
  return {
    affordanceId: `${actionId}-${itemId}`,
    value: true,
    itemId,
  };
}

/**
 * The single, well-known page-level affordanceId for the "session complete"
 * signal. Unlike the item-scoped affordances (`<action>-<item>`, `voice-note-<item>`),
 * this is a FIXED, page-level id — there is exactly one "done" per session and it
 * is not tied to any item.
 */
export const SESSION_DONE_AFFORDANCE_ID = 'session-done';

/** Optional, trivially-available triage summary carried on the done signal. */
export interface SessionDoneSummary {
  triaged: number;
  total: number;
}

/**
 * Build the page-level "session complete → trigger downstream processing" signal.
 *
 * ─── This repo EMITS the signal; it does NOT execute the downstream work ───
 *
 * A page-level affordance (a deliberate operator "I'm done" click), NOT item-scoped:
 * it carries NO `itemId`, so after a flat drain it lands in the managing agent's
 * `ungrouped` bucket rather than gluing onto some item. A DRAINING consuming agent
 * interprets this envelope as "the triage session is over — kick off whatever
 * downstream processing you own" (e.g. rebuilding its review page). That downstream
 * work is the consuming project's concern and lives OUTSIDE this repo (design
 * principle: executing decisions is the consuming agent's job). Data durability does
 * NOT depend on this signal — every submission is already journaled on POST; this is
 * purely a workflow convenience so the operator can end a session from the browser.
 *
 * `value.done` is always `true`; a trivial `{ triaged, total }` summary rides along
 * when the page has one (the cockpit dogfood), so a consumer can log/act on the
 * session's shape without re-deriving it. Kept deliberately simple.
 */
export function sessionDoneSubmission(summary?: SessionDoneSummary): SubmissionEnvelope {
  return {
    affordanceId: SESSION_DONE_AFFORDANCE_ID,
    value: summary ? { done: true, ...summary } : { done: true },
    // No itemId — this is page-level, not tied to any item.
  };
}

/**
 * Build the envelope for a finalized voice transcript.
 *
 * The correlationId comes from voice's onFinal payload — it is whatever item was
 * focused when the utterance finalized (cockpit stamped it via the wiring). A
 * transcript with no correlation (voice spoke before any item focused, or voice
 * mounted without cockpit) gets no itemId and lands in the drain's `ungrouped`
 * bucket — which is exactly the worked-example-3 (voice-without-cockpit) case.
 */
export function voiceSubmission(
  text: string,
  correlationId: string | null,
): SubmissionEnvelope {
  if (correlationId == null) {
    return { affordanceId: `voice-note-uncorrelated-${Date.now()}`, value: text };
  }
  return {
    affordanceId: `voice-note-${correlationId}`,
    value: text,
    itemId: correlationId,
  };
}

/**
 * Build the envelope for DISCARDING an item's captured voice notes (the
 * clear/re-record recovery affordance). The operator captured voice
 * that went wrong and cleared it to start over. Every note was already POSTed as
 * its own `voice-note-<item>` submission and journaled durably, so silently
 * dropping the local notes would leave the drain claiming voice the operator has
 * disowned. This compensating submission makes the discard honest: the managing
 * agent, grouping client-side by `itemId`, sees the clear marker and knows the
 * prior `voice-note-<item>` transcripts for this item were retracted.
 */
export function clearVoiceSubmission(itemId: string): SubmissionEnvelope {
  return {
    affordanceId: `voice-clear-${itemId}`,
    value: { cleared: true },
    itemId,
  };
}

/**
 * Build the envelope for REVERSING the most recent disposition applied to an item
 * (the undo-last recovery affordance). The original action was
 * already POSTed as `<action>-<item>` and journaled, so undo cannot un-send it;
 * it emits an explicit compensating submission instead. The managing agent,
 * grouping client-side by `itemId`, reads the `undo` marker and knows the named
 * action on this item was retracted rather than acting on a disposition the
 * operator took back.
 */
export function undoSubmission(actionId: string, itemId: string): SubmissionEnvelope {
  return {
    affordanceId: `undo-${actionId}-${itemId}`,
    value: { undo: actionId },
    itemId,
  };
}
