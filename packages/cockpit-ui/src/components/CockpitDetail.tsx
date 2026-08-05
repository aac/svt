import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import DOMPurify from 'dompurify';
import type { CockpitAction, ItemId } from '@surface/cockpit';
import { onAccentText, tokens, v } from '../tokens.js';
import { shouldResetDetailScroll } from '../layout.js';
import { useOptionalCockpitEngine } from './CockpitProvider.js';
import type { DisplayItem } from '../types.js';

/**
 * Hand-written typographic styling for the rich/HTML body container.
 *
 * Replaces the dead `prose prose-slate prose-sm` Tailwind classes that this
 * library used to advertise — there is no CSS build (decisions.md #4), so those
 * were no-ops and HTML email/reading bodies rendered with bare browser defaults.
 * We inject a scoped <style> targeting descendant tags of the body container so
 * headings, paragraphs, lists, links, blockquotes, code, and rules get real
 * hierarchy without pulling in a CSS pipeline. The class name is unique to avoid
 * leaking into the consuming app's DOM. Every color/radius/font goes through the
 * `--cockpit-*` seam (via `v.*`), so a themed body re-tunes with everything else.
 */
const BODY_CLASS = 'cockpit-rich-body';
const richBodyCss = `
.${BODY_CLASS} > :first-child { margin-top: 0; }
.${BODY_CLASS} > :last-child { margin-bottom: 0; }
.${BODY_CLASS} p { margin: 0 0 0.85em; }
.${BODY_CLASS} h1, .${BODY_CLASS} h2, .${BODY_CLASS} h3, .${BODY_CLASS} h4 {
  color: ${v.ink};
  font-weight: 600;
  line-height: 1.3;
  margin: 1.5em 0 0.5em;
  letter-spacing: -0.01em;
}
.${BODY_CLASS} h1 { font-size: 1.3em; }
.${BODY_CLASS} h2 { font-size: 1.15em; }
.${BODY_CLASS} h3 { font-size: 1.05em; }
.${BODY_CLASS} h4 { font-size: 1em; }
.${BODY_CLASS} a { color: ${v.accent}; text-decoration: underline; text-underline-offset: 2px; }
.${BODY_CLASS} ul, .${BODY_CLASS} ol { margin: 0 0 0.85em; padding-left: 1.4em; }
.${BODY_CLASS} li { margin: 0.2em 0; }
.${BODY_CLASS} blockquote {
  margin: 1em 0;
  padding: 0.1em 0 0.1em 1em;
  border-left: 3px solid ${v.border};
  color: ${v.textMuted};
  font-style: italic;
}
.${BODY_CLASS} code {
  font-family: ${v.fontFamilyMono};
  font-size: 0.875em;
  background: ${v.surfaceSunken};
  border: 1px solid ${v.border};
  border-radius: ${v.radiusSm};
  padding: 0.1em 0.35em;
}
.${BODY_CLASS} pre {
  background: ${v.surfaceSunken};
  border: 1px solid ${v.border};
  border-radius: ${v.radiusMd};
  padding: 0.85em 1em;
  overflow: auto;
  margin: 0 0 0.85em;
}
.${BODY_CLASS} pre code { background: none; border: none; padding: 0; }
.${BODY_CLASS} hr { border: none; border-top: 1px solid ${v.border}; margin: 1.5em 0; }
.${BODY_CLASS} img { max-width: 100%; height: auto; border-radius: ${v.radiusMd}; }
.${BODY_CLASS} strong { color: ${v.ink}; font-weight: 600; }
.${BODY_CLASS} table { border-collapse: collapse; margin: 0 0 0.85em; }
.${BODY_CLASS} th, .${BODY_CLASS} td { border: 1px solid ${v.border}; padding: 0.4em 0.6em; text-align: left; }
.${BODY_CLASS} th { background: ${v.surfaceSunken}; font-weight: 600; }
`;

/**
 * Suppress the keyboard-shortcut chips on devices that can't use them.
 *
 * The `<kbd>` chips on the action buttons advertise j/k/Enter-style shortcuts.
 * On a touch device with no hardware keyboard they are dead UI (design-pass
 * feedback: "keyboard shortcuts aren't useful on the phone"). We key
 * off INPUT CAPABILITY, not width — a narrow desktop column still has a keyboard,
 * and a wide iPad may not have hover — via `(hover: none) and (pointer: coarse)`,
 * the standard touch-primary signal. The keyboard HANDLERS stay wired regardless
 * (a hardware keyboard can attach to a touch device); only the visual hint hides,
 * so a keyboard-equipped iPad still benefits.
 *
 * Done as a scoped media query (mirroring the reduced-motion rule in Cockpit's
 * root stylesheet) rather than a matchMedia hook: no window access, SSR-safe, and
 * the browser re-evaluates it live as the device/input state changes — no React
 * re-render required. The class name is unique to avoid leaking into the
 * consuming app's DOM.
 */
const KBD_CLASS = 'cockpit-action-kbd';
const kbdHintCss = `
@media (hover: none) and (pointer: coarse) {
  .${KBD_CLASS} { display: none; }
}
`;

export interface CockpitDetailProps<T extends ItemId = ItemId> {
  /**
   * Map the item to its display fields (`title`/`body`/`accent`). The context-mode
   * counterpart to `<CockpitList>`'s `mapItem`: with it, the piece self-wires under
   * a provider and maps the focused item itself. Provide THIS or `display`.
   */
  mapItem?: (item: T) => DisplayItem;
  /**
   * Pre-mapped display fields — the prop-drill OVERRIDE for `mapItem` (what today's
   * `<Cockpit>` threads in, having already mapped the focused item). Wins over
   * `mapItem` when both are given.
   */
  display?: DisplayItem;
  /** Optional block above the body (additive slot, e.g. annotations). */
  renderDetailBefore?: (item: T) => ReactNode;
  /**
   * When set (narrow single-pane mode), renders a back affordance that returns to
   * the list. Absent on desktop, where both panes are always visible. A view/
   * arrangement concern, so it is always a prop — never sourced from the engine.
   */
  onBack?: () => void;
  // ── Engine wiring — OMIT to read the shared engine off <CockpitProvider> ──
  // Defaults to the context engine; passing one is the prop-drill override for a
  // consumer NOT using a provider (e.g. today's `<Cockpit>`).
  /**
   * The item to render. Defaults to the context engine's `focusedItem`. When it
   * resolves to `null` (nothing focused), the piece renders its own empty state, so
   * a bare `<CockpitDetail mapItem={…}/>` is self-sufficient under a provider.
   */
  item?: T | null;
  /** The registered actions. Defaults to the context engine's `actions`. */
  actions?: CockpitAction[];
  /**
   * Fired when an action button is clicked, with the action + focused-item ids.
   * Defaults to routing through the context engine's `invokeAction` (which calls
   * the engine's own `onAction`), so a context-mode button fires the same path as
   * a keybind. Passing one is the prop-drill override.
   */
  onAction?: (actionId: string, itemId: string) => void;
}

/**
 * Right detail pane.
 * Renders item title, body (plain text or HTML), and action buttons.
 * Completely generic — no domain concepts (no proposals, destinations, email fields).
 *
 * Body rendering: the managing agent may supply HTML (e.g. an email body).
 * All HTML is sanitized via DOMPurify before insertion; plain-text bodies are
 * rendered as-is inside a pre-wrap container without going through innerHTML.
 *
 * Styling: inline styles (themed via `--cockpit-*` vars). Action-button hover is
 * tracked in local state since inline styles can't express :hover.
 */
export function CockpitDetail<T extends ItemId = ItemId>({
  mapItem,
  display: displayProp,
  renderDetailBefore,
  onBack,
  item: itemProp,
  actions: actionsProp,
  onAction: onActionProp,
}: CockpitDetailProps<T>) {
  // All hooks run unconditionally FIRST (rules-of-hooks); the guards/early return
  // for the resolved state come after.
  const engine = useOptionalCockpitEngine<T>();
  const [hoveredAction, setHoveredAction] = useState<string | null>(null);
  const bodyRef = useRef<HTMLElement | null>(null);
  const prevItemIdRef = useRef<string | null>(null);

  // Resolve engine wiring: explicit prop wins, else the shared context engine.
  const item = itemProp ?? engine?.focusedItem ?? null;
  const actions = actionsProp ?? engine?.actions ?? [];
  const display = displayProp ?? (item && mapItem ? mapItem(item) : undefined);
  // Route action clicks: explicit `onAction` prop wins; otherwise fire the engine's
  // `invokeAction` (looked up by the action's index) so a button and a keybind take
  // the exact same path. A no-op when neither source exists (unconfigured).
  const onAction: (actionId: string, itemId: string) => void =
    onActionProp ??
    ((actionId) => {
      const index = actions.findIndex((a) => a.id === actionId);
      if (index >= 0) engine?.invokeAction(index);
    });

  // Reset the body scroll to the top when the FOCUSED ITEM changes, so a long
  // body scrolled down doesn't stay mid-scrolled on the next item. Deliberately
  // guarded on item id (not remounted, not keyed): a live accent flip (voice
  // go/wait) keeps the same id and must not interrupt the read. The effect runs
  // on accent changes too, which is exactly why the id guard is load-bearing.
  useEffect(() => {
    const id = item?.id ?? null;
    if (shouldResetDetailScroll(prevItemIdRef.current, id) && bodyRef.current) {
      bodyRef.current.scrollTop = 0;
    }
    prevItemIdRef.current = id;
  }, [item?.id, display?.accent]);

  // Nothing focused → self-sufficient empty state (a bare context-mode piece shows
  // this; `<Cockpit>` guards externally and never reaches it).
  if (!item) {
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: tokens.font.small,
          color: v.textFaint,
          letterSpacing: '0.04em',
        }}
        data-testid="cockpit-detail"
      >
        No item selected
      </div>
    );
  }
  // Item present but no way to render it → fail loud (a missing `mapItem`/`display`).
  if (!display) {
    throw new Error(
      'CockpitDetail has an item but no way to render it — pass `mapItem` (or a ' +
        'pre-mapped `display`) so it can map the item to title/body/accent.',
    );
  }

  // Detect HTML bodies by the presence of a tag. Plain-text bodies skip
  // DOMPurify and dangerouslySetInnerHTML entirely.
  const bodyIsHtml = display.body ? /<[a-z][\s\S]*>/i.test(display.body) : false;

  const bodyContent = bodyIsHtml
    ? { __html: DOMPurify.sanitize(display.body) }
    : null;

  const bodyBaseStyle: CSSProperties = {
    maxWidth: '42rem',
    color: v.text,
    fontFamily: v.fontFamily,
    lineHeight: tokens.font.lineHeight,
    fontSize: tokens.font.body,
  };

  return (
    <article
      style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
      data-testid="cockpit-detail"
    >
      {/* Scoped typographic styles for the rich-body container. */}
      <style>{richBodyCss}</style>
      {/* Hide the keyboard-shortcut chips on touch-primary devices. */}
      <style>{kbdHintCss}</style>

      {/* Accent bar — mirrors the list row's rail so the item's `accent` state
          (e.g. an active voice session) reads in the detail view too. Always
          present (transparent when unset) so toggling it causes no layout shift. */}
      <div
        aria-hidden
        style={{
          height: '3px',
          flexShrink: 0,
          background: display.accent ?? 'transparent',
          transition: 'background-color 160ms ease',
        }}
      />

      <header
        style={{
          padding: `${tokens.space.xl} ${tokens.space.xl} ${tokens.space.lg}`,
          borderBottom: `1px solid ${v.border}`,
        }}
      >
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            data-testid="cockpit-back"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.3em',
              marginBottom: tokens.space.sm,
              padding: '0.25rem 0',
              border: 'none',
              background: 'transparent',
              color: v.accent,
              fontFamily: 'inherit',
              fontSize: tokens.font.small,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <span aria-hidden>&larr;</span> Back to list
          </button>
        ) : null}
        <h2
          style={{
            margin: 0,
            fontSize: tokens.font.title,
            fontWeight: tokens.font.titleWeight,
            lineHeight: 1.25,
            letterSpacing: '-0.02em',
            color: v.ink,
            fontFamily: v.fontFamilyDisplay,
          }}
          data-testid="cockpit-detail-title"
        >
          {display.title || '(no title)'}
        </h2>
      </header>

      <section
        ref={bodyRef}
        style={{
          flex: '1 1 0%',
          overflow: 'auto',
          padding: `${tokens.space.xl} ${tokens.space.xl}`,
        }}
      >
        {renderDetailBefore ? (
          <div
            data-testid="cockpit-detail-before"
            style={{ marginBottom: tokens.space.lg }}
          >
            {renderDetailBefore(item)}
          </div>
        ) : null}
        {display.body ? (
          bodyContent ? (
            <div
              className={BODY_CLASS}
              style={bodyBaseStyle}
              data-testid="cockpit-detail-body"
              dangerouslySetInnerHTML={bodyContent}
            />
          ) : (
            <div
              style={{ ...bodyBaseStyle, whiteSpace: 'pre-wrap' }}
              data-testid="cockpit-detail-body"
            >
              {display.body}
            </div>
          )
        ) : (
          <p
            style={{
              color: v.textFaint,
              fontStyle: 'italic',
              fontSize: tokens.font.body,
              margin: 0,
            }}
            data-testid="cockpit-detail-body"
          >
            (empty body)
          </p>
        )}
      </section>

      {actions.length > 0 ? (
        <footer
          style={{
            padding: `${tokens.space.lg} ${tokens.space.xl}`,
            borderTop: `1px solid ${v.border}`,
            background: v.surfaceSunken,
            display: 'flex',
            gap: tokens.space.sm,
            flexWrap: 'wrap',
          }}
        >
          {actions.map((action, idx) => {
            // Presentational default only: the first action reads as primary.
            // Cockpit doesn't know what actions *mean* — this is purely visual
            // weight, not semantics.
            const isPrimary = idx === 0;
            const isHovered = hoveredAction === action.id;

            const base: CSSProperties = {
              display: 'inline-flex',
              alignItems: 'center',
              gap: tokens.space.sm,
              padding: '0.5rem 0.85rem',
              borderRadius: v.radiusMd,
              fontSize: tokens.font.small,
              fontWeight: 550,
              cursor: 'pointer',
              transition: 'background-color 140ms, color 140ms, border-color 140ms, box-shadow 140ms',
              font: 'inherit',
            };

            const primaryStyle: CSSProperties = {
              ...base,
              background: isHovered ? v.accentHover : v.accent,
              color: v.accentText,
              border: `1px solid ${v.accent}`,
              boxShadow: v.shadowButton,
            };

            const secondaryStyle: CSSProperties = {
              ...base,
              background: isHovered ? v.surfaceHover : v.surfaceRaised,
              color: isHovered ? v.ink : v.text,
              border: `1px solid ${v.borderStrong}`,
            };

            return (
              <button
                key={action.id}
                type="button"
                data-testid={`cockpit-action-${action.id}`}
                onClick={() => onAction(action.id, item.id)}
                onMouseEnter={() => setHoveredAction(action.id)}
                onMouseLeave={() =>
                  setHoveredAction((prev) => (prev === action.id ? null : prev))
                }
                style={isPrimary ? primaryStyle : secondaryStyle}
              >
                {action.label}
                <kbd
                  className={KBD_CLASS}
                  style={{
                    fontSize: tokens.font.micro,
                    fontFamily: v.fontFamilyMono,
                    lineHeight: 1,
                    padding: '0.15em 0.4em',
                    borderRadius: v.radiusSm,
                    // On the accent button, the kbd chip is a translucent layer of
                    // the accent-text color (re-themes with --cockpit-accent-text);
                    // on secondary buttons it sits on the sunken ground.
                    background: isPrimary ? onAccentText(18) : v.surfaceSunken,
                    color: isPrimary ? onAccentText(92) : v.textFaint,
                    border: isPrimary
                      ? `1px solid ${onAccentText(25)}`
                      : `1px solid ${v.border}`,
                  }}
                >
                  {action.keybind ?? idx + 1}
                </kbd>
              </button>
            );
          })}
        </footer>
      ) : null}
    </article>
  );
}
