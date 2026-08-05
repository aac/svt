import { useCallback, useEffect, useRef, useState } from 'react';
import type { EngineCapabilities, FinalTranscript, VoiceState } from './types.js';
import type { UseVoiceCaptureResult } from './useVoiceCapture.js';
import { SegmentCorrelator } from './segment-correlator.js';
import { initialVoiceState, type VoiceCapability } from './capability.js';
import { detectWebSpeechCapability } from './web-speech-capability.js';

/**
 * useWebSpeechCapture — headless hook for browser-side Web Speech API
 * transcription. The SIBLING of `useVoiceCapture` (OpenAI Realtime): it returns
 * the identical `UseVoiceCaptureResult` shape and shares the same
 * `SegmentCorrelator` and `types.ts`, so a consumer (mounts.tsx / VoiceIndicator)
 * treats the two engines interchangeably.
 *
 * The OpenAI hook stays the untouched default; this adds a second engine, it does
 * not modify the first (design note Decisions.6 — hard non-degradation gate).
 *
 * ── PRIVACY CAVEAT ──────────────────────────────────────────────────────────
 * Web Speech is keyless but NOT local/private. The browser streams microphone
 * audio to a remote server for recognition: **Google's servers on Chrome/Edge,
 * Apple's on Safari.** "No API key" does not mean "on-device." Consumers must
 * surface this to users (the demo does). See `webSpeechCapabilities.privacy`.
 *
 * ── ENGINE SCOPE ────────────────────────────────────────────────────────────
 * Hands-free narration works on Chromium (Chrome/Edge). Firefox has no
 * `SpeechRecognition` at all (→ `unavailable`). Safari exposes
 * `webkitSpeechRecognition` but its `interimResults` are unreliable, so the
 * onset-anchoring degrades; `webSpeechCapabilities` scopes "hands-free works" to
 * Chromium and the LIBRARY.md documents the Safari caveat.
 *
 * Voice is annotation, not command. Raw transcripts out; reasoning lives in the
 * consuming agent's endpoint (design brief non-goals).
 */

export interface UseWebSpeechCaptureOptions {
  // NO tokenProvider — Web Speech has no server piece (design note Decisions.2).
  /** BCP-47 language tag. Default 'en-US'. */
  lang?: string;
  onPartial?: (text: string) => void;
  onFinal?: (transcript: FinalTranscript) => void;
}

/**
 * Injectable dependencies — the test seam mirroring `useVoiceCapture`'s WebRTC
 * deps. Tests pass a `FakeSpeechRecognition` through `createRecognition`.
 */
export interface UseWebSpeechCaptureDeps {
  /**
   * Factory for a fresh `SpeechRecognition`. Defaults to
   * `new (window.SpeechRecognition ?? window.webkitSpeechRecognition)()`.
   * May return `undefined` (no constructor) — the hook degrades to `unavailable`
   * rather than throwing.
   */
  createRecognition?: () => SpeechRecognition | undefined;
}

/**
 * Static capability declaration read by the managing agent at compose time.
 * `engine` doubles as the single `VoiceState.live.model` string (one source, no
 * drift between §5.1 and §7).
 */
export const webSpeechCapabilities: EngineCapabilities = {
  engine: 'web-speech',
  streamingPartials: true, // interimResults → partials; satisfies the hands-free gate.
  preTextOnset: false, // earliest anchor is the first interim (STT-downstream), not pre-text VAD.
  serverAuth: false, // no token broker.
  privacy: 'cloud-keyless', // keyless, but audio still goes to Google (Chrome) / Apple (Safari).
};

export function useWebSpeechCapture(
  options: UseWebSpeechCaptureOptions = {},
  deps: UseWebSpeechCaptureDeps = {},
): UseVoiceCaptureResult {
  // Capability probe, up front. When a test injects `createRecognition`, treat
  // capability as present (the fake stands in for the constructor); otherwise
  // detect from real globals. Firefox (no SpeechRecognition) → unavailable, so
  // the default factory is never invoked to construct `undefined` and throw
  // (design-review MUST-FIX 1). Computed once and stashed so it stays stable.
  const capabilityRef = useRef<VoiceCapability | null>(null);
  if (capabilityRef.current === null) {
    capabilityRef.current =
      deps.createRecognition != null ? { available: true } : detectWebSpeechCapability();
  }
  const capability = capabilityRef.current;

  const [state, setState] = useState<VoiceState>(() => initialVoiceState(capability));
  const [partial, setPartial] = useState<string>('');
  const [finals, setFinals] = useState<string[]>([]);
  const [speechActive, setSpeechActive] = useState(false);

  // The live recognition instance. Recreated on every restart (auto-end → start()).
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  // Shared, unmodified. Focus captured at each segment onset; dequeued per final.
  const correlatorRef = useRef(new SegmentCorrelator());

  // One id per connect() — stable across ALL internal restarts (§5.1).
  const sessionIdRef = useRef<string>('');

  // true between connect() and disconnect(): distinguishes an auto-end (restart,
  // stay live) from an intentional stop (settle idle). Set false on error too.
  const shouldRestartRef = useRef(false);

  // ── Per-SpeechRecognition-INSTANCE anchor bookkeeping (§B). Reset on EVERY
  // start() because Web Speech's resultIndex namespace is per-instance: a restart
  // begins a fresh results array at index 0. The correlator's FIFO is NOT reset
  // across restart (session focus continuity persists) — only these counters.
  //   anchoredCount   — number of result slots we've enqueued an onset for.
  //   finalizedCount  — number of isFinal results we've dequeued.
  const anchoredCountRef = useRef(0);
  const finalizedCountRef = useRef(0);

  // Mirror of `partial` readable synchronously inside the (non-React) engine
  // handlers — needed for the half-open flush on auto-end.
  const partialRef = useRef('');
  const setPartialTracked = useCallback((next: string) => {
    partialRef.current = next;
    setPartial(next);
  }, []);

  const onPartialRef = useRef(options.onPartial);
  const onFinalRef = useRef(options.onFinal);
  useEffect(() => {
    onPartialRef.current = options.onPartial;
  }, [options.onPartial]);
  useEffect(() => {
    onFinalRef.current = options.onFinal;
  }, [options.onFinal]);

  const lang = options.lang ?? 'en-US';

  const createRecognitionImpl =
    deps.createRecognition ??
    (() => {
      const Ctor =
        typeof window !== 'undefined'
          ? (window.SpeechRecognition ?? window.webkitSpeechRecognition)
          : undefined;
      return Ctor ? new Ctor() : undefined;
    });

  const emitFinal = useCallback((text: string, correlationId: string | null) => {
    if (text.length === 0) return;
    setFinals((prev) => [...prev, text]);
    const fire = onFinalRef.current;
    if (fire) {
      const payload: FinalTranscript = {
        text,
        sessionId: sessionIdRef.current,
        correlationId,
        t: Date.now(),
      };
      queueMicrotask(() => fire(payload));
    }
  }, []);

  const setCorrelationId = useCallback((id: string | null) => {
    correlatorRef.current.setCorrelation(id);
  }, []);

  const forceFinalize = useCallback(() => {
    // Mirror the OpenAI hook: push the in-progress partial as a final, stamping
    // the segment's onset focus (its queued anchor). Push-to-talk fallback.
    const text = partialRef.current;
    if (text.length === 0) return;
    const correlationId = correlatorRef.current.completeSegment();
    finalizedCountRef.current += 1;
    setPartialTracked('');
    setSpeechActive(false);
    emitFinal(text, correlationId);
  }, [emitFinal, setPartialTracked]);

  // ── Core §B mapping: adapt Web Speech's coarse event stream onto the
  // correlator's noteSpeechStarted/completeSegment FIFO. SegmentCorrelator is
  // UNCHANGED; all adaptation lives here.
  const handleResult = useCallback(
    (event: SpeechRecognitionEvent) => {
      const results = event.results;
      const len = results.length;

      // Step 2 — reconcile on shrink. The spec permits a trailing interim to be
      // REMOVED (array shrinks) before it finalizes; only FINAL results are
      // promised stable. If that happens, an anchor we enqueued would outlive its
      // slot and mis-attribute the next segment (F2 overflow).
      //
      // T0 has NOT yet measured whether Chrome shrinks the array in continuous
      // mode. Per the design review's option (a): ship the shrink case as a LOUD
      // ASSERTION rather than adding a correlator method here. If a shrink
      // is ever observed in the wild this throws loudly (surfacing the T0
      // question) instead of silently mis-attributing. The final-count-keyed
      // dequeue below is removal-proof regardless.
      if (len < anchoredCountRef.current) {
        throw new Error(
          `[useWebSpeechCapture] results array shrank (anchored ${anchoredCountRef.current} → ` +
            `length ${len}). Web Speech removed an interim slot in continuous mode — a case ` +
            `T0 has not measured. The anchor-rollback path (the design review's option b) is not ` +
            `implemented here; failing loudly rather than risk a silent mis-attribution.`,
        );
      }

      // Step 1 — enqueue onset for newly-seen trailing slots. Each new slot index
      // captures the focus LIVE at the moment it first appears — the per-segment
      // onset the FIFO needs (one enqueue per slot). resultIndex-keyed, NOT
      // speechstart-keyed: a single speechstart can span multiple slots.
      for (let i = anchoredCountRef.current; i < len; i++) {
        correlatorRef.current.noteSpeechStarted();
      }
      anchoredCountRef.current = len;

      // Step 3 — dequeue on FINAL-COUNT INCREASE (not index-seen). Final results
      // are spec-guaranteed stable and ordered, so counting them is removal-proof:
      // each increment over finalizedCount dequeues exactly one anchor → 1:1 FIFO
      // alignment, however many finals share one speechstart. A slot that arrives
      // already-isFinal on first sight fires its enqueue (step 1) then its dequeue
      // here in the same handler pass.
      const finalTexts: string[] = [];
      for (let i = 0; i < len; i++) {
        if (results[i].isFinal) finalTexts.push(results[i][0].transcript);
      }
      while (finalizedCountRef.current < finalTexts.length) {
        const text = finalTexts[finalizedCountRef.current];
        const correlationId = correlatorRef.current.completeSegment();
        finalizedCountRef.current += 1;
        emitFinal(text, correlationId);
      }

      // Step 4 — interim (!isFinal) text drives `partial` only.
      let interim = '';
      for (let i = 0; i < len; i++) {
        if (!results[i].isFinal) interim += results[i][0].transcript;
      }
      setPartialTracked(interim);
      if (interim.length > 0) {
        const fire = onPartialRef.current;
        if (fire) queueMicrotask(() => fire(interim));
      }
    },
    [emitFinal, setPartialTracked],
  );

  const handleError = useCallback((event: SpeechRecognitionErrorEvent) => {
    const code = event.error;
    // Benign: no-speech is the ordinary silence timeout (onend restarts per
    // shouldRestart); `aborted` is our own disconnect()/abort() or a benign
    // interruption — never surfaced as an error.
    if (code === 'no-speech' || code === 'aborted') return;

    // Hard failures: surface as `error` AND stop the restart loop so it doesn't
    // spin against a permanently-broken condition.
    if (
      code === 'not-allowed' ||
      code === 'service-not-allowed' ||
      code === 'audio-capture' ||
      code === 'network'
    ) {
      shouldRestartRef.current = false;
      setState({ kind: 'error', message: `web-speech: ${code}` });
      return;
    }

    // Unknown/less-common codes: log, don't kill the session (benign default).
    console.warn('[useWebSpeechCapture] speech recognition error:', code);
  }, []);

  const startRecognition = useCallback(() => {
    const rec = createRecognitionImpl();
    // No constructor / injected factory returned undefined → degrade cleanly to
    // `unavailable` (NOT error), do not arm the restart loop, do not throw
    // (design-review MUST-FIX 1).
    if (rec == null) {
      shouldRestartRef.current = false;
      setState({
        kind: 'unavailable',
        reason: capability.available
          ? 'Voice unavailable — the Web Speech recognition factory returned nothing.'
          : (capability as { available: false; reason: string }).reason,
      });
      return;
    }
    recognitionRef.current = rec;
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;

    // Fresh per-instance anchor namespace: the new results array starts at 0.
    // Correlator FIFO is NOT reset — session focus continuity persists (§B / F1).
    anchoredCountRef.current = 0;
    finalizedCountRef.current = 0;

    rec.onstart = () => {
      // One static engine label; matches webSpeechCapabilities.engine (no drift).
      setState({ kind: 'live', model: webSpeechCapabilities.engine });
    };
    rec.onresult = handleResult;
    rec.onspeechstart = () => setSpeechActive(true);
    rec.onspeechend = () => setSpeechActive(false);
    rec.onerror = handleError;
    rec.onend = () => {
      recognitionRef.current = null;
      if (shouldRestartRef.current) {
        // AUTO-END (silence timeout). First the half-open flush (§5.1 / F1): if a
        // partial is still pending, emit it as a final through completeSegment()
        // — consuming its queued anchor — so a silence-truncated utterance is
        // attributed, not dropped. This drains the FIFO to zero un-dequeued
        // anchors before the next start() resets the counters.
        const pending = partialRef.current;
        if (pending.length > 0) {
          const correlationId = correlatorRef.current.completeSegment();
          finalizedCountRef.current += 1;
          setPartialTracked('');
          emitFinal(pending, correlationId);
        }
        setSpeechActive(false);
        // Re-arm on a fresh macrotask: an immediate start() in onend throws
        // InvalidStateError on Chrome (the instance is still tearing down).
        setTimeout(() => {
          if (shouldRestartRef.current) startRecognition();
        }, 0);
      } else {
        // INTENTIONAL stop (disconnect) or a hard error already set the state.
        // Never promote to idle here — disconnect owns the idle transition and an
        // error state must stick.
        setSpeechActive(false);
      }
    };

    try {
      rec.start();
    } catch (err) {
      // A clean instance should not throw; if it does, surface it rather than
      // spin. (InvalidStateError is prevented by the fresh-instance-per-start
      // design + the setTimeout re-arm.)
      shouldRestartRef.current = false;
      const message = err instanceof Error ? err.message : String(err);
      setState({ kind: 'error', message: `web-speech start failed: ${message}` });
    }
  }, [
    capability,
    createRecognitionImpl,
    emitFinal,
    handleError,
    handleResult,
    lang,
    setPartialTracked,
  ]);

  const connect = useCallback(async () => {
    if (!capability.available) {
      setState({ kind: 'unavailable', reason: capability.reason });
      return;
    }
    if (state.kind === 'connecting' || state.kind === 'live') return;
    setState({ kind: 'connecting' });

    // One id per connect, stable across restarts. Start with a clean correlator
    // (drop any half-open segment from a prior session; live focus is preserved
    // by the caller's next setCorrelationId).
    sessionIdRef.current = crypto.randomUUID();
    correlatorRef.current.reset();
    setSpeechActive(false);
    shouldRestartRef.current = true;
    startRecognition();
  }, [capability, startRecognition, state.kind]);

  const disconnect = useCallback(() => {
    // Intentional stop: no restart, no half-open flush (abort suppresses the
    // pending final). Drop any half-open segment and settle to the
    // capability-appropriate state (idle when voice can run, else unavailable).
    shouldRestartRef.current = false;
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    if (rec) {
      try {
        rec.abort();
      } catch {
        /* already stopped */
      }
    }
    correlatorRef.current.reset();
    anchoredCountRef.current = 0;
    finalizedCountRef.current = 0;
    setSpeechActive(false);
    setPartialTracked('');
    setState(initialVoiceState(capability));
  }, [capability, setPartialTracked]);

  // Disconnect on unmount.
  useEffect(() => disconnect, [disconnect]);

  const clearTranscript = useCallback(() => {
    setPartialTracked('');
    setFinals([]);
    setSpeechActive(false);
    // Discard the in-progress segment's start-focus so it doesn't leak onto the
    // next utterance. NOTE: the per-instance anchor counters are deliberately NOT
    // reset here — they track the running instance's (unchanged) results array,
    // and resetting them while that array persists would re-anchor already-seen
    // slots (double-enqueue). A final that lands for a slot cleared mid-flight
    // dequeues an empty FIFO → live-focus fallback, an acceptable best-effort for
    // a user-initiated discard.
    correlatorRef.current.reset();
  }, [setPartialTracked]);

  const transcript =
    finals.join(' ').trim() + (partial.length > 0 ? (finals.length > 0 ? ' ' : '') + partial : '');

  return {
    state,
    partial,
    speechActive,
    finals,
    transcript,
    connect,
    disconnect,
    clearTranscript,
    setCorrelationId,
    forceFinalize,
  };
}
