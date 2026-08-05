import { describe, expect, test, vi } from 'vitest';
import { parseSegmentUsage } from '@surface-voice-triage/voice';
import type { VoiceCaptureEvent, VoiceUsageTotals } from '@surface-voice-triage/voice';
import { createUsageSink } from './usage-sink.js';
import { buildUsageRow, parseUsageTotals } from './server/usage-journal.js';

/**
 * Tests for the client sink that carries voice usage to the journal.
 *
 * The two properties that matter: rows are posted PER usage event (not once at
 * session end, which a closed tab would lose), and the sink can never affect
 * capture — a dead journal costs the measurement, not the mic.
 */

function usageSinkEvent(sessionId: string, t: number, audioTokens: number): VoiceCaptureEvent {
  const usage = parseSegmentUsage({
    type: 'tokens',
    input_tokens: audioTokens + 1,
    output_tokens: 9,
    total_tokens: audioTokens + 10,
    input_token_details: { audio_tokens: audioTokens, text_tokens: 1 },
  });
  if (!usage) throw new Error('fixture did not parse');
  return { kind: 'usage', t, sessionId, usage };
}

function usageSinkHarness() {
  const posted: VoiceUsageTotals[] = [];
  const sink = createUsageSink({ post: (totals) => void posted.push(totals) });
  return { posted, sink };
}

describe('createUsageSink', () => {
  test('posts a row per usage event, each carrying the running total', () => {
    const { posted, sink } = usageSinkHarness();
    sink.onEvent(usageSinkEvent('sess-1', 1_000, 100));
    sink.onEvent(usageSinkEvent('sess-1', 2_000, 50));

    expect(posted).toHaveLength(2);
    expect(posted[0].audioTokens).toBe(100);
    expect(posted[1].audioTokens).toBe(150); // cumulative — last row is the total
    expect(posted[1].segments).toBe(2);
  });

  test('non-usage events post nothing but still advance the session wall clock', () => {
    const { posted, sink } = usageSinkHarness();
    sink.onEvent({ kind: 'speech-started', t: 1_000, pendingDepth: 1 });
    sink.onEvent({ kind: 'partial', t: 1_500, textLength: 4 });
    sink.onEvent({ kind: 'speech-stopped', t: 2_000 });
    expect(posted).toHaveLength(0);

    sink.onEvent(usageSinkEvent('sess-1', 3_000, 80));
    expect(posted).toHaveLength(1);
    expect(posted[0].wallClockMs).toBe(2_000); // 1_000 → 3_000
  });

  test('a reconnect posts against the NEW session rather than merging spend', () => {
    const { posted, sink } = usageSinkHarness();
    sink.onEvent(usageSinkEvent('sess-1', 1_000, 100));
    sink.onEvent(usageSinkEvent('sess-2', 90_000, 30));

    expect(posted.map((p) => p.sessionId)).toEqual(['sess-1', 'sess-2']);
    expect(posted[1].audioTokens).toBe(30);
  });

  test('a rejecting journal is reported but never thrown into the capture path', () => {
    const onError = vi.fn();
    const sink = createUsageSink({
      post: () => {
        throw new Error('journal down');
      },
      onError,
    });
    expect(() => sink.onEvent(usageSinkEvent('sess-1', 1_000, 100))).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
    // Totals keep accumulating so a later successful post still carries the spend.
    expect(sink.totals().audioTokens).toBe(100);
  });

  test('an async post rejection is caught, not left as an unhandled rejection', async () => {
    const onError = vi.fn();
    const sink = createUsageSink({ post: async () => Promise.reject(new Error('502')), onError });
    sink.onEvent(usageSinkEvent('sess-1', 1_000, 100));
    // Drain the microtask queue the fire-and-forget chain resolves on.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onError).toHaveBeenCalledTimes(1);
  });

  test('what the sink posts is what the journal accepts — the real producer/consumer pair', () => {
    // Contract check across the browser→server boundary: run the sink's actual
    // payload through the server's actual validator and row builder, rather than
    // paraphrasing either side in a fixture.
    const { posted, sink } = usageSinkHarness();
    sink.onEvent(usageSinkEvent('sess-1', 1_000, 140));

    const totals = parseUsageTotals(JSON.parse(JSON.stringify(posted[0])));
    expect(totals).not.toBeNull();
    const row = buildUsageRow(totals!);
    expect(row.sessionId).toBe('sess-1');
    expect(row.audioTokens).toBe(140);
    expect(row.costBasis).toBe('tokens');
    expect(row.estimatedCostUsd).toBeGreaterThan(0);
  });
});
