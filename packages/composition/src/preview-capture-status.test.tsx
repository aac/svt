// @vitest-environment happy-dom
/**
 * Mic/capture status mirrored into the item PREVIEW (detail pane).
 *
 * Dogfood report: "to monitor what's happening I have to look at the very top
 * nav to see the mic status, but what I'm actually looking at is the item
 * preview." This pins that the capture-status indicator renders INSIDE the
 * cockpit detail pane (via the app's real `renderDetailBefore` slot), reflects
 * voice state changes, and stays absent when voice is off.
 *
 * Two layers:
 *   1. The `CaptureStatus` component's own state/color logic (pure, prop-driven).
 *   2. The indicator threaded through a REAL <Cockpit> detail slot exactly as
 *      App.tsx wires it — proving the preview path, not just the component.
 * Helpers are prefixed `cs` (parallel-sibling collision guard).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { Cockpit, type DisplayItem } from '@surface/cockpit-ui';
import type { CockpitAction } from '@surface/cockpit';
import { CaptureStatus } from './App.js';

interface CsItem {
  id: string;
  title: string;
  body: string;
}

const CS_ITEMS: CsItem[] = [
  { id: 'a', title: 'First item', body: 'Body A.' },
  { id: 'b', title: 'Second item', body: 'Body B.' },
];
const CS_ACTIONS: CockpitAction[] = [{ id: 'keep', label: 'Keep', keybind: 'Enter' }];
const csMap = (it: CsItem): DisplayItem => ({ title: it.title, body: it.body });

let csContainer: HTMLDivElement | null = null;
let csRoot: Root | null = null;

function csMount(ui: React.ReactElement): HTMLElement {
  csContainer = document.createElement('div');
  document.body.appendChild(csContainer);
  csRoot = createRoot(csContainer);
  act(() => {
    csRoot!.render(ui);
  });
  return csContainer;
}

function csRender(ui: React.ReactElement) {
  act(() => {
    csRoot!.render(ui);
  });
}

function csStatus(root: HTMLElement): HTMLElement | null {
  return root.querySelector<HTMLElement>('[data-testid="preview-capture-status"]');
}

afterEach(() => {
  if (csRoot) act(() => csRoot!.unmount());
  csContainer?.remove();
  csRoot = null;
  csContainer = null;
});

// The focused (correlated) item's id in these tests. Cockpit drives focus to
// index 0 (item `a`) on mount, so `a` is what the detail pane renders.
const FOCUSED = 'a';

/**
 * A test host that wires CaptureStatus into a REAL <Cockpit> detail slot exactly
 * the way App.tsx's renderDetailBefore does — same showStatus gate, same props —
 * so we exercise the actual preview path, not a bespoke render.
 */
function CsHost(props: {
  correlation: string | null;
  voiceLive: boolean;
  voiceBusy: boolean;
  captureStartItem: string | null;
}) {
  const { correlation, voiceLive, voiceBusy, captureStartItem } = props;
  return (
    <Cockpit<CsItem>
      items={CS_ITEMS}
      actions={CS_ACTIONS}
      onAction={() => {}}
      mapItem={csMap}
      renderDetailBefore={(it) => {
        const showStatus = voiceLive && correlation !== null && it.id === correlation;
        return showStatus ? (
          <CaptureStatus
            itemId={it.id}
            correlation={correlation}
            voiceLive={voiceLive}
            voiceBusy={voiceBusy}
            captureStartItem={captureStartItem}
          />
        ) : null;
      }}
    />
  );
}

describe('CaptureStatus — pure state/color logic', () => {
  const base = {
    itemId: FOCUSED,
    correlation: FOCUSED,
    voiceLive: true,
    voiceBusy: false,
    captureStartItem: FOCUSED,
  };

  it('renders nothing when voice is off', () => {
    const root = csMount(<CaptureStatus {...base} voiceLive={false} />);
    expect(csStatus(root)).toBeNull();
  });

  it('renders nothing when this item is not the correlated one', () => {
    const root = csMount(<CaptureStatus {...base} correlation="b" />);
    expect(csStatus(root)).toBeNull();
  });

  it('live + idle → GREEN "listening"', () => {
    const root = csMount(<CaptureStatus {...base} voiceBusy={false} />);
    const el = csStatus(root)!;
    expect(el).not.toBeNull();
    expect(el.getAttribute('data-capture-state')).toBe('listening');
    expect(el.textContent).toContain('listening');
    // Green talk-freely color (VOICE_GO = #3f9655) on the border + text.
    expect(el.style.borderColor).toBe('#3f9655');
    expect(el.style.color).toBe('#3f9655');
  });

  it('live + busy on THIS item → GREEN "capturing"', () => {
    const root = csMount(
      <CaptureStatus {...base} voiceBusy={true} captureStartItem={FOCUSED} />,
    );
    const el = csStatus(root)!;
    expect(el.getAttribute('data-capture-state')).toBe('capturing');
    expect(el.textContent).toContain('capturing');
    expect(el.style.borderColor).toBe('#3f9655');
  });

  it('busy but focus moved off where the utterance started → AMBER wait', () => {
    // correlation is the NEW item (a); the utterance started on b.
    const root = csMount(
      <CaptureStatus {...base} voiceBusy={true} captureStartItem="b" />,
    );
    const el = csStatus(root)!;
    expect(el.getAttribute('data-capture-state')).toBe('wait');
    expect(el.textContent).toContain('let last note land');
    // Amber wait color (VOICE_WAIT = #d98324).
    expect(el.style.borderColor).toBe('#d98324');
    expect(el.style.color).toBe('#d98324');
  });
});

describe('CaptureStatus — inside the real <Cockpit> preview (detail pane)', () => {
  it('does NOT show in the preview when voice is off', () => {
    const root = csMount(
      <CsHost correlation={FOCUSED} voiceLive={false} voiceBusy={false} captureStartItem={null} />,
    );
    // The detail pane renders the focused item...
    expect(
      root.querySelector('[data-testid="cockpit-detail-title"]')?.textContent,
    ).toBe('First item');
    // ...but no capture status, because voice is off.
    expect(csStatus(root)).toBeNull();
  });

  it('shows inside the detail-before slot when voice is live on the focused item', () => {
    const root = csMount(
      <CsHost correlation={FOCUSED} voiceLive={true} voiceBusy={false} captureStartItem={FOCUSED} />,
    );
    const el = csStatus(root)!;
    expect(el).not.toBeNull();
    // It lives INSIDE the cockpit detail pane's before-slot — the preview.
    const slot = root.querySelector('[data-testid="cockpit-detail-before"]');
    expect(slot).not.toBeNull();
    expect(slot!.contains(el)).toBe(true);
  });

  it('reacts to voice state changes on re-render (no stale closure)', () => {
    // Off → nothing.
    const root = csMount(
      <CsHost correlation={FOCUSED} voiceLive={false} voiceBusy={false} captureStartItem={null} />,
    );
    expect(csStatus(root)).toBeNull();

    // Live + idle → listening.
    csRender(
      <CsHost correlation={FOCUSED} voiceLive={true} voiceBusy={false} captureStartItem={FOCUSED} />,
    );
    expect(csStatus(root)!.getAttribute('data-capture-state')).toBe('listening');

    // Busy on this item → capturing.
    csRender(
      <CsHost correlation={FOCUSED} voiceLive={true} voiceBusy={true} captureStartItem={FOCUSED} />,
    );
    expect(csStatus(root)!.getAttribute('data-capture-state')).toBe('capturing');

    // Busy but focus moved off the start item → amber wait.
    csRender(
      <CsHost correlation={FOCUSED} voiceLive={true} voiceBusy={true} captureStartItem="b" />,
    );
    expect(csStatus(root)!.getAttribute('data-capture-state')).toBe('wait');

    // Back to off → gone again.
    csRender(
      <CsHost correlation={FOCUSED} voiceLive={false} voiceBusy={false} captureStartItem={null} />,
    );
    expect(csStatus(root)).toBeNull();
  });
});
