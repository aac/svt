/**
 * Voice usage journal — the APP's half of cost accounting.
 *
 * LAYERING. `@surface-voice-triage/voice` exposes usage on its `onEvent` stream and
 * folds it into per-session totals; it does no I/O and holds no pricing policy
 * ("v0 voice is dumb"). Everything policy-shaped — what a minute of audio costs,
 * where rows land, what a row looks like — lives here, in the consuming app. Same
 * split as the phantom stripper.
 *
 * DURABILITY SHAPE. One JSON object per line, appended PER USAGE EVENT rather than
 * once at session end. A single end-of-session write loses the whole session when a
 * tab closes or the dev server dies — which is exactly the "we have no idea what we
 * spent" failure this exists to fix. Because each row carries the session's RUNNING
 * CUMULATIVE totals, the LAST row for a sessionId *is* that session's total, and a
 * crash mid-session still leaves everything up to the last segment on disk.
 *
 * Query it with the tools already on the machine — that is the whole "queryable
 * across sessions" requirement, deliberately:
 *
 *   # every session's final total, newest last
 *   jq -s 'group_by(.sessionId) | map(last)' .data/voice-usage.jsonl
 *   # total estimated spend across all sessions
 *   jq -s 'group_by(.sessionId) | map(last.estimatedCostUsd // 0) | add' .data/voice-usage.jsonl
 *
 * No dashboard, no CLI, no database. If you are reaching for one, re-read this.
 *
 * Transport-agnostic on purpose (no http, no fs) — same convention as
 * surface-store.ts, so the row-building and rate policy are unit-testable at the
 * boundary that matters rather than through an incidental HTTP layer. The Vite dev
 * server (vite.config.ts) wires this to POST /usage and does the appending.
 */

/**
 * Pricing rates, recorded ON EVERY ROW.
 *
 * A stored dollar figure with no rate becomes uninterpretable the moment pricing
 * changes, and a rate that lives only in code silently rewrites history every time
 * someone edits the constant. So the rate travels with the number it produced.
 *
 * Defaults are for `gpt-4o-transcribe` (the model this project's broker mints):
 *   - $0.006 per minute of audio — OpenAI's published per-minute rate for
 *     gpt-4o-transcribe, and the documented default.
 *   - $2.50 / 1M input tokens and $10.00 / 1M output tokens — OpenAI's
 *     gpt-4o-transcribe model page.
 *
 * All three are env-overridable so a rate change needs no code change.
 */
export interface UsageRates {
  usdPerAudioMinute: number;
  usdPer1MInputTokens: number;
  usdPer1MOutputTokens: number;
}

export const DEFAULT_USAGE_RATES: UsageRates = Object.freeze({
  usdPerAudioMinute: 0.006,
  usdPer1MInputTokens: 2.5,
  usdPer1MOutputTokens: 10.0,
});

/** Default journal path. Gitignored (`.data/`) and overridable via VOICE_USAGE_JOURNAL. */
export const DEFAULT_USAGE_JOURNAL_RELATIVE_PATH = '.data/voice-usage.jsonl';

function envNumber(raw: string | undefined, fallback: number): number {
  if (raw == null || raw.trim() === '') return fallback;
  const n = Number(raw);
  // A garbage override must not silently zero out the rate and make spend vanish.
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Resolve rates from the environment, falling back to the documented defaults. */
export function resolveUsageRates(env: Record<string, string | undefined> = {}): UsageRates {
  return {
    usdPerAudioMinute: envNumber(env.VOICE_USD_PER_AUDIO_MINUTE, DEFAULT_USAGE_RATES.usdPerAudioMinute),
    usdPer1MInputTokens: envNumber(
      env.VOICE_USD_PER_1M_INPUT_TOKENS,
      DEFAULT_USAGE_RATES.usdPer1MInputTokens,
    ),
    usdPer1MOutputTokens: envNumber(
      env.VOICE_USD_PER_1M_OUTPUT_TOKENS,
      DEFAULT_USAGE_RATES.usdPer1MOutputTokens,
    ),
  };
}

/**
 * Which input the cost estimate was computed from — so a null cost is readable as
 * a *cause*, not just a blank. `unreported` means the wire told us nothing usable;
 * that is NOT the same as "this session was free", and nothing downstream may
 * render it as $0.00.
 */
export type UsageCostBasis = 'audio-duration' | 'tokens' | 'unreported';

/** One line of the journal. Flat on purpose — `jq`-friendly, no nesting to walk. */
export interface UsageRow {
  /** RFC3339 append time. */
  at: string;
  /** Voice sessionId — the grouping key for "what did this session cost". */
  sessionId: string;
  /** Usage-bearing segments so far this session (cumulative). */
  segments: number;
  audioTokens: number | null;
  textTokens: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  /** Billed audio seconds reported by the wire (duration-billed models). */
  audioSeconds: number | null;
  /** Session wall clock from first capture event to this one. */
  wallClockMs: number;
  /** Usage variants seen this session: 'tokens' and/or 'duration'. */
  variants: string[];
  /** The rates used for `estimatedCostUsd`. Stored so the figure stays readable. */
  rates: UsageRates;
  /** Estimate in USD, or null when the wire reported nothing costable. */
  estimatedCostUsd: number | null;
  costBasis: UsageCostBasis;
}

/**
 * The subset of the voice library's `VoiceUsageTotals` this journal needs.
 *
 * Declared structurally rather than imported so the server module stays free of a
 * browser-hook dependency — but the fields and their `number | null` semantics are
 * the library's, and `parseUsageTotals` below is what actually enforces them,
 * because these totals arrive over HTTP from the browser and a TypeScript
 * annotation on a process-boundary value is an assertion, not a check.
 */
export interface UsageTotalsInput {
  sessionId: string;
  segments: number;
  audioTokens: number | null;
  textTokens: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  audioSeconds: number | null;
  wallClockMs: number;
  variants: string[];
}

function optionalNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Validate a totals payload arriving from the browser. Returns null on anything
 * unusable — the route answers 400 rather than journaling a row that lies.
 *
 * `sessionId` is the one hard requirement: a row with no session key is unqueryable
 * and therefore worthless. Everything else degrades to null/0.
 */
export function parseUsageTotals(raw: unknown): UsageTotalsInput | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const t = raw as Record<string, unknown>;
  if (typeof t.sessionId !== 'string' || t.sessionId.length === 0) return null;
  return {
    sessionId: t.sessionId,
    segments: optionalNumber(t.segments) ?? 0,
    audioTokens: optionalNumber(t.audioTokens),
    textTokens: optionalNumber(t.textTokens),
    inputTokens: optionalNumber(t.inputTokens),
    outputTokens: optionalNumber(t.outputTokens),
    totalTokens: optionalNumber(t.totalTokens),
    audioSeconds: optionalNumber(t.audioSeconds),
    wallClockMs: optionalNumber(t.wallClockMs) ?? 0,
    variants: Array.isArray(t.variants) ? t.variants.filter((v): v is string => typeof v === 'string') : [],
  };
}

/**
 * Estimate cost, preferring the basis the wire actually reported.
 *
 * Duration wins when present because a billed-seconds figure is what the
 * per-minute rate is denominated in. Tokens are the fallback. When neither
 * arrived, the answer is `null` + `'unreported'` — never a fabricated zero.
 */
export function estimateUsageCost(
  totals: UsageTotalsInput,
  rates: UsageRates,
): { estimatedCostUsd: number | null; costBasis: UsageCostBasis } {
  if (totals.audioSeconds != null) {
    return {
      estimatedCostUsd: (totals.audioSeconds / 60) * rates.usdPerAudioMinute,
      costBasis: 'audio-duration',
    };
  }
  if (totals.inputTokens != null || totals.outputTokens != null) {
    const input = ((totals.inputTokens ?? 0) / 1_000_000) * rates.usdPer1MInputTokens;
    const output = ((totals.outputTokens ?? 0) / 1_000_000) * rates.usdPer1MOutputTokens;
    return { estimatedCostUsd: input + output, costBasis: 'tokens' };
  }
  return { estimatedCostUsd: null, costBasis: 'unreported' };
}

/** Build the journal line for a set of running totals. Pure. */
export function buildUsageRow(
  totals: UsageTotalsInput,
  rates: UsageRates = DEFAULT_USAGE_RATES,
  at: string = new Date().toISOString(),
): UsageRow {
  const { estimatedCostUsd, costBasis } = estimateUsageCost(totals, rates);
  return {
    at,
    sessionId: totals.sessionId,
    segments: totals.segments,
    audioTokens: totals.audioTokens,
    textTokens: totals.textTokens,
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    totalTokens: totals.totalTokens,
    audioSeconds: totals.audioSeconds,
    wallClockMs: totals.wallClockMs,
    variants: totals.variants,
    rates,
    estimatedCostUsd,
    costBasis,
  };
}

/** Serialise a row as one JSONL line (trailing newline included). */
export function usageRowToJsonl(row: UsageRow): string {
  return JSON.stringify(row) + '\n';
}
