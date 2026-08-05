// @vitest-environment happy-dom
/**
 * Page-level "session done" affordance.
 *
 * A follow-up to the journal-on-submit durability work. Data safety does NOT
 * depend on this — every submission is already journaled on POST — so this is
 * purely a workflow convenience: a deliberate operator "I'm done" signal that a
 * DRAINING consuming agent interprets as "run your downstream processing" (e.g.
 * rebuild the review page). This repo only EMITS the signal; executing the
 * downstream work lives outside this repo (design principle).
 *
 * Two layers under test:
 *   1. the pure `sessionDoneSubmission` builder — page-level (no itemId), fixed
 *      affordanceId, `{ done: true }` value (+ optional trivial summary);
 *   2. the App's Done button — two-step (arm → confirm) so a stray click can't
 *      end the session, and on confirm it flows through the SAME recordSent +
 *      postSubmission path as every other submission (lands in the Activity feed)
 *      and shows an on-screen acknowledgement.
 *
 * Component layer follows the createRoot + act + happy-dom pattern the other
 * composition component tests use (example-arrangements.test.tsx). Cockpit mounts
 * a ResizeObserver happy-dom lacks, so this installs a no-op stub; `fetch` is
 * stubbed so postSubmission resolves without a live surface server.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import {
  sessionDoneSubmission,
  SESSION_DONE_AFFORDANCE_ID,
} from './submissions.js';
import { App } from './App.js';

// ── Builder (pure) ───────────────────────────────────────────────────────────
describe('sessionDoneSubmission builder', () => {
  it('is page-level: fixed affordanceId, NO itemId, { done: true } value', () => {
    const env = sessionDoneSubmission();
    expect(env.affordanceId).toBe('session-done');
    expect(env.affordanceId).toBe(SESSION_DONE_AFFORDANCE_ID);
    // Page-level, not item-scoped — must carry no itemId so it drains ungrouped.
    expect(env.itemId).toBeUndefined();
    expect('itemId' in env).toBe(false);
    expect(env.value).toEqual({ done: true });
  });

  it('carries a trivial { triaged, total } summary when one is supplied', () => {
    const env = sessionDoneSubmission({ triaged: 8, total: 12 });
    expect(env.affordanceId).toBe('session-done');
    expect(env.itemId).toBeUndefined();
    expect(env.value).toEqual({ done: true, triaged: 8, total: 12 });
  });
});

// ── Component (App Done button) ──────────────────────────────────────────────

// Cockpit's responsive collapse mounts a ResizeObserver happy-dom lacks.
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let originalRO: typeof ResizeObserver | undefined;
let originalFetch: typeof fetch | undefined;
let fetchMock: ReturnType<typeof vi.fn<Parameters<typeof fetch>, Promise<Response>>>;
let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  originalRO = (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = NoopResizeObserver;
  originalFetch = globalThis.fetch;
  fetchMock = vi.fn<Parameters<typeof fetch>, Promise<Response>>(
    async () => new Response('{}', { status: 200 }),
  );
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = originalRO;
  globalThis.fetch = originalFetch as typeof fetch;
});

function mount(): HTMLElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<App />);
  });
  return container;
}

function click(host: HTMLElement, testid: string) {
  const el = host.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
  if (!el) throw new Error(`no element ${testid}`);
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function has(host: HTMLElement, testid: string): boolean {
  return host.querySelector(`[data-testid="${testid}"]`) !== null;
}

function submitCalls(): Array<Record<string, unknown>> {
  return fetchMock.mock.calls
    .filter((c) => c[0] === '/submit')
    .map((c) => JSON.parse((c[1] as RequestInit).body as string));
}

describe('App — page-level Done affordance', () => {
  it('renders the Done button in the header, idle by default', () => {
    const host = mount();
    expect(has(host, 'session-done-button')).toBe(true);
    // Not armed, not acknowledged, nothing emitted yet.
    expect(has(host, 'session-done-confirm')).toBe(false);
    expect(has(host, 'session-done-ack')).toBe(false);
    expect(submitCalls()).toHaveLength(0);
  });

  it('is two-step: a single Done click arms a confirm but emits NOTHING', () => {
    const host = mount();
    click(host, 'session-done-button');
    expect(has(host, 'session-done-confirm')).toBe(true);
    expect(has(host, 'session-done-cancel')).toBe(true);
    // Still no submission — arming is not ending.
    expect(submitCalls()).toHaveLength(0);
    expect(has(host, 'session-done-ack')).toBe(false);
  });

  it('cancel returns to idle without emitting', () => {
    const host = mount();
    click(host, 'session-done-button');
    click(host, 'session-done-cancel');
    expect(has(host, 'session-done-button')).toBe(true);
    expect(has(host, 'session-done-confirm')).toBe(false);
    expect(submitCalls()).toHaveLength(0);
  });

  it('confirm emits the page-level session-done submission and acknowledges', () => {
    const host = mount();
    click(host, 'session-done-button');
    click(host, 'session-done-confirm');

    // On-screen acknowledgement that the done signal was sent.
    expect(has(host, 'session-done-ack')).toBe(true);
    const ack = host.querySelector('[data-testid="session-done-ack"]')!;
    expect(ack.textContent).toContain('session ended');

    // POSTed through the real postSubmission path.
    const calls = submitCalls();
    expect(calls).toHaveLength(1);
    // Wire shape: { id, payload } where payload is the envelope.
    expect(calls[0].id).toBe('session-done');
    const payload = calls[0].payload as { affordanceId: string; itemId?: string; value: unknown };
    expect(payload.affordanceId).toBe('session-done');
    expect(payload.itemId).toBeUndefined();
    expect((payload.value as { done: boolean }).done).toBe(true);

    // Lands in the Activity feed like every other submission (recordSent path).
    const feedRows = Array.from(host.querySelectorAll('[data-testid="sent-row"]'));
    expect(feedRows.some((r) => r.textContent?.includes('session-done'))).toBe(true);
  });
});
