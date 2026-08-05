import { useEffect, type CSSProperties } from 'react';
import { eventOrigin, useCockpitKeys, type ItemId } from '@surface/cockpit';
import { cssVar, tokens, v } from '../tokens.js';
import { useResolvedTheme } from '../useCockpitTheme.js';
import { useResponsiveCollapse } from '../useResponsiveCollapse.js';
import { actionsBindEscape, shouldInterceptEscape } from '../layout.js';
import type { CockpitProps } from '../types.js';
import { CockpitDetail } from './CockpitDetail.js';
import { CockpitList } from './CockpitList.js';
import { CockpitProvider, useCockpitContext } from './CockpitProvider.js';

/** Stable root class the scoped stylesheet keys off. Never remounted. */
const ROOT_CLASS = 'cockpit-root';
const NARROW_CLASS = 'cockpit-root--narrow';

/**
 * One uniquely-scoped stylesheet for everything inline styles can't express —
 * `:focus-visible` rings, the reduced-motion override, and the narrow-mode pane
 * layout (design brief §3.2 / §3.2b). Every selector is scoped under
 * `.cockpit-root`, so nothing leaks into the consuming app's DOM; the ring color
 * flows from `--cockpit-accent` so it re-themes per subtree. Emitted identically
 * per mount (cascade-safe on multi-mount pages), at the ROOT — never inside a
 * subtree that could be keyed/remounted.
 *
 * The `!important` on the narrow rules is deliberate and mirrors the
 * reduced-motion mechanism: stylesheet `!important` beats the panes' inline
 * width/flex, so the two-pane inline defaults collapse only under the class.
 */
const rootCss = `
.${ROOT_CLASS} :focus-visible {
  outline: 2px solid ${cssVar('--cockpit-accent')};
  outline-offset: 2px;
}
@media (prefers-reduced-motion: reduce) {
  .${ROOT_CLASS} *,
  .${ROOT_CLASS} *::before,
  .${ROOT_CLASS} *::after {
    transition: none !important;
    animation: none !important;
  }
}
.${NARROW_CLASS} .cockpit-pane--list {
  width: 100% !important;
  flex: 1 1 auto !important;
  border-right: none !important;
}
.${NARROW_CLASS} .cockpit-pane--detail {
  flex: 1 1 auto !important;
}
.${NARROW_CLASS}[data-cockpit-view="detail"] .cockpit-pane--list {
  display: none !important;
}
.${NARROW_CLASS}[data-cockpit-view="list"] .cockpit-pane--detail {
  display: none !important;
}
`;

/** Local alias so `TwoPaneLayout`'s `mapItem` matches `<Cockpit>`'s exactly. */
type DisplayItemOf<T extends ItemId> = ReturnType<CockpitProps<T>['mapItem']>;

interface TwoPaneLayoutProps<T extends ItemId> {
  themeVars: CSSProperties;
  mapItem: (item: T) => DisplayItemOf<T>;
  renderRowAside?: CockpitProps<T>['renderRowAside'];
  renderDetailBefore?: CockpitProps<T>['renderDetailBefore'];
}

/**
 * The two-pane arrangement, expressed as a composition of the promoted pieces
 * (composable-layout impl node 5). PRIVATE — never exported; `<Cockpit>` is its
 * only mount. It is the worked example of arranging the shared pieces into the
 * shipped two-pane / narrow-collapse layout, not a fork of them:
 *   - the shared ENGINE comes from `<CockpitProvider>` (read here via
 *     `useCockpitContext`), not a private `useCockpit` call;
 *   - the KEY wiring is the engine's own `useCockpitKeys` resolver (j/k via
 *     `defaultKeymap`, plus `1-9` positional + named `action.keybind` keys) —
 *     attached to `window` to match the shipped `<Cockpit>` posture (keys work
 *     without first clicking into the cockpit). The provider's own
 *     container-scoped listener is disabled (`<Cockpit>` passes `keymap={null}`)
 *     so exactly one listener is live;
 *   - the narrow single-pane COLLAPSE comes from `useResponsiveCollapse` (the
 *     ResizeObserver + `view`/`isNarrow` state + the wired activate/back
 *     handlers), not an inline observer.
 *
 * What legitimately stays HERE is the ARRANGEMENT: the two-pane box, the scoped
 * stylesheet, and the Escape-to-list narrow gesture (a view concern the engine
 * has no opinion on). Focus vs. activation stays split exactly as before —
 * `useResponsiveCollapse`'s `onActivate` overrides the list's default `onSelect`
 * so a tap focuses AND (when narrow) opens the detail, while j/k keeps focus in
 * the list (brief §3.2b).
 */
function TwoPaneLayout<T extends ItemId = ItemId>({
  themeVars,
  mapItem,
  renderRowAside,
  renderDetailBefore,
}: TwoPaneLayoutProps<T>) {
  const engine = useCockpitContext<T>();

  // Narrow single-pane collapse: the observer + view state + wired handlers all
  // come from the shared hook. `onActivate` runs the engine's `setFocusedItem`
  // and, when narrow, flips to the detail view — so one row handler both focuses
  // and opens (focus/activation split, brief §3.2b).
  const { ref, isNarrow, view, onActivate, onBack } =
    useResponsiveCollapse<HTMLDivElement>({ onActivate: engine.setFocusedItem });

  // Keyboard nav + action keybinds through the engine's own resolver, on the
  // window (the shipped posture). `defaultKeymap` gives j/k; the resolver also
  // fires `1-9` positional + named `action.keybind` keys. The provider's
  // container-scoped listener is disabled by `<Cockpit>` (`keymap={null}`), so
  // this is the single live listener — no double dispatch.
  useCockpitKeys(engine, {});

  // Escape returns from the narrow detail view to the list (brief D-N1). This is
  // an ARRANGEMENT gesture, not an engine intent, so it lives with the layout —
  // and it yields to a consumer action that binds Escape (which the key resolver
  // then fires instead). Only intercepted when narrow AND in detail, never while
  // focus is in an editable element.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (
        !actionsBindEscape(engine.actions) &&
        // Pass the real origin node, not just its tag: the guard then sees
        // `contenteditable` regions (inherited cases included), which a tag name
        // alone cannot express. `eventOrigin` rather than `e.target` so a field
        // inside a shadow root — retargeted to the host — suppresses here too,
        // keeping this guard and the key resolver's guard one rule.
        shouldInterceptEscape({ isNarrow, view, target: eventOrigin(e) })
      ) {
        onBack();
        e.preventDefault();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [engine.actions, isNarrow, view, onBack]);

  return (
    <div
      ref={ref}
      className={isNarrow ? `${ROOT_CLASS} ${NARROW_CLASS}` : ROOT_CLASS}
      data-cockpit-view={view}
      style={{
        // System-adaptive / explicit theme vars applied at the root, so every
        // descendant's bare `var(--cockpit-*)` and the literals below resolve
        // against the resolved theme. Empty (inherit posture) leaves ancestor vars.
        ...themeVars,
        display: 'flex',
        height: '100%',
        minHeight: 0,
        color: v.text,
        background: v.surface,
        fontFamily: v.fontFamily,
        fontSize: tokens.font.body,
      }}
      data-testid="cockpit"
    >
      {/* Root-scoped stylesheet: focus rings, reduced-motion, narrow panes. */}
      <style>{rootCss}</style>

      {/* List sidebar. Reads items/focus off the shared engine (context); only
          `onSelect` is overridden — to the collapse's activate handler — so a tap
          focuses AND (when narrow) opens the detail. */}
      <aside
        className="cockpit-pane cockpit-pane--list"
        style={{
          width: '21rem',
          flexShrink: 0,
          borderRight: `1px solid ${v.border}`,
          background: v.surfaceSunken,
          overflow: 'auto',
        }}
        data-testid="cockpit-list-pane"
      >
        <CockpitList<T>
          mapItem={mapItem}
          renderRowAside={renderRowAside}
          onSelect={onActivate}
        />
      </aside>

      {/* Detail pane. Reads the focused item/actions/dispatch off the shared
          engine (context); it renders its own "no item selected" empty state, so
          this pane needs no external guard. `onBack` is threaded only when narrow
          (the back affordance is a single-pane concern). */}
      <main
        className="cockpit-pane cockpit-pane--detail"
        style={{
          flex: '1 1 0%',
          minWidth: 0,
          overflow: 'auto',
          background: v.surface,
        }}
        data-testid="cockpit-detail-pane"
      >
        <CockpitDetail<T>
          mapItem={mapItem}
          renderDetailBefore={renderDetailBefore}
          onBack={isNarrow ? onBack : undefined}
        />
      </main>
    </div>
  );
}

/**
 * Pre-styled presentational display for the cockpit engine.
 * Renders a two-pane layout (list sidebar left, detail pane right) off the
 * headless cockpit engine and wires keyboard navigation globally.
 *
 * Re-expressed (composable-layout impl node 5) as a COMPOSITION of the promoted
 * pieces rather than a fork of them: `<Cockpit>` mounts `<CockpitProvider>` (the
 * shared engine + context) around a private `<TwoPaneLayout>` that arranges
 * `<CockpitList>` + `<CockpitDetail>` and pulls keyboard + collapse wiring from
 * the shared `useCockpitKeys` / `useResponsiveCollapse` primitives. Its public
 * props and zero-config behavior are unchanged — `<Cockpit>` is now the worked
 * example of that arrangement, no longer the only frame (see the design brief's
 * composable-layout arc). Consumers who want a different arrangement compose the
 * same exported pieces directly; consumers who want different rendering entirely
 * use `useCockpit` (the headless tier).
 *
 * The agent maps each opaque engine item to display fields via `mapItem`, and may
 * inject content into two additive regions via `renderRowAside` / `renderDetailBefore`.
 *
 * Styling: inline styles + one scoped stylesheet (no Tailwind, no CSS file to
 * import). Self-contained; mounting it renders correctly with zero consumer
 * setup, and every color/radius/shadow/font is a `--cockpit-*` variable a
 * consumer may override. Consuming apps that need different rendering use
 * `useCockpit` directly (the headless tier).
 *
 * Responsive: on a narrow root element (ResizeObserver, ~640px inline-size) it
 * collapses to one pane — j/k move focus in the list; tapping a row opens the
 * detail full-width; a back affordance / Escape returns to the list (brief §3.2b).
 */
export function Cockpit<T extends ItemId = ItemId>({
  items,
  actions,
  onAction,
  mapItem,
  renderRowAside,
  renderDetailBefore,
  theme,
  themeStorageKey,
  bus,
}: CockpitProps<T>) {
  // Default posture: resolve system-adaptive (prefers-color-scheme + persisted
  // toggle) and apply the resulting `--cockpit-*` vars on our own root, so a bare
  // mount adapts with zero setup. The hook is always called (rules-of-hooks); its
  // result is only APPLIED when no consumer theme is given. `'inherit'` opts fully
  // out (the consumer applies vars at an ancestor and we must not fight it); an
  // explicit `CockpitTheme` wins outright. Precedence: explicit > toggle > system.
  const resolved = useResolvedTheme({ storageKey: themeStorageKey });
  const themeVars: CSSProperties =
    theme === 'inherit'
      ? {}
      : theme
        ? (theme as CSSProperties)
        : (resolved.theme as CSSProperties);

  // The shared engine + its context live in the provider; the two-pane
  // arrangement reads them off context. `keymap={null}` disables the provider's
  // OWN container-scoped key listener — `<Cockpit>` keeps keys on `window`
  // (wired in `TwoPaneLayout` via `useCockpitKeys`) to preserve the shipped
  // posture where j/k work without first focusing into the cockpit. `onActivate`
  // is intentionally unwired: the shipped `<Cockpit>` uses per-action keybinds,
  // and `defaultKeymap` leaves `activate` unbound.
  return (
    <CockpitProvider
      items={items}
      actions={actions}
      onAction={onAction}
      keymap={null}
      bus={bus}
    >
      <TwoPaneLayout<T>
        themeVars={themeVars}
        mapItem={mapItem}
        renderRowAside={renderRowAside}
        renderDetailBefore={renderDetailBefore}
      />
    </CockpitProvider>
  );
}
