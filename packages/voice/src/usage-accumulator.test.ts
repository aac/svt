import { describe, expect, test } from 'vitest';
import {
  accumulateVoiceUsage,
  emptyVoiceUsageTotals,
  foldVoiceUsage,
  parseSegmentUsage,
} from './usage-accumulator.js';
import type { VoiceCaptureEvent } from './types.js';

/**
 * Tests for the voice usage instrument.
 *
 * ─── WHAT THESE TESTS DO AND DO NOT PROVE ───────────────────────────────────
 *
 * They prove the PARSER's and the ACCUMULATOR's behaviour on hand-built payloads:
 * the two documented `usage` variants, absent/malformed payloads, and the folding
 * arithmetic. Same style as segment-correlator.test.ts — events built by hand.
 *
 * They do NOT verify what OpenAI actually sends on the wire. Nothing here can: a
 * live payload needs a real mic session. The documented-shape fixtures below are
 * transcriptions of the OpenAI Realtime reference's
 * `ConversationItemInputAudioTranscriptionCompletedEvent.usage` (tokens variant /
 * duration variant), not observed traffic — so a green suite here means "the parser
 * handles the documented shape and degrades safely on anything else", NOT "the
 * shape is confirmed". The malformed cases are the load-bearing half, because they
 * are what actually protects transcription if the real shape differs.
 */

/** The tokens variant, exactly as the Realtime reference documents it. */
const usageTokensPayload = {
  type: 'tokens',
  input_tokens: 141,
  output_tokens: 9,
  total_tokens: 150,
  input_token_details: { audio_tokens: 140, text_tokens: 1 },
};

/** The duration variant (duration-billed models, e.g. whisper-1). */
const usageDurationPayload = { type: 'duration', seconds: 4.5 };

function usageEvent(sessionId: string, t: number, raw: unknown): VoiceCaptureEvent {
  const usage = parseSegmentUsage(raw);
  if (!usage) throw new Error('test fixture did not parse — fix the fixture, not the parser');
  return { kind: 'usage', t, sessionId, usage };
}

describe('parseSegmentUsage — documented shapes', () => {
  test('tokens variant maps every documented field', () => {
    expect(parseSegmentUsage(usageTokensPayload)).toEqual({
      variant: 'tokens',
      declaredType: 'tokens',
      audioSeconds: null,
      audioTokens: 140,
      textTokens: 1,
      inputTokens: 141,
      outputTokens: 9,
      totalTokens: 150,
    });
  });

  test('duration variant maps seconds and leaves token fields unreported', () => {
    expect(parseSegmentUsage(usageDurationPayload)).toEqual({
      variant: 'duration',
      declaredType: 'duration',
      audioSeconds: 4.5,
      audioTokens: null,
      textTokens: null,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
    });
  });

  test('a tokens payload with no input_token_details reports audioTokens as UNREPORTED, not zero', () => {
    // Absent and zero are different facts. Conflating them would let the journal
    // claim a segment burnt no audio when the wire simply did not break it out.
    const parsed = parseSegmentUsage({ type: 'tokens', input_tokens: 90, total_tokens: 95 });
    expect(parsed?.audioTokens).toBeNull();
    expect(parsed?.inputTokens).toBe(90);
  });
});

describe('parseSegmentUsage — defensive against a shape we could not verify', () => {
  test.each([
    ['absent', undefined],
    ['null', null],
    ['empty object', {}],
    ['array', [1, 2, 3]],
    ['a bare string', 'tokens'],
    ['a number', 42],
    ['tokens-typed but with no numbers at all', { type: 'tokens' }],
    ['duration-typed but seconds missing', { type: 'duration' }],
    ['string-valued token counts (wrong primitive)', { type: 'tokens', input_tokens: '141' }],
    ['NaN seconds', { type: 'duration', seconds: Number.NaN }],
    ['non-object input_token_details', { type: 'tokens', input_token_details: 'nope' }],
  ])('returns null for %s rather than throwing', (_label, raw) => {
    expect(() => parseSegmentUsage(raw)).not.toThrow();
    expect(parseSegmentUsage(raw)).toBeNull();
  });

  test('an UNRECOGNISED type still parses when the fields are usable, preserving the raw type', () => {
    // Shape drift must land in the journal as data, not be normalised into a lie.
    const parsed = parseSegmentUsage({ type: 'audio_seconds_v2', seconds: 12 });
    expect(parsed?.variant).toBe('duration');
    expect(parsed?.declaredType).toBe('audio_seconds_v2');
    expect(parsed?.audioSeconds).toBe(12);
  });

  test('a MISSING type is sniffed from the fields present', () => {
    expect(parseSegmentUsage({ input_token_details: { audio_tokens: 7 } })?.variant).toBe('tokens');
    expect(parseSegmentUsage({ seconds: 3 })?.variant).toBe('duration');
  });

  test('partial numeric junk does not poison the good fields', () => {
    const parsed = parseSegmentUsage({
      type: 'tokens',
      input_tokens: 100,
      output_tokens: null,
      total_tokens: Number.POSITIVE_INFINITY,
      input_token_details: { audio_tokens: 99, text_tokens: {} },
    });
    expect(parsed).toEqual({
      variant: 'tokens',
      declaredType: 'tokens',
      audioSeconds: null,
      audioTokens: 99,
      textTokens: null,
      inputTokens: 100,
      outputTokens: null,
      totalTokens: null,
    });
  });
});

describe('foldVoiceUsage — per-session totals', () => {
  test('running totals are cumulative, so the latest value IS the session so far', () => {
    const totals = accumulateVoiceUsage([
      usageEvent('sess-1', 1_000, usageTokensPayload),
      usageEvent('sess-1', 2_000, usageTokensPayload),
      usageEvent('sess-1', 3_500, usageTokensPayload),
    ]);
    expect(totals.sessionId).toBe('sess-1');
    expect(totals.segments).toBe(3);
    expect(totals.audioTokens).toBe(420);
    expect(totals.textTokens).toBe(3);
    expect(totals.totalTokens).toBe(450);
    expect(totals.variants).toEqual(['tokens']);
  });

  test('non-usage events advance the session wall clock but contribute no spend', () => {
    const totals = accumulateVoiceUsage([
      { kind: 'speech-started', t: 1_000, pendingDepth: 1 },
      { kind: 'partial', t: 1_400, textLength: 6 },
      { kind: 'speech-stopped', t: 2_000 },
      { kind: 'final', t: 2_200, empty: false, textLength: 22, correlationId: 'fruit-02', pendingDepth: 0 },
      usageEvent('sess-1', 2_250, usageTokensPayload),
      { kind: 'speech-started', t: 9_000, pendingDepth: 1 },
    ]);
    expect(totals.wallClockMs).toBe(8_000); // 1_000 → 9_000, spanning silence
    expect(totals.segments).toBe(1);
    expect(totals.audioTokens).toBe(140);
  });

  test('an EMPTY final still bills: a dropped segment burnt audio', () => {
    const totals = accumulateVoiceUsage([
      { kind: 'final', t: 500, empty: true, textLength: 0, correlationId: null, pendingDepth: 0 },
      usageEvent('sess-1', 510, usageTokensPayload),
    ]);
    expect(totals.audioTokens).toBe(140);
  });

  test('a reconnect (new sessionId) starts fresh instead of merging two sessions', () => {
    const totals = accumulateVoiceUsage([
      usageEvent('sess-1', 1_000, usageTokensPayload),
      usageEvent('sess-1', 2_000, usageTokensPayload),
      usageEvent('sess-2', 60_000, usageDurationPayload),
    ]);
    expect(totals.sessionId).toBe('sess-2');
    expect(totals.segments).toBe(1);
    expect(totals.audioTokens).toBeNull(); // sess-1's 280 must not leak in
    expect(totals.audioSeconds).toBe(4.5);
    expect(totals.wallClockMs).toBe(0);
    expect(totals.variants).toEqual(['duration']);
  });

  test('mixed variants across a session are both recorded', () => {
    const totals = accumulateVoiceUsage([
      usageEvent('sess-1', 1_000, usageTokensPayload),
      usageEvent('sess-1', 2_000, usageDurationPayload),
    ]);
    expect(totals.variants).toEqual(['tokens', 'duration']);
    expect(totals.audioTokens).toBe(140);
    expect(totals.audioSeconds).toBe(4.5);
  });

  test('empty totals mean UNREPORTED everywhere — a fresh session claims no spend', () => {
    expect(emptyVoiceUsageTotals.audioTokens).toBeNull();
    expect(emptyVoiceUsageTotals.audioSeconds).toBeNull();
    expect(emptyVoiceUsageTotals.segments).toBe(0);
  });

  test('the fold is pure — it never mutates the totals handed to it', () => {
    const before = { ...emptyVoiceUsageTotals };
    const after = foldVoiceUsage(before, usageEvent('sess-1', 1_000, usageTokensPayload));
    expect(before).toEqual(emptyVoiceUsageTotals);
    expect(after.audioTokens).toBe(140);
  });

  test('out-of-order timestamps clamp the wall clock to zero rather than going negative', () => {
    const totals = accumulateVoiceUsage([
      usageEvent('sess-1', 5_000, usageTokensPayload),
      usageEvent('sess-1', 1_000, usageTokensPayload),
    ]);
    expect(totals.wallClockMs).toBe(0);
  });
});
