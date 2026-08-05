// @vitest-environment happy-dom
/**
 * `useCockpitKeys` target semantics — omitted vs. explicit `null`.
 *
 * The sharp edge this pins: the hook used to resolve its attach point with
 * `target ?? window`, which collapses "omitted" and "explicitly null". A consumer
 * that passed a not-yet-mounted container (exactly what `CockpitProvider` does —
 * its `rootEl` state is `null` for the first commit, before the ref callback
 * fires) therefore got a TRANSIENT `window` listener for one commit before
 * rebinding to the container. Harmless in practice, surprising as a contract:
 * "I passed a target and got a global listener."
 *
 * Settled semantics (matrix Q4 in `useCockpitKeys.ts`), mirroring how `keymap`
 * already separates the two:
 *   - `target` omitted / `undefined` → `window` (the shipped `<Cockpit>` posture)
 *   - `target === null`              → attach NOTHING
 *   - a target                       → attach there
 *
 * All helpers are prefixed `nulltarget` (parallel-sibling collision guard).
 *
 * Both halves are asserted two ways on purpose: a spy on `window.addEventListener`
 * (was a listener registered at all?) AND a real dispatched `keydown` on `window`
 * (did it reach the engine?). The spy alone would pass against a listener attached
 * to some other node; the dispatch alone can't see a listener that exists but is
 * shadowed.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import {
  useCockpitKeys,
  type CockpitAction,
  type ItemId,
  type UseCockpitKeysOptions,
  type UseCockpitResult,
} from '@surface/cockpit';
import { CockpitProvider } from '../../cockpit-ui/src/components/CockpitProvider';

type NulltargetCall = { kind: 'next' } | { kind: 'invokeAction'; index: number };

const NULLTARGET_ACTIONS: CockpitAction[] = [
  { id: 'archive', label: 'Archive', keybind: 'a' },
];

/** Recording fake engine — only what the resolver reads/calls. */
function nulltargetEngine(): { engine: UseCockpitResult; calls: NulltargetCall[] } {
  const calls: NulltargetCall[] = [];
  const focusedItem: ItemId = { id: 'nt-0' };
  const engine: UseCockpitResult = {
    items: [focusedItem],
    focusedIndex: 0,
    focusedItem,
    setFocusedItem: () => {},
    moveSelection: () => {},
    next: () => calls.push({ kind: 'next' }),
    prev: () => {},
    activate: () => {},
    invokeAction: (index: number) => calls.push({ kind: 'invokeAction', index }),
    actions: NULLTARGET_ACTIONS,
  };
  return { engine, calls };
}

function NulltargetProbe({
  engine,
  options,
}: {
  engine: UseCockpitResult;
  options: UseCockpitKeysOptions;
}) {
  useCockpitKeys(engine, options);
  return null;
}

let nulltargetContainer: HTMLDivElement | null = null;
let nulltargetRoot: Root | null = null;

function nulltargetMount(node: ReactNode) {
  nulltargetContainer = document.createElement('div');
  document.body.appendChild(nulltargetContainer);
  nulltargetRoot = createRoot(nulltargetContainer);
  act(() => {
    nulltargetRoot!.render(node);
  });
}

/** Count of `keydown` registrations on `window` while `fn` runs. */
function nulltargetCountWindowKeydowns(fn: () => void): number {
  const spy = vi.spyOn(window, 'addEventListener');
  try {
    fn();
    return spy.mock.calls.filter(([type]) => type === 'keydown').length;
  } finally {
    spy.mockRestore();
  }
}

function nulltargetPressWindow(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

afterEach(() => {
  if (nulltargetRoot) act(() => nulltargetRoot!.unmount());
  nulltargetContainer?.remove();
  nulltargetRoot = null;
  nulltargetContainer = null;
});

describe('useCockpitKeys — target semantics', () => {
  it('omitted target still attaches to window (the shipped <Cockpit> posture)', () => {
    const f = nulltargetEngine();
    const registrations = nulltargetCountWindowKeydowns(() => {
      nulltargetMount(<NulltargetProbe engine={f.engine} options={{}} />);
    });
    expect(registrations).toBe(1);

    nulltargetPressWindow('j');
    expect(f.calls).toEqual([{ kind: 'next' }]);
  });

  it('an EXPLICIT null target attaches nothing at all', () => {
    const f = nulltargetEngine();
    const registrations = nulltargetCountWindowKeydowns(() => {
      nulltargetMount(<NulltargetProbe engine={f.engine} options={{ target: null }} />);
    });
    expect(registrations).toBe(0);

    nulltargetPressWindow('j');
    nulltargetPressWindow('a');
    expect(f.calls).toEqual([]);
  });

  it('a real target still receives keys (null is "off", not "broken")', () => {
    const f = nulltargetEngine();
    const el = document.createElement('div');
    document.body.appendChild(el);
    try {
      const registrations = nulltargetCountWindowKeydowns(() => {
        nulltargetMount(<NulltargetProbe engine={f.engine} options={{ target: el }} />);
      });
      expect(registrations).toBe(0);

      act(() => {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
      });
      expect(f.calls).toEqual([{ kind: 'next' }]);
    } finally {
      el.remove();
    }
  });
});

describe('CockpitProvider — no transient window listener on the first commit', () => {
  it('mounting a provider registers ZERO window keydown listeners', () => {
    // The provider passes `target: rootEl`, and `rootEl` is `null` until the ref
    // callback fires — the exact case that used to leak a one-commit window
    // listener. With explicit-null meaning "don't attach", the provider attaches
    // only ever to its own container.
    const registrations = nulltargetCountWindowKeydowns(() => {
      nulltargetMount(
        <CockpitProvider
          items={[{ id: 'p0' }, { id: 'p1' }]}
          actions={NULLTARGET_ACTIONS}
          onAction={() => {}}
        >
          <span>child</span>
        </CockpitProvider>,
      );
    });
    expect(registrations).toBe(0);
  });
});
