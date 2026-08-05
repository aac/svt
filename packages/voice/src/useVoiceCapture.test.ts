// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useVoiceCapture } from './useVoiceCapture.js';
import type { UseVoiceCaptureDeps } from './useVoiceCapture.js';
import type { TokenResponse, VoiceCaptureEvent } from './types.js';

/**
 * Hook-level tests for the OpenAI Realtime engine's DROP-VISIBILITY instrument
 *. The bug: speech was dropped during a real pass with no way to see
 * it happen live. `onEvent` now surfaces every VAD/segment event — crucially, an
 * EMPTY `completed` (a segment STT resolved no text for = a silent drop) and a FIFO
 * desync shed. These tests drive the data channel with fakes and assert the events.
 *
 * The fakes model the real WebRTC surface the hook drives via its deps seam
 * (tokenProvider + createPeerConnection + getUserMedia + onDataChannelReady). The
 * data channel is a real EventTarget so the hook's addEventListener('message') path
 * fires exactly as in the browser — we assert on the boundary, not a proxy for it.
 */

// ── Fakes for the WebRTC surface ─────────────────────────────────────────────

class FakeDataChannel extends EventTarget {
  readyState = 'open';
  close() {
    this.readyState = 'closed';
  }
  /** Push an OpenAI Realtime event exactly as the browser delivers it. */
  emit(obj: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(obj) }));
  }
}

class FakeTrack {
  kind = 'audio';
  stop = vi.fn();
}

class FakeStream {
  private readonly track = new FakeTrack();
  getAudioTracks() {
    return [this.track as unknown as MediaStreamTrack];
  }
  getTracks() {
    return [this.track as unknown as MediaStreamTrack];
  }
}

class FakePeerConnection {
  connectionState = 'new';
  ontrack: ((ev: unknown) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  addTrack = vi.fn();
  close = vi.fn();
  constructor(private readonly dc: FakeDataChannel) {}
  createDataChannel() {
    return this.dc as unknown as RTCDataChannel;
  }
  async createOffer() {
    return { type: 'offer', sdp: 'offer-sdp' } as RTCSessionDescriptionInit;
  }
  async setLocalDescription() {
    /* no-op */
  }
  async setRemoteDescription() {
    /* no-op */
  }
}

const TOKEN: TokenResponse = {
  clientSecret: 'sec_ephemeral',
  expiresAt: 2_000_000_000,
  model: 'gpt-4o-transcribe',
};

interface Harness {
  dc: FakeDataChannel;
  events: VoiceCaptureEvent[];
  finals: string[];
  finalPayloads: { text: string; correlationId: string | null }[];
  deps: UseVoiceCaptureDeps;
  tokenProvider: () => Promise<TokenResponse>;
}

function makeHarness(): Harness {
  const dc = new FakeDataChannel();
  const events: VoiceCaptureEvent[] = [];
  const finals: string[] = [];
  const finalPayloads: { text: string; correlationId: string | null }[] = [];
  const okFetch = (async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => 'answer-sdp',
  })) as unknown as typeof fetch;
  const deps: UseVoiceCaptureDeps = {
    fetch: okFetch,
    getUserMedia: async () => new FakeStream() as unknown as MediaStream,
    createPeerConnection: () => new FakePeerConnection(dc) as unknown as RTCPeerConnection,
  };
  return {
    dc,
    events,
    finals,
    finalPayloads,
    deps,
    tokenProvider: async () => TOKEN,
  };
}

/** Mount the hook, run connect() to completion, and return the live result ref. */
async function mountConnected(h: Harness) {
  const rendered = renderHook(() =>
    useVoiceCapture(
      {
        tokenProvider: h.tokenProvider,
        onEvent: (e) => h.events.push(e),
        onFinal: (t) => {
          h.finals.push(t.text);
          h.finalPayloads.push({ text: t.text, correlationId: t.correlationId });
        },
      },
      h.deps,
    ),
  );
  await act(async () => {
    await rendered.result.current.connect();
  });
  return rendered;
}

const completed = (transcript: string) => ({
  type: 'conversation.item.input_audio_transcription.completed',
  transcript,
});
const delta = (d: string) => ({
  type: 'conversation.item.input_audio_transcription.delta',
  delta: d,
});
const SPEECH_STARTED = { type: 'input_audio_buffer.speech_started' };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useVoiceCapture onEvent (drop-visibility instrument)', () => {
  it('reaches the live state through the faked WebRTC connect path', async () => {
    const h = makeHarness();
    const { result } = await mountConnected(h);
    expect(result.current.state.kind).toBe('live');
  });

  it('flags an empty completion as a drop (final with empty: true, no onFinal)', async () => {
    const h = makeHarness();
    await mountConnected(h);

    act(() => h.dc.emit(SPEECH_STARTED));
    // STT resolves no text for the cut fragment — the silent-drop case.
    act(() => h.dc.emit(completed('')));

    const finalEvents = h.events.filter((e) => e.kind === 'final');
    expect(finalEvents).toHaveLength(1);
    expect(finalEvents[0]).toMatchObject({ kind: 'final', empty: true, textLength: 0 });
    // An empty final must NOT reach onFinal — it carries no words.
    expect(h.finals).toHaveLength(0);
  });

  it('a real utterance emits a non-empty final and reaches onFinal with its onset focus', async () => {
    const h = makeHarness();
    const { result } = await mountConnected(h);

    act(() => result.current.setCorrelationId('item-A'));
    act(() => h.dc.emit(SPEECH_STARTED));
    act(() => h.dc.emit(delta('hello ')));
    act(() => result.current.setCorrelationId('item-B')); // user navigates mid-utterance
    act(() => h.dc.emit(completed('hello there')));

    const finalEvents = h.events.filter((e) => e.kind === 'final');
    expect(finalEvents).toHaveLength(1);
    expect(finalEvents[0]).toMatchObject({ kind: 'final', empty: false, correlationId: 'item-A' });

    // onFinal fires on a microtask; flush it. Attribution stays on the onset item.
    await act(async () => {
      await Promise.resolve();
    });
    expect(h.finalPayloads).toEqual([{ text: 'hello there', correlationId: 'item-A' }]);
  });

  it('emits speech-started / partial / speech-stopped with FIFO depth', async () => {
    const h = makeHarness();
    await mountConnected(h);

    act(() => h.dc.emit(SPEECH_STARTED));
    act(() => h.dc.emit(delta('word')));
    act(() => h.dc.emit({ type: 'input_audio_buffer.speech_stopped' }));

    const kinds = h.events.map((e) => e.kind);
    expect(kinds).toEqual(['speech-started', 'partial', 'speech-stopped']);
    const started = h.events.find((e) => e.kind === 'speech-started');
    expect(started).toMatchObject({ kind: 'speech-started', pendingDepth: 1 });
  });

  it('surfaces a FIFO desync when onsets pile up without completions', async () => {
    const h = makeHarness();
    await mountConnected(h);

    // 9 onsets, none completing (dropped fragments) → the 9th trips the guard.
    for (let i = 0; i < 9; i++) act(() => h.dc.emit(SPEECH_STARTED));

    const desync = h.events.filter((e) => e.kind === 'desync');
    expect(desync).toHaveLength(1);
    expect(desync[0]).toMatchObject({ kind: 'desync', droppedAnchors: 1 });
  });

  it('an observer that throws never breaks capture', async () => {
    const h = makeHarness();
    const rendered = renderHook(() =>
      useVoiceCapture(
        {
          tokenProvider: h.tokenProvider,
          onEvent: () => {
            throw new Error('observer blew up');
          },
        },
        h.deps,
      ),
    );
    await act(async () => {
      await rendered.result.current.connect();
    });
    // Emitting an event must not throw out of the data-channel handler.
    expect(() => act(() => h.dc.emit(SPEECH_STARTED))).not.toThrow();
    expect(rendered.result.current.state.kind).toBe('live');
  });
});

// ── Usage/cost instrument ───────────────────────────────────────

/**
 * A `completed` event carrying the tokens-variant `usage` payload the OpenAI
 * Realtime reference documents. NOT observed traffic — see the provenance note in
 * usage-accumulator.ts. These tests assert the hook's plumbing (does the parsed
 * usage reach onEvent, and does an absent/garbage payload leave transcription
 * alone); they cannot confirm the live shape, which needs a real mic pass.
 */
const usageCompletedWithTokens = (transcript: string) => ({
  ...completed(transcript),
  usage: {
    type: 'tokens',
    input_tokens: 141,
    output_tokens: 9,
    total_tokens: 150,
    input_token_details: { audio_tokens: 140, text_tokens: 1 },
  },
});

describe('useVoiceCapture usage instrument', () => {
  it('emits a usage event after the final, carrying the session id and parsed usage', async () => {
    const h = makeHarness();
    await mountConnected(h);

    act(() => h.dc.emit(SPEECH_STARTED));
    act(() => h.dc.emit(usageCompletedWithTokens('hello there')));

    // Ordering matters: the final (transcript truth) precedes the usage row.
    expect(h.events.map((e) => e.kind)).toEqual(['speech-started', 'final', 'usage']);
    const usageEvents = h.events.filter((e) => e.kind === 'usage');
    expect(usageEvents).toHaveLength(1);
    const [ev] = usageEvents;
    expect(ev).toMatchObject({
      kind: 'usage',
      usage: { variant: 'tokens', audioTokens: 140, textTokens: 1, totalTokens: 150 },
    });
    // sessionId is a per-connect uuid; assert it's present and non-empty.
    expect(ev.kind === 'usage' && ev.sessionId.length > 0).toBe(true);
  });

  it('an EMPTY completion still reports usage — a dropped segment burnt audio', async () => {
    const h = makeHarness();
    await mountConnected(h);

    act(() => h.dc.emit(SPEECH_STARTED));
    act(() => h.dc.emit(usageCompletedWithTokens('')));

    expect(h.events.filter((e) => e.kind === 'usage')).toHaveLength(1);
    expect(h.finals).toHaveLength(0); // transcript path unchanged: no words, no onFinal
  });

  it('a completion with NO usage field emits no usage event and transcribes normally', async () => {
    const h = makeHarness();
    const { result } = await mountConnected(h);

    act(() => result.current.setCorrelationId('item-A'));
    act(() => h.dc.emit(SPEECH_STARTED));
    act(() => h.dc.emit(completed('no usage on this wire')));

    expect(h.events.filter((e) => e.kind === 'usage')).toHaveLength(0);
    await act(async () => {
      await Promise.resolve();
    });
    expect(h.finalPayloads).toEqual([{ text: 'no usage on this wire', correlationId: 'item-A' }]);
  });

  it('a MALFORMED usage payload cannot break transcription', async () => {
    // The honest case: we could not verify the live shape, so a wrong guess must
    // cost nothing. Garbage usage → no usage event, transcript still lands.
    const h = makeHarness();
    const { result } = await mountConnected(h);

    act(() => result.current.setCorrelationId('item-Z'));
    act(() => h.dc.emit(SPEECH_STARTED));
    act(() => h.dc.emit({ ...completed('still fine'), usage: 'not-an-object' }));

    expect(h.events.filter((e) => e.kind === 'usage')).toHaveLength(0);
    await act(async () => {
      await Promise.resolve();
    });
    expect(h.finalPayloads).toEqual([{ text: 'still fine', correlationId: 'item-Z' }]);
    expect(result.current.state.kind).toBe('live');
  });
});
