// @vitest-environment happy-dom
/**
 * Manifest-wired bus scope — `applyWiring` takes a per-composition bus.
 *
 * Bus scoping gave the engine and the display an opt-in `bus`, but the composition
 * runtime's `BUS_EVENTS` table still closed over the module singleton, so the seam
 * was reachable only by a consumer that hand-wired its own subscription. A
 * MANIFEST-wired page — the runtime's whole point — could not scope at all: two
 * compositions on one page shared the one global channel and the last-touched
 * cockpit stamped every voice correlation.
 *
 * This file pins both halves of the fix, and the first half matters more:
 *
 *   1. THE DEFAULT IS STILL THE SINGLETON. Every existing caller passes two
 *      arguments (`App.tsx`, `triage-dogfood.test.ts`, `worked-examples.test.ts`)
 *      and every existing subscriber reaches the singleton BY IMPORT. If the
 *      default ever became a private bus, all of them would silently stop hearing
 *      focus changes — no error, no type failure, just dead voice correlation. The
 *      default-path tests below call `applyWiring` with exactly two arguments.
 *
 *   2. TWO RUNTIME-WIRED COMPOSITIONS DO NOT CROSS-TALK. The acceptance criterion, and the
 *      manifest-path mirror of the two-provider proof in `cockpit-bus-scope.test.tsx`.
 *
 * Everything here drives the REAL path: real manifests (`EMAIL_TRIAGE_MANIFEST`,
 * `TRIAGE_MANIFEST`) supply the wiring array rather than a paraphrase of it, the
 * cockpit is mounted through the runtime's own `CockpitMount`, and focus moves by
 * clicking real rendered rows.
 *
 * All test helpers are prefixed `wiring` (parallel-sibling collision guard).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// Tell React this is an act() environment so state updates flush inside act()
// deterministically (and to silence the "not configured to support act" warning).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import {
  FOCUSED_ITEM_EVENT,
  cockpitBus,
  createCockpitBus,
  type CockpitAction,
  type CockpitBus,
} from '@surface/cockpit';
import { CockpitMount } from './mounts.js';
import { applyWiring, type HandleRegistry, type LibraryHandle } from './runtime.js';
import type { SurfaceManifest, TriageItem } from './manifest.js';
import { EMAIL_TRIAGE_MANIFEST } from './manifest.example.js';
import { TRIAGE_MANIFEST } from './manifest.triage.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** The cockpit config out of a real manifest, exactly as App.tsx narrows it. */
function wiringCockpitConfig(manifest: SurfaceManifest): {
  items: TriageItem[];
  actions: CockpitAction[];
} {
  const config = manifest.libraries.find((l) => l.name === 'cockpit')?.config as
    | { items: TriageItem[]; actions: CockpitAction[] }
    | undefined;
  if (!config) throw new Error('manifest mounts no cockpit');
  return config;
}

const WIRING_EMAIL = wiringCockpitConfig(EMAIL_TRIAGE_MANIFEST);
const WIRING_FRUIT = wiringCockpitConfig(TRIAGE_MANIFEST);

/** The item ids the two manifests focus on mount (index 0) and after a click. */
const WIRING_EMAIL_FIRST = WIRING_EMAIL.items[0]!.id;
const WIRING_EMAIL_OTHER = WIRING_EMAIL.items[2]!.id;
const WIRING_FRUIT_FIRST = WIRING_FRUIT.items[0]!.id;
const WIRING_FRUIT_OTHER = WIRING_FRUIT.items[3]!.id;

function wiringMapItem(item: TriageItem) {
  return { title: item.title, body: item.body };
}

// ── Harness ──────────────────────────────────────────────────────────────────

interface WiringComposition {
  /** Every correlation id the manifest's wiring pushed into voice, in order. */
  seen: Array<string | null>;
  teardown: () => void;
}

/**
 * Wire a real manifest's `wiring[]` against a voice handle, through the REAL
 * runtime.
 *
 * `bus` omitted → `applyWiring` is called with exactly TWO arguments, which is
 * what pins the default. Passing `undefined` explicitly would still exercise the
 * default parameter, but it would not prove a two-argument caller still works.
 */
function wiringWire(manifest: SurfaceManifest, bus?: CockpitBus): WiringComposition {
  const seen: Array<string | null> = [];
  const handle: LibraryHandle = {
    setCorrelationId: (id: unknown) => {
      seen.push((id ?? null) as string | null);
    },
  };
  const handles: HandleRegistry = new Map([['voice', handle]]);
  const teardown =
    bus === undefined
      ? applyWiring(manifest.wiring, handles)
      : applyWiring(manifest.wiring, handles, bus);
  return { seen, teardown };
}

/** Record every payload a bus delivers, so a test can assert on a raw channel. */
function wiringRecorder(bus: CockpitBus): { seen: Array<string | null>; off: () => void } {
  const seen: Array<string | null> = [];
  const off = bus.on(FOCUSED_ITEM_EVENT, (id) => seen.push(id));
  return { seen, off };
}

let wiringContainer: HTMLDivElement | null = null;
let wiringRoot: Root | null = null;

function wiringMount(ui: React.ReactElement): HTMLElement {
  wiringContainer = document.createElement('div');
  document.body.appendChild(wiringContainer);
  wiringRoot = createRoot(wiringContainer);
  act(() => {
    wiringRoot!.render(ui);
  });
  return wiringContainer;
}

/** Move focus by clicking a rendered row — the display's own selection path. */
function wiringClickRow(root: HTMLElement, itemId: string) {
  const el = root.querySelector<HTMLButtonElement>(`[data-testid="cockpit-item-${itemId}"]`);
  if (!el) throw new Error(`no rendered row for item ${itemId}`);
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** A manifest-wired cockpit, mounted the way the runtime mounts one. */
function WiringCockpit({
  config,
  bus,
}: {
  config: { items: TriageItem[]; actions: CockpitAction[] };
  bus?: CockpitBus;
}) {
  return <CockpitMount config={config} onAction={() => {}} mapItem={wiringMapItem} bus={bus} />;
}

afterEach(() => {
  if (wiringRoot) act(() => wiringRoot!.unmount());
  wiringContainer?.remove();
  wiringRoot = null;
  wiringContainer = null;
});

// ── 1. The default is still the module singleton ─────────────────────────────
describe('applyWiring default — no bus argument resolves to cockpitBus', () => {
  it('subscribes to the module singleton when called with two arguments', () => {
    // The narrowest possible statement of the default: wire with no bus, emit on
    // the singleton by hand, and the manifest's voice edge fires.
    const wired = wiringWire(EMAIL_TRIAGE_MANIFEST);
    cockpitBus.emit(FOCUSED_ITEM_EVENT, 'msg-default');
    cockpitBus.emit(FOCUSED_ITEM_EVENT, null);
    expect(wired.seen).toEqual(['msg-default', null]);
    wired.teardown();
    // Teardown really unsubscribes — otherwise later tests would see this edge.
    cockpitBus.emit(FOCUSED_ITEM_EVENT, 'msg-after-teardown');
    expect(wired.seen).toEqual(['msg-default', null]);
  });

  it('an unscoped manifest-wired composition reaches voice end-to-end', () => {
    // Real manifest → real CockpitMount (no bus) → singleton → real applyWiring
    // (no bus) → voice.setCorrelationId. This is the shape every current consumer
    // relies on, and the test that fails loudly if the default ever changes.
    const wired = wiringWire(EMAIL_TRIAGE_MANIFEST);
    const root = wiringMount(<WiringCockpit config={WIRING_EMAIL} />);
    expect(wired.seen).toEqual([WIRING_EMAIL_FIRST]);
    wiringClickRow(root, WIRING_EMAIL_OTHER);
    expect(wired.seen).toEqual([WIRING_EMAIL_FIRST, WIRING_EMAIL_OTHER]);
    wired.teardown();
  });

  it('rejects an unknown bus event the same way on the scoped path as the default', () => {
    // Strict resolution is a property of the wiring table, not of the channel, so
    // scoping must not weaken the fail-loud posture.
    const handles: HandleRegistry = new Map([['voice', { setCorrelationId: () => {} }]]);
    const bogus = [{ on: 'not-an-event', call: 'voice.setCorrelationId' }];
    expect(() => applyWiring(bogus, handles)).toThrow(/unknown bus event/);
    expect(() => applyWiring(bogus, handles, createCockpitBus())).toThrow(/unknown bus event/);
  });
});

// ── 2. Two runtime-wired compositions do not cross-talk ──────────────────────
describe('applyWiring scoping — two manifest-wired compositions on one page', () => {
  it('each composition stamps only its OWN correlations, and the singleton stays silent', () => {
    const emailBus = createCockpitBus();
    const fruitBus = createCockpitBus();
    const email = wiringWire(EMAIL_TRIAGE_MANIFEST, emailBus);
    const fruit = wiringWire(TRIAGE_MANIFEST, fruitBus);
    const singleton = wiringRecorder(cockpitBus);

    const root = wiringMount(
      <>
        <WiringCockpit config={WIRING_EMAIL} bus={emailBus} />
        <WiringCockpit config={WIRING_FRUIT} bus={fruitBus} />
      </>,
    );

    // Mount: each composition's voice hears only its own cockpit's initial focus.
    expect(email.seen).toEqual([WIRING_EMAIL_FIRST]);
    expect(fruit.seen).toEqual([WIRING_FRUIT_FIRST]);

    // Move focus in the email cockpit only. The fruit composition sees nothing —
    // this is the exact cross-talk the singleton could not prevent.
    wiringClickRow(root, WIRING_EMAIL_OTHER);
    expect(email.seen).toEqual([WIRING_EMAIL_FIRST, WIRING_EMAIL_OTHER]);
    expect(fruit.seen).toEqual([WIRING_FRUIT_FIRST]);

    // And the other way round.
    wiringClickRow(root, WIRING_FRUIT_OTHER);
    expect(fruit.seen).toEqual([WIRING_FRUIT_FIRST, WIRING_FRUIT_OTHER]);
    expect(email.seen).toEqual([WIRING_EMAIL_FIRST, WIRING_EMAIL_OTHER]);

    // Neither scoped composition leaked onto the global channel — that is what
    // makes the scoping real rather than an extra copy of the same emissions.
    expect(singleton.seen).toEqual([]);

    singleton.off();
    email.teardown();
    fruit.teardown();
  });

  it('mixes postures: a scoped composition beside an unscoped one', () => {
    // The migration shape — one page opts in, the legacy composition keeps the
    // singleton. Each hears exactly one cockpit.
    const scopedBus = createCockpitBus();
    const scoped = wiringWire(TRIAGE_MANIFEST, scopedBus);
    const legacy = wiringWire(EMAIL_TRIAGE_MANIFEST);

    const root = wiringMount(
      <>
        <WiringCockpit config={WIRING_FRUIT} bus={scopedBus} />
        <WiringCockpit config={WIRING_EMAIL} />
      </>,
    );

    expect(scoped.seen).toEqual([WIRING_FRUIT_FIRST]);
    expect(legacy.seen).toEqual([WIRING_EMAIL_FIRST]);

    wiringClickRow(root, WIRING_FRUIT_OTHER);
    expect(scoped.seen).toEqual([WIRING_FRUIT_FIRST, WIRING_FRUIT_OTHER]);
    expect(legacy.seen).toEqual([WIRING_EMAIL_FIRST]);

    wiringClickRow(root, WIRING_EMAIL_OTHER);
    expect(legacy.seen).toEqual([WIRING_EMAIL_FIRST, WIRING_EMAIL_OTHER]);
    expect(scoped.seen).toEqual([WIRING_FRUIT_FIRST, WIRING_FRUIT_OTHER]);

    scoped.teardown();
    legacy.teardown();
  });

  it('scoping only the wiring (not the mount) hears nothing — pass the SAME instance to both', () => {
    // The one way to get this wrong. There is no error to raise: a bus with no
    // publisher is a legitimate state, so the failure is silence. Pinning it here
    // makes the pairing requirement a tested fact rather than a doc sentence.
    const orphanBus = createCockpitBus();
    const orphan = wiringWire(TRIAGE_MANIFEST, orphanBus);
    const singleton = wiringRecorder(cockpitBus);

    wiringMount(<WiringCockpit config={WIRING_FRUIT} />); // mount left on the singleton

    expect(orphan.seen).toEqual([]);
    expect(singleton.seen).toEqual([WIRING_FRUIT_FIRST]);

    singleton.off();
    orphan.teardown();
  });
});
