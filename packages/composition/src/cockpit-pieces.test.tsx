// @vitest-environment happy-dom
/**
 * Promoted pieces — context-by-default + prop-override (composable-layout node 3).
 *
 * The load-bearing proof for the composable pieces: `CockpitList` / `CockpitDetail` are now
 * first-class exports that SELF-WIRE off the shared engine under a
 * `<CockpitProvider>` (drop them in any arrangement, no prop drilling), AND still
 * accept explicit engine props as the prop-drill escape hatch for a consumer NOT
 * using a provider. This exercises both mounting modes against the real rendered
 * DOM — the styling boundary cockpit-ui's LIBRARY.md claims
 * rests on these two paths actually working.
 *
 * `<Cockpit>`'s own prop-drill path is already pinned by display-split.test.ts /
 * token-seam.test.ts; this file adds what those don't: the CONTEXT default and the
 * pieces used standalone. Helpers are prefixed `pc` (parallel-sibling collision guard).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import {
  CockpitProvider,
  CockpitList,
  CockpitDetail,
  type DisplayItem,
} from '../../cockpit-ui/src';
import type { CockpitAction } from '@surface/cockpit';

interface PcItem {
  id: string;
  title: string;
  body: string;
}

const PC_ITEMS: PcItem[] = [
  { id: 'x', title: 'Strawberries', body: 'Peak season right now.' },
  { id: 'y', title: 'Avocados', body: 'Check ripeness before buying.' },
];
const PC_ACTIONS: CockpitAction[] = [{ id: 'keep', label: 'Keep', keybind: 'Enter' }];
const pcMap = (it: PcItem): DisplayItem => ({ title: it.title, body: it.body });

let pcContainer: HTMLDivElement | null = null;
let pcRoot: Root | null = null;

function pcMount(ui: React.ReactElement): HTMLElement {
  pcContainer = document.createElement('div');
  document.body.appendChild(pcContainer);
  pcRoot = createRoot(pcContainer);
  act(() => {
    pcRoot!.render(ui);
  });
  return pcContainer;
}

function pcText(root: HTMLElement, testid: string): string {
  return root.querySelector(`[data-testid="${testid}"]`)?.textContent ?? '';
}

/** Focus a row button and dispatch a bubbling keydown (routes to the provider). */
function pcPressOnRow(root: HTMLElement, id: string, key: string) {
  const el = root.querySelector<HTMLButtonElement>(`[data-testid="cockpit-item-${id}"]`);
  if (!el) throw new Error(`no row ${id}`);
  el.focus();
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

function pcClick(root: HTMLElement, testid: string) {
  const el = root.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
  if (!el) throw new Error(`no element ${testid}`);
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

afterEach(() => {
  if (pcRoot) act(() => pcRoot!.unmount());
  pcContainer?.remove();
  pcRoot = null;
  pcContainer = null;
});

describe('promoted pieces — context-by-default (self-wire under a provider)', () => {
  function pcArrangement(onAction = () => {}) {
    // A FREE-FORM arrangement (detail above list) — the pieces carry only mapItem;
    // items/focus/dispatch all come from the shared engine off context.
    return (
      <CockpitProvider items={PC_ITEMS} actions={PC_ACTIONS} onAction={onAction}>
        <div>
          <CockpitDetail<PcItem> mapItem={pcMap} />
          <CockpitList<PcItem> mapItem={pcMap} />
        </div>
      </CockpitProvider>
    );
  }

  it('renders both list rows and the focused item detail, all from context', () => {
    const root = pcMount(pcArrangement());
    // Both rows present (from mapItem — engine items are opaque).
    expect(root.querySelector('[data-testid="cockpit-item-x"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="cockpit-item-y"]')).not.toBeNull();
    // Engine drives focus to index 0 → detail shows item x, from context.
    expect(pcText(root, 'cockpit-detail-title')).toBe('Strawberries');
    expect(pcText(root, 'cockpit-detail-body')).toBe('Peak season right now.');
    // Position reads the shared focusedIndex.
    expect(pcText(root, 'cockpit-position')).toBe('#1/2');
  });

  it('a nav key advances the shared engine; the detail piece follows (one engine)', () => {
    const root = pcMount(pcArrangement());
    pcPressOnRow(root, 'x', 'j'); // default keymap: j → next
    // The DETAIL piece re-renders off the SAME engine — no prop wiring between them.
    expect(pcText(root, 'cockpit-detail-title')).toBe('Avocados');
    expect(pcText(root, 'cockpit-position')).toBe('#2/2');
    expect(
      root
        .querySelector('[data-testid="cockpit-item-y"]')
        ?.getAttribute('data-focused'),
    ).toBe('true');
  });

  it('clicking a row activates it via the default onSelect (engine setFocusedItem)', () => {
    const root = pcMount(pcArrangement());
    pcClick(root, 'cockpit-item-y'); // no onSelect prop → defaults to engine focus
    expect(pcText(root, 'cockpit-detail-title')).toBe('Avocados');
  });

  it('a detail action button routes through the engine (invokeAction → onAction)', () => {
    const onAction = vi.fn();
    const root = pcMount(pcArrangement(onAction));
    pcClick(root, 'cockpit-action-keep'); // no onAction prop on the piece
    expect(onAction).toHaveBeenCalledWith('keep', 'x'); // focused item id
  });

  it('renders its own empty state when nothing is focused (self-sufficient)', () => {
    const root = pcMount(
      <CockpitProvider items={[]} actions={PC_ACTIONS} onAction={() => {}}>
        <CockpitDetail<PcItem> mapItem={pcMap} />
      </CockpitProvider>,
    );
    expect(pcText(root, 'cockpit-detail')).toContain('No item selected');
  });
});

describe('promoted pieces — prop-override (no provider, prop-drill escape hatch)', () => {
  it('CockpitList renders from explicit props with no provider in the tree', () => {
    const onSelect = vi.fn();
    const root = pcMount(
      <CockpitList<PcItem>
        items={PC_ITEMS}
        focusedIndex={1}
        onSelect={onSelect}
        mapItem={pcMap}
      />,
    );
    // Renders both rows; the explicit focusedIndex (1) highlights item y.
    expect(
      root
        .querySelector('[data-testid="cockpit-item-y"]')
        ?.getAttribute('data-focused'),
    ).toBe('true');
    // Clicking calls the CONSUMER's onSelect, not any engine.
    pcClick(root, 'cockpit-item-x');
    expect(onSelect).toHaveBeenCalledWith('x');
  });

  it('CockpitDetail renders from explicit props with no provider in the tree', () => {
    const onAction = vi.fn();
    const root = pcMount(
      <CockpitDetail<PcItem>
        item={PC_ITEMS[1]}
        display={pcMap(PC_ITEMS[1])}
        actions={PC_ACTIONS}
        onAction={onAction}
      />,
    );
    expect(pcText(root, 'cockpit-detail-title')).toBe('Avocados');
    expect(pcText(root, 'cockpit-detail-body')).toBe('Check ripeness before buying.');
    // The explicit onAction fires directly (no engine to route through).
    pcClick(root, 'cockpit-action-keep');
    expect(onAction).toHaveBeenCalledWith('keep', 'y');
  });
});
