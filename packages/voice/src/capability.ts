import type { VoiceState } from './types.js';

/**
 * Secure-context capability probe for voice capture.
 *
 * getUserMedia and RTCPeerConnection only exist in a *secure context* — HTTPS or
 * localhost. A phone opening a plain-HTTP LAN URL (`http://<lan-ip>:5173`) has
 * `navigator.mediaDevices === undefined`: the mic simply cannot work, and a UI
 * that presents a connect button there fails obscurely. This probe lets the hook
 * detect the condition up front and degrade to a clear `unavailable` state
 * instead (the secure-context requirement).
 */

/** Single user-facing reason string for the unavailable state. */
export const VOICE_UNAVAILABLE_REASON =
  'Voice unavailable — requires a secure (HTTPS) context. This page was opened over ' +
  'plain HTTP, so the browser exposes no microphone (getUserMedia / WebRTC) API. ' +
  'Open the hosted HTTPS surface (localhost is also exempt in dev).';

export type VoiceCapability =
  | { available: true }
  | { available: false; reason: string };

/**
 * The slice of browser globals the probe reads. Injectable so it can be unit
 * tested with a faked-absent `navigator.mediaDevices` (no real mic needed).
 */
export interface VoiceCapabilityEnv {
  navigator?: { mediaDevices?: { getUserMedia?: unknown } | undefined } | undefined;
  RTCPeerConnection?: unknown;
}

function readGlobalEnv(): VoiceCapabilityEnv {
  return {
    navigator: typeof navigator !== 'undefined' ? navigator : undefined,
    RTCPeerConnection:
      typeof RTCPeerConnection !== 'undefined' ? RTCPeerConnection : undefined,
  };
}

/**
 * Decide whether the browser can capture voice at all. Reads real globals by
 * default; pass an explicit env to test the absent-mediaDevices path.
 */
export function detectVoiceCapability(
  env: VoiceCapabilityEnv = readGlobalEnv(),
): VoiceCapability {
  const nav = env.navigator;
  const hasGetUserMedia =
    nav != null &&
    nav.mediaDevices != null &&
    typeof nav.mediaDevices.getUserMedia === 'function';
  const hasPeerConnection = typeof env.RTCPeerConnection === 'function';

  if (hasGetUserMedia && hasPeerConnection) return { available: true };
  return { available: false, reason: VOICE_UNAVAILABLE_REASON };
}

/** Map a capability to the hook's initial VoiceState. */
export function initialVoiceState(capability: VoiceCapability): VoiceState {
  return capability.available
    ? { kind: 'idle' }
    : { kind: 'unavailable', reason: capability.reason };
}
