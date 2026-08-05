import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  EngineCapabilities,
  FinalTranscript,
  TokenProvider,
  VoiceCaptureEvent,
  VoiceEngineResult,
  VoiceState,
} from './types.js';
import { SegmentCorrelator } from './segment-correlator.js';
import { parseSegmentUsage } from './usage-accumulator.js';
import { detectVoiceCapability, initialVoiceState, type VoiceCapability } from './capability.js';

/**
 * useVoiceCapture — headless hook for browser-side OpenAI Realtime transcription.
 *
 * Lifted from a consuming app's voice-transcription hook and generalised:
 * - tokenProvider replaces the hardcoded /api/realtime/transcription-token path.
 *   The consumer wires in their own token-minting backend.
 * - onFinal payload is now { text, sessionId, correlationId, t } instead of just text.
 * - setCorrelationId(id) is returned — the cross-library coupling primitive.
 *   Cockpit calls this whenever focused item changes. Works without cockpit too.
 * - forceFinalize() pushes the in-progress partial as a final segment (push-to-talk fallback).
 *
 * Voice is annotation, not command. This hook emits raw transcripts; reasoning
 * lives in the consuming agent's server-side endpoint.
 */

export interface UseVoiceCaptureOptions {
  tokenProvider: TokenProvider;
  onPartial?: (text: string) => void;
  onFinal?: (transcript: FinalTranscript) => void;
  /**
   * Optional capture-lifecycle observer. Called for every VAD/segment
   * event — onset, offset, partial, final (incl. EMPTY finals = silent drops), and
   * FIFO desync. Wire `onEvent: console.log` to watch drops happen live during a
   * pass. Purely observational: no behavior change, no transcript inspection.
   */
  onEvent?: (event: VoiceCaptureEvent) => void;
}

/**
 * The OpenAI hook returns the shared engine contract. The public NAME
 * `UseVoiceCaptureResult` is preserved — only its definition source moved to
 * `types.ts` (`VoiceEngineResult`) so both engine hooks share one contract type.
 */
export type UseVoiceCaptureResult = VoiceEngineResult;

/**
 * Static capability declaration for the OpenAI Realtime engine, read by the
 * managing agent at compose time (sibling of `webSpeechCapabilities`). This is a
 * NEW export next to the hook — it does not change the hook's behavior.
 *
 * `serverAuth: true` records the first extraction discovery: `tokenProvider` and
 * the `UseVoiceCaptureDeps` WebRTC seam below are OpenAI-ENGINE CONFIG, not part
 * of the shared `VoiceEngineResult` contract. The Web Speech hook has neither —
 * so auth/transport lives per-engine, while the result + correlation + lifecycle
 * surface is the shared contract.
 */
export const openAiCapabilities: EngineCapabilities = {
  engine: 'openai-realtime',
  streamingPartials: true, // transcription deltas stream before the completed final.
  preTextOnset: true, // input_audio_buffer.speech_started fires ahead of any transcript text.
  serverAuth: true, // requires a token broker (tokenProvider) — engine config, not shared contract.
  privacy: 'cloud-keyed', // audio goes to OpenAI under the consumer's key.
};

/**
 * Injectable dependencies — used in tests to avoid real WebRTC / fetch / mic.
 *
 * NOTE: this WebRTC seam (together with `UseVoiceCaptureOptions.tokenProvider`)
 * is OpenAI-engine config, NOT part of the shared `VoiceEngineResult` contract.
 * The Web Speech sibling has no server/token/WebRTC piece.
 */
export interface UseVoiceCaptureDeps {
  fetch?: typeof fetch;
  createPeerConnection?: () => RTCPeerConnection;
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  /** Test seam: called with the data channel once it's ready. */
  onDataChannelReady?: (dc: RTCDataChannel) => void;
}

// GA Realtime WebRTC SDP exchange. Beta used /v1/realtime?intent=transcription;
// GA moved the SDP offer/answer to POST /v1/realtime/calls.
// Session config (transcription, model, VAD) is baked into the ephemeral token,
// so no session params ride on this URL.
const REALTIME_CALLS_URL = 'https://api.openai.com/v1/realtime/calls';

export function useVoiceCapture(
  options: UseVoiceCaptureOptions,
  deps: UseVoiceCaptureDeps = {},
): UseVoiceCaptureResult {
  // Secure-context probe, up front. If the browser has no getUserMedia /
  // RTCPeerConnection (a plain-HTTP page — e.g. a phone on a LAN URL), voice
  // simply cannot run: degrade to a clear `unavailable` state rather than
  // presenting a control that fails obscurely. When both test seams are
  // injected, WebRTC is faked, so treat capability as present (no global probe).
  // Computed once and stashed so it stays stable across renders.
  const capabilityRef = useRef<VoiceCapability | null>(null);
  if (capabilityRef.current === null) {
    capabilityRef.current =
      deps.getUserMedia != null && deps.createPeerConnection != null
        ? { available: true }
        : detectVoiceCapability();
  }
  const capability = capabilityRef.current;

  const [state, setState] = useState<VoiceState>(() => initialVoiceState(capability));
  const [partial, setPartial] = useState<string>('');
  const [finals, setFinals] = useState<string[]>([]);
  const [speechActive, setSpeechActive] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);

  // Decides which correlationId each transcript segment carries. Stamps the
  // focus captured at the segment's first delta — NOT at completion — so a note
  // lands on the item the user was on when they started speaking it, even after
  // they've navigated past it. Mutable ref: focus/segment changes
  // never trigger a reconnect or re-render.
  const correlatorRef = useRef(new SegmentCorrelator());

  // Session ID is generated once per connect() call, stable for the session lifetime.
  const sessionIdRef = useRef<string>(crypto.randomUUID());

  // Stash the latest callbacks in refs so data-channel closures don't capture stale values.
  const onPartialRef = useRef(options.onPartial);
  const onFinalRef = useRef(options.onFinal);
  const onEventRef = useRef(options.onEvent);
  useEffect(() => {
    onPartialRef.current = options.onPartial;
  }, [options.onPartial]);
  useEffect(() => {
    onFinalRef.current = options.onFinal;
  }, [options.onFinal]);
  useEffect(() => {
    onEventRef.current = options.onEvent;
  }, [options.onEvent]);

  // Fire a lifecycle event to the observer, if one is wired. Never throws into the
  // data-channel handler: a broken observer must not take down capture.
  const emitEvent = useCallback((event: VoiceCaptureEvent) => {
    const fire = onEventRef.current;
    if (!fire) return;
    try {
      fire(event);
    } catch {
      /* observer must not break capture */
    }
  }, []);

  const tokenProvider = options.tokenProvider;

  const fetchImpl = deps.fetch ?? (typeof window !== 'undefined' ? window.fetch : fetch);
  const createPeerImpl =
    deps.createPeerConnection ??
    (() => new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }));
  const getMediaImpl =
    deps.getUserMedia ??
    ((constraints: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(constraints));
  const onDataChannelReady = deps.onDataChannelReady;

  const setCorrelationId = useCallback((id: string | null) => {
    correlatorRef.current.setCorrelation(id);
  }, []);

  const forceFinalize = useCallback(() => {
    setPartial((prev) => {
      if (prev.length === 0) return prev;
      const text = prev;
      setFinals((f) => [...f, text]);
      // Stamp the segment's start-focus, matching the completed path.
      const correlationId = correlatorRef.current.completeSegment();
      emitEvent({ kind: 'force-finalize', t: Date.now(), empty: false, correlationId });
      const fire = onFinalRef.current;
      if (fire) {
        queueMicrotask(() =>
          fire({
            text,
            sessionId: sessionIdRef.current,
            correlationId,
            t: Date.now(),
          }),
        );
      }
      return '';
    });
  }, [emitEvent]);

  const disconnect = useCallback(() => {
    if (dcRef.current) {
      try {
        dcRef.current.close();
      } catch {
        /* already closed */
      }
      dcRef.current = null;
    }
    if (pcRef.current) {
      try {
        pcRef.current.close();
      } catch {
        /* already closed */
      }
      pcRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    // Drop any half-open segment; preserves the live focus for the next session.
    correlatorRef.current.reset();
    setSpeechActive(false);
    // Rest to the capability-appropriate state: idle when voice can run, else
    // back to unavailable (never silently promote a no-secure-context page to idle).
    setState(initialVoiceState(capability));
  }, [capability]);

  // Disconnect on unmount.
  useEffect(() => disconnect, [disconnect]);

  const clearTranscript = useCallback(() => {
    setPartial('');
    setFinals([]);
    setSpeechActive(false);
    // The in-progress segment is being discarded too; don't let its start-focus
    // leak onto the next utterance.
    correlatorRef.current.reset();
  }, []);

  const handleDataChannelMessage = useCallback((event: MessageEvent) => {
    let data: { type?: string; transcript?: string; delta?: string; usage?: unknown } | null = null;
    try {
      data = JSON.parse(event.data as string);
    } catch {
      return;
    }
    if (!data?.type) return;

    // OpenAI Realtime transcription session events.
    // Primary shapes:
    //   - input_audio_buffer.speech_started (VAD onset — the correlation anchor)
    //   - conversation.item.input_audio_transcription.delta { delta: string }
    //   - conversation.item.input_audio_transcription.completed { transcript: string }

    // VAD detected speech onset. This fires EARLIER than the first transcription
    // delta (the delta is downstream of STT processing), so anchoring correlation
    // here captures the focus while the user is much more likely still on the item
    // they're talking about — before they've pressed j/k.
    if (data.type === 'input_audio_buffer.speech_started') {
      const shed = correlatorRef.current.noteSpeechStarted();
      // A shed at onset means the FIFO desynced (an earlier onset never completed);
      // surface it so the mis-attribution risk is visible, not silent.
      if (shed) {
        emitEvent({
          kind: 'desync',
          t: Date.now(),
          droppedAnchors: correlatorRef.current.desyncDrops(),
          pendingDepth: correlatorRef.current.pendingDepth(),
        });
      }
      emitEvent({
        kind: 'speech-started',
        t: Date.now(),
        pendingDepth: correlatorRef.current.pendingDepth(),
      });
      setSpeechActive(true);
      return;
    }

    // VAD detected end of speech — the segment will finalize shortly. Clear the
    // active flag now so the "capturing" cue ends the moment the user stops, not
    // when the (later) transcript completes.
    if (data.type === 'input_audio_buffer.speech_stopped') {
      emitEvent({ kind: 'speech-stopped', t: Date.now() });
      setSpeechActive(false);
      return;
    }

    if (data.type.endsWith('input_audio_transcription.delta')) {
      const text = typeof data.delta === 'string' ? data.delta : '';
      if (text.length > 0) {
        // Fallback anchor: only captures focus if no speech_started opened this
        // segment. When an onset already anchored it, this is a no-op.
        correlatorRef.current.noteDelta();
        setPartial((prev) => {
          const next = prev + text;
          const fire = onPartialRef.current;
          if (fire) queueMicrotask(() => fire(next));
          return next;
        });
        emitEvent({ kind: 'partial', t: Date.now(), textLength: text.length });
      }
      return;
    }

    if (data.type.endsWith('input_audio_transcription.completed')) {
      const text = typeof data.transcript === 'string' ? data.transcript : '';
      // Close the segment ALWAYS — even an empty/silent completion — so the
      // correlator's FIFO stays aligned with VAD's speech_started↔completed
      // pairing and a silent segment can't leave a stale anchor that mis-attributes
      // the next real one. Stamp the focus captured at the segment's onset, not the
      // live focus (the user may have navigated while it finalized).
      const correlationId = correlatorRef.current.completeSegment();
      setPartial('');
      setSpeechActive(false);
      // Emit the final event ALWAYS — including empty completions. An empty final
      // is a SILENT DROP (STT resolved no text for the segment), and making it
      // visible here is the whole point of the drop-visibility instrument.
      emitEvent({
        kind: 'final',
        t: Date.now(),
        empty: text.length === 0,
        textLength: text.length,
        correlationId,
        pendingDepth: correlatorRef.current.pendingDepth(),
      });
      // COST/USAGE INSTRUMENT. The completed event is the only place
      // the data channel reports audio usage, so surface it here — after the
      // `final`, and only when a usage payload actually parsed. Absent/malformed
      // `usage` yields null and emits nothing; transcription is untouched either
      // way (parseSegmentUsage never throws, and emitEvent swallows observer
      // errors). Empty finals count too: a dropped segment still burnt audio.
      const usage = parseSegmentUsage(data.usage);
      if (usage) {
        emitEvent({ kind: 'usage', t: Date.now(), sessionId: sessionIdRef.current, usage });
      }
      if (text.length > 0) {
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
      }
      return;
    }

    if (data.type === 'error') {
      console.warn('[useVoiceCapture] data-channel error event:', data);
    }
  }, [emitEvent]);

  const connect = useCallback(async () => {
    // No secure context → nothing to connect to. Re-assert the unavailable state
    // (idempotent) instead of calling getUserMedia, which would throw obscurely.
    if (!capability.available) {
      setState({ kind: 'unavailable', reason: capability.reason });
      return;
    }
    if (state.kind === 'connecting' || state.kind === 'live') return;
    setState({ kind: 'connecting' });

    // Fresh session ID each connect; start with no half-open segment carried
    // over from a prior session (the live focus is preserved).
    sessionIdRef.current = crypto.randomUUID();
    correlatorRef.current.reset();
    setSpeechActive(false);

    try {
      const token = await tokenProvider();
      if (!token.clientSecret) {
        throw new Error('tokenProvider returned an empty clientSecret');
      }

      const stream = await getMediaImpl({ audio: true });
      streamRef.current = stream;

      const pc = createPeerImpl();
      pcRef.current = pc;

      // Transcription session: no audio response from OpenAI; voice-IN only.
      pc.ontrack = () => {
        // Defensive: ignore any unexpected audio track.
      };

      const [micTrack] = stream.getAudioTracks();
      if (!micTrack) throw new Error('microphone returned no audio track');
      pc.addTrack(micTrack, stream);

      // Data channel for transcript events. Must be created before the SDP offer.
      const dc = pc.createDataChannel('oai-events');
      dcRef.current = dc;
      dc.addEventListener('message', handleDataChannelMessage);
      onDataChannelReady?.(dc);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // The session config is baked into the ephemeral token — no query params.
      const sdpRes = await fetchImpl(REALTIME_CALLS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token.clientSecret}`,
          'Content-Type': 'application/sdp',
        },
        body: offer.sdp ?? '',
      });

      if (!sdpRes.ok) {
        const detail = await sdpRes.text().catch(() => sdpRes.statusText);
        throw new Error(`transcription SDP exchange failed (${sdpRes.status}): ${detail}`);
      }

      const answerSdp = await sdpRes.text();
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          setState({ kind: 'error', message: `peer ${pc.connectionState}` });
        }
      };

      setState({ kind: 'live', model: token.model });
    } catch (err) {
      disconnect();
      const message = err instanceof Error ? err.message : String(err);
      setState({ kind: 'error', message });
    }
  }, [
    capability,
    createPeerImpl,
    disconnect,
    fetchImpl,
    getMediaImpl,
    handleDataChannelMessage,
    onDataChannelReady,
    state.kind,
    tokenProvider,
  ]);

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
