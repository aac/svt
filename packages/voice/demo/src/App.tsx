/**
 * Voice Library Demo
 *
 * Standalone demo — no consuming-app coupling, no other libraries.
 * Exercises the full voice loop: mic connect/disconnect, partial transcripts,
 * final transcripts, correlationId stamping, forceFinalize.
 *
 * Two engines, selectable at the top (defaults to OpenAI Realtime, the untouched
 * default engine). The Web Speech engine needs NO API key — but ships audio to a
 * remote server (Google on Chrome / Apple on Safari); the privacy caveat is shown
 * on that panel.
 *
 * How to run:
 *   cd packages/voice
 *   OPENAI_API_KEY=sk-... pnpm demo   (OpenAI panel; Web Speech works keyless)
 * Then open http://localhost:5173 in Chrome.
 */

import { useState } from 'react';
import {
  useVoiceCapture,
  useWebSpeechCapture,
  VoiceIndicator,
  webSpeechCapabilities,
  type FinalTranscript,
  type UseVoiceCaptureResult,
} from '../../src/index.js';

type Engine = 'openai' | 'web-speech';

/**
 * Token provider: POSTs to the Vite dev-server middleware wired in vite.config.ts.
 * The server reads OPENAI_API_KEY and mints an ephemeral transcription token.
 * The API key never reaches the browser.
 */
async function fetchToken() {
  const res = await fetch('/api/realtime/token', { method: 'POST' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(
      `Token mint failed (${res.status}): ${body.message ?? res.statusText}`,
    );
  }
  return res.json() as Promise<{ clientSecret: string; expiresAt: number; model: string }>;
}

export function App() {
  // OpenAI is the default engine (design note Decisions.6 non-degradation).
  const [engine, setEngine] = useState<Engine>('openai');

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '40px 24px' }}>
      <h1 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600, color: '#f4f4f5' }}>
        Voice Library Demo
      </h1>
      <p style={{ margin: '0 0 24px', color: '#71717a', fontSize: 12 }}>
        Exercises <code>useVoiceCapture</code> / <code>useWebSpeechCapture</code> +{' '}
        <code>setCorrelationId</code> + <code>forceFinalize</code>.
      </p>

      {/* ── Engine selector ──────────────────────────────────────────────── */}
      <section style={{ marginBottom: 28 }}>
        <SectionLabel>Engine</SectionLabel>
        <div style={{ display: 'flex', gap: 8 }}>
          <EngineTab
            active={engine === 'openai'}
            onClick={() => setEngine('openai')}
            label="OpenAI Realtime"
            sub="default · needs API key"
          />
          <EngineTab
            active={engine === 'web-speech'}
            onClick={() => setEngine('web-speech')}
            label="Web Speech"
            sub="keyless · Chromium"
          />
        </div>
      </section>

      {/* Mounting/unmounting the whole panel swaps which hook is active — keeps
          the Rules of Hooks intact (a hook in an unmounted component isn't run). */}
      {engine === 'openai' ? <OpenAiPanel /> : <WebSpeechPanel />}
    </div>
  );
}

// ── Per-engine panels (each owns its hook) ───────────────────────────────────

function OpenAiPanel() {
  const [finals, setFinals] = useState<FinalTranscript[]>([]);
  const voice = useVoiceCapture({
    tokenProvider: fetchToken,
    onFinal: (t) => setFinals((prev) => [t, ...prev]),
  });
  return <VoicePanel voice={voice} finals={finals} onClearFinals={() => setFinals([])} />;
}

function WebSpeechPanel() {
  const [finals, setFinals] = useState<FinalTranscript[]>([]);
  const voice = useWebSpeechCapture({
    onFinal: (t) => setFinals((prev) => [t, ...prev]),
  });
  return (
    <VoicePanel
      voice={voice}
      finals={finals}
      onClearFinals={() => setFinals([])}
      banner={
        <div
          style={{
            background: '#1c1917',
            border: '1px solid #57534e',
            borderRadius: 6,
            padding: '10px 14px',
            marginBottom: 24,
            color: '#d6d3d1',
            fontSize: 12,
            lineHeight: 1.5,
          }}
          data-testid="web-speech-privacy-caveat"
        >
          <strong style={{ color: '#fbbf24' }}>Privacy:</strong> Web Speech is{' '}
          <em>keyless, not private</em>. Your microphone audio is streamed to a remote
          server for recognition — <strong>Google on Chrome/Edge, Apple on Safari</strong>.
          No API key ≠ on-device. Hands-free transcription is reliable only on Chromium
          (<code>engine: {webSpeechCapabilities.engine}</code>,{' '}
          <code>privacy: {webSpeechCapabilities.privacy}</code>).
        </div>
      }
    />
  );
}

// ── Shared presentational panel ──────────────────────────────────────────────

function VoicePanel({
  voice,
  finals,
  onClearFinals,
  banner,
}: {
  voice: UseVoiceCaptureResult;
  finals: FinalTranscript[];
  onClearFinals: () => void;
  banner?: React.ReactNode;
}) {
  const [correlationInput, setCorrelationInput] = useState('item-001');

  const handleSetCorrelation = () => {
    voice.setCorrelationId(correlationInput.trim() || null);
  };
  const handleClearCorrelation = () => {
    voice.setCorrelationId(null);
    setCorrelationInput('');
  };

  return (
    <>
      {banner}

      {/* ── Controls ─────────────────────────────────────────────────────── */}
      <section style={{ marginBottom: 32 }}>
        <SectionLabel>Controls</SectionLabel>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <VoiceIndicator
            state={voice.state}
            onConnect={() => void voice.connect()}
            onDisconnect={() => void voice.disconnect()}
          />
          <Button onClick={() => voice.forceFinalize()} disabled={voice.state.kind !== 'live'}>
            force finalize
          </Button>
          <Button
            onClick={() => {
              voice.clearTranscript();
              onClearFinals();
            }}
          >
            clear transcript
          </Button>
        </div>
      </section>

      {/* ── Correlation ID ───────────────────────────────────────────────── */}
      <section style={{ marginBottom: 32 }}>
        <SectionLabel>Correlation ID</SectionLabel>
        <p style={{ margin: '0 0 10px', color: '#71717a', fontSize: 11 }}>
          Stamped on every final transcript. Simulates cockpit focus change. Call{' '}
          <code>setCorrelationId(id)</code> to update.
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="text"
            value={correlationInput}
            onChange={(e) => setCorrelationInput(e.target.value)}
            placeholder="e.g. item-001"
            style={{
              background: '#18181b',
              border: '1px solid #3f3f46',
              borderRadius: 4,
              color: '#e4e4e7',
              fontFamily: 'inherit',
              fontSize: 12,
              padding: '5px 10px',
              width: 180,
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSetCorrelation();
            }}
          />
          <Button onClick={handleSetCorrelation}>set</Button>
          <Button onClick={handleClearCorrelation}>clear (null)</Button>
        </div>
      </section>

      {/* ── Live transcript ──────────────────────────────────────────────── */}
      <section style={{ marginBottom: 8 }}>
        <SectionLabel>Live transcript</SectionLabel>
        <div
          style={{
            background: '#18181b',
            border: '1px solid #27272a',
            borderRadius: 6,
            padding: '12px 14px',
            minHeight: 64,
            color: '#a1a1aa',
            lineHeight: 1.6,
          }}
        >
          {voice.transcript.length > 0 ? (
            <>
              <span style={{ color: '#e4e4e7' }}>{voice.finals.join(' ')}</span>
              {voice.partial.length > 0 && (
                <>
                  {voice.finals.length > 0 && ' '}
                  <span style={{ color: '#71717a' }}>{voice.partial}</span>
                </>
              )}
            </>
          ) : (
            <span style={{ color: '#3f3f46', fontStyle: 'italic' }}>
              {voice.state.kind === 'idle'
                ? 'Click "voice off" to connect, then speak.'
                : voice.state.kind === 'connecting'
                  ? 'Connecting…'
                  : voice.state.kind === 'live'
                    ? 'Listening. Speak now.'
                    : voice.state.kind === 'unavailable'
                      ? voice.state.reason
                      : `Error: ${voice.state.message}`}
            </span>
          )}
        </div>
        <div style={{ marginTop: 6, fontSize: 11, color: '#52525b' }}>
          state: <StateChip kind={voice.state.kind} /> · finals: {voice.finals.length} · partial
          chars: {voice.partial.length}
        </div>
      </section>

      {/* ── Final transcripts log ────────────────────────────────────────── */}
      <section style={{ marginTop: 24 }}>
        <SectionLabel>Final transcripts</SectionLabel>
        <p style={{ margin: '0 0 10px', color: '#71717a', fontSize: 11 }}>
          Each entry is a <code>FinalTranscript</code> — includes <code>correlationId</code>,{' '}
          <code>sessionId</code>, and <code>t</code> (unix ms).
        </p>
        {finals.length === 0 ? (
          <div style={{ color: '#3f3f46', fontStyle: 'italic', fontSize: 12 }}>No finals yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {finals.map((f, i) => (
              <div
                key={i}
                style={{
                  background: '#18181b',
                  border: '1px solid #27272a',
                  borderRadius: 6,
                  padding: '10px 14px',
                }}
              >
                <div style={{ color: '#e4e4e7', marginBottom: 6 }}>{f.text}</div>
                <div style={{ fontSize: 10, color: '#52525b', display: 'flex', gap: 16 }}>
                  <span>
                    correlationId:{' '}
                    <code style={{ color: '#a1a1aa' }}>{f.correlationId ?? 'null'}</code>
                  </span>
                  <span>
                    sessionId: <code style={{ color: '#a1a1aa' }}>{f.sessionId.slice(0, 8)}…</code>
                  </span>
                  <span>t: {f.t}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

// ── Small UI helpers ─────────────────────────────────────────────────────────

function EngineTab({
  active,
  onClick,
  label,
  sub,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: active ? '#27272a' : '#18181b',
        border: `1px solid ${active ? '#52525b' : '#27272a'}`,
        borderRadius: 6,
        color: active ? '#f4f4f5' : '#71717a',
        cursor: 'pointer',
        fontFamily: 'inherit',
        padding: '8px 14px',
        textAlign: 'left',
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 10, color: active ? '#a1a1aa' : '#52525b', marginTop: 2 }}>{sub}</div>
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: '#52525b',
        marginBottom: 10,
      }}
    >
      {children}
    </div>
  );
}

function Button({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        background: disabled ? '#18181b' : '#27272a',
        border: '1px solid #3f3f46',
        borderRadius: 4,
        color: disabled ? '#52525b' : '#a1a1aa',
        cursor: disabled ? 'default' : 'pointer',
        fontFamily: 'inherit',
        fontSize: 11,
        letterSpacing: '0.06em',
        padding: '5px 12px',
        textTransform: 'uppercase',
      }}
    >
      {children}
    </button>
  );
}

function StateChip({ kind }: { kind: string }) {
  const colors: Record<string, string> = {
    idle: '#52525b',
    connecting: '#fbbf24',
    live: '#34d399',
    error: '#f87171',
    unavailable: '#a16207',
  };
  return <span style={{ color: colors[kind] ?? '#71717a', fontWeight: 600 }}>{kind}</span>;
}
