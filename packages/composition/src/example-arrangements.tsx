/**
 * Worked arrangements — the promoted pieces arranged NON-default, off
 * `<CockpitProvider>` + `useCockpitContext()` + `useResponsiveCollapse`, never
 * `<Cockpit>` (composable-layout impl node 6).
 *
 * These ARE the demonstration of the arc's DIRECTION SEED: a consumer is NOT
 * locked into the side-by-side two-pane layout or j/k nav. The contract is
 * "iterate a list of items with these affordances"; `<Cockpit>`'s two-pane j/k
 * default is one EXAMPLE realization a consumer deviates from. Each arrangement
 * here deviates on a different axis, using only the public exports:
 *
 *   1. `ExampleStackedArrowNav`     — a single-column STACK (detail above list),
 *      with nav REBOUND to the arrow keys via a custom `keymap`, and a restyle
 *      through the `--cockpit-*` token seam using a hand-written var map (NOT a
 *      shipped theme). Proves arrangement AND keybindings AND look are all
 *      consumer-choosable.
 *
 *   2. `ExampleMasterDetailCollapse` — a free-form master-detail that COLLAPSES
 *      to one pane on a narrow container via `useResponsiveCollapse`, restyled
 *      with the shipped `themes.console`. This is the load-bearing proof (baked
 *      fix 1 part a): a master-detail consumer who wants collapse threads the ONE
 *      object the hook returns — `ref`, `isNarrow`/`view`, `onActivate`, `onBack`
 *      — not three separately-wired things. See `ExampleMasterDetailInner`.
 *
 * Imports come from the PUBLIC package names (`@surface/cockpit-ui`,
 * `@surface/cockpit`) exactly as an out-of-repo consumer would write them — this
 * file is copy-pasteable, not reaching into library internals.
 */

import type { CSSProperties } from 'react';
import {
  CockpitProvider,
  CockpitList,
  CockpitDetail,
  useCockpitContext,
  useResponsiveCollapse,
  themes,
  type DisplayItem,
} from '@surface/cockpit-ui';
import type { CockpitAction, Keymap } from '@surface/cockpit';

// ── Shared example inputs (a tiny opaque queue + two actions) ────────────────
export interface ExampleQueueItem {
  id: string;
  title: string;
  body: string;
}

export const EXAMPLE_ITEMS: ExampleQueueItem[] = [
  { id: 'q1', title: 'Renew the domain', body: 'surface-voice-triage.dev expires in 9 days.' },
  { id: 'q2', title: 'Reply to the contractor', body: 'Confirm the rewire scheduling window.' },
  { id: 'q3', title: 'Book the flight', body: 'Denver to Sydney, award seats opened up.' },
];

export const EXAMPLE_ACTIONS: CockpitAction[] = [
  { id: 'keep', label: 'Keep', keybind: 'Enter' },
  { id: 'archive', label: 'Archive', keybind: 'a' },
];

export const exampleMapItem = (it: ExampleQueueItem): DisplayItem => ({
  title: it.title,
  body: it.body,
});

interface ExampleArrangementProps {
  /** A real consumer passes their own handler; the demo defaults it to a no-op. */
  onAction?: (actionId: string, itemId: string) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Arrangement 1 — stacked, arrow-key nav, custom token restyle
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Nav rebound to the arrow keys (defaults are j/k). The keymap is plain data —
 * `defaultKeymap` is the shipped EXAMPLE, not the contract — so passing this
 * REBINDS the keys with zero library change and no nav logic re-derived. Two keys
 * per intent shows a binding is a `string[]`, not a single key.
 */
export const EXAMPLE_ARROW_KEYMAP: Keymap = {
  next: ['ArrowDown', 'ArrowRight'],
  prev: ['ArrowUp', 'ArrowLeft'],
  activate: ['Enter'],
};

/**
 * A hand-written `--cockpit-*` map — the token seam restyle WITHOUT a shipped
 * theme. Set on any shared ancestor; the pieces below inherit it (no prop, no CSS
 * import, no build step). Only the vars a consumer wants to move need listing; the
 * rest fall through to each piece's inline default.
 */
export const EXAMPLE_CUSTOM_VARS: Record<string, string> = {
  '--cockpit-accent': '#b4531f',
  '--cockpit-accent-hover': '#9a4419',
  '--cockpit-accent-soft': '#f6e7dc',
  '--cockpit-radius-md': '0.5rem',
};

/**
 * Single-column stack: the detail pane sits ABOVE the list, the opposite of
 * `<Cockpit>`'s side-by-side arrangement. The pieces read the shared engine off
 * context, so no engine state is threaded between them — dropping them in this
 * order is the entire "arrangement."
 */
export function ExampleStackedArrowNav({ onAction = () => {} }: ExampleArrangementProps = {}) {
  return (
    <div style={EXAMPLE_CUSTOM_VARS as CSSProperties} data-testid="example-stacked">
      <CockpitProvider
        items={EXAMPLE_ITEMS}
        actions={EXAMPLE_ACTIONS}
        onAction={onAction}
        keymap={EXAMPLE_ARROW_KEYMAP}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div
            data-testid="example-stacked-detail"
            style={{ minHeight: '12rem', border: '1px solid var(--cockpit-border, #e5e5e5)' }}
          >
            <CockpitDetail<ExampleQueueItem> mapItem={exampleMapItem} />
          </div>
          <div data-testid="example-stacked-list">
            <CockpitList<ExampleQueueItem> mapItem={exampleMapItem} />
          </div>
        </div>
      </CockpitProvider>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Arrangement 2 — free-form master-detail that COLLAPSES (the load-bearing proof)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The inner arrangement. It reads the shared engine off context and calls
 * `useResponsiveCollapse` ONCE, then threads that hook's single return:
 *
 *   - `ref`               → the root element whose OWN width gates the collapse
 *                           (a narrow column on a wide desktop collapses too);
 *   - `isNarrow` / `view` → which pane(s) to render;
 *   - `onActivate`        → the list's `onSelect` (focuses the item AND, when
 *                           narrow, opens the detail);
 *   - `onBack`            → the detail's `onBack` (returns to the list).
 *
 * That is the whole point of baked fix 1 part a: a master-detail consumer wires
 * ONE object, not three separate things (mount an observer + override select to
 * flip the view + thread a back handler). Passing `engine.setFocusedItem` as the
 * hook's `onActivate` is what fuses focus with the view flip in a single row
 * handler.
 */
function ExampleMasterDetailInner() {
  const engine = useCockpitContext<ExampleQueueItem>();
  const { ref, isNarrow, view, onActivate, onBack } =
    useResponsiveCollapse<HTMLDivElement>({ onActivate: engine.setFocusedItem });

  // Wide: both panes. Narrow: exactly one, chosen by `view`.
  const showList = !isNarrow || view === 'list';
  const showDetail = !isNarrow || view === 'detail';

  return (
    <div
      ref={ref}
      data-testid="example-md-root"
      data-narrow={isNarrow ? 'true' : 'false'}
      data-view={view}
      style={{ display: 'flex', gap: isNarrow ? 0 : '1rem', height: '100%' }}
    >
      {showList ? (
        <div
          data-testid="example-md-list"
          style={{ flex: isNarrow ? '1 1 100%' : '0 0 20rem', minWidth: 0 }}
        >
          {/* onSelect override = the collapse's onActivate: focus + (narrow) open. */}
          <CockpitList<ExampleQueueItem> mapItem={exampleMapItem} onSelect={onActivate} />
        </div>
      ) : null}
      {showDetail ? (
        <div data-testid="example-md-detail" style={{ flex: '1 1 auto', minWidth: 0 }}>
          {/* onBack only when narrow — desktop shows both panes, no "back". */}
          <CockpitDetail<ExampleQueueItem>
            mapItem={exampleMapItem}
            onBack={isNarrow ? onBack : undefined}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Master-detail arrangement, restyled with the shipped `themes.console` (the
 * token seam again — this time applying a ready theme by reference rather than a
 * hand-written map). The provider supplies the shared engine + keyboard nav; the
 * inner component owns the responsive collapse.
 */
export function ExampleMasterDetailCollapse({ onAction = () => {} }: ExampleArrangementProps = {}) {
  return (
    <div style={themes.console as CSSProperties} data-testid="example-md">
      <CockpitProvider items={EXAMPLE_ITEMS} actions={EXAMPLE_ACTIONS} onAction={onAction}>
        <ExampleMasterDetailInner />
      </CockpitProvider>
    </div>
  );
}
