// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useWebSpeechCapture, webSpeechCapabilities } from './useWebSpeechCapture.js';
import {
  detectWebSpeechCapability,
  WEB_SPEECH_UNAVAILABLE_REASON,
} from './web-speech-capability.js';
import { SegmentCorrelator } from './segment-correlator.js';
import type { FinalTranscript } from './types.js';

/**
 * Hook-level tests for the Web Speech engine. Today's voice tests are non-React
 * (pure class + fn); this file introduces the React hook-test infra
 * (@testing-library/react + happy-dom).
 *
 * The central discipline (agent-manual 09): a permissive fake tests a fiction, so
 * FakeSpeechRecognition ENFORCES the real API's constraints —
 *   - start() after start() with no intervening end throws InvalidStateError,
 *   - auto-`end` is emittable to drive the restart loop,
 *   - abort() suppresses any pending final,
 *   - it models Chrome's COARSE behavior: one speechstart can span multiple
 *     isFinal result slots (the FIFO-underflow hazard the mapping must survive).
 */

// ── Fake SpeechRecognition (models Chrome's real quirks) ─────────────────────

class FakeAlternative {
  readonly confidence = 1;
  constructor(public readonly transcript: string) {}
}

class FakeResult {
  readonly length = 1;
  readonly 0: FakeAlternative;
  constructor(transcript: string, public readonly isFinal: boolean) {
    this[0] = new FakeAlternative(transcript);
  }
  item() {
    return this[0];
  }
}

class FakeSpeechRecognition {
  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;

  onstart: ((ev: Event) => unknown) | null = null;
  onresult: ((ev: unknown) => unknown) | null = null;
  onspeechstart: ((ev: Event) => unknown) | null = null;
  onspeechend: ((ev: Event) => unknown) | null = null;
  onend: ((ev: Event) => unknown) | null = null;
  onerror: ((ev: unknown) => unknown) | null = null;

  private running = false;
  private slots: FakeResult[] = [];

  // ── The real API surface ──
  start(): void {
    // The load-bearing constraint: a second start() before an end throws. This
    // keeps the restart re-arm honest — a permissive fake would hide a
    // double-start bug.
    if (this.running) {
      throw new DOMException('recognition has already started', 'InvalidStateError');
    }
    this.running = true;
    this.slots = [];
    this.onstart?.(new Event('start'));
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.onend?.(new Event('end'));
  }

  abort(): void {
    // abort() suppresses any pending final: drop in-progress slots, end without
    // emitting a result.
    this.running = false;
    this.slots = [];
    this.onend?.(new Event('end'));
  }

  // ── Test-only emit helpers ──
  get isRunning(): boolean {
    return this.running;
  }

  emitResult(index: number, transcript: string, isFinal: boolean): void {
    if (!this.running) throw new Error('emitResult on a non-running recognition');
    this.slots[index] = new FakeResult(transcript, isFinal);
    // Present the full accumulated array each event (Chrome continuous mode).
    const results = this.slots.slice();
    this.onresult?.({ resultIndex: index, results });
  }

  emitSpeechStart(): void {
    this.onspeechstart?.(new Event('speechstart'));
  }

  emitSpeechEnd(): void {
    this.onspeechend?.(new Event('speechend'));
  }

  /** Auto-end (silence timeout) — drives the restart loop. */
  emitEnd(): void {
    this.running = false;
    this.onend?.(new Event('end'));
  }

  emitError(code: string): void {
    this.onerror?.({ error: code });
  }

  /**
   * Model a results-array SHRINK (a trailing interim removed before finalizing).
   * The spec permits this in continuous mode; T0 has not measured whether Chrome
   * does it. Used to prove the hook's loud assertion fires (the design review's option (a)).
   */
  emitShrinkTo(length: number): void {
    if (!this.running) throw new Error('emitShrinkTo on a non-running recognition');
    this.slots.length = length;
    const results = this.slots.slice();
    this.onresult?.({ resultIndex: Math.max(0, length - 1), results });
  }
}

/** A factory that records every instance it hands out, for the restart loop. */
function recordingFactory() {
  const instances: FakeSpeechRecognition[] = [];
  const createRecognition = () => {
    const rec = new FakeSpeechRecognition();
    instances.push(rec);
    return rec as unknown as SpeechRecognition;
  };
  return { instances, createRecognition };
}

/** Flush the queued microtasks (onFinal/onPartial) and the setTimeout(0) re-arm. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ── The naive mapping this design rejects — demonstrated RED ──────────────────

describe('the naive speechstart-keyed mapping mis-attributes (why resultIndex-keying is required)', () => {
  it('enqueue-once-per-speechstart, dequeue-per-final underflows to live focus on a run-on', () => {
    // agent-manual iterating rule: a regression guard is unproven until watched
    // fail against the exact bug. This replays the naive mapping (one enqueue at
    // speechstart, one dequeue per isFinal) and asserts it produces the WRONG
    // attribution — so the hook's correct mapping (below) is trusted only after
    // its counter-example is seen red.
    const c = new SegmentCorrelator();
    c.setCorrelation('A'); // user on A, begins speaking
    c.noteSpeechStarted(); // naive: the ONE onset for the whole talk-spurt → [A]
    c.setCorrelation('B'); // slot 1 was actually spoken under B…
    c.setCorrelation('C'); // …but focus has moved to C by the time finals arrive
    const first = c.completeSegment(); // final #1 → dequeues A
    const second = c.completeSegment(); // final #2 → FIFO empty → LIVE focus (C)

    expect(first).toBe('A');
    // The mis-attribution: the second phrase, spoken under B, lands on C.
    expect(second).toBe('C');
    expect(second).not.toBe('B'); // the correct answer the naive mapping CANNOT produce
  });
});

// ── Capability probe (MUST-FIX 1) ────────────────────────────────────────────

describe('detectWebSpeechCapability', () => {
  it('available when a SpeechRecognition constructor is present (secure)', () => {
    expect(
      detectWebSpeechCapability({ SpeechRecognition: function () {}, isSecureContext: true }),
    ).toEqual({ available: true });
  });

  it('available via the vendor-prefixed webkitSpeechRecognition', () => {
    expect(
      detectWebSpeechCapability({ webkitSpeechRecognition: function () {} }),
    ).toEqual({ available: true });
  });

  it('unavailable (NOT error) on Firefox — has no SpeechRecognition constructor', () => {
    // Firefox HAS getUserMedia + RTCPeerConnection (so detectVoiceCapability would
    // say available) but no SpeechRecognition — the exact gap MUST-FIX 1 closes.
    const cap = detectWebSpeechCapability({ SpeechRecognition: undefined });
    expect(cap).toEqual({ available: false, reason: WEB_SPEECH_UNAVAILABLE_REASON });
  });

  it('unavailable when the constructor exists but the context is insecure', () => {
    const cap = detectWebSpeechCapability({
      SpeechRecognition: function () {},
      isSecureContext: false,
    });
    expect(cap.available).toBe(false);
  });
});

describe('useWebSpeechCapture — capability wiring (MUST-FIX 1)', () => {
  it('starts unavailable (not error) when no SpeechRecognition global exists', () => {
    // happy-dom has no SpeechRecognition; with no injected factory the probe runs.
    const { result } = renderHook(() => useWebSpeechCapture());
    expect(result.current.state.kind).toBe('unavailable');
  });

  it('connect() on an unavailable browser stays unavailable and does not throw', async () => {
    const { result } = renderHook(() => useWebSpeechCapture());
    await act(async () => {
      await result.current.connect();
    });
    expect(result.current.state.kind).toBe('unavailable');
  });

  it('createRecognition returning undefined → unavailable, no throw, restart never arms', async () => {
    // Even with a factory injected (capability treated present), a factory that
    // yields undefined must degrade cleanly rather than `new undefined()`-throw.
    let calls = 0;
    const { result } = renderHook(() =>
      useWebSpeechCapture(
        {},
        {
          createRecognition: () => {
            calls += 1;
            return undefined;
          },
        },
      ),
    );
    await act(async () => {
      await result.current.connect();
    });
    await flush();
    expect(result.current.state.kind).toBe('unavailable');
    // Called exactly once — the restart loop never armed (no spin).
    expect(calls).toBe(1);
  });
});

// ── The §6 test matrix (7 cases) ─────────────────────────────────────────────

interface Harness {
  result: { current: ReturnType<typeof useWebSpeechCapture> };
  instances: FakeSpeechRecognition[];
  finals: FinalTranscript[];
  partials: string[];
}

async function mountLive(): Promise<Harness> {
  const { instances, createRecognition } = recordingFactory();
  const finals: FinalTranscript[] = [];
  const partials: string[] = [];
  const { result } = renderHook(() =>
    useWebSpeechCapture(
      {
        onFinal: (t) => finals.push(t),
        onPartial: (p) => partials.push(p),
      },
      { createRecognition },
    ),
  );
  await act(async () => {
    await result.current.connect();
  });
  await flush();
  return { result, instances, finals, partials };
}

describe('useWebSpeechCapture — §6 test matrix', () => {
  it('1. onset beats focus move — final is stamped with the onset focus, not the live focus', async () => {
    const h = await mountLive();
    const rec = h.instances[0];
    act(() => h.result.current.setCorrelationId('A'));
    act(() => rec.emitResult(0, 'bananas', false)); // interim anchors slot 0 under A
    act(() => h.result.current.setCorrelationId('B')); // user pressed j → B
    act(() => rec.emitResult(0, 'bananas are great', true)); // slot 0 finalizes
    await flush();

    expect(h.finals).toHaveLength(1);
    expect(h.finals[0].correlationId).toBe('A');
    expect(h.finals[0].text).toBe('bananas are great');
  });

  it('2. multi-final per speechstart — each final keeps its own onset focus, no underflow', async () => {
    // The regression guard for the §5.2 hazard (the naive mapping fails this above).
    const h = await mountLive();
    const rec = h.instances[0];
    act(() => h.result.current.setCorrelationId('A'));
    act(() => rec.emitSpeechStart()); // ONE speechstart spanning both phrases
    act(() => rec.emitResult(0, 'apple', false)); // slot 0 interim under A
    act(() => h.result.current.setCorrelationId('B'));
    act(() => rec.emitResult(1, 'banana', false)); // slot 1 interim under B
    act(() => h.result.current.setCorrelationId('C')); // focus moves on before finals
    act(() => rec.emitResult(0, 'apple', true)); // slot 0 finalizes
    act(() => rec.emitResult(1, 'banana', true)); // slot 1 finalizes
    await flush();

    expect(h.finals.map((f) => [f.text, f.correlationId])).toEqual([
      ['apple', 'A'],
      ['banana', 'B'], // NOT 'C' — the underflow the correct mapping prevents
    ]);
  });

  it('3. restart invisibility — auto-end keeps state live + one sessionId across restarts', async () => {
    const h = await mountLive();
    expect(h.result.current.state.kind).toBe('live');

    // Emit a final in instance 0 to capture its sessionId.
    const rec0 = h.instances[0];
    act(() => h.result.current.setCorrelationId('X'));
    act(() => rec0.emitResult(0, 'first', true));
    await flush();

    // Auto-end (silence) — must NOT flip state out of live, must restart.
    act(() => rec0.emitEnd());
    await flush();
    expect(h.result.current.state.kind).toBe('live'); // stayed live through the gap
    expect(h.instances).toHaveLength(2); // a fresh instance was started

    // Emit a final in instance 1 and compare sessionIds.
    const rec1 = h.instances[1];
    act(() => rec1.emitResult(0, 'second', true));
    await flush();

    expect(h.finals).toHaveLength(2);
    expect(h.finals[0].sessionId).toBe(h.finals[1].sessionId); // one connect = one session
  });

  it('4. half-open flush on auto-end — a pending partial is emitted, not dropped', async () => {
    const h = await mountLive();
    const rec = h.instances[0];
    act(() => h.result.current.setCorrelationId('Z'));
    act(() => rec.emitResult(0, 'unfinished thought', false)); // interim, never finalized
    expect(h.result.current.partial).toBe('unfinished thought');

    act(() => rec.emitEnd()); // silence truncates before isFinal
    await flush();

    // Flushed as a final through the same completeSegment path — attributed to Z.
    expect(h.finals).toHaveLength(1);
    expect(h.finals[0].text).toBe('unfinished thought');
    expect(h.finals[0].correlationId).toBe('Z');
    expect(h.result.current.partial).toBe('');

    // And the restart still keyed a fresh instance with realigned counters: a
    // brand-new segment attributes correctly (no underflow from the flush).
    const rec1 = h.instances[1];
    act(() => h.result.current.setCorrelationId('Z2'));
    act(() => rec1.emitResult(0, 'next', true));
    await flush();
    expect(h.finals[1].correlationId).toBe('Z2');
  });

  it('5. mic denied — not-allowed → error state, restart loop stopped', async () => {
    const h = await mountLive();
    const rec = h.instances[0];
    act(() => rec.emitError('not-allowed'));
    act(() => rec.emitEnd()); // error is followed by end
    await flush();

    expect(h.result.current.state.kind).toBe('error');
    // Restart loop stopped: no second instance despite the end.
    expect(h.instances).toHaveLength(1);
  });

  it('6. disconnect — abort() called, state idle, correlator reset, no restart', async () => {
    const h = await mountLive();
    const rec = h.instances[0];
    const abortSpy = vi.spyOn(rec, 'abort');
    act(() => h.result.current.disconnect());
    await flush();

    expect(abortSpy).toHaveBeenCalledOnce();
    expect(h.result.current.state.kind).toBe('idle');
    expect(h.instances).toHaveLength(1); // no restart after an intentional stop
  });

  it('7. composability without correlation — correlationId is null when never set', async () => {
    const h = await mountLive();
    const rec = h.instances[0];
    // No setCorrelationId call at all (voice-without-cockpit; worked example 3).
    act(() => rec.emitResult(0, 'standalone note', true));
    await flush();

    expect(h.finals).toHaveLength(1);
    expect(h.finals[0].correlationId).toBeNull();
  });
});

// ── Benign errors + fake faithfulness ────────────────────────────────────────

describe('useWebSpeechCapture — benign errors and fake faithfulness', () => {
  it('no-speech is benign — state stays live and the loop restarts', async () => {
    const h = await mountLive();
    const rec = h.instances[0];
    act(() => rec.emitError('no-speech'));
    act(() => rec.emitEnd());
    await flush();
    expect(h.result.current.state.kind).toBe('live');
    expect(h.instances.length).toBeGreaterThanOrEqual(2); // restarted
  });

  it('the fake refuses a double start() (InvalidStateError) — models the real constraint', () => {
    const rec = new FakeSpeechRecognition();
    rec.start();
    expect(() => rec.start()).toThrowError(/already started/);
  });

  it('array shrink fires a LOUD ASSERTION (design review option a — T0 has not measured it)', async () => {
    // The hook does NOT silently roll back (no correlator method here); it
    // throws so a real-world shrink surfaces the T0 question instead of a silent
    // mis-attribution. Two interims anchored (len 2), then the array shrinks to 1.
    const h = await mountLive();
    const rec = h.instances[0];
    act(() => h.result.current.setCorrelationId('A'));
    act(() => rec.emitResult(0, 'one', false));
    act(() => rec.emitResult(1, 'two', false)); // anchoredCount is now 2
    expect(() => rec.emitShrinkTo(1)).toThrowError(/results array shrank/);
  });

  it('the static engine label matches the capabilities engine id (no drift)', async () => {
    const h = await mountLive();
    const state = h.result.current.state;
    expect(state.kind).toBe('live');
    if (state.kind === 'live') {
      expect(state.model).toBe(webSpeechCapabilities.engine);
      expect(state.model).toBe('web-speech');
    }
  });
});
