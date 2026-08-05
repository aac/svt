/**
 * @surface-voice-triage/voice
 *
 * Headless voice-capture library — wraps OpenAI Realtime transcription.
 *
 * Browser exports:
 *   useVoiceCapture  — headless hook
 *   VoiceIndicator   — optional presentational button
 *
 * Server exports (import from '@surface-voice-triage/voice/server'):
 *   makeTranscriptionBroker     — factory wired to OpenAI SDK
 *   RealtimeTranscriptionBroker — class for custom mint fns (tests)
 *   TranscriptionMintFn         — type for the mint boundary
 */

export { useVoiceCapture, openAiCapabilities } from './useVoiceCapture.js';
export { VoiceIndicator } from './VoiceIndicator.js';
export type {
  UseVoiceCaptureOptions,
  UseVoiceCaptureResult,
  UseVoiceCaptureDeps,
} from './useVoiceCapture.js';
// Web Speech API engine — sibling of useVoiceCapture, identical result shape.
// Shares SegmentCorrelator + types.ts; the OpenAI hook stays the untouched default.
export {
  useWebSpeechCapture,
  webSpeechCapabilities,
} from './useWebSpeechCapture.js';
export type {
  UseWebSpeechCaptureOptions,
  UseWebSpeechCaptureDeps,
} from './useWebSpeechCapture.js';
export type {
  VoiceState,
  VoiceEngineResult,
  FinalTranscript,
  TokenProvider,
  TokenResponse,
  EngineCapabilities,
  VoiceCaptureEvent,
  SegmentUsage,
} from './types.js';
// Usage/cost accounting. Pure parse + fold; the library does NO I/O
// and holds NO pricing policy — persistence and dollars live in the consuming app.
export {
  parseSegmentUsage,
  foldVoiceUsage,
  accumulateVoiceUsage,
  emptyVoiceUsageTotals,
} from './usage-accumulator.js';
export type { VoiceUsageTotals } from './usage-accumulator.js';
// Secure-context capability probe: lets a consumer detect that voice can't run
// (plain-HTTP page, no getUserMedia/WebRTC) before rendering a control.
export {
  detectVoiceCapability,
  initialVoiceState,
  VOICE_UNAVAILABLE_REASON,
} from './capability.js';
export type { VoiceCapability, VoiceCapabilityEnv } from './capability.js';
// Web Speech capability probe (checks SpeechRecognition presence + secure context).
export {
  detectWebSpeechCapability,
  WEB_SPEECH_UNAVAILABLE_REASON,
} from './web-speech-capability.js';
export type { WebSpeechCapabilityEnv } from './web-speech-capability.js';
