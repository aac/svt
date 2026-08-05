// @vitest-environment happy-dom
/**
 * The key guard vs. shadow-DOM retargeting.
 *
 * The regression: a listener OUTSIDE a shadow root never sees the inner node in
 * `e.target` — the DOM retargets it to the shadow HOST — so an `<input>` or a
 * `contenteditable` region inside a web component was invisible to the guard and
 * the cockpit hijacked `j`/`k` while the user was typing. The fix reads the true
 * origin from `composedPath()[0]`, falling back to `e.target`.
 *
 * All three event shapes the resolver must handle are pinned here:
 *   1. a retargeted event crossing a shadow boundary (real nodes, real path)
 *   2. a plain DOM event with no `composedPath` at all
 *   3. the bare structural `CockpitKeyEvent` (no path, no DOM node behind it)
 *
 * happy-dom note (verified against 15.11.7): happy-dom does NOT retarget — an
 * event dispatched from inside a shadow root arrives at a window listener with
 * `target` still set to the inner node, so the browser bug cannot be reproduced
 * end-to-end here. It DOES build a real `composedPath()`. So shape 1 dispatches a
 * real event from a real shadow root, captures the DOM's own path array, and
 * presents it with `target` set to the HOST — which is exactly what a real
 * browser hands the listener. Real nodes, real path, browser-faithful target.
 *
 * All helpers are prefixed `shadow` (parallel-sibling collision guard).
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  resolveCockpitKey,
  defaultKeymap,
  type CockpitAction,
  type CockpitKeyEvent,
  type ItemId,
  type UseCockpitResult,
} from '@surface/cockpit';

type ShadowCall = { kind: 'next' } | { kind: 'invokeAction'; index: number };

const SHADOW_ACTIONS: CockpitAction[] = [
  { id: 'archive', label: 'Archive', keybind: 'a' },
];

/** Recording fake engine — only the fields the resolver reads/calls matter. */
function shadowEngine(): { engine: UseCockpitResult; calls: ShadowCall[] } {
  const calls: ShadowCall[] = [];
  const focusedItem: ItemId = { id: 'item-1' };
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
    actions: SHADOW_ACTIONS,
  };
  return { engine, calls };
}

const shadowHosts: HTMLElement[] = [];

/**
 * Mount `innerHTML` inside a real open shadow root and return the host plus a
 * lookup for nodes inside the root.
 */
function shadowMount(innerHTML: string): {
  host: HTMLElement;
  inner: (selector: string) => HTMLElement;
} {
  const host = document.createElement('div');
  document.body.appendChild(host);
  shadowHosts.push(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = innerHTML;
  return {
    host,
    inner: (selector: string) => {
      const el = root.querySelector<HTMLElement>(selector);
      if (!el) throw new Error(`no ${selector} inside the shadow root`);
      return el;
    },
  };
}

/**
 * A browser-faithful retargeted event: the DOM's OWN `composedPath()` (captured
 * during a real dispatch from `from`, so entry 0 really is the inner node) paired
 * with `target` set to the shadow host, which is what a real browser reports to a
 * listener outside the root.
 */
function shadowRetargetedEvent(
  host: HTMLElement,
  from: HTMLElement,
  key: string,
): CockpitKeyEvent {
  let path: EventTarget[] = [];
  const capture = (e: Event) => {
    path = e.composedPath();
  };
  window.addEventListener('keydown', capture);
  from.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, composed: true }),
  );
  window.removeEventListener('keydown', capture);

  if (path[0] !== from) {
    throw new Error('composedPath()[0] is not the inner node — fixture is wrong');
  }
  return {
    key,
    target: host, // retargeted, as a real browser hands it to an outer listener
    composedPath: () => path,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
  };
}

/** A plain event-like with a real DOM target and NO `composedPath` at all. */
function shadowPathlessEvent(target: EventTarget, key: string): CockpitKeyEvent {
  return { key, target, metaKey: false, ctrlKey: false, altKey: false };
}

afterEach(() => {
  for (const host of shadowHosts.splice(0)) host.remove();
});

describe('key guard — shape 1: an event retargeted across a shadow boundary', () => {
  it('an <input> inside a shadow root suppresses the cockpit binding', () => {
    const { host, inner } = shadowMount('<input id="field" /><span id="plain">x</span>');
    const f = shadowEngine();
    const e = shadowRetargetedEvent(host, inner('#field'), 'j');

    // The retargeted target is NOT editable — only composedPath()[0] tells the truth.
    expect((e.target as HTMLElement).tagName).toBe('DIV');
    expect(resolveCockpitKey(f.engine, defaultKeymap, e)).toBe(false);
    expect(f.calls).toEqual([]);
  });

  it('a contenteditable region inside a shadow root suppresses too (inheritance included)', () => {
    const { host, inner } = shadowMount(
      '<div id="editable" contenteditable="true"><span id="inherited">i</span></div>',
    );
    const f = shadowEngine();

    expect(
      resolveCockpitKey(
        f.engine,
        defaultKeymap,
        shadowRetargetedEvent(host, inner('#editable'), 'j'),
      ),
    ).toBe(false);
    expect(
      resolveCockpitKey(
        f.engine,
        defaultKeymap,
        shadowRetargetedEvent(host, inner('#inherited'), 'j'),
      ),
    ).toBe(false);
    expect(f.calls).toEqual([]);
  });

  it('a NON-editable node inside a shadow root still navigates (the guard is not a blanket off)', () => {
    const { host, inner } = shadowMount('<input id="field" /><span id="plain">x</span>');
    const f = shadowEngine();

    expect(
      resolveCockpitKey(
        f.engine,
        defaultKeymap,
        shadowRetargetedEvent(host, inner('#plain'), 'j'),
      ),
    ).toBe(true);
    expect(f.calls).toEqual([{ kind: 'next' }]);
  });

  it('an empty composedPath() falls back to target (the DOM answer for a spent event)', () => {
    const field = document.createElement('input');
    document.body.appendChild(field);
    const f = shadowEngine();
    const e: CockpitKeyEvent = {
      key: 'j',
      target: field,
      composedPath: () => [],
      metaKey: false,
      ctrlKey: false,
      altKey: false,
    };

    expect(resolveCockpitKey(f.engine, defaultKeymap, e)).toBe(false);
    expect(f.calls).toEqual([]);
    field.remove();
  });
});

describe('key guard — shape 2: a plain DOM event with no composedPath', () => {
  it('a real <input> target still suppresses through the e.target fallback', () => {
    const field = document.createElement('input');
    document.body.appendChild(field);
    const f = shadowEngine();

    expect(
      resolveCockpitKey(f.engine, defaultKeymap, shadowPathlessEvent(field, 'j')),
    ).toBe(false);
    expect(f.calls).toEqual([]);
    field.remove();
  });

  it('a real non-editable target still resolves keys', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    const f = shadowEngine();

    expect(
      resolveCockpitKey(f.engine, defaultKeymap, shadowPathlessEvent(div, 'a')),
    ).toBe(true);
    expect(f.calls).toEqual([{ kind: 'invokeAction', index: 0 }]);
    div.remove();
  });
});

describe('key guard — shape 3: the bare structural CockpitKeyEvent', () => {
  it('a hand-built INPUT target suppresses with neither composedPath nor a DOM node', () => {
    const f = shadowEngine();
    const target = { tagName: 'INPUT' } as unknown as EventTarget;

    expect(
      resolveCockpitKey(f.engine, defaultKeymap, shadowPathlessEvent(target, 'j')),
    ).toBe(false);
    expect(f.calls).toEqual([]);
  });

  it('a hand-built non-editable target still resolves keys', () => {
    const f = shadowEngine();
    const target = { tagName: 'DIV' } as unknown as EventTarget;

    expect(
      resolveCockpitKey(f.engine, defaultKeymap, shadowPathlessEvent(target, 'j')),
    ).toBe(true);
    expect(f.calls).toEqual([{ kind: 'next' }]);
  });

  it('a null target is still safe (no path, no node)', () => {
    const f = shadowEngine();
    expect(
      resolveCockpitKey(f.engine, defaultKeymap, {
        key: 'j',
        target: null,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
      }),
    ).toBe(true);
    expect(f.calls).toEqual([{ kind: 'next' }]);
  });
});
