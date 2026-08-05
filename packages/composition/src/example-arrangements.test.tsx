// @vitest-environment happy-dom
/**
 * Worked arrangements — mount + engine-wiring proof (composable-layout impl node
 * 6). Renders the two example arrangements from
 * `example-arrangements.tsx` into a real DOM and drives the actual production
 * paths, so this asserts the wiring FIRED, not just that markup looks right:
 *
 *   - stacked arrow-nav: a rebound arrow key advances the SHARED engine and the
 *     stacked detail follows; the old `j` binding is dead; the custom token-seam
 *     var map is applied on the ancestor;
 *   - master-detail collapse: the ONE `useResponsiveCollapse` return drives a
 *     real narrow→collapse→activate→back→widen cycle end-to-end, threaded as one
 *     object (baked fix 1 part a); the shipped `themes.console` restyle is applied.
 *
 * `useResponsiveCollapse` mounts a `ResizeObserver`, which happy-dom does not
 * implement — so this installs `exampleResizeObserver`, a fake that captures the
 * hook's real callback and lets the test play width changes through it. That
 * drives the REAL hook path (observer → `readObservedInlineSize` →
 * `isNarrowInlineSize` → `setIsNarrow` → the returned `onActivate` flips `view`),
 * standing in ONLY for the browser's observer plumbing.
 *
 * All new test helpers/fakes are `example`-prefixed (parallel-sibling guard).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import {
  ExampleStackedArrowNav,
  ExampleMasterDetailCollapse,
  EXAMPLE_ITEMS,
} from './example-arrangements.js';

// ── Fake ResizeObserver — captures the hook's callback so the test drives width ──
type ExampleROCallback = (entries: unknown[], observer: unknown) => void;
interface ExampleRORecord {
  cb: ExampleROCallback;
  el: Element | null;
}
const exampleObservers: ExampleRORecord[] = [];

class ExampleResizeObserver {
  private cb: ExampleROCallback;
  constructor(cb: ExampleROCallback) {
    this.cb = cb;
    exampleObservers.push({ cb, el: null });
  }
  observe(el: Element) {
    const rec = exampleObservers.find((o) => o.cb === this.cb);
    if (rec) rec.el = el;
  }
  unobserve() {}
  disconnect() {
    const i = exampleObservers.findIndex((o) => o.cb === this.cb);
    if (i >= 0) exampleObservers.splice(i, 1);
  }
}

/** Play a width through every live observer callback (wrapped in act()). */
function exampleResizeTo(width: number) {
  const entries = [{ contentBoxSize: [{ inlineSize: width, blockSize: 0 }] }];
  act(() => {
    for (const rec of [...exampleObservers]) rec.cb(entries, {});
  });
}

let exampleOriginalRO: typeof ResizeObserver | undefined;
let exampleContainer: HTMLDivElement | null = null;
let exampleRoot: Root | null = null;

beforeEach(() => {
  exampleOriginalRO = (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ExampleResizeObserver;
  exampleObservers.length = 0;
});

afterEach(() => {
  if (exampleRoot) act(() => exampleRoot!.unmount());
  exampleContainer?.remove();
  exampleRoot = null;
  exampleContainer = null;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = exampleOriginalRO;
});

function exampleMount(ui: React.ReactElement): HTMLElement {
  exampleContainer = document.createElement('div');
  document.body.appendChild(exampleContainer);
  exampleRoot = createRoot(exampleContainer);
  act(() => {
    exampleRoot!.render(ui);
  });
  return exampleContainer;
}

function exampleText(root: HTMLElement, testid: string): string {
  return root.querySelector(`[data-testid="${testid}"]`)?.textContent ?? '';
}

function exampleHas(root: HTMLElement, testid: string): boolean {
  return root.querySelector(`[data-testid="${testid}"]`) !== null;
}

/** Focus a row button and dispatch a bubbling keydown (routes to the provider). */
function examplePressOnRow(root: HTMLElement, id: string, key: string) {
  const el = root.querySelector<HTMLButtonElement>(`[data-testid="cockpit-item-${id}"]`);
  if (!el) throw new Error(`no row ${id}`);
  el.focus();
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

function exampleClick(root: HTMLElement, testid: string) {
  const el = root.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
  if (!el) throw new Error(`no element ${testid}`);
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
describe('arrangement 1 — stacked, arrow-key nav, custom token restyle', () => {
  it('stacks detail ABOVE list, both wired off the shared engine (context)', () => {
    const root = exampleMount(<ExampleStackedArrowNav />);
    // Both panes present, in a single column (detail first in DOM order).
    expect(exampleHas(root, 'example-stacked-detail')).toBe(true);
    expect(exampleHas(root, 'example-stacked-list')).toBe(true);
    const detailIdx = Array.from(root.querySelectorAll('[data-testid]')).findIndex(
      (n) => n.getAttribute('data-testid') === 'example-stacked-detail',
    );
    const listIdx = Array.from(root.querySelectorAll('[data-testid]')).findIndex(
      (n) => n.getAttribute('data-testid') === 'example-stacked-list',
    );
    expect(detailIdx).toBeLessThan(listIdx); // detail above list
    // Engine drives focus to index 0 → detail shows the first item, from context.
    expect(exampleText(root, 'cockpit-detail-title')).toBe(EXAMPLE_ITEMS[0].title);
    // All three rows render (from mapItem — engine items are opaque).
    expect(exampleHas(root, 'cockpit-item-q1')).toBe(true);
    expect(exampleHas(root, 'cockpit-item-q3')).toBe(true);
  });

  it('a REBOUND arrow key advances the shared engine; the detail follows', () => {
    const root = exampleMount(<ExampleStackedArrowNav />);
    expect(exampleText(root, 'cockpit-position')).toBe('#1/3');
    examplePressOnRow(root, 'q1', 'ArrowDown'); // rebound: ArrowDown → next
    expect(exampleText(root, 'cockpit-detail-title')).toBe(EXAMPLE_ITEMS[1].title);
    expect(exampleText(root, 'cockpit-position')).toBe('#2/3');
  });

  it('the OLD j binding is dead once nav is rebound to the arrows', () => {
    const root = exampleMount(<ExampleStackedArrowNav />);
    examplePressOnRow(root, 'q1', 'j'); // j is not in the custom keymap → no move
    expect(exampleText(root, 'cockpit-position')).toBe('#1/3');
    expect(exampleText(root, 'cockpit-detail-title')).toBe(EXAMPLE_ITEMS[0].title);
  });

  it('an action button still routes through the shared engine → onAction', () => {
    const onAction = vi.fn();
    const root = exampleMount(<ExampleStackedArrowNav onAction={onAction} />);
    exampleClick(root, 'cockpit-action-keep');
    expect(onAction).toHaveBeenCalledWith('keep', 'q1'); // focused item id
  });

  it('restyles through the token seam — the custom --cockpit-* map is on the ancestor', () => {
    const root = exampleMount(<ExampleStackedArrowNav />);
    const ancestor = root.querySelector('[data-testid="example-stacked"]')!;
    const style = ancestor.getAttribute('style') ?? '';
    expect(style).toContain('--cockpit-accent');
    expect(style).toContain('#b4531f');
    expect(style).toContain('--cockpit-radius-md');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('arrangement 2 — master-detail collapse (the ONE-wire proof, fix 1 part a)', () => {
  it('wide container → both panes render, no back affordance', () => {
    const root = exampleMount(<ExampleMasterDetailCollapse />);
    exampleResizeTo(1200); // observed wide
    expect(root.querySelector('[data-testid="example-md-root"]')?.getAttribute('data-narrow')).toBe(
      'false',
    );
    expect(exampleHas(root, 'example-md-list')).toBe(true);
    expect(exampleHas(root, 'example-md-detail')).toBe(true);
    expect(exampleHas(root, 'cockpit-back')).toBe(false); // desktop: no "back"
  });

  it('narrow container → collapses to the LIST pane only (focus ≠ shown)', () => {
    const root = exampleMount(<ExampleMasterDetailCollapse />);
    exampleResizeTo(390); // iPhone-width → narrow
    const rootEl = root.querySelector('[data-testid="example-md-root"]')!;
    expect(rootEl.getAttribute('data-narrow')).toBe('true');
    expect(rootEl.getAttribute('data-view')).toBe('list');
    expect(exampleHas(root, 'example-md-list')).toBe(true);
    expect(exampleHas(root, 'example-md-detail')).toBe(false); // detail hidden until activated
  });

  it('activating a row (tap) opens the detail full-width AND focuses the item', () => {
    const root = exampleMount(<ExampleMasterDetailCollapse />);
    exampleResizeTo(390);
    // Nav (keyboard) alone must NOT open the detail — it only moves focus in-list.
    examplePressOnRow(root, 'q1', 'j'); // default keymap (provider): j → next
    expect(
      root.querySelector('[data-testid="example-md-root"]')?.getAttribute('data-view'),
    ).toBe('list'); // still the list — focus moved, view did not
    // Activation (click) is the separate event that opens the detail.
    exampleClick(root, 'cockpit-item-q2');
    const rootEl = root.querySelector('[data-testid="example-md-root"]')!;
    expect(rootEl.getAttribute('data-view')).toBe('detail');
    expect(exampleHas(root, 'example-md-detail')).toBe(true);
    expect(exampleHas(root, 'example-md-list')).toBe(false); // list hidden in detail view
    // The SAME activation focused the item (onActivate = setFocusedItem + flip):
    expect(exampleText(root, 'cockpit-detail-title')).toBe(EXAMPLE_ITEMS[1].title);
    // And the detail carries a back affordance (onBack threaded in narrow mode).
    expect(exampleHas(root, 'cockpit-back')).toBe(true);
  });

  it('the back affordance (onBack, one wire) returns to the list', () => {
    const root = exampleMount(<ExampleMasterDetailCollapse />);
    exampleResizeTo(390);
    exampleClick(root, 'cockpit-item-q1'); // open detail
    expect(
      root.querySelector('[data-testid="example-md-root"]')?.getAttribute('data-view'),
    ).toBe('detail');
    exampleClick(root, 'cockpit-back'); // ← the threaded onBack
    expect(
      root.querySelector('[data-testid="example-md-root"]')?.getAttribute('data-view'),
    ).toBe('list');
    expect(exampleHas(root, 'example-md-list')).toBe(true);
  });

  it('widening back out of narrow restores both panes and resets the view', () => {
    const root = exampleMount(<ExampleMasterDetailCollapse />);
    exampleResizeTo(390);
    exampleClick(root, 'cockpit-item-q1'); // narrow + detail view
    expect(
      root.querySelector('[data-testid="example-md-root"]')?.getAttribute('data-view'),
    ).toBe('detail');
    exampleResizeTo(1200); // widen
    const rootEl = root.querySelector('[data-testid="example-md-root"]')!;
    expect(rootEl.getAttribute('data-narrow')).toBe('false');
    expect(rootEl.getAttribute('data-view')).toBe('list'); // reset on leaving narrow
    expect(exampleHas(root, 'example-md-list')).toBe(true);
    expect(exampleHas(root, 'example-md-detail')).toBe(true);
  });

  it('restyles through the token seam — the shipped themes.console is on the ancestor', () => {
    const root = exampleMount(<ExampleMasterDetailCollapse />);
    const ancestor = root.querySelector('[data-testid="example-md"]')!;
    const style = ancestor.getAttribute('style') ?? '';
    expect(style).toContain('--cockpit-surface');
    expect(style).toContain('--cockpit-accent');
  });
});
