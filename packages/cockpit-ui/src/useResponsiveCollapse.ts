/**
 * React wiring for the responsive single-pane collapse (design brief §3.2b,
 * composable-layout impl node 4 / baked fix 1 part b).
 *
 * The pure decisions live in `layout.ts` (`isNarrowInlineSize`,
 * `reduceNarrowView`, `readObservedInlineSize`, `buildCollapseHandlers`); this
 * module adds the three things that need a runtime: a `ResizeObserver` on the
 * consumer's root element, the `isNarrow`/`view` state, and the reset of `view`
 * on leaving narrow mode.
 *
 * WHY the hook returns the activate/back handlers (not just `isNarrow`/`view`):
 * `<Cockpit>` currently spreads this behavior across the component — it mounts the
 * observer, overrides `onSelect` to flip `view` on activate, AND threads `onBack`
 * into the detail pane. A free-form master-detail consumer that wants collapse
 * would have to replicate all three. This hook collapses them into ONE wired
 * return: mount `ref`, read `isNarrow`/`view`, and attach the returned
 * `onActivate`/`onBack`. The consumer threads one thing, not three (fix 1 part b).
 *
 * Independent of the engine on purpose: the hook owns only view/narrow state. A
 * consumer that also wants engine focus passes `setFocusedItem` as
 * `options.onActivate`; the returned `onActivate` runs it then flips the view, so
 * a single row handler does both. A consumer using the hook purely for view state
 * omits it.
 */

import { useEffect, useRef, useState } from 'react';
import {
  buildCollapseHandlers,
  isNarrowInlineSize,
  readObservedInlineSize,
  type CockpitView,
} from './layout.js';

export interface UseResponsiveCollapseOptions {
  /**
   * Consumer's own select callback (e.g. the engine's `setFocusedItem`). The
   * returned `onActivate` runs it before flipping the view, so one row handler
   * both focuses the item and (when narrow) opens the detail. Optional.
   */
  onActivate?: (id: string) => void;
}

/**
 * The single wired return. Thread all of it from one call: spread `ref` on the
 * root, drive layout off `isNarrow`/`view`, attach `onActivate` to rows and
 * `onBack` to the detail's back affordance.
 */
export interface ResponsiveCollapse<E extends HTMLElement = HTMLElement> {
  /** Attach to the root element whose OWN inline-size gates the collapse. */
  ref: React.RefObject<E | null>;
  /** True once a real width under the breakpoint has been observed. */
  isNarrow: boolean;
  /** Current narrow-mode view. Inert (stays `'list'`) while not narrow. */
  view: CockpitView;
  /** Focus the item (via `options.onActivate`) and, when narrow, open the detail. */
  onActivate: (id: string) => void;
  /** Return to the list. Safe to wire unconditionally; inert while not narrow. */
  onBack: () => void;
}

/**
 * Observe a root element's own inline-size and derive `isNarrow` + the collapse
 * `view`, returning the activate/back handlers bundled so a master-detail
 * consumer wires one thing (fix 1 part b). See the module comment for the WHY.
 *
 * The root's OWN width is observed (a `ResizeObserver`), never the viewport — the
 * cockpit is embeddable, so a narrow column on a wide desktop must collapse too.
 * SSR / first paint default to not-narrow (two-pane); the observer corrects on
 * mount, so no `window`/`ResizeObserver` access happens during render.
 */
export function useResponsiveCollapse<E extends HTMLElement = HTMLElement>(
  options: UseResponsiveCollapseOptions = {},
): ResponsiveCollapse<E> {
  const { onActivate } = options;
  const ref = useRef<E | null>(null);
  const [isNarrow, setIsNarrow] = useState(false);
  const [view, setView] = useState<CockpitView>('list');

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const inlineSize = readObservedInlineSize(entries[0], el.clientWidth);
      setIsNarrow(isNarrowInlineSize(inlineSize));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Leaving narrow mode returns the (now-inert) view to a clean default so a
  // later collapse always starts on the list.
  useEffect(() => {
    if (!isNarrow) setView('list');
  }, [isNarrow]);

  // The activate/back bundle (fix 1 part b). Rebuilt per render off the current
  // `isNarrow`; `setView`'s functional-updater form keeps the handlers from
  // closing over a stale `view`. Handler identity is intentionally not memoized —
  // no consumer depends on it, and stabilizing here would be over-engineering.
  const { onActivate: onActivateWired, onBack } = buildCollapseHandlers({
    isNarrow,
    setView,
    onActivate,
  });

  return { ref, isNarrow, view, onActivate: onActivateWired, onBack };
}
