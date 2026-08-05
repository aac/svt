/**
 * useResponsiveCollapse — the responsive-collapse hook (composable-layout impl
 * node 4, brief §3.2b / baked fix 1 part b).
 *
 * The hook itself is a thin React binding: a ResizeObserver, `isNarrow`/`view`
 * state, and a reset-on-leave effect. All of its decisions are the pure fns in
 * cockpit-ui's `layout` module, so — exactly as the sibling `cockpit-narrow`
 * suite does — this exercises the logic at the boundary that holds the rules (no
 * DOM environment is configured in this repo; the rendered collapse is a dogfood
 * item). To prove the "one wired return" contract end-to-end without a renderer,
 * `collapseSimulateHook` assembles the hook's exact return object out of the SAME
 * pure fns the hook uses (`readObservedInlineSize` → `isNarrowInlineSize` for
 * narrow detection; `buildCollapseHandlers` for the activate/back bundle),
 * standing in ONLY for React's useState/ResizeObserver plumbing.
 *
 * Fakes/helpers are `collapse`-prefixed to stay clear of parallel sibling suites.
 */

import { describe, it, expect } from 'vitest';
import {
  NARROW_BREAKPOINT,
  isNarrowInlineSize,
  readObservedInlineSize,
  buildCollapseHandlers,
  type CockpitView,
} from '../../cockpit-ui/src/layout';

/** A minimal ResizeObserver entry, shaped like the real callback's `entries[0]`.
 * `-readonly` strips the DOM lib's readonly modifiers so the fake can be built by
 * conditional assignment (the real entry props are readonly; the test double isn't). */
type CollapseEntryShape = {
  -readonly [K in 'contentBoxSize' | 'contentRect']?: ResizeObserverEntry[K];
};
function collapseFakeEntry(opts: {
  inlineSize?: number;
  rectWidth?: number;
}): CollapseEntryShape {
  const entry: CollapseEntryShape = {};
  if (opts.inlineSize !== undefined) {
    entry.contentBoxSize = [
      { inlineSize: opts.inlineSize, blockSize: 0 },
    ] as unknown as ResizeObserverEntry['contentBoxSize'];
  }
  if (opts.rectWidth !== undefined) {
    entry.contentRect = { width: opts.rectWidth } as DOMRectReadOnly;
  }
  return entry;
}

describe('readObservedInlineSize — narrow detection off the ResizeObserver width', () => {
  it('prefers the standardized contentBoxSize inlineSize', () => {
    const entry = collapseFakeEntry({ inlineSize: 390, rectWidth: 1440 });
    const width = readObservedInlineSize(entry as ResizeObserverEntry, 9999);
    expect(width).toBe(390);
    expect(isNarrowInlineSize(width)).toBe(true); // 390px → narrow (iPhone target)
  });

  it('falls back to contentRect.width when contentBoxSize is absent', () => {
    const entry = collapseFakeEntry({ rectWidth: 800 });
    const width = readObservedInlineSize(entry as ResizeObserverEntry, 9999);
    expect(width).toBe(800);
    expect(isNarrowInlineSize(width)).toBe(false); // 800px → two-pane
  });

  it('falls back to the caller width (el.clientWidth) when the entry is missing', () => {
    expect(readObservedInlineSize(undefined, 360)).toBe(360);
    expect(isNarrowInlineSize(readObservedInlineSize(undefined, 360))).toBe(true);
  });

  it('a width at/above the breakpoint is not narrow', () => {
    const entry = collapseFakeEntry({ inlineSize: NARROW_BREAKPOINT });
    expect(isNarrowInlineSize(readObservedInlineSize(entry as ResizeObserverEntry, 0))).toBe(
      false,
    );
  });
});

describe('buildCollapseHandlers — the activate/back bundle (fix 1 part b)', () => {
  it('onActivate flips the view to detail when narrow AND forwards to the consumer select', () => {
    const collapseFocused: string[] = [];
    let collapseView: CockpitView = 'list';
    const { onActivate } = buildCollapseHandlers({
      isNarrow: true,
      setView: (fn) => (collapseView = fn(collapseView)),
      onActivate: (id) => collapseFocused.push(id),
    });
    onActivate('item-7');
    expect(collapseFocused).toEqual(['item-7']); // consumer focus ran
    expect(collapseView).toBe('detail'); // and the view flipped
  });

  it('onActivate on desktop (not narrow) forwards focus but leaves the view inert', () => {
    const collapseFocused: string[] = [];
    let collapseView: CockpitView = 'list';
    const { onActivate } = buildCollapseHandlers({
      isNarrow: false,
      setView: (fn) => (collapseView = fn(collapseView)),
      onActivate: (id) => collapseFocused.push(id),
    });
    onActivate('item-7');
    expect(collapseFocused).toEqual(['item-7']);
    expect(collapseView).toBe('list'); // two-pane: focus === shown, no flip
  });

  it('onBack returns to the list', () => {
    let collapseView: CockpitView = 'detail';
    const { onBack } = buildCollapseHandlers({
      isNarrow: true,
      setView: (fn) => (collapseView = fn(collapseView)),
    });
    onBack();
    expect(collapseView).toBe('list');
  });

  it('is safe with no consumer select (view-only consumer)', () => {
    let collapseView: CockpitView = 'list';
    const { onActivate } = buildCollapseHandlers({
      isNarrow: true,
      setView: (fn) => (collapseView = fn(collapseView)),
    });
    expect(() => onActivate('x')).not.toThrow();
    expect(collapseView).toBe('detail');
  });
});

/**
 * DOM-free stand-in for the hook: holds the same `isNarrow`/`view` state the hook
 * holds and assembles the identical single return out of the same pure fns. Only
 * React's useState + ResizeObserver plumbing is faked; `observeWidth` plays the
 * observer callback (`readObservedInlineSize` → `isNarrowInlineSize`), and the
 * returned handlers are rebuilt off the current `isNarrow`, exactly as the hook
 * rebuilds them per render.
 */
function collapseSimulateHook(consumerOnActivate?: (id: string) => void) {
  let isNarrow = false;
  let view: CockpitView = 'list';
  const setView = (fn: (prev: CockpitView) => CockpitView) => (view = fn(view));
  const bundle = () =>
    buildCollapseHandlers({ isNarrow, setView, onActivate: consumerOnActivate });
  return {
    get isNarrow() {
      return isNarrow;
    },
    get view() {
      return view;
    },
    /** Play a ResizeObserver callback with a fake entry. */
    observeWidth(entry: CollapseEntryShape | undefined, clientWidth = 0) {
      isNarrow = isNarrowInlineSize(
        readObservedInlineSize(entry as ResizeObserverEntry | undefined, clientWidth),
      );
      // Mirror the hook's reset-on-leave effect.
      if (!isNarrow) view = 'list';
    },
    onActivate(id: string) {
      bundle().onActivate(id);
    },
    onBack() {
      bundle().onBack();
    },
  };
}

describe('the single wired return — one thing, not three (fix 1 part b)', () => {
  it('narrow → activate opens detail → back returns to list, all off one return', () => {
    const collapseFocused: string[] = [];
    const c = collapseSimulateHook((id) => collapseFocused.push(id));

    // Starts two-pane; a narrow width collapses it.
    expect(c.isNarrow).toBe(false);
    c.observeWidth(collapseFakeEntry({ inlineSize: 390 }));
    expect(c.isNarrow).toBe(true);
    expect(c.view).toBe('list');

    // Activation (not focus) opens the detail full-width and focuses the item.
    c.onActivate('a');
    expect(collapseFocused).toEqual(['a']);
    expect(c.view).toBe('detail');

    // Back returns to the list.
    c.onBack();
    expect(c.view).toBe('list');
  });

  it('widening back out of narrow resets the view to list', () => {
    const c = collapseSimulateHook();
    c.observeWidth(collapseFakeEntry({ inlineSize: 390 }));
    c.onActivate('a');
    expect(c.view).toBe('detail');
    c.observeWidth(collapseFakeEntry({ inlineSize: 1200 })); // widen
    expect(c.isNarrow).toBe(false);
    expect(c.view).toBe('list');
  });
});
