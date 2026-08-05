import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import type { ItemId } from '@surface/cockpit';
import { accentWash, tokens, v } from '../tokens.js';
import { useOptionalCockpitEngine } from './CockpitProvider.js';
import type { DisplayItem } from '../types.js';

export interface CockpitListProps<T extends ItemId = ItemId> {
  /**
   * Map a domain item to its display fields. Required — engine items are opaque
   * (`{ id }` only), so the display can't invent a title/body/accent for a row.
   */
  mapItem: (item: T) => DisplayItem;
  /** Optional trailing region of each row (additive slot). */
  renderRowAside?: (item: T) => ReactNode;
  // ── Engine wiring — OMIT to read the shared engine off <CockpitProvider> ──
  // Each of these defaults to the context engine, so `<CockpitList mapItem={…}/>`
  // self-wires under a provider in any arrangement. Passing one is the prop-drill
  // OVERRIDE (the escape hatch for a consumer NOT using a provider — e.g. today's
  // `<Cockpit>`, which threads these in directly). A resolved value must exist for
  // `items`/`onSelect` from EITHER source or the piece throws (fail-loud).
  /** The item set. Defaults to the context engine's `items`. */
  items?: T[];
  /** Index of the focused row. Defaults to the context engine's `focusedIndex`. */
  focusedIndex?: number;
  /**
   * Called when a row is activated (click/tap), with the item id. Defaults to the
   * context engine's `setFocusedItem` (focus the item). A consumer that also drives
   * a narrow-mode collapse overrides this to flip the view too (as `<Cockpit>` does).
   */
  onSelect?: (id: string) => void;
}

/**
 * Render a clean, single-paragraph text preview for the 2-line list row.
 *
 * Bodies may be HTML (e.g. an email body — see the email worked example). The
 * detail pane renders that HTML; the *list row* must not show raw markup
 * ("<p>Your <strong>…"). This is a purely presentational text transform: it
 * strips tags, decodes the handful of entities that survive, and collapses
 * whitespace so the row preview reads as plain prose. It changes no behavior —
 * the full body still flows untouched to the detail pane.
 *
 * Implemented without DOM parsing so it's the same on server and client and
 * carries no XSS surface (the output is rendered as text, never as HTML).
 */
function previewText(body: string): string {
  if (!/<[a-z][\s\S]*>/i.test(body)) return body;
  return body
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '') // drop script/style content
    .replace(/<[^>]+>/g, ' ') // strip remaining tags
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Left sidebar: scrollable list of items.
 * Generic — knows nothing about the item domain. It learns each row's title/body/
 * accent through `mapItem`, and may render an agent-supplied trailing region via
 * `renderRowAside` (the row chip slot).
 *
 * Styling: inline styles (themed via `--cockpit-*` vars). Hover is tracked in
 * local state since inline styles can't express :hover. Focus vs hover: the
 * focused row washes in the accent (its own background becomes a low-alpha tint),
 * hover is a strictly weaker neutral wash — the keyboard-driven state out-weighs
 * the mouse one (design brief §3.2).
 */
export function CockpitList<T extends ItemId = ItemId>({
  mapItem,
  renderRowAside,
  items: itemsProp,
  focusedIndex: focusedIndexProp,
  onSelect: onSelectProp,
}: CockpitListProps<T>) {
  // All hooks run unconditionally FIRST (rules-of-hooks), then the guard throws.
  // Resolve engine state: explicit prop wins, else the shared context engine.
  const engine = useOptionalCockpitEngine<T>();
  const [hoveredIndex, setHoveredIndex] = useState<number>(-1);
  const focusedRowRef = useRef<HTMLLIElement | null>(null);

  const items = itemsProp ?? engine?.items;
  const focusedIndex = focusedIndexProp ?? engine?.focusedIndex ?? -1;
  const onSelect = onSelectProp ?? engine?.setFocusedItem;

  // Keep the focused row visible as j/k moves focus past the viewport on a long
  // list. Presentational only — a consequence of the existing nav, not new
  // behavior: focusedIndex is already owned by useCockpit; this just scrolls the
  // corresponding row into view when it changes.
  useEffect(() => {
    focusedRowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [focusedIndex]);

  if (!items || !onSelect) {
    throw new Error(
      'CockpitList needs engine state. Either mount it under a <CockpitProvider> ' +
        '(so it reads the shared engine off context) or pass explicit `items` and ' +
        '`onSelect` props (the prop-drill path).',
    );
  }

  if (items.length === 0) {
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.4rem',
          padding: '2rem 1.5rem',
          textAlign: 'center',
        }}
        data-testid="cockpit-empty"
      >
        <div style={{ fontSize: tokens.font.small, fontWeight: 600, color: v.textMuted }}>
          No items in the queue
        </div>
        <div style={{ fontSize: tokens.font.small, color: v.textFaint, lineHeight: 1.5 }}>
          Items will appear here once they&rsquo;re loaded.
        </div>
      </div>
    );
  }

  const position = Math.max(0, focusedIndex) + 1;

  return (
    <>
      <div
        style={{
          padding: `${tokens.space.lg} ${tokens.space.lg} ${tokens.space.sm}`,
          fontSize: tokens.font.micro,
          fontWeight: 600,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: v.textFaint,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
        }}
      >
        <span>Queue</span>
        {/* Cursor position — styled AS position (subdued mono, tabular figures),
            deliberately unlike the consumers' semantic "N / M triaged" ratios. */}
        <span
          style={{
            fontFamily: v.fontFamilyMono,
            fontVariantNumeric: 'tabular-nums',
            fontWeight: 500,
            letterSpacing: 'normal',
            textTransform: 'none',
            color: v.textFaint,
          }}
          data-testid="cockpit-position"
        >
          #{position}/{items.length}
        </span>
      </div>
      <ul
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '2px',
          listStyle: 'none',
          margin: 0,
          padding: `0 ${tokens.space.sm} ${tokens.space.sm}`,
        }}
        role="listbox"
        aria-label="Items"
        data-testid="cockpit-list"
      >
        {items.map((item, idx) => {
          const isFocused = idx === focusedIndex;
          const isHovered = idx === hoveredIndex;
          const d = mapItem(item);
          const aside = renderRowAside?.(item);

          const buttonStyle: CSSProperties = {
            position: 'relative',
            display: 'block',
            width: '100%',
            textAlign: 'left',
            padding: `${tokens.space.md} ${tokens.space.md}`,
            borderRadius: v.radiusMd,
            // All rows carry a 1px border so focus (which colors it via
            // --cockpit-border-focus, default transparent) causes no layout shift.
            border: `1px solid ${isFocused ? v.borderFocus : 'transparent'}`,
            // Focused row's OWN background becomes the wash: the live item accent
            // when set (voice go/wait hue), else the soft accent for idle.
            background: isFocused
              ? d.accent
                ? accentWash(d.accent)
                : v.accentSoft
              : isHovered
                ? v.surfaceHover
                : 'transparent',
            boxShadow: isFocused ? v.shadowRaised : 'none',
            cursor: 'pointer',
            transition:
              'background-color 140ms ease, box-shadow 140ms ease, border-color 140ms ease',
            font: 'inherit',
          };

          const titleStyle: CSSProperties = {
            flex: '1 1 auto',
            minWidth: 0,
            fontSize: tokens.font.rowTitle,
            fontWeight: isFocused ? 600 : tokens.font.rowTitleWeight,
            lineHeight: 1.35,
            color: isFocused ? v.ink : v.text,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          };

          return (
            <li
              key={item.id}
              role="option"
              aria-selected={isFocused}
              ref={isFocused ? focusedRowRef : null}
            >
              <button
                type="button"
                onClick={() => onSelect(item.id)}
                onMouseEnter={() => setHoveredIndex(idx)}
                onMouseLeave={() => setHoveredIndex((prev) => (prev === idx ? -1 : prev))}
                data-testid={`cockpit-item-${item.id}`}
                data-focused={isFocused ? 'true' : 'false'}
                style={buttonStyle}
              >
                {/* Accent left rail — only on the focused row. Color is the
                    item's mapped `accent` when set (a presentational state hint
                    from the managing agent), else the default accent. */}
                {isFocused ? (
                  <span
                    aria-hidden
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: '0.5rem',
                      bottom: '0.5rem',
                      width: d.accent ? '4px' : '3px',
                      borderRadius: '3px',
                      background: d.accent ?? v.accent,
                      transition: 'background-color 160ms ease, width 160ms ease',
                    }}
                  />
                ) : null}
                {/* Title line + optional trailing aside slot (e.g. a chip). */}
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: tokens.space.sm,
                  }}
                >
                  <span style={titleStyle}>{d.title || '(no title)'}</span>
                  {aside ? (
                    <span style={{ flexShrink: 0, display: 'inline-flex' }}>{aside}</span>
                  ) : null}
                </span>
                {d.body ? (
                  <p
                    style={{
                      margin: '0.3rem 0 0',
                      fontSize: tokens.font.small,
                      lineHeight: 1.45,
                      color: v.textMuted,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                    }}
                  >
                    {previewText(d.body)}
                  </p>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
