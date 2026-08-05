/**
 * Key-ownership matrix guard (composable-layout impl node 1).
 *
 * Drives the REAL public resolver `resolveCockpitKey` from `@surface/cockpit`
 * against a recording fake engine — no DOM needed, so it runs in the existing
 * node-env gate. Pins the three resolved matrix decisions plus the guard so
 * nodes 2-7 build against a closed, tested contract:
 *   - keymap covers nav + activation intents only (1-9/named stay action bindings)
 *   - keymap=null silences the WHOLE global listener (nav + 1-9 + named together)
 *   - the input-suppression guard lives in the resolver (the event layer)
 *   - keymap intents win over action keybinds (Enter-activate over an Enter action)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  resolveCockpitKey,
  defaultKeymap,
  type CockpitAction,
  type CockpitKeyEvent,
  type ItemId,
  type Keymap,
  type UseCockpitResult,
} from '@surface/cockpit';

type Call =
  | { kind: 'next' }
  | { kind: 'prev' }
  | { kind: 'activate' }
  | { kind: 'invokeAction'; index: number };

const ACTIONS: CockpitAction[] = [
  { id: 'keep', label: 'Keep', keybind: 'Enter' },
  { id: 'archive', label: 'Archive', keybind: 'a' },
  { id: 'defer', label: 'Defer', keybind: 'd' },
];

/** Recording fake engine — only the fields the resolver reads/calls matter. */
function fakeEngine(opts?: {
  focused?: boolean;
  actions?: CockpitAction[];
}): { engine: UseCockpitResult; calls: Call[] } {
  const calls: Call[] = [];
  const actions = opts?.actions ?? ACTIONS;
  const focusedItem: ItemId | null =
    (opts?.focused ?? true) ? { id: 'item-1' } : null;
  const engine: UseCockpitResult = {
    items: focusedItem ? [focusedItem] : [],
    focusedIndex: focusedItem ? 0 : -1,
    focusedItem,
    setFocusedItem: () => {},
    moveSelection: () => {},
    next: () => calls.push({ kind: 'next' }),
    prev: () => calls.push({ kind: 'prev' }),
    activate: () => calls.push({ kind: 'activate' }),
    invokeAction: (index: number) => calls.push({ kind: 'invokeAction', index }),
    actions,
  };
  return { engine, calls };
}

function ev(key: string, over: Partial<CockpitKeyEvent> = {}): CockpitKeyEvent {
  return {
    key,
    target: null,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    ...over,
  };
}

function tagTarget(tagName: string): EventTarget {
  return { tagName } as unknown as EventTarget;
}

describe('resolveCockpitKey — default keymap (j/k example)', () => {
  let f: ReturnType<typeof fakeEngine>;
  beforeEach(() => {
    f = fakeEngine();
  });

  it('j → next, k → prev (case-insensitive)', () => {
    expect(resolveCockpitKey(f.engine, defaultKeymap, ev('j'))).toBe(true);
    expect(resolveCockpitKey(f.engine, defaultKeymap, ev('K'))).toBe(true);
    expect(f.calls).toEqual([{ kind: 'next' }, { kind: 'prev' }]);
  });

  it('Enter fires the NAMED action keybind, not activate (activate unbound by default)', () => {
    expect(resolveCockpitKey(f.engine, defaultKeymap, ev('Enter'))).toBe(true);
    // index 0 = the { keybind: 'Enter' } action; activate was NOT called.
    expect(f.calls).toEqual([{ kind: 'invokeAction', index: 0 }]);
  });

  it('undefined keymap resolves as defaultKeymap', () => {
    expect(resolveCockpitKey(f.engine, undefined, ev('j'))).toBe(true);
    expect(f.calls).toEqual([{ kind: 'next' }]);
  });
});

describe('resolveCockpitKey — action bindings (matrix Q2: 1-9/named stay on actions)', () => {
  it('numeric 1-9 → invokeAction(n-1) positionally', () => {
    const f = fakeEngine();
    expect(resolveCockpitKey(f.engine, defaultKeymap, ev('2'))).toBe(true);
    expect(f.calls).toEqual([{ kind: 'invokeAction', index: 1 }]);
  });

  it('numeric key with no action at that slot is NOT handled', () => {
    const f = fakeEngine({ actions: [ACTIONS[0]!] }); // only 1 action
    expect(resolveCockpitKey(f.engine, defaultKeymap, ev('5'))).toBe(false);
    expect(f.calls).toEqual([]);
  });

  it('numeric key with nothing focused is NOT handled', () => {
    const f = fakeEngine({ focused: false });
    expect(resolveCockpitKey(f.engine, defaultKeymap, ev('1'))).toBe(false);
    expect(f.calls).toEqual([]);
  });

  it('named keybind (a/d) → invokeAction at that action index', () => {
    const f = fakeEngine();
    expect(resolveCockpitKey(f.engine, defaultKeymap, ev('d'))).toBe(true);
    expect(f.calls).toEqual([{ kind: 'invokeAction', index: 2 }]);
  });
});

describe('resolveCockpitKey — rebinding (nav re-derives nothing)', () => {
  const arrows: Keymap = {
    next: ['ArrowDown', 'j'],
    prev: ['ArrowUp', 'k'],
    activate: [],
  };

  it('ArrowDown → next under a custom keymap', () => {
    const f = fakeEngine();
    expect(resolveCockpitKey(f.engine, arrows, ev('ArrowDown'))).toBe(true);
    expect(f.calls).toEqual([{ kind: 'next' }]);
  });

  it('keymap intents WIN over action keybinds — activate:[Enter] beats the Enter action', () => {
    const f = fakeEngine();
    const withActivate: Keymap = { next: ['j'], prev: ['k'], activate: ['Enter'] };
    expect(resolveCockpitKey(f.engine, withActivate, ev('Enter'))).toBe(true);
    // activate fired; the { keybind:'Enter' } action did NOT.
    expect(f.calls).toEqual([{ kind: 'activate' }]);
  });
});

describe('resolveCockpitKey — matrix Q1: keymap=null silences the whole listener', () => {
  it('null silences nav, numeric, AND named keybinds together', () => {
    const f = fakeEngine();
    expect(resolveCockpitKey(f.engine, null, ev('j'))).toBe(false);
    expect(resolveCockpitKey(f.engine, null, ev('1'))).toBe(false);
    expect(resolveCockpitKey(f.engine, null, ev('Enter'))).toBe(false);
    expect(f.calls).toEqual([]);
  });
});

describe('resolveCockpitKey — input-suppression guard (lives in the resolver)', () => {
  it('keys inside input/textarea/select are not hijacked', () => {
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
      const f = fakeEngine();
      const e = ev('j', { target: tagTarget(tag) });
      expect(resolveCockpitKey(f.engine, defaultKeymap, e)).toBe(false);
      expect(f.calls).toEqual([]);
    }
  });

  // contenteditable on the STRUCTURAL (non-DOM) path — the resolver is
  // deliberately drivable with hand-built plain-object events, so the guard must
  // reach the same verdict without `closest()`, `isContentEditable`, or an
  // `ownerDocument` behind the target. The real-DOM path (where inheritance is
  // resolved by walking actual parents) is covered in `cockpit-editable-guard.test.tsx`.
  it('a contenteditable target is not hijacked (attribute form)', () => {
    const f = fakeEngine();
    const target = {
      tagName: 'DIV',
      getAttribute: (name: string) => (name === 'contenteditable' ? 'true' : null),
    } as unknown as EventTarget;
    expect(resolveCockpitKey(f.engine, defaultKeymap, ev('j', { target }))).toBe(false);
    expect(f.calls).toEqual([]);
  });

  it('a contenteditable target is not hijacked (property form, no getAttribute)', () => {
    const f = fakeEngine();
    const target = { tagName: 'DIV', contentEditable: 'true' } as unknown as EventTarget;
    expect(resolveCockpitKey(f.engine, defaultKeymap, ev('j', { target }))).toBe(false);
    expect(f.calls).toEqual([]);
  });

  it('an INHERITED contenteditable ancestor suppresses a child that declares nothing', () => {
    const f = fakeEngine();
    const target = {
      tagName: 'SPAN',
      contentEditable: 'inherit',
      parentElement: { tagName: 'DIV', contentEditable: 'plaintext-only' },
    } as unknown as EventTarget;
    expect(resolveCockpitKey(f.engine, defaultKeymap, ev('j', { target }))).toBe(false);
    expect(f.calls).toEqual([]);
  });

  it('contenteditable="false" inside an editable ancestor is NOT suppressed (nearest wins)', () => {
    const f = fakeEngine();
    const target = {
      tagName: 'SPAN',
      contentEditable: 'false',
      parentElement: { tagName: 'DIV', contentEditable: 'true' },
    } as unknown as EventTarget;
    expect(resolveCockpitKey(f.engine, defaultKeymap, ev('j', { target }))).toBe(true);
    expect(f.calls).toEqual([{ kind: 'next' }]);
  });

  it('a bare structural target with no editability fields still resolves keys', () => {
    const f = fakeEngine();
    expect(
      resolveCockpitKey(f.engine, defaultKeymap, ev('j', { target: tagTarget('DIV') })),
    ).toBe(true);
    expect(f.calls).toEqual([{ kind: 'next' }]);
  });

  it('modified chords (meta/ctrl/alt) are ignored', () => {
    const f = fakeEngine();
    expect(resolveCockpitKey(f.engine, defaultKeymap, ev('j', { metaKey: true }))).toBe(false);
    expect(resolveCockpitKey(f.engine, defaultKeymap, ev('j', { ctrlKey: true }))).toBe(false);
    expect(resolveCockpitKey(f.engine, defaultKeymap, ev('j', { altKey: true }))).toBe(false);
    expect(f.calls).toEqual([]);
  });
});
