/**
 * Responsive single-pane collapse — the pure decision logic (design brief §3.2b).
 *
 * The narrow-mode behavior is factored into these plain functions so it is unit
 * testable at the boundary that actually holds the rules, without a DOM: the
 * `<Cockpit>` component wires a ResizeObserver + keyboard listener to them, but
 * the *decisions* (is it narrow, does j/k open detail, does Escape return to the
 * list) live here.
 */

import { isTextEntryTarget } from '@surface/cockpit';

/**
 * Inline-size (px) at/under which the two-pane layout collapses to one pane. The
 * cockpit is embeddable, so this is measured on the ROOT ELEMENT's own width (a
 * ResizeObserver), never the viewport — a cockpit in a narrow column on a wide
 * desktop must collapse too.
 */
export const NARROW_BREAKPOINT = 640;

/**
 * Narrow when a real, positive width has been observed and it is under the
 * breakpoint. Zero/unknown (SSR, first paint before the observer fires) is NOT
 * narrow, so the server and first client paint both render two-pane.
 */
export function isNarrowInlineSize(inlineSize: number): boolean {
  return inlineSize > 0 && inlineSize < NARROW_BREAKPOINT;
}

/** The two narrow-mode views. Inert on desktop (both panes always render). */
export type CockpitView = 'list' | 'detail';

/**
 * Narrow-mode events. Focus and activation are SEPARATE (brief §3.2b):
 *   - `nav`      — j/k moved focus. Stays in the current view (list stays list;
 *                  in detail it advances the item in place — intended carousel).
 *   - `activate` — a row was tapped/clicked. Opens the detail full-width.
 *   - `back`     — the back affordance. Returns to the list.
 *   - `escape`   — Escape key (already scoped by `shouldInterceptEscape`).
 */
export type NarrowEvent = 'nav' | 'activate' | 'back' | 'escape';

/** Next narrow view for an event. Pure; desktop callers keep `view` inert. */
export function reduceNarrowView(view: CockpitView, event: NarrowEvent): CockpitView {
  switch (event) {
    case 'nav':
      return view;
    case 'activate':
      return 'detail';
    case 'back':
      return 'list';
    case 'escape':
      return view === 'detail' ? 'list' : view;
    default:
      return view;
  }
}

const EDITABLE_TAGS = new Set(['input', 'textarea', 'select']);

/**
 * Whether a cockpit-level Escape should be intercepted to return to the list.
 * Only when narrow AND in the detail view, and never while focus is in an
 * editable element (brief delta D-N1). A consumer that binds Escape to an action
 * is honored separately (the component yields before consulting this).
 *
 * Two ways to name the focused element, both optional:
 *   - `target` — the real event target. Preferred: it routes through the engine's
 *     `isTextEntryTarget`, so this guard and the key resolver's guard are ONE rule
 *     (native fields + `contenteditable`, inherited cases included).
 *   - `targetTag` — tag name only. The pre-existing, DOM-free form; kept because a
 *     caller with nothing but a tag name is still a valid caller, but it CANNOT see
 *     `contenteditable`, so pass `target` when you have it.
 */
export function shouldInterceptEscape(args: {
  isNarrow: boolean;
  view: CockpitView;
  targetTag?: string | null;
  target?: EventTarget | null;
}): boolean {
  const { isNarrow, view, targetTag, target } = args;
  if (!isNarrow || view !== 'detail') return false;
  if (targetTag && EDITABLE_TAGS.has(targetTag.toLowerCase())) return false;
  if (target && isTextEntryTarget(target)) return false;
  return true;
}

/**
 * True if any consumer action binds the Escape key — in which case the cockpit
 * yields Escape to the consumer rather than using it as "back to list".
 */
export function actionsBindEscape(
  actions: ReadonlyArray<{ keybind?: string }>,
): boolean {
  return actions.some((a) => {
    const k = a.keybind?.toLowerCase();
    return k === 'escape' || k === 'esc';
  });
}

/**
 * Whether the detail body's scroll should be reset. Only on a real focused-item
 * CHANGE — a live accent flip (voice go/wait) keeps the same item id and must NOT
 * reset scroll mid-read (brief §3.2b.2). The component's reset effect runs on
 * accent changes too, so this guard is load-bearing, not decoration.
 */
export function shouldResetDetailScroll(
  prevItemId: string | null,
  nextItemId: string | null,
): boolean {
  return prevItemId !== nextItemId;
}

/**
 * Read the observed inline-size (px) out of a ResizeObserver entry, with the
 * fallback chain the spec allows: the standardized `contentBoxSize[0].inlineSize`
 * first, then the older `contentRect.width`, then a caller-supplied width
 * (typically `el.clientWidth`) when neither is present. Pure so the narrow
 * derivation off a real observer callback is unit-testable without a DOM — the
 * hook feeds the result straight into `isNarrowInlineSize`.
 */
export function readObservedInlineSize(
  entry: ResizeObserverEntry | undefined,
  fallbackWidth: number,
): number {
  return (
    entry?.contentBoxSize?.[0]?.inlineSize ??
    entry?.contentRect.width ??
    fallbackWidth
  );
}

/**
 * Build the activate/back handlers a responsive-collapse consumer wires (baked
 * fix 1 part b). This is the whole ergonomics point of `useResponsiveCollapse`:
 * a master-detail consumer that wants collapse must otherwise thread THREE things
 * — mount the observer, override select to flip `view` on activate, and thread a
 * back handler. This function bundles the last two so the hook returns ONE wired
 * object.
 *
 *   - `onActivate(id)` runs the consumer's own select callback (e.g. the engine's
 *     `setFocusedItem`) AND, when narrow, flips the view to `detail`. On desktop
 *     (not narrow) the view is inert, so it only forwards the select — focus and
 *     activation stay conflated there, which is correct for two-pane (brief §3.2b).
 *   - `onBack()` returns to the list.
 *
 * `setView` takes the functional-updater form so the handlers never close over a
 * stale `view` (they read `prev` at dispatch time). Pure: the React state setters
 * are injected, so the exact wiring the hook hands the consumer is testable with a
 * recording fake in a no-DOM env.
 */
export function buildCollapseHandlers(args: {
  isNarrow: boolean;
  setView: (updater: (prev: CockpitView) => CockpitView) => void;
  onActivate?: (id: string) => void;
}): { onActivate: (id: string) => void; onBack: () => void } {
  const { isNarrow, setView, onActivate } = args;
  return {
    onActivate(id: string) {
      onActivate?.(id);
      if (isNarrow) setView((prev) => reduceNarrowView(prev, 'activate'));
    },
    onBack() {
      setView((prev) => reduceNarrowView(prev, 'back'));
    },
  };
}
