import { describe, expect, it } from 'vitest';
import {
  buildTranscriptionSessionBody,
  DEFAULT_VAD_TUNING,
  RealtimeTranscriptionBroker,
  resolveVadTuning,
  type TranscriptionMintFn,
} from './server.js';

// Narrow accessors so the tests read the nested wire shape without `any`.
type SessionBody = {
  session: {
    audio: {
      input: {
        transcription: { model: string; language: string; prompt?: string };
        noise_reduction?: { type: string };
        turn_detection: {
          type: string;
          threshold: number;
          prefix_padding_ms: number;
          silence_duration_ms: number;
        };
      };
    };
  };
};
const turnDetection = (b: Record<string, unknown>) =>
  (b as unknown as SessionBody).session.audio.input.turn_detection;
const audioInput = (b: Record<string, unknown>) =>
  (b as unknown as SessionBody).session.audio.input;

// Tests ported from the originating app's realtime-broker test suite
// (transcription broker block, lines 101–151). Bidirectional broker dropped.

describe('RealtimeTranscriptionBroker', () => {
  it('forwards the mint result with model echoed back', async () => {
    const mint: TranscriptionMintFn = async () => ({
      clientSecret: 'sec_xyz',
      expiresAt: 1_700_000_000,
      model: 'gpt-4o-transcribe',
    });
    const broker = new RealtimeTranscriptionBroker({ mint });
    const result = await broker.mintEphemeralToken();
    expect(result).toEqual({
      clientSecret: 'sec_xyz',
      expiresAt: 1_700_000_000,
      model: 'gpt-4o-transcribe',
    });
  });

  it('throws loudly when OpenAI returns an empty client_secret', async () => {
    const mint: TranscriptionMintFn = async () => ({
      clientSecret: '',
      expiresAt: 1,
      model: 'gpt-4o-transcribe',
    });
    const broker = new RealtimeTranscriptionBroker({ mint });
    await expect(broker.mintEphemeralToken()).rejects.toThrow(/empty client_secret/);
  });

  it('the result never contains anything that looks like a master API key', async () => {
    // Simulate a leaky mint that accidentally returns the master key as a field.
    const leakyMintResult = {
      clientSecret: 'sec_ephemeral',
      expiresAt: 1,
      model: 'gpt-4o-transcribe',
      apiKey: 'sk-MASTER-LEAK',
    };
    const mint = (async () => leakyMintResult) as unknown as TranscriptionMintFn;
    const broker = new RealtimeTranscriptionBroker({ mint });
    const result = await broker.mintEphemeralToken();
    expect(JSON.stringify(result)).not.toContain('sk-MASTER-LEAK');
    expect(Object.keys(result).sort()).toEqual(['clientSecret', 'expiresAt', 'model']);
  });

  it('propagates errors from the underlying mint fn', async () => {
    const mint: TranscriptionMintFn = async () => {
      throw new Error('transcription session create rate limited');
    };
    const broker = new RealtimeTranscriptionBroker({ mint });
    await expect(broker.mintEphemeralToken()).rejects.toThrow(/rate limited/);
  });
});

// ── VAD / segmentation tuning ──────────────────────────────────

describe('resolveVadTuning', () => {
  const emptyEnv: Record<string, string | undefined> = {};

  it('defaults to the forgiving thinking-out-loud profile (not the old triage 400ms)', () => {
    const vad = resolveVadTuning({}, emptyEnv);
    expect(vad).toEqual(DEFAULT_VAD_TUNING);
    // The load-bearing regression: the old hardcoded silence window that cut
    // mid-thought speech was 400ms. The default must now tolerate a thinking pause.
    expect(vad.silenceDurationMs).toBeGreaterThan(400);
  });

  it('explicit options win over env and default', () => {
    const vad = resolveVadTuning(
      { silenceDurationMs: 400, threshold: 0.6, prefixPaddingMs: 300, noiseReduction: 'near_field' },
      { OPENAI_VAD_SILENCE_MS: '999', OPENAI_VAD_NOISE_REDUCTION: 'none' },
    );
    expect(vad).toEqual({
      silenceDurationMs: 400,
      threshold: 0.6,
      prefixPaddingMs: 300,
      noiseReduction: 'near_field',
    });
  });

  it('env vars win over the default when no explicit option is given', () => {
    const vad = resolveVadTuning(
      {},
      {
        OPENAI_VAD_SILENCE_MS: '2000',
        OPENAI_VAD_THRESHOLD: '0.4',
        OPENAI_VAD_PREFIX_MS: '600',
        OPENAI_VAD_NOISE_REDUCTION: 'none',
      },
    );
    expect(vad).toEqual({
      silenceDurationMs: 2000,
      threshold: 0.4,
      prefixPaddingMs: 600,
      noiseReduction: 'none',
    });
  });

  it('ignores non-numeric / invalid env values (falls through to default)', () => {
    const vad = resolveVadTuning(
      {},
      { OPENAI_VAD_SILENCE_MS: 'not-a-number', OPENAI_VAD_NOISE_REDUCTION: 'bogus' },
    );
    expect(vad.silenceDurationMs).toBe(DEFAULT_VAD_TUNING.silenceDurationMs);
    expect(vad.noiseReduction).toBe(DEFAULT_VAD_TUNING.noiseReduction);
  });
});

describe('buildTranscriptionSessionBody', () => {
  it('threads the resolved VAD params onto the server_vad turn_detection', () => {
    const body = buildTranscriptionSessionBody({
      model: 'gpt-4o-transcribe',
      vad: {
        silenceDurationMs: 1500,
        threshold: 0.45,
        prefixPaddingMs: 550,
        noiseReduction: 'far_field',
      },
    });
    expect(turnDetection(body)).toEqual({
      type: 'server_vad',
      threshold: 0.45,
      prefix_padding_ms: 550,
      silence_duration_ms: 1500,
    });
    expect(audioInput(body).noise_reduction).toEqual({ type: 'far_field' });
  });

  it("omits noise_reduction entirely when set to 'none'", () => {
    const body = buildTranscriptionSessionBody({
      model: 'gpt-4o-transcribe',
      vad: { ...DEFAULT_VAD_TUNING, noiseReduction: 'none' },
    });
    expect(audioInput(body).noise_reduction).toBeUndefined();
  });

  it('includes the prompt only when supplied', () => {
    const withPrompt = buildTranscriptionSessionBody({
      model: 'gpt-4o-transcribe',
      prompt: 'triage vocabulary',
      vad: DEFAULT_VAD_TUNING,
    });
    expect(audioInput(withPrompt).transcription.prompt).toBe('triage vocabulary');

    const without = buildTranscriptionSessionBody({
      model: 'gpt-4o-transcribe',
      vad: DEFAULT_VAD_TUNING,
    });
    expect(audioInput(without).transcription.prompt).toBeUndefined();
  });
});
