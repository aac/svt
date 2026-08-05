/**
 * Shared types for the voice library.
 *
 * Design brief: v0 voice is dumb — transcription only. No intent classification,
 * no item-context injection into the STT session. Raw transcripts out.
 */

/** Connection state of the voice session. */
export type VoiceState =
  | { kind: 'idle' }
  | { kind: 'connecting' }
  | { kind: 'live'; model: string }
  | { kind: 'error'; message: string }
  /**
   * The browser can't capture voice at all: getUserMedia / RTCPeerConnection are
   * absent because the page isn't a secure context (HTTPS or localhost). A plain
   * HTTP LAN URL on a phone lands here. Distinct from `error` (a session that
   * tried and failed): here there is nothing to try, so consumers should present
   * a clear "unavailable" message rather than a control that fails obscurely.
   */
  | { kind: 'unavailable'; reason: string };

/**
 * Payload emitted for a finalised speech segment.
 *
 * correlationId comes from setCorrelationId() — the cross-library coupling
 * primitive that stamps each transcript with whichever item was focused at
 * the time of utterance.
 */
export interface FinalTranscript {
  text: string;
  sessionId: string;
  correlationId: string | null;
  t: number;
}

/**
 * The shared result shape every voice engine hook returns.
 *
 * This is the ENGINE CONTRACT extracted from the diff of the two concrete hooks
 * (`useVoiceCapture` — OpenAI Realtime; `useWebSpeechCapture` — Web Speech API).
 * Both hooks return this exact surface, so a consumer (mounts.tsx /
 * VoiceIndicator) treats the engines interchangeably. The contract is the
 * result + correlation + lifecycle-method surface — NOT the auth/transport
 * surface: `tokenProvider` and the WebRTC deps seam are OpenAI-engine config,
 * not part of this contract (the first extraction discovery — the Web Speech
 * hook has neither).
 *
 * `UseVoiceCaptureResult` is preserved as a public alias of this type (the
 * OpenAI hook's original name), so existing consumers keep compiling.
 */
export interface VoiceEngineResult {
  state: VoiceState;
  /** Current in-progress transcript fragment (replaces as new interim text arrives). */
  partial: string;
  /**
   * True while an utterance is being captured — set at speech ONSET, cleared when
   * the segment ends. Engines that surface a pre-text onset signal (OpenAI's VAD
   * `speech_started`) fire this ahead of the first transcript text, so consumers
   * can show an immediate "capturing" cue instead of waiting for (laggy) partials.
   */
  speechActive: boolean;
  /** Completed transcript segments (appends on each final). */
  finals: string[];
  /** Convenience: finals.join(' ') + (' ' + partial). */
  transcript: string;
  /** Start the session. */
  connect: () => Promise<void>;
  /** Tear down the session and release the mic. */
  disconnect: () => void;
  /** Reset finals/partial buffer (call on item navigation). */
  clearTranscript: () => void;
  /**
   * Set the correlation ID stamped on outbound FinalTranscript payloads.
   * Cockpit calls this on focus change. Null means no item is focused.
   */
  setCorrelationId: (id: string | null) => void;
  /**
   * Push the current partial as a final segment, clearing the partial.
   * Push-to-talk fallback for consumers who don't want server VAD latency.
   */
  forceFinalize: () => void;
}

/**
 * Normalised per-segment audio usage, parsed off the Realtime
 * `...input_audio_transcription.completed` event's `usage` field.
 *
 * Every numeric field is `number | null` on purpose: `null` means THE WIRE DID NOT
 * REPORT IT, which is a different fact from zero. A consumer computing cost must
 * not treat an unreported audio duration as "$0.00 spent".
 *
 * `variant` records which of the two documented `usage` shapes the payload matched
 * — `tokens` (what token-billed models like `gpt-4o-transcribe` return) or
 * `duration` (duration-billed models like `whisper-1`). `declaredType` preserves
 * the raw `type` string the wire actually sent, including an unrecognised one, so
 * a shape drift shows up in the journal instead of being silently normalised away.
 *
 * See `parseSegmentUsage` in `usage-accumulator.ts` for the exact assumed shape,
 * its provenance, and the (deliberate) defensiveness.
 */
export interface SegmentUsage {
  variant: 'tokens' | 'duration';
  /** Raw `usage.type` as sent, or null if absent. May differ from `variant`. */
  declaredType: string | null;
  /** Billed audio seconds (duration variant). */
  audioSeconds: number | null;
  audioTokens: number | null;
  textTokens: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

/**
 * Structured capture-lifecycle event, emitted by `useVoiceCapture` via the optional
 * `onEvent` callback. This is the DROP-VISIBILITY instrument: it makes
 * segment boundaries, empty finals (silent drops), and FIFO desync observable live
 * without baking console noise into the library. A consumer wires
 * `onEvent: (e) => console.log(e)` (or filters to `kind === 'final' && e.empty`) to
 * watch drops happen during a real pass. Purely observational — it changes no
 * behavior and inspects no transcript content (voice stays dumb).
 *
 * The `t` field is a client `Date.now()` timestamp; gaps between a `speech-stopped`
 * and the next `speech-started` reveal the thinking pauses that aggressive VAD would
 * cut. `empty: true` on a `final` is a segment STT returned no text for — a drop.
 */
export type VoiceCaptureEvent =
  /** VAD onset. `pendingDepth` is the onset FIFO depth after enqueue. */
  | { kind: 'speech-started'; t: number; pendingDepth: number }
  /** VAD offset — the segment will finalize shortly. */
  | { kind: 'speech-stopped'; t: number }
  /** A non-empty transcription delta arrived (interim text growing). */
  | { kind: 'partial'; t: number; textLength: number }
  /**
   * A segment completed. `empty: true` means STT returned no text — a DROP (the
   * cut fragment was unresolvable). `pendingDepth` is the FIFO depth after dequeue.
   */
  | { kind: 'final'; t: number; empty: boolean; textLength: number; correlationId: string | null; pendingDepth: number }
  /**
   * The onset FIFO exceeded its ceiling and shed a stale anchor — a desync signal
   * (an onset never got its completion). `droppedAnchors` is the session total.
   */
  | { kind: 'desync'; t: number; droppedAnchors: number; pendingDepth: number }
  /** forceFinalize() pushed the in-progress partial as a final (push-to-talk). */
  | { kind: 'force-finalize'; t: number; empty: boolean; correlationId: string | null }
  /**
   * COST/USAGE INSTRUMENT. Fires immediately after the `final` for a
   * segment, but ONLY when the completed event actually carried a parseable
   * `usage` payload — so "the wire reported nothing" is observable as the absence
   * of these events rather than a null field smeared across every `final`.
   *
   * `sessionId` rides here (the other kinds carry none) because a usage row is
   * only meaningful attributed to a session, and a reconnect mints a new id — the
   * accumulator uses it to refuse to merge two sessions' spend into one total.
   *
   * Purely observational, same as the drop instrument: emitting it changes no
   * transcript behaviour, and a throwing observer cannot take down capture.
   */
  | { kind: 'usage'; t: number; sessionId: string; usage: SegmentUsage };

/**
 * Ephemeral token returned by the consumer's tokenProvider.
 * The server-side helper (makeTranscriptionTokenHandler) produces this shape.
 */
export interface TokenResponse {
  clientSecret: string;
  expiresAt: number;
  model: string;
}

/**
 * Auth contract: the consumer provides a callback that mints ephemeral tokens.
 * The library never holds API keys.
 *
 * @returns Promise resolving to { clientSecret, expiresAt, model }
 */
export type TokenProvider = () => Promise<TokenResponse>;

/**
 * Compose-time static capability declaration for a voice engine.
 *
 * The managing agent reads this when writing a manifest to pick an interaction
 * mode — there is no runtime negotiation or plugin handshake (design note
 * Decisions.3). Kept deliberately minimal; the load-bearing axis is the
 * streaming-partials + onset profile, NOT a flag matrix.
 *
 * NOTE: there is intentionally no `interactionModes` field. Hands-free vs
 * push-to-talk is *derived* from `streamingPartials` (hands-free is available
 * iff `streamingPartials`; push-to-talk is available for any engine), so storing
 * a derived list would be a drift-prone duplicate (design-review SHOULD-FIX 5).
 *
 * The `EngineCapabilities` *type* and the two concrete declarations
 * (`webSpeechCapabilities`, `openAiCapabilities`) are the source of truth the
 * LIBRARY.md must cite rather than paraphrase.
 */
export interface EngineCapabilities {
  /** Stable engine id, used in manifests/docs and as `VoiceState.live.model`. */
  engine: 'openai-realtime' | 'web-speech';
  /**
   * Interim results stream before the final — the correctness-load-bearing input
   * to the correlator's onset-anchoring. This is the gate for hands-free.
   */
  streamingPartials: boolean;
  /**
   * A speech-onset anchor EARLIER THAN THE TRANSCRIPT (pre-text VAD).
   * OpenAI: true (input_audio_buffer.speech_started). Web Speech: false — its
   * earliest per-segment anchor is the first interim result (downstream of STT),
   * which still beats finalization but is not pre-text. A latency refinement, NOT
   * the gate for hands-free.
   */
  preTextOnset: boolean;
  /**
   * Requires a server token broker (auth is engine config, not shared contract).
   * OpenAI: true; Web Speech: false.
   */
  serverAuth: boolean;
  /**
   * Where audio goes — drives the privacy caveat the docs must state.
   * `cloud-keyless` (Web Speech on Chromium) is NOT local/private: audio is sent
   * to a remote server (Google on Chrome, Apple on Safari).
   */
  privacy: 'cloud-keyed' | 'cloud-keyless';
}
