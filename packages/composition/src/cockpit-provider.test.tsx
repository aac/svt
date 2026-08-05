// @vitest-environment happy-dom
/**
 * CockpitProvider — focus-scoped key routing (composable-layout impl node 2).
 *
 * The load-bearing proof for the container-ref decision: TWO providers mounted on
 * ONE page, each owning its own container-scoped key listener, must route a key
 * to exactly the provider whose subtree currently holds focus — never both. This
 * renders real providers into happy-dom, moves DOM focus, dispatches real bubbling
 * `keydown` events, and reads each engine's `focusedIndex` off context.
 *
 * All test helpers are prefixed `prov` (parallel-sibling collision guard).
 *
 * Note: engine-level key semantics (j/k, 1-9, named keybinds, the input guard,
 * keymap=null) are already pinned by `cockpit-keys.test.ts` against the pure
 * `resolveCockpitKey`. This file only adds what needs a real DOM: multi-instance
 * focus routing and keymap pass-through THROUGH the provider's listener.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// Tell React this is an act() environment so state updates flush inside act()
// deterministically (and to silence the "not configured to support act" warning).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import {
  CockpitProvider,
  useCockpitContext,
} from '../../cockpit-ui/src/components/CockpitProvider';
import type { CockpitAction, Keymap } from '@surface/cockpit';

interface ProvItem {
  id: string;
}

const PROV_ACTIONS: CockpitAction[] = [
  { id: 'keep', label: 'Keep', keybind: 'Enter' },
  { id: 'archive', label: 'Archive', keybind: 'a' },
];

/**
 * A probe piece that reads the shared engine off context and renders:
 *   - the live focusedIndex (as text, so the test can read routing outcomes),
 *   - one focusable button per item, tagged so the test can move focus into
 *     THIS provider's subtree.
 */
function ProvProbe({ tag, items }: { tag: string; items: ProvItem[] }) {
  const engine = useCockpitContext<ProvItem>();
  return (
    <div>
      <span data-testid={`${tag}-idx`}>{engine.focusedIndex}</span>
      {items.map((it) => (
        <button key={it.id} data-focus={`${tag}-${it.id}`} type="button">
          {it.id}
        </button>
      ))}
    </div>
  );
}

const PROV_ITEMS_A: ProvItem[] = [{ id: 'a0' }, { id: 'a1' }, { id: 'a2' }];
const PROV_ITEMS_B: ProvItem[] = [{ id: 'b0' }, { id: 'b1' }, { id: 'b2' }];

let provContainer: HTMLDivElement | null = null;
let provRoot: Root | null = null;

/** Mount a React tree into a fresh in-document container and flush effects. */
function provMount(ui: React.ReactElement): HTMLElement {
  provContainer = document.createElement('div');
  document.body.appendChild(provContainer);
  provRoot = createRoot(provContainer);
  act(() => {
    provRoot!.render(ui);
  });
  return provContainer;
}

/** Focus a tagged button and press a key on it (bubbles to its provider). */
function provPressOn(root: HTMLElement, focusTag: string, key: string) {
  const el = root.querySelector<HTMLButtonElement>(`[data-focus="${focusTag}"]`);
  if (!el) throw new Error(`no focusable for tag ${focusTag}`);
  el.focus();
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

/** Press a key from OUTSIDE both providers (focus on document.body). */
function provPressOutside(root: HTMLElement, key: string) {
  (document.body as HTMLElement).focus();
  act(() => {
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true }),
    );
  });
}

function provIdx(root: HTMLElement, tag: string): number {
  const el = root.querySelector(`[data-testid="${tag}-idx"]`);
  return Number(el?.textContent ?? 'NaN');
}

function provTwoCockpits(keymap?: Keymap | null) {
  const noop = () => {};
  return (
    <>
      <CockpitProvider
        items={PROV_ITEMS_A}
        actions={PROV_ACTIONS}
        onAction={noop}
        keymap={keymap}
      >
        <ProvProbe tag="A" items={PROV_ITEMS_A} />
      </CockpitProvider>
      <CockpitProvider
        items={PROV_ITEMS_B}
        actions={PROV_ACTIONS}
        onAction={noop}
        keymap={keymap}
      >
        <ProvProbe tag="B" items={PROV_ITEMS_B} />
      </CockpitProvider>
    </>
  );
}

afterEach(() => {
  if (provRoot) act(() => provRoot!.unmount());
  provContainer?.remove();
  provRoot = null;
  provContainer = null;
});

describe('CockpitProvider — two cockpits on one page, focus-scoped key routing', () => {
  it('a key advances ONLY the provider whose subtree holds focus', () => {
    const root = provMount(provTwoCockpits());
    expect(provIdx(root, 'A')).toBe(0);
    expect(provIdx(root, 'B')).toBe(0);

    // Focus inside A, press j → only A advances.
    provPressOn(root, 'A-a0', 'j');
    expect(provIdx(root, 'A')).toBe(1);
    expect(provIdx(root, 'B')).toBe(0);

    // Move focus into B, press j → only B advances; A is untouched.
    provPressOn(root, 'B-b0', 'j');
    expect(provIdx(root, 'A')).toBe(1);
    expect(provIdx(root, 'B')).toBe(1);
  });

  it('k routes to the focused cockpit only (reverse direction, wraps)', () => {
    const root = provMount(provTwoCockpits());
    // In B, k from index 0 wraps to the last item (2).
    provPressOn(root, 'B-b0', 'k');
    expect(provIdx(root, 'B')).toBe(2);
    expect(provIdx(root, 'A')).toBe(0);
  });

  it('a key with focus OUTSIDE both providers moves neither (focus-within guard)', () => {
    const root = provMount(provTwoCockpits());
    provPressOutside(root, 'j');
    expect(provIdx(root, 'A')).toBe(0);
    expect(provIdx(root, 'B')).toBe(0);
  });
});

describe('CockpitProvider — keymap pass-through', () => {
  it('omitted keymap uses the default j/k example', () => {
    const root = provMount(provTwoCockpits());
    provPressOn(root, 'A-a0', 'j');
    expect(provIdx(root, 'A')).toBe(1);
  });

  it('a custom keymap rebinds nav; the default j is no longer bound', () => {
    const arrows: Keymap = {
      next: ['ArrowDown'],
      prev: ['ArrowUp'],
      activate: [],
    };
    const root = provMount(provTwoCockpits(arrows));
    // j is not in the custom map → no movement.
    provPressOn(root, 'A-a0', 'j');
    expect(provIdx(root, 'A')).toBe(0);
    // ArrowDown → next.
    provPressOn(root, 'A-a0', 'ArrowDown');
    expect(provIdx(root, 'A')).toBe(1);
  });

  it('keymap={null} disables the global key listener entirely', () => {
    const root = provMount(provTwoCockpits(null));
    provPressOn(root, 'A-a0', 'j');
    expect(provIdx(root, 'A')).toBe(0);
  });
});

describe('useCockpitContext — used outside a provider', () => {
  it('throws (fail-loud), rather than silently returning a null engine', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    expect(() =>
      act(() => {
        root.render(<ProvProbe tag="orphan" items={PROV_ITEMS_A} />);
      }),
    ).toThrow(/must be called inside a <CockpitProvider>/);
    act(() => root.unmount());
    container.remove();
  });
});
