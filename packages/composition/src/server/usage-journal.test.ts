import { describe, expect, test } from 'vitest';
import {
  buildUsageRow,
  DEFAULT_USAGE_RATES,
  estimateUsageCost,
  parseUsageTotals,
  resolveUsageRates,
  usageRowToJsonl,
  type UsageTotalsInput,
} from './usage-journal.js';

/**
 * Tests for the app-side voice usage journal.
 *
 * The point of the journal is that spend stops being unknown, so the load-bearing
 * assertions are the honesty ones: an unreported figure must never render as $0.00,
 * a stored cost must always travel with the rate that produced it, and the last row
 * for a session must be that session's total.
 */

const usageBaseTotals: UsageTotalsInput = {
  sessionId: 'sess-abc',
  segments: 1,
  audioTokens: 140,
  textTokens: 1,
  inputTokens: 141,
  outputTokens: 9,
  totalTokens: 150,
  audioSeconds: null,
  wallClockMs: 4_200,
  variants: ['tokens'],
};

describe('resolveUsageRates', () => {
  test('defaults to the documented gpt-4o-transcribe rates', () => {
    expect(resolveUsageRates({})).toEqual({
      usdPerAudioMinute: 0.006,
      usdPer1MInputTokens: 2.5,
      usdPer1MOutputTokens: 10.0,
    });
  });

  test('every rate is env-overridable, so a price change needs no code change', () => {
    expect(
      resolveUsageRates({
        VOICE_USD_PER_AUDIO_MINUTE: '0.01',
        VOICE_USD_PER_1M_INPUT_TOKENS: '3',
        VOICE_USD_PER_1M_OUTPUT_TOKENS: '12',
      }),
    ).toEqual({ usdPerAudioMinute: 0.01, usdPer1MInputTokens: 3, usdPer1MOutputTokens: 12 });
  });

  test('a garbage or negative override falls back rather than zeroing spend', () => {
    // A silent 0 rate would make every future row claim the session was free.
    expect(resolveUsageRates({ VOICE_USD_PER_AUDIO_MINUTE: 'free' }).usdPerAudioMinute).toBe(0.006);
    expect(resolveUsageRates({ VOICE_USD_PER_AUDIO_MINUTE: '-1' }).usdPerAudioMinute).toBe(0.006);
    expect(resolveUsageRates({ VOICE_USD_PER_AUDIO_MINUTE: '' }).usdPerAudioMinute).toBe(0.006);
    // An explicit zero IS a legitimate rate (e.g. a self-hosted engine).
    expect(resolveUsageRates({ VOICE_USD_PER_AUDIO_MINUTE: '0' }).usdPerAudioMinute).toBe(0);
  });
});

describe('estimateUsageCost', () => {
  test('prefers reported audio duration, priced at the per-minute rate', () => {
    const result = estimateUsageCost(
      { ...usageBaseTotals, audioSeconds: 120, variants: ['duration'] },
      DEFAULT_USAGE_RATES,
    );
    expect(result.costBasis).toBe('audio-duration');
    expect(result.estimatedCostUsd).toBeCloseTo(0.012, 10); // 2 min × $0.006
  });

  test('falls back to tokens when the wire reported no duration', () => {
    const result = estimateUsageCost(usageBaseTotals, DEFAULT_USAGE_RATES);
    expect(result.costBasis).toBe('tokens');
    // 141/1M × $2.50 + 9/1M × $10.00
    expect(result.estimatedCostUsd).toBeCloseTo(141e-6 * 2.5 + 9e-6 * 10, 12);
  });

  test('reports UNREPORTED rather than $0.00 when the wire gave nothing costable', () => {
    // The whole failure this guard exists to fix is "unknown". A fabricated zero
    // would reintroduce it while looking like an answer.
    const result = estimateUsageCost(
      {
        ...usageBaseTotals,
        audioTokens: null,
        textTokens: null,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        variants: [],
      },
      DEFAULT_USAGE_RATES,
    );
    expect(result.costBasis).toBe('unreported');
    expect(result.estimatedCostUsd).toBeNull();
  });

  test('a genuinely zero-second segment costs zero — distinct from unreported', () => {
    const result = estimateUsageCost({ ...usageBaseTotals, audioSeconds: 0 }, DEFAULT_USAGE_RATES);
    expect(result.costBasis).toBe('audio-duration');
    expect(result.estimatedCostUsd).toBe(0);
  });
});

describe('buildUsageRow', () => {
  test('stores the RATE alongside the dollar figure, so history stays interpretable', () => {
    const row = buildUsageRow(usageBaseTotals, DEFAULT_USAGE_RATES, '2026-07-25T12:00:00.000Z');
    expect(row.rates).toEqual(DEFAULT_USAGE_RATES);
    expect(row.estimatedCostUsd).not.toBeNull();
  });

  test('a row written under an old rate keeps that old rate, not the current one', () => {
    const old = buildUsageRow(usageBaseTotals, { ...DEFAULT_USAGE_RATES, usdPer1MInputTokens: 1 });
    const current = buildUsageRow(usageBaseTotals, DEFAULT_USAGE_RATES);
    expect(old.rates.usdPer1MInputTokens).toBe(1);
    expect(current.rates.usdPer1MInputTokens).toBe(2.5);
    expect(old.estimatedCostUsd).not.toBe(current.estimatedCostUsd);
  });

  test('carries the sessionId and cumulative counters needed to group across sessions', () => {
    const row = buildUsageRow(usageBaseTotals);
    expect(row.sessionId).toBe('sess-abc');
    expect(row.segments).toBe(1);
    expect(row.audioTokens).toBe(140);
    expect(row.wallClockMs).toBe(4_200);
    expect(row.variants).toEqual(['tokens']);
  });

  test('the LAST row for a session is that session’s total (rows carry running totals)', () => {
    // Simulates appending per usage event: a mid-session crash still leaves
    // everything up to the last row on disk, and no summing across rows is needed.
    const rows = [1, 2, 3].map((n) =>
      buildUsageRow({ ...usageBaseTotals, segments: n, audioTokens: 140 * n, inputTokens: 141 * n }),
    );
    const last = rows[rows.length - 1];
    expect(last.segments).toBe(3);
    expect(last.audioTokens).toBe(420);
    // Grouping by sessionId and taking the last row is the whole query model.
    expect(new Set(rows.map((r) => r.sessionId)).size).toBe(1);
  });
});

describe('parseUsageTotals — the browser→server boundary', () => {
  test('accepts a well-formed totals payload', () => {
    expect(parseUsageTotals({ ...usageBaseTotals })).toEqual(usageBaseTotals);
  });

  test.each([
    ['null', null],
    ['an array', []],
    ['a string', 'sess-abc'],
    ['no sessionId', { segments: 3 }],
    ['an empty sessionId', { sessionId: '' }],
    ['a non-string sessionId', { sessionId: 42 }],
  ])('rejects %s rather than journaling an unqueryable row', (_label, raw) => {
    expect(parseUsageTotals(raw)).toBeNull();
  });

  test('coerces junk numerics to unreported instead of trusting the annotation', () => {
    const parsed = parseUsageTotals({
      sessionId: 'sess-x',
      segments: 'three',
      audioTokens: '140',
      inputTokens: Number.NaN,
      audioSeconds: 12,
      wallClockMs: null,
      variants: ['duration', 7, null],
    });
    expect(parsed).toEqual({
      sessionId: 'sess-x',
      segments: 0,
      audioTokens: null,
      textTokens: null,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      audioSeconds: 12,
      wallClockMs: 0,
      variants: ['duration'],
    });
  });
});

describe('usageRowToJsonl', () => {
  test('emits exactly one newline-terminated JSON object, so appends stay greppable', () => {
    const line = usageRowToJsonl(buildUsageRow(usageBaseTotals, DEFAULT_USAGE_RATES, '2026-07-25T12:00:00.000Z'));
    expect(line.endsWith('\n')).toBe(true);
    expect(line.trimEnd().includes('\n')).toBe(false);
    expect(JSON.parse(line)).toMatchObject({ sessionId: 'sess-abc', costBasis: 'tokens' });
  });
});
