// @vitest-environment happy-dom
/**
 * Recovery affordances — clear-voice + undo-last-disposition.
 *
 * Two "recover from a mistake" controls were asked for by name in a dogfood
 * pass: clear a note's captured voice when capture goes wrong (re-record from
 * scratch), and an undo button for a disposition he triggered by accident. This
 * covers all three layers they live in:
 *   1. the compensating submission builders (submissions.ts),
 *   2. the presentational DetailRecovery toolbar (recovery-controls.tsx),
 *   3. the wired-up behavior in the real App — undo reverts the last disposition,
 *      un-marks the row (triage progress drops back), and emits a reversal
 *      submission into the Activity feed; the undo button is disabled with nothing
 *      to undo.
 *
 * These are APP-SIDE only: no cockpit/voice change. The App owns the state; the
 * libraries stay dumb.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { clearVoiceSubmission, undoSubmission } from './submissions.js';
import { DetailRecovery } from './recovery-controls.js';
import { App } from './App.js';

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(ui: React.ReactElement): HTMLElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(ui);
  });
  return container;
}

function rerender(ui: React.ReactElement) {
  act(() => {
    root!.render(ui);
  });
}

function q(rootEl: HTMLElement, testid: string): HTMLElement | null {
  return rootEl.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
}

function click(rootEl: HTMLElement, testid: string) {
  const el = q(rootEl, testid);
  if (!el) throw new Error(`no element ${testid}`);
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

// ── 1. Submission builders ────────────────────────────────────────────────────

describe('recovery submission builders', () => {
  it('clearVoiceSubmission carries the itemId + a clear marker (drain sees the discard)', () => {
    const env = clearVoiceSubmission('fruit-03');
    expect(env.affordanceId).toBe('voice-clear-fruit-03');
    expect(env.itemId).toBe('fruit-03');
    expect(env.value).toEqual({ cleared: true });
  });

  it('undoSubmission names the reversed action + itemId (drain sees the reversal)', () => {
    const env = undoSubmission('cart', 'fruit-01');
    expect(env.affordanceId).toBe('undo-cart-fruit-01');
    expect(env.itemId).toBe('fruit-01');
    expect(env.value).toEqual({ undo: 'cart' });
  });
});

// ── 2. DetailRecovery presentational toolbar ──────────────────────────────────

describe('DetailRecovery toolbar', () => {
  it('shows the clear-voice button + notes block only when the item has notes', () => {
    const el = mount(
      <DetailRecovery
        notes={['looks mushy', 'get a big batch']}
        onClearVoice={() => {}}
        canUndo={false}
        onUndo={() => {}}
      />,
    );
    expect(q(el, 'recovery-clear-voice')).not.toBeNull();
    const block = q(el, 'cockpit-quote-block');
    expect(block).not.toBeNull();
    expect(block!.textContent).toContain('looks mushy');
  });

  it('clear-voice click calls onClearVoice; clearing the notes hides both the button and the block', () => {
    const onClearVoice = vi.fn();
    const el = mount(
      <DetailRecovery notes={['bad take']} onClearVoice={onClearVoice} canUndo={false} onUndo={() => {}} />,
    );
    click(el, 'recovery-clear-voice');
    expect(onClearVoice).toHaveBeenCalledTimes(1);
    // Re-render as the App would after clearing this item's notes: block + button gone.
    rerender(
      <DetailRecovery notes={[]} onClearVoice={onClearVoice} canUndo={false} onUndo={() => {}} />,
    );
    expect(q(el, 'recovery-clear-voice')).toBeNull();
    expect(q(el, 'cockpit-quote-block')).toBeNull();
  });

  it('undo is present but disabled when there is nothing to undo, enabled + clickable otherwise', () => {
    const onUndo = vi.fn();
    const el = mount(
      <DetailRecovery notes={[]} onClearVoice={() => {}} canUndo={false} onUndo={onUndo} />,
    );
    const undo = q(el, 'recovery-undo') as HTMLButtonElement | null;
    expect(undo).not.toBeNull();
    expect(undo!.disabled).toBe(true);

    rerender(<DetailRecovery notes={[]} onClearVoice={() => {}} canUndo onUndo={onUndo} />);
    const undoEnabled = q(el, 'recovery-undo') as HTMLButtonElement;
    expect(undoEnabled.disabled).toBe(false);
    click(el, 'recovery-undo');
    expect(onUndo).toHaveBeenCalledTimes(1);
  });
});

// ── 3. Undo wired into the real App ───────────────────────────────────────────

describe('undo-last-disposition in the App', () => {
  function progressText(el: HTMLElement): string {
    return q(el, 'triage-progress')?.textContent ?? '';
  }
  function hasSentRow(el: HTMLElement, affordanceId: string): boolean {
    return Array.from(el.querySelectorAll('[data-testid="sent-row"]')).some((row) =>
      row.textContent?.includes(affordanceId),
    );
  }

  it('reverts the most recent disposition, un-marks the row, and emits a reversal submission', () => {
    // Keep POSTs off the network — the Activity feed (recordSent) is populated
    // synchronously regardless, which is what we assert on.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    const el = mount(<App />);

    // Fresh state: nothing triaged, undo disabled.
    expect(progressText(el)).toContain('0 / 12 triaged');
    expect((q(el, 'recovery-undo') as HTMLButtonElement).disabled).toBe(true);

    // Apply the primary disposition to the focused item (fruit-01) via its detail
    // action button — the cockpit engine calls onAction('cart', 'fruit-01').
    click(el, 'cockpit-action-cart');
    expect(progressText(el)).toContain('1 / 12 triaged');
    expect(hasSentRow(el, 'cart-fruit-01')).toBe(true);
    // Undo is now enabled.
    expect((q(el, 'recovery-undo') as HTMLButtonElement).disabled).toBe(false);

    // Undo it: progress falls back, the row un-marks, a reversal submission lands.
    click(el, 'recovery-undo');
    expect(progressText(el)).toContain('0 / 12 triaged');
    expect(hasSentRow(el, 'undo-cart-fruit-01')).toBe(true);
    // Nothing left to undo → disabled again.
    expect((q(el, 'recovery-undo') as HTMLButtonElement).disabled).toBe(true);
  });
});
