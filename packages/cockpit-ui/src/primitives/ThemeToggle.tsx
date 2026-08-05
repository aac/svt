import type { CSSProperties } from 'react';
import { v, tokens } from '../tokens.js';
import { THEME_MODES, type ThemeMode } from '../theme-resolution.js';

/**
 * The conventional system / light / dark tri-state control — a small
 * segmented control.
 *
 * Controlled: the consumer owns `mode` (typically from `useResolvedTheme`) and
 * persists it via `onChange`. Styled entirely through the `--cockpit-*` seam so it
 * re-skins with whatever theme is active. This is a DISPLAY-tier primitive — a
 * consumer/composition mounts it in its own chrome; it is never part of the
 * headless engine (no theme state there).
 */

const LABELS: Record<ThemeMode, string> = {
  system: 'Auto',
  light: 'Light',
  dark: 'Dark',
};

export interface ThemeToggleProps {
  /** Current tri-state choice. */
  mode: ThemeMode;
  /** Called with the next choice when a segment is pressed. */
  onChange: (mode: ThemeMode) => void;
  /** Accessible label for the group (default "Color theme"). */
  label?: string;
}

export function ThemeToggle({ mode, onChange, label = 'Color theme' }: ThemeToggleProps) {
  return (
    <div
      role="group"
      aria-label={label}
      style={{
        display: 'inline-flex',
        gap: '2px',
        padding: '2px',
        background: v.surfaceSunken,
        border: `1px solid ${v.border}`,
        borderRadius: v.radiusMd,
      }}
      data-testid="theme-toggle"
    >
      {THEME_MODES.map((m) => {
        const active = m === mode;
        return (
          <button
            key={m}
            type="button"
            onClick={() => onChange(m)}
            aria-pressed={active}
            title={`${LABELS[m]} theme`}
            data-theme-mode={m}
            style={segmentStyle(active)}
          >
            {LABELS[m]}
          </button>
        );
      })}
    </div>
  );
}

function segmentStyle(active: boolean): CSSProperties {
  return {
    appearance: 'none',
    WebkitAppearance: 'none',
    border: 'none',
    cursor: 'pointer',
    fontFamily: v.fontFamily,
    fontSize: tokens.font.small,
    fontWeight: active ? 600 : 500,
    lineHeight: 1,
    padding: '4px 10px',
    borderRadius: v.radiusSm,
    background: active ? v.accent : 'transparent',
    color: active ? v.accentText : v.textMuted,
    transition: 'background 140ms, color 140ms',
  };
}
