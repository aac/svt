/**
 * Server-side token-minting helpers for the voice library.
 *
 * These are optional utilities — the consumer can wire them into their own
 * server route however they like (Hono, Express, raw Node http, Vite middleware).
 * The library makes no assumptions about the server framework.
 *
 * Usage (Hono example):
 *
 *   import { makeTranscriptionBroker, makeOpenAiTranscriptionMint } from '@surface-voice-triage/voice/server';
 *   import { Hono } from 'hono';
 *
 *   const broker = makeTranscriptionBroker({ apiKey: process.env.OPENAI_API_KEY });
 *   const app = new Hono();
 *   app.post('/api/realtime/token', async (c) => {
 *     const token = await broker.mintEphemeralToken();
 *     return c.json(token);
 *   });
 *
 * The browser-side tokenProvider points at this route:
 *
 *   useVoiceCapture({
 *     tokenProvider: () => fetch('/api/realtime/token', { method: 'POST' }).then(r => r.json()),
 *   });
 */

import type { TokenResponse } from './types.js';

// ─── Mint function boundary ────────────────────────────────────────────────

/**
 * The OpenAI boundary. Tests inject a fake; production uses makeOpenAiTranscriptionMint.
 * Returns the minimum the broker cares about; the master key never propagates outward.
 */
export type TranscriptionMintFn = () => Promise<{
  clientSecret: string;
  expiresAt: number;
  model: string;
}>;

// ─── Broker ───────────────────────────────────────────────────────────────

export interface TranscriptionBrokerOptions {
  mint: TranscriptionMintFn;
}

/**
 * Lightweight broker for transcription-only ephemeral tokens.
 * Validates the mint result; never propagates extra fields from the mint
 * response (prevents accidental master-key leakage via spread).
 */
export class RealtimeTranscriptionBroker {
  private readonly mint: TranscriptionMintFn;

  constructor(opts: TranscriptionBrokerOptions) {
    this.mint = opts.mint;
  }

  async mintEphemeralToken(): Promise<TokenResponse> {
    const result = await this.mint();
    if (!result.clientSecret) {
      // Loud failure — a silent empty token would produce confusing WebRTC
      // credential errors in the browser rather than a useful diagnostic.
      throw new Error('[RealtimeTranscriptionBroker] OpenAI returned an empty client_secret.');
    }
    // Explicit field selection: never spread the mint result.
    // A leaky mint that adds extra fields (e.g. the master api key) won't propagate.
    return {
      clientSecret: result.clientSecret,
      expiresAt: result.expiresAt,
      model: result.model,
    };
  }
}

// ─── OpenAI factory ────────────────────────────────────────────────────────

export interface MakeTranscriptionBrokerOptions {
  apiKey?: string;
  /** Override the model. Default: gpt-4o-transcribe (or OPENAI_TRANSCRIPTION_MODEL env var). */
  model?: string;
  /**
   * Optional STT prompt — vocabulary/style bias on transcription models, or a
   * steerable instruction on a reasoning model (e.g. gpt-realtime-2). The library
   * stays generic: the CONSUMER supplies any domain context (item names, marker
   * instructions). Nothing item-specific is hardcoded here — the voice library
   * doesn't know what's being triaged. Caveat: gpt-4o-transcribe can leak prompt
   * text into the transcript on silence, so use sparingly on that model.
   */
  prompt?: string;
  /**
   * Server-VAD / segmentation tuning. THE load-bearing knob for how forgiving
   * capture is of unprepared, thinking-out-loud speech. Baked into
   * the ephemeral token, so it lives here (server-side), not in the browser hook.
   * Any field left unset falls back to an env var, then to `DEFAULT_VAD_TUNING`.
   * See `VadTuning` for what each field does and why it matters.
   */
  vad?: VadTuning;
}

// ─── VAD / segmentation tuning ─────────────────────────────────

export type NoiseReductionProfile = 'far_field' | 'near_field' | 'none';

/**
 * How server VAD cuts continuous mic audio into transcribed segments. These were
 * previously hardcoded, tuned for the triage dogfood (short per-item bursts, where
 * AGGRESSIVE splitting is wanted so a run-on splits between items). That profile
 * is wrong for thinking-out-loud speech — pauses, gaps, ums, mid-sentence restarts
 * — where the same aggressiveness CUTS MID-THOUGHT: the pre-pause audio becomes a
 * tiny fragment STT often returns empty (a silent drop, observed in practice),
 * and the post-pause resume gets its head clipped ("fragments start mid-sentence").
 *
 * So the tuning is now a consumer knob, TUNABLE not hardcoded (design direction,
 * 2026-07-21): a triage consumer can opt back into aggressive splitting; a
 * dictation-style consumer keeps the forgiving default. The library can't know
 * which it is, so the DEFAULT serves the general, unprepared case.
 */
export interface VadTuning {
  /**
   * How long VAD waits in silence before ENDING a segment (ms). The primary knob.
   * Higher = tolerates thinking pauses without cutting the thought (fewer drops);
   * lower = splits a run-on across items more eagerly (triage). Env: OPENAI_VAD_SILENCE_MS.
   */
  silenceDurationMs?: number;
  /**
   * How confident VAD must be it's hearing speech before OPENING a segment (0..1).
   * Higher rejects more room tone (fewer phantom transcripts) but clips leading
   * words when it opens late. Env: OPENAI_VAD_THRESHOLD.
   */
  threshold?: number;
  /**
   * Audio retained BEFORE the onset point (ms) — protects the first word(s) from
   * the moment VAD takes to lock on, which matters most right after a pause when it
   * must re-detect onset. Env: OPENAI_VAD_PREFIX_MS.
   */
  prefixPaddingMs?: number;
  /**
   * Input noise-reduction profile. `far_field` suits a laptop/room-distance mic;
   * `near_field` a close/headset mic (it over-suppresses quieter speech on a laptop
   * and can drop whole short utterances); `none` disables it. Env:
   * OPENAI_VAD_NOISE_REDUCTION.
   */
  noiseReduction?: NoiseReductionProfile;
}

/**
 * Forgiving defaults for unprepared thinking-out-loud speech. The
 * `silenceDurationMs` default is deliberately well above the old triage-tuned 400ms
 * so a normal mid-thought pause doesn't cut the segment. These are a STARTING point
 * meant to be tuned live per consumer, not a proven optimum — that's why they're a
 * knob. A triage consumer that wants eager run-on splitting passes a lower
 * `silenceDurationMs` (e.g. 400) explicitly.
 */
export const DEFAULT_VAD_TUNING: Required<VadTuning> = {
  silenceDurationMs: 1200,
  threshold: 0.5,
  prefixPaddingMs: 500,
  noiseReduction: 'far_field',
};

const NOISE_REDUCTION_PROFILES: readonly NoiseReductionProfile[] = [
  'far_field',
  'near_field',
  'none',
];

/**
 * Merge explicit tuning > env vars > `DEFAULT_VAD_TUNING` into a fully-resolved set.
 * Pure and exported so consumers/tests can see exactly what a config resolves to
 * without minting a token. Invalid env values are ignored (fall through to default)
 * rather than silently poisoning the session with a NaN/garbage VAD param.
 */
export function resolveVadTuning(
  tuning: VadTuning = {},
  env: Record<string, string | undefined> = process.env,
): Required<VadTuning> {
  const num = (explicit: number | undefined, envKey: string, fallback: number): number => {
    if (typeof explicit === 'number' && Number.isFinite(explicit)) return explicit;
    const raw = env[envKey];
    if (raw != null && raw.trim() !== '') {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
  };
  const noiseReduction: NoiseReductionProfile = (() => {
    if (tuning.noiseReduction && NOISE_REDUCTION_PROFILES.includes(tuning.noiseReduction)) {
      return tuning.noiseReduction;
    }
    const raw = env.OPENAI_VAD_NOISE_REDUCTION as NoiseReductionProfile | undefined;
    if (raw && NOISE_REDUCTION_PROFILES.includes(raw)) return raw;
    return DEFAULT_VAD_TUNING.noiseReduction;
  })();
  return {
    silenceDurationMs: num(
      tuning.silenceDurationMs,
      'OPENAI_VAD_SILENCE_MS',
      DEFAULT_VAD_TUNING.silenceDurationMs,
    ),
    threshold: num(tuning.threshold, 'OPENAI_VAD_THRESHOLD', DEFAULT_VAD_TUNING.threshold),
    prefixPaddingMs: num(
      tuning.prefixPaddingMs,
      'OPENAI_VAD_PREFIX_MS',
      DEFAULT_VAD_TUNING.prefixPaddingMs,
    ),
    noiseReduction,
  };
}

/**
 * Build the OpenAI transcription-session request body. Pure and exported so the
 * exact wire shape (including the resolved VAD params) is unit-testable without a
 * network call — the boundary where a wrong VAD value would silently degrade
 * capture. `noiseReduction: 'none'` omits the field entirely (disables it).
 */
export function buildTranscriptionSessionBody(args: {
  model: string;
  language?: string;
  prompt?: string;
  vad: Required<VadTuning>;
}): Record<string, unknown> {
  const { model, language = 'en', prompt, vad } = args;
  const noiseReduction =
    vad.noiseReduction === 'none' ? undefined : { type: vad.noiseReduction };
  return {
    session: {
      type: 'transcription',
      audio: {
        input: {
          transcription: {
            model,
            language,
            // Only include the prompt when the consumer supplied one.
            ...(prompt ? { prompt } : {}),
          },
          // Omit noise_reduction only when explicitly disabled ('none').
          ...(noiseReduction ? { noise_reduction: noiseReduction } : {}),
          turn_detection: {
            type: 'server_vad',
            threshold: vad.threshold,
            prefix_padding_ms: vad.prefixPaddingMs,
            silence_duration_ms: vad.silenceDurationMs,
          },
        },
      },
    },
  };
}

const DEFAULT_TRANSCRIPTION_MODEL = 'gpt-4o-transcribe';

/** GA Realtime: the single endpoint that mints ephemeral client secrets for any session type. */
const OPENAI_CLIENT_SECRETS_URL = 'https://api.openai.com/v1/realtime/client_secrets';

/**
 * Factory that wires the broker to the OpenAI GA Realtime API.
 *
 * Throws at construction if OPENAI_API_KEY is missing — fail early at
 * server boot rather than at the first browser request.
 */
export function makeTranscriptionBroker(opts: MakeTranscriptionBrokerOptions = {}): RealtimeTranscriptionBroker {
  const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      '[voice/server] OPENAI_API_KEY is not set. ' +
        'Set it in your environment before constructing the broker.',
    );
  }
  const model = opts.model ?? process.env.OPENAI_TRANSCRIPTION_MODEL ?? DEFAULT_TRANSCRIPTION_MODEL;
  const prompt = opts.prompt;
  // Resolve VAD tuning ONCE at broker construction (explicit opts > env > defaults),
  // so every minted token in this broker's lifetime carries the same segmentation
  // profile. See VadTuning / DEFAULT_VAD_TUNING for the per-field rationale.
  const vad = resolveVadTuning(opts.vad);

  const mint: TranscriptionMintFn = async () => {
    // GA Realtime mints every ephemeral key through POST /v1/realtime/client_secrets.
    // session.type "transcription" yields a transcription-only session (no model
    // audio response). Beta's /v1/realtime/transcription_sessions was removed at GA
    // Session config is baked into the minted token, so the
    // browser's SDP exchange carries no session params. The turn_detection /
    // noise_reduction values come from the resolved VadTuning — no
    // longer hardcoded, so a consumer can serve thinking-out-loud speech (forgiving
    // default) or eager triage run-on splitting (a lower silence_duration_ms).
    const body = buildTranscriptionSessionBody({ model, prompt, vad });
    const res = await fetch(OPENAI_CLIENT_SECRETS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText);
      throw new Error(`client_secrets mint failed (${res.status}): ${detail}`);
    }
    // GA response: ephemeral token in `value`, expiry in `expires_at`.
    const data = (await res.json()) as { value?: string; expires_at?: number };
    return {
      clientSecret: data.value ?? '',
      expiresAt: data.expires_at ?? 0,
      model,
    };
  };

  return new RealtimeTranscriptionBroker({ mint });
}
