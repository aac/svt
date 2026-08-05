import type { VoiceCapability } from './capability.js';

/**
 * Capability probe for the Web Speech engine — the sibling of
 * `detectVoiceCapability` (which probes the OpenAI/WebRTC path).
 *
 * WHY A SEPARATE PROBE: `detectVoiceCapability` checks `getUserMedia` +
 * `RTCPeerConnection` — neither of which Web Speech uses. On Firefox (which HAS
 * getUserMedia + RTCPeerConnection but NO `SpeechRecognition`) that probe reports
 * available, and the hook would then construct `undefined` and throw on invocation
 * — exactly the obscure failure the `unavailable` state exists to prevent
 * (design-review MUST-FIX 1). So the Web Speech hook feeds its initial state from THIS
 * probe instead.
 *
 * Checks two things:
 *   1. A `SpeechRecognition` (or vendor-prefixed `webkitSpeechRecognition`)
 *      constructor is present.
 *   2. Secure context — the spec marks `SpeechRecognition` `[[SecureContext]]`.
 *
 * Reuses `VoiceCapability` and `initialVoiceState` from `capability.ts` (both are
 * engine-agnostic), so the resulting `VoiceState` slots into the same
 * idle/unavailable machinery the OpenAI hook already uses.
 *
 * Presence of `webkitSpeechRecognition` does NOT guarantee a working hands-free
 * experience: Safari exposes it but its `interimResults` are unreliable. This
 * probe reports `available` when a constructor exists (so the hook runs), and the
 * Chromium-scoped degradation is documented on `webSpeechCapabilities` and in
 * LIBRARY.md rather than blocked here (blocking would require brittle UA
 * sniffing).
 */

/** Single user-facing reason string for the Web Speech unavailable state. */
export const WEB_SPEECH_UNAVAILABLE_REASON =
  'Voice unavailable — this browser has no Web Speech API (SpeechRecognition), or ' +
  'the page is not a secure context. Web Speech transcription requires a Chromium ' +
  'browser (Chrome/Edge) served over HTTPS (localhost is exempt in dev). Firefox has ' +
  'no SpeechRecognition; Safari exposes it but its streaming partials are unreliable.';

/**
 * The slice of browser globals the probe reads. Injectable so it can be unit
 * tested without a real browser.
 */
export interface WebSpeechCapabilityEnv {
  SpeechRecognition?: unknown;
  webkitSpeechRecognition?: unknown;
  /**
   * `window.isSecureContext`. `undefined` in a non-browser/test env — treated as
   * "don't fail on this axis" so unit tests can probe presence alone. Only an
   * explicit `false` marks the context insecure.
   */
  isSecureContext?: boolean;
}

function readGlobalEnv(): WebSpeechCapabilityEnv {
  const g = globalThis as {
    SpeechRecognition?: unknown;
    webkitSpeechRecognition?: unknown;
    isSecureContext?: boolean;
  };
  return {
    SpeechRecognition: g.SpeechRecognition,
    webkitSpeechRecognition: g.webkitSpeechRecognition,
    isSecureContext: typeof g.isSecureContext === 'boolean' ? g.isSecureContext : undefined,
  };
}

/**
 * Decide whether the browser can run Web Speech transcription at all. Reads real
 * globals by default; pass an explicit env to test the absent-constructor path.
 */
export function detectWebSpeechCapability(
  env: WebSpeechCapabilityEnv = readGlobalEnv(),
): VoiceCapability {
  const hasCtor =
    typeof env.SpeechRecognition === 'function' ||
    typeof env.webkitSpeechRecognition === 'function';
  // Only an explicit `false` disqualifies; `undefined` (test/non-browser) passes.
  const secure = env.isSecureContext !== false;

  if (hasCtor && secure) return { available: true };
  return { available: false, reason: WEB_SPEECH_UNAVAILABLE_REASON };
}
