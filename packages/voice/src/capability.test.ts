import { describe, expect, it } from 'vitest';
import {
  detectVoiceCapability,
  initialVoiceState,
  VOICE_UNAVAILABLE_REASON,
} from './capability.js';

/**
 * Graceful degradation for phone voice capture over plain HTTP.
 *
 * getUserMedia / RTCPeerConnection only exist in a secure context (HTTPS or
 * localhost). A phone on a plain-HTTP LAN URL has `navigator.mediaDevices ===
 * undefined`, so the hook must degrade to a clear `unavailable` state instead of
 * presenting a control that fails obscurely. These tests fake the absent globals
 * — no real mic — mirroring the injectable-deps pattern already used elsewhere.
 */
describe('detectVoiceCapability', () => {
  // A minimal "secure context" env: both capabilities present.
  const secureEnv = {
    navigator: { mediaDevices: { getUserMedia: () => Promise.resolve({}) } },
    RTCPeerConnection: function RTCPeerConnection() {},
  };

  it('reports available when getUserMedia and RTCPeerConnection both exist', () => {
    expect(detectVoiceCapability(secureEnv)).toEqual({ available: true });
  });

  it('reports unavailable when navigator.mediaDevices is absent (plain-HTTP phone)', () => {
    // The exact shape a phone on http://<lan-ip>:5173 sees.
    const cap = detectVoiceCapability({
      navigator: {},
      RTCPeerConnection: secureEnv.RTCPeerConnection,
    });
    expect(cap).toEqual({ available: false, reason: VOICE_UNAVAILABLE_REASON });
  });

  it('reports unavailable when navigator itself is absent', () => {
    const cap = detectVoiceCapability({ RTCPeerConnection: secureEnv.RTCPeerConnection });
    expect(cap.available).toBe(false);
  });

  it('reports unavailable when getUserMedia exists but RTCPeerConnection does not', () => {
    const cap = detectVoiceCapability({
      navigator: { mediaDevices: { getUserMedia: () => Promise.resolve({}) } },
      RTCPeerConnection: undefined,
    });
    expect(cap.available).toBe(false);
  });

  it('reports unavailable when mediaDevices exists but getUserMedia is not a function', () => {
    const cap = detectVoiceCapability({
      navigator: { mediaDevices: {} },
      RTCPeerConnection: secureEnv.RTCPeerConnection,
    });
    expect(cap.available).toBe(false);
  });
});

describe('initialVoiceState', () => {
  it('starts idle when voice is available', () => {
    expect(initialVoiceState({ available: true })).toEqual({ kind: 'idle' });
  });

  it('starts in the unavailable state (not idle, not error) when voice is unavailable', () => {
    const state = initialVoiceState({ available: false, reason: VOICE_UNAVAILABLE_REASON });
    expect(state).toEqual({ kind: 'unavailable', reason: VOICE_UNAVAILABLE_REASON });
  });
});
