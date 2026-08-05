// @vitest-environment happy-dom
/**
 * The key guard vs. `contenteditable` — REAL DOM path.
 *
 * The regression: the input-suppression guard covered `input|textarea|select`
 * only, so a consumer with a rich-text / editable region had every keystroke
 * hijacked — type `j` in an editable div and the cockpit navigated instead.
 *
 * This drives a real `CockpitProvider` in happy-dom and dispatches real bubbling
 * `keydown` events from real nodes, because the load-bearing part of the rule is
 * DOM-shaped: `contenteditable` INHERITS (a bare `<span>` inside an editable div
 * is itself editable) and a nested `contenteditable="false"` opts back out. The
 * non-DOM structural-target path is pinned separately in `cockpit-keys.test.ts`,
 * against the pure resolver.
 *
 * All helpers are prefixed `edit` (parallel-sibling collision guard).
 *
 * happy-dom note (verified against 15.11.7, and the reason the guard does not
 * lean on `element.isContentEditable`): happy-dom hardcodes `isContentEditable`
 * to `false` and `contentEditable` to `'inherit'` on every element, so these
 * assertions only pass because the guard resolves the ATTRIBUTE by walking
 * ancestors. A guard written against `isContentEditable` alone would fail here.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import {
  CockpitProvider,
  useCockpitContext,
} from '../../cockpit-ui/src/components/CockpitProvider';
import type { CockpitAction } from '@surface/cockpit';

interface EditItem {
  id: string;
}

const EDIT_ITEMS: EditItem[] = [{ id: 'e0' }, { id: 'e1' }, { id: 'e2' }];
const EDIT_ACTIONS: CockpitAction[] = [
  { id: 'archive', label: 'Archive', keybind: 'a' },
];

/**
 * The probe subtree. `dangerouslySetInnerHTML` is deliberate: `contenteditable`
 * must be a real ATTRIBUTE on a real node (React's `contentEditable` prop plus
 * children is a runtime error), and the markup here is a fixed literal.
 *
 *   #editable                      → contenteditable region
 *     #inherited                   → inherits editability, declares nothing
 *     #opted-out                   → contenteditable="false" inside the region
 *   #plain                         → outside any editable region (control)
 */
function EditProbe() {
  const engine = useCockpitContext<EditItem>();
  return (
    <div>
      <span data-testid="edit-idx">{engine.focusedIndex}</span>
      <div
        dangerouslySetInnerHTML={{
          __html:
            '<div id="editable" contenteditable="true">' +
            '<span id="inherited">inherits</span>' +
            '<span id="opted-out" contenteditable="false">opted out</span>' +
            '</div>' +
            '<span id="plain">plain</span>',
        }}
      />
    </div>
  );
}

let editContainer: HTMLDivElement | null = null;
let editRoot: Root | null = null;

function editMount(): HTMLElement {
  editContainer = document.createElement('div');
  document.body.appendChild(editContainer);
  editRoot = createRoot(editContainer);
  act(() => {
    editRoot!.render(
      <CockpitProvider
        items={EDIT_ITEMS}
        actions={EDIT_ACTIONS}
        onAction={() => {}}
      >
        <EditProbe />
      </CockpitProvider>,
    );
  });
  return editContainer;
}

/** Dispatch a real bubbling keydown FROM a real node, by element id. */
function editPressFrom(root: HTMLElement, id: string, key: string) {
  const el = root.querySelector<HTMLElement>(`#${id}`);
  if (!el) throw new Error(`no element #${id} in the probe subtree`);
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

function editIdx(root: HTMLElement): number {
  return Number(root.querySelector('[data-testid="edit-idx"]')?.textContent ?? 'NaN');
}

afterEach(() => {
  if (editRoot) act(() => editRoot!.unmount());
  editContainer?.remove();
  editRoot = null;
  editContainer = null;
});

describe('key guard — contenteditable (real DOM nodes)', () => {
  it('a key typed in a contenteditable region does NOT navigate', () => {
    const root = editMount();
    expect(editIdx(root)).toBe(0);
    editPressFrom(root, 'editable', 'j');
    expect(editIdx(root)).toBe(0);
  });

  it('a nested element that only INHERITS editability is also suppressed', () => {
    const root = editMount();
    editPressFrom(root, 'inherited', 'j');
    expect(editIdx(root)).toBe(0);
  });

  it('contenteditable="false" inside an editable region is NOT editable — keys work', () => {
    const root = editMount();
    editPressFrom(root, 'opted-out', 'j');
    expect(editIdx(root)).toBe(1);
  });

  it('a non-editable node still navigates (positive control — the guard is not a blanket off)', () => {
    const root = editMount();
    editPressFrom(root, 'plain', 'j');
    expect(editIdx(root)).toBe(1);
    // and the action keybind still fires from there
    editPressFrom(root, 'plain', 'k');
    expect(editIdx(root)).toBe(0);
  });
});
