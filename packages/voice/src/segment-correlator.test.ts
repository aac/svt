import { describe, expect, test } from 'vitest';
import { SegmentCorrelator } from './segment-correlator.js';

/**
 * Regression tests for boundary straddle + anchoring too late. A
 * transcript segment must be attributed to the item focused when the user STARTED
 * speaking it, not when the segment finalized. The anchor is OpenAI's VAD
 * `input_audio_buffer.speech_started` (noteSpeechStarted) — the earliest signal —
 * with the first delta (noteDelta) as a fallback when no onset preceded it.
 *
 * Scenarios mirror mis-attributions observed in the dogfood drains, expressed as
 * the event sequence the hook feeds the correlator:
 *   setCorrelation (focus change) / noteSpeechStarted (VAD onset) / noteDelta
 *   (first delta, fallback anchor) / completeSegment (the .completed resolves +
 *   dequeues it).
 */
describe('SegmentCorrelator', () => {
  // ── Anchor = speech onset ───────────────────────────────

  test('speech_started captures focus at onset, even if focus moves before any delta', () => {
    // The dominant live failure: user speaks about Bananas, then presses j; the
    // first STT delta arrives AFTER the move. Onset anchoring beats that lag.
    const c = new SegmentCorrelator();
    c.setCorrelation('fruit-02'); // Bananas focused, user begins speaking
    c.noteSpeechStarted(); //        VAD onset captures Bananas
    c.setCorrelation('fruit-03'); //  user presses j → Avocados
    c.noteDelta(); //                 first delta only arrives now — must NOT re-anchor
    expect(c.completeSegment()).toBe('fruit-02'); // note belongs to Bananas
  });

  test('onset anchor is not mutated by rapid focus changes mid-segment', () => {
    const c = new SegmentCorrelator();
    c.setCorrelation('fruit-06');
    c.noteSpeechStarted();
    c.setCorrelation('fruit-07');
    c.setCorrelation('fruit-08'); // multiple rapid j presses
    expect(c.completeSegment()).toBe('fruit-06');
  });

  // ── FIFO across overlapping run-on segments ──────────────────────────────────

  test('run-on split into two segments attributes each to its own onset, in order', () => {
    // A fast narration: VAD splits it, and segment 2 can start before segment 1's
    // transcript completes (STT lags). A single slot would clobber; the FIFO pairs
    // each completion with the focus its speech began under.
    const c = new SegmentCorrelator();
    c.setCorrelation('fruit-05'); // Mangoes
    c.noteSpeechStarted(); //        onset 1 → [fruit-05]
    c.setCorrelation('fruit-06'); //  navigated to Honeycrisp while still talking
    c.noteSpeechStarted(); //        onset 2 → [fruit-05, fruit-06]
    expect(c.completeSegment()).toBe('fruit-05'); // segment 1 finalizes
    expect(c.completeSegment()).toBe('fruit-06'); // segment 2 finalizes
  });

  test('consecutive non-overlapping segments are each attributed to their own start', () => {
    const c = new SegmentCorrelator();
    c.setCorrelation('fruit-05');
    c.noteSpeechStarted();
    expect(c.completeSegment()).toBe('fruit-05');

    c.setCorrelation('fruit-09');
    c.noteSpeechStarted();
    expect(c.completeSegment()).toBe('fruit-09');
  });

  // ── Fallback behaviour ───────────────────────────────────────────────────────

  test('first delta anchors when no speech_started preceded it', () => {
    const c = new SegmentCorrelator();
    c.setCorrelation('fruit-02');
    c.noteDelta(); //               no onset seen — delta is the fallback anchor
    c.noteDelta(); //               later deltas of the same segment don't re-anchor
    c.setCorrelation('fruit-03');
    expect(c.completeSegment()).toBe('fruit-02');
  });

  test('falls back to live focus when a segment completes with no onset or delta', () => {
    const c = new SegmentCorrelator();
    c.setCorrelation('fruit-07');
    expect(c.completeSegment()).toBe('fruit-07');
  });

  test('an empty/silent completion consumes its onset anchor (keeps the FIFO aligned)', () => {
    // The hook closes EVERY completed segment, even empty ones, so a silent
    // segment can't leave a stale anchor that mis-pairs the next real segment.
    const c = new SegmentCorrelator();
    c.setCorrelation('fruit-01');
    c.noteSpeechStarted(); //        onset for a segment that yields no transcript
    c.completeSegment(); //          empty completion dequeues fruit-01 (hook fires no onFinal)
    c.setCorrelation('fruit-04');
    c.noteSpeechStarted(); //        the next, real segment
    c.noteDelta();
    expect(c.completeSegment()).toBe('fruit-04'); // not the orphaned fruit-01
  });

  test('uncorrelated speech (no item focused) stamps null', () => {
    const c = new SegmentCorrelator();
    c.noteSpeechStarted();
    expect(c.completeSegment()).toBeNull();
  });

  test('reset clears queued segments (new session / clearTranscript)', () => {
    const c = new SegmentCorrelator();
    c.setCorrelation('fruit-02');
    c.noteSpeechStarted();
    c.reset();
    c.setCorrelation('fruit-08');
    expect(c.completeSegment()).toBe('fruit-08'); // falls back to live focus
  });

  // ── Desync guard (mis-attribution audit) ──────────────────────────
  //
  // The FIFO stays aligned only if every onset eventually gets a completion. Under
  // aggressive VAD cutting a short fragment can fail to emit a `completed`, orphaning
  // its onset at the head of the queue — and then EVERY later completion dequeues a
  // stale head, mis-attributing all subsequent notes (the idx-37 symptom). The guard
  // bounds this: a queue past MAX_PENDING (8) is desync, not real concurrency, so the
  // stale head is shed to keep later attribution close to correct.

  test('pendingDepth reflects queued-but-uncompleted onsets', () => {
    const c = new SegmentCorrelator();
    expect(c.pendingDepth()).toBe(0);
    c.noteSpeechStarted();
    c.noteSpeechStarted();
    expect(c.pendingDepth()).toBe(2);
    c.completeSegment();
    expect(c.pendingDepth()).toBe(1);
  });

  test('bounds unbounded desync: sheds the stale head past MAX_PENDING and counts it', () => {
    const c = new SegmentCorrelator();
    // 8 onsets whose completions never came (orphaned by dropped fragments).
    for (let i = 0; i < 8; i++) c.noteSpeechStarted();
    expect(c.pendingDepth()).toBe(8);
    expect(c.desyncDrops()).toBe(0);

    // The 9th onset would push depth to 9 — that's the desync signal. Guard sheds
    // the oldest stale anchor instead and reports the shed.
    const shed = c.noteSpeechStarted();
    expect(shed).toBe(true);
    expect(c.pendingDepth()).toBe(8);
    expect(c.desyncDrops()).toBe(1);
  });

  test('regression: without shedding, one orphaned onset mis-attributes every later note', () => {
    // Concretely demonstrate the poisoning the guard prevents. One orphaned onset
    // (no completion) followed by MAX_PENDING real, immediately-completed segments.
    // With the shed, the stale head is gone by the time the real segments complete,
    // so the last real segment attributes to ITS OWN onset — not one item stale.
    const c = new SegmentCorrelator();
    c.setCorrelation('orphan'); // a fragment STT dropped: onset, never completes
    c.noteSpeechStarted();

    // Fill exactly to the ceiling with real onsets (no completions yet), which
    // triggers the shed of the orphan on the last push.
    for (let i = 0; i < 8; i++) {
      c.setCorrelation(`real-${i}`);
      c.noteSpeechStarted();
    }
    expect(c.desyncDrops()).toBe(1); // the orphan was shed, not the real work

    // Now the 8 real segments complete in order → each gets its own onset focus.
    for (let i = 0; i < 8; i++) {
      expect(c.completeSegment()).toBe(`real-${i}`);
    }
  });

  test('reset clears the desync counter too (fresh slate per session)', () => {
    const c = new SegmentCorrelator();
    for (let i = 0; i < 9; i++) c.noteSpeechStarted();
    expect(c.desyncDrops()).toBe(1);
    c.reset();
    expect(c.pendingDepth()).toBe(0);
    expect(c.desyncDrops()).toBe(0);
  });
});
