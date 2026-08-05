import type { VoiceState } from './types.js';

export interface VoiceIndicatorProps {
  state: VoiceState;
  onConnect: () => void;
  onDisconnect: () => void;
}

/**
 * Optional presentational component showing voice session state.
 * Toggles connect/disconnect on click. Disabled during 'connecting'
 * to avoid the double-click race that would tear down the peer mid-handshake.
 *
 * State-styled colors (warm-neutral default look, to sit on an editorial
 * "ink on warm paper" surface rather than the cool-slate "AI default"):
 *   idle       — warm neutral (default off-state)
 *   connecting — amber, with a soft pulse
 *   live       — green (microphone is hot — the one state that must read as "on")
 *   error      — red; tooltip carries the diagnostic message
 *
 * The label text also tracks the state in words ("voice off" → "connecting…" →
 * "voice live" → "voice error") so the affordance is legible without relying on
 * color alone.
 *
 * No Tailwind required — uses inline styles so the library has no CSS build dep.
 * Consumers can replace this entirely with their own UI and just use useVoiceCapture.
 */
export function VoiceIndicator({ state, onConnect, onDisconnect }: VoiceIndicatorProps) {
  const variant = variantFor(state);

  const handleClick = () => {
    if (state.kind === 'live') {
      onDisconnect();
      return;
    }
    // No secure context and no in-flight handshake: nothing to toggle.
    if (state.kind === 'connecting' || state.kind === 'unavailable') return;
    void onConnect();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={state.kind === 'connecting' || state.kind === 'unavailable'}
      data-testid="voice-indicator"
      data-state={state.kind}
      aria-label={variant.ariaLabel}
      title={variant.tooltip}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '4px 10px',
        borderRadius: '6px',
        border: `1px solid ${variant.borderColor}`,
        background: variant.background,
        color: variant.color,
        fontSize: '11px',
        fontFamily: 'inherit',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        cursor:
          state.kind === 'connecting'
            ? 'wait'
            : state.kind === 'unavailable'
              ? 'not-allowed'
              : 'pointer',
        transition: 'color 0.15s, background 0.15s, border-color 0.15s',
        animation: state.kind === 'connecting' ? 'voicePulse 1s ease-in-out infinite' : undefined,
      }}
    >
      <MicIcon />
      <span>{variant.label}</span>
    </button>
  );
}

function MicIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label="microphone icon"
    >
      <title>microphone</title>
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

interface Variant {
  label: string;
  ariaLabel: string;
  tooltip: string;
  borderColor: string;
  background: string;
  color: string;
}

function variantFor(state: VoiceState): Variant {
  switch (state.kind) {
    case 'idle':
      return {
        label: 'voice off',
        ariaLabel: 'Voice off — click to start',
        tooltip: 'Click to connect the realtime voice session.',
        borderColor: '#d8d2c4',
        background: '#f6f4ef',
        color: '#857d70',
      };
    case 'connecting':
      return {
        label: 'connecting…',
        ariaLabel: 'Voice connecting',
        tooltip: 'Negotiating WebRTC peer connection.',
        borderColor: 'rgba(217, 119, 6, 0.4)',
        background: 'rgba(251, 191, 36, 0.15)',
        color: '#b45309',
      };
    case 'live':
      return {
        label: 'voice live',
        ariaLabel: 'Voice live — click to stop',
        tooltip: `Connected to ${state.model}. Click to disconnect.`,
        borderColor: 'rgba(5, 150, 105, 0.5)',
        background: 'rgba(52, 211, 153, 0.18)',
        color: '#047857',
      };
    case 'error':
      return {
        label: 'voice error',
        ariaLabel: 'Voice error — click to retry',
        tooltip: state.message,
        borderColor: 'rgba(225, 29, 72, 0.4)',
        background: 'rgba(239, 68, 68, 0.12)',
        color: '#be123c',
      };
    case 'unavailable':
      // Not an error state — the browser can't capture voice here at all (no
      // secure context). Muted, non-interactive; the reason rides in the tooltip.
      return {
        label: 'voice unavailable',
        ariaLabel: `Voice unavailable — ${state.reason}`,
        tooltip: state.reason,
        borderColor: '#d8d2c4',
        background: '#efece4',
        color: '#a39a89',
      };
  }
}
