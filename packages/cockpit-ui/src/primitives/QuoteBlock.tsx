import type { ReactNode } from 'react';
import { tokens, v } from '../tokens.js';

export interface QuoteBlockProps {
  /** A short heading above the quotes (e.g. a micro label). The agent owns the meaning. */
  label: ReactNode;
  /** The quoted lines. Each renders on its own line inside typographic quotes. */
  quotes: readonly string[];
}

/**
 * A labeled list of quoted lines in a soft, accent-tinted box — an exported
 * visual primitive (alongside `<Chip>`). Purely visual: it renders quotes and
 * knows nothing of where they come from. Agents drop it into a slot (or their own
 * panes) to get cockpit-native styling for any short set of quoted lines. Themed
 * via the `--cockpit-*` seam, so it re-tunes with everything else.
 */
export function QuoteBlock({ label, quotes }: QuoteBlockProps) {
  return (
    <div
      data-testid="cockpit-quote-block"
      style={{
        padding: `${tokens.space.sm} ${tokens.space.md}`,
        background: v.accentSoft,
        border: `1px solid ${v.border}`,
        borderRadius: v.radiusMd,
      }}
    >
      <div
        style={{
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          fontSize: tokens.font.micro,
          fontWeight: 600,
          color: v.accent,
          marginBottom: '4px',
        }}
      >
        {label}
      </div>
      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: '3px',
        }}
      >
        {quotes.map((q, i) => (
          <li
            key={i}
            style={{
              fontSize: tokens.font.small,
              color: v.text,
              lineHeight: 1.45,
            }}
          >
            &ldquo;{q}&rdquo;
          </li>
        ))}
      </ul>
    </div>
  );
}
