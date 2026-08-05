/**
 * Narrow-mode interaction logic (cockpit-design-pass T1, brief §3.2b).
 *
 * The responsive collapse's rules — focus vs activation, Escape scoping, the
 * ~640px inline-size boundary, the detail scroll-reset guard — are factored into
 * pure functions in cockpit-ui's `layout` module and wired into the `<Cockpit>`
 * component. This exercises that logic at its boundary (no DOM environment is
 * configured in this repo; the rendered collapse itself is a dogfood item).
 */

import { describe, it, expect } from 'vitest';
import {
  NARROW_BREAKPOINT,
  isNarrowInlineSize,
  reduceNarrowView,
  shouldInterceptEscape,
  actionsBindEscape,
  shouldResetDetailScroll,
} from '../../cockpit-ui/src/layout';

describe('isNarrowInlineSize — element-width boundary', () => {
  it('is narrow strictly under the breakpoint', () => {
    expect(isNarrowInlineSize(NARROW_BREAKPOINT - 1)).toBe(true);
    expect(isNarrowInlineSize(390)).toBe(true);
    expect(isNarrowInlineSize(360)).toBe(true);
  });
  it('is not narrow at or above the breakpoint', () => {
    expect(isNarrowInlineSize(NARROW_BREAKPOINT)).toBe(false);
    expect(isNarrowInlineSize(1440)).toBe(false);
  });
  it('treats zero/unknown width (SSR / first paint) as NOT narrow (two-pane)', () => {
    expect(isNarrowInlineSize(0)).toBe(false);
    expect(isNarrowInlineSize(-1)).toBe(false);
  });
});

describe('reduceNarrowView — focus and activation are separate events', () => {
  it('j/k (nav) stays in the list — focus does NOT open detail', () => {
    expect(reduceNarrowView('list', 'nav')).toBe('list');
  });
  it('j/k (nav) in detail stays in detail — carousel in place (intended)', () => {
    expect(reduceNarrowView('detail', 'nav')).toBe('detail');
  });
  it('a row tap (activate) opens the detail', () => {
    expect(reduceNarrowView('list', 'activate')).toBe('detail');
  });
  it('back returns to the list', () => {
    expect(reduceNarrowView('detail', 'back')).toBe('list');
  });
  it('escape from detail returns to the list; from list is inert', () => {
    expect(reduceNarrowView('detail', 'escape')).toBe('list');
    expect(reduceNarrowView('list', 'escape')).toBe('list');
  });
});

describe('shouldInterceptEscape — scoping (brief D-N1)', () => {
  it('intercepts only when narrow AND in the detail view', () => {
    expect(shouldInterceptEscape({ isNarrow: true, view: 'detail' })).toBe(true);
    expect(shouldInterceptEscape({ isNarrow: true, view: 'list' })).toBe(false);
    expect(shouldInterceptEscape({ isNarrow: false, view: 'detail' })).toBe(false);
  });
  it('is ignored when focus is in an input/textarea/select', () => {
    for (const tag of ['input', 'textarea', 'select', 'INPUT', 'TextArea']) {
      expect(shouldInterceptEscape({ isNarrow: true, view: 'detail', targetTag: tag })).toBe(false);
    }
  });
  it('still intercepts for non-editable targets', () => {
    expect(shouldInterceptEscape({ isNarrow: true, view: 'detail', targetTag: 'button' })).toBe(true);
    expect(shouldInterceptEscape({ isNarrow: true, view: 'detail', targetTag: 'div' })).toBe(true);
  });
  // `target` (the real event target) routes through the engine's shared guard, so
  // this listener sees contenteditable too — a tag name alone cannot.
  it('is ignored when the target is a contenteditable region, or inherits one', () => {
    const editable = { tagName: 'DIV', contentEditable: 'true' } as unknown as EventTarget;
    const inherits = {
      tagName: 'SPAN',
      contentEditable: 'inherit',
      parentElement: editable,
    } as unknown as EventTarget;
    expect(shouldInterceptEscape({ isNarrow: true, view: 'detail', target: editable })).toBe(false);
    expect(shouldInterceptEscape({ isNarrow: true, view: 'detail', target: inherits })).toBe(false);
  });
  it('still intercepts for a target inside no editable region, and for a nested contenteditable="false"', () => {
    const plain = { tagName: 'DIV' } as unknown as EventTarget;
    const optedOut = {
      tagName: 'SPAN',
      contentEditable: 'false',
      parentElement: { tagName: 'DIV', contentEditable: 'true' },
    } as unknown as EventTarget;
    expect(shouldInterceptEscape({ isNarrow: true, view: 'detail', target: plain })).toBe(true);
    expect(shouldInterceptEscape({ isNarrow: true, view: 'detail', target: optedOut })).toBe(true);
  });
});

describe('actionsBindEscape — yield Escape to a consumer that binds it', () => {
  it('is false for the usual keybinds', () => {
    expect(actionsBindEscape([{ keybind: 'Enter' }, { keybind: 'a' }, {}])).toBe(false);
  });
  it('is true when an action binds Escape/Esc', () => {
    expect(actionsBindEscape([{ keybind: 'Escape' }])).toBe(true);
    expect(actionsBindEscape([{ keybind: 'esc' }])).toBe(true);
  });
});

describe('shouldResetDetailScroll — reset on item change, not accent flip', () => {
  it('resets when the focused item id changes', () => {
    expect(shouldResetDetailScroll('a', 'b')).toBe(true);
    expect(shouldResetDetailScroll(null, 'a')).toBe(true);
  });
  it('does NOT reset when the id is unchanged (a live accent go/wait flip)', () => {
    expect(shouldResetDetailScroll('a', 'a')).toBe(false);
  });
});
