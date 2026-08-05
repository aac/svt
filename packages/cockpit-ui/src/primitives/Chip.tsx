import type { CSSProperties, ReactNode } from 'react';
import { tokens, v } from '../tokens.js';

export interface ChipProps {
  /** Chip contents — text, an emoji + count, etc. The agent owns the meaning. */
  label: ReactNode;
  /** Visual tone. `default` is a neutral pill; `accent` uses the cockpit accent. */
  tone?: 'default' | 'accent';
}

/**
 * A small styled pill — an exported visual primitive (design synth: export a
 * component, not the raw tokens, so the look stays re-tunable without breaking a
 * contract). Purely visual: it carries no domain semantics. Agents compose it into
 * slots (or their own panes) to get cockpit-native styling. Themed via the
 * `--cockpit-*` seam.
 */
export function Chip({ label, tone = 'default' }: ChipProps) {
  const accent = tone === 'accent';
  const style: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.3em',
    fontSize: tokens.font.micro,
    fontWeight: 600,
    lineHeight: 1,
    padding: '0.25em 0.5em',
    borderRadius: v.radiusSm,
    background: accent ? v.accent : v.surfaceSunken,
    color: accent ? v.accentText : v.textMuted,
    border: `1px solid ${accent ? v.accent : v.border}`,
    whiteSpace: 'nowrap',
  };
  return <span style={style}>{label}</span>;
}
