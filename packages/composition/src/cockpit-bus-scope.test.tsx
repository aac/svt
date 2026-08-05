// @vitest-environment happy-dom
/**
 * Bus scope — the module singleton stays the default, scoping is opt-in.
 *
 * `cockpitBus` is a module-level singleton with one event name, so two cockpits on
 * one page published `focused-item` to one global channel and a subscriber heard
 * whichever cockpit was last touched. `createCockpitBus()` + the `bus` option on
 * `useCockpit` / `<CockpitProvider>` / `<Cockpit>` fix that — opt-in.
 *
 * This file pins BOTH halves of that contract, and the first half is the more
 * important one:
 *
 *   1. DEFAULT-PATH REGRESSION GUARD. Every existing subscriber — composition's
 *      wiring runtime (`runtime.ts` `BUS_EVENTS`), the two cockpit-ui demos, and
 *      downstream consumer apps — subscribes to the
 *      singleton BY IMPORT. If a provider ever defaults to a private bus, all of
 *      them silently stop hearing focus changes: no error, no type failure, just
 *      dead voice correlation. Nothing else in the suite catches that, because
 *      every other bus test emits on the singleton by hand instead of mounting a
 *      real cockpit. So these tests drive a REAL engine / REAL provider through
 *      the REAL `applyWiring` runtime and assert the singleton still hears it.
 *
 *   2. CROSS-TALK PROOF (the acceptance criterion). Two providers on one page, each given
 *      its own `createCockpitBus()`, must not stamp each other's correlations —
 *      and must leave the singleton silent.
 *
 * All test helpers are prefixed `bus` (parallel-sibling collision guard).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// Tell React this is an act() environment so state updates flush inside act()
// deterministically (and to silence the "not configured to support act" warning).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import {
  FOCUSED_ITEM_EVENT,
  cockpitBus,
  createCockpitBus,
  useCockpit,
  type CockpitAction,
  type CockpitBus,
} from '@surface/cockpit';
import {
  CockpitProvider,
  useCockpitBus,
  useCockpitContext,
} from '../../cockpit-ui/src/components/CockpitProvider';
import { applyWiring, type HandleRegistry, type LibraryHandle } from './runtime';

interface BusItem {
  id: string;
}

const BUS_ACTIONS: CockpitAction[] = [{ id: 'keep', label: 'Keep', keybind: 'Enter' }];
const BUS_ITEMS_A: BusItem[] = [{ id: 'a0' }, { id: 'a1' }, { id: 'a2' }];
const BUS_ITEMS_B: BusItem[] = [{ id: 'b0' }, { id: 'b1' }, { id: 'b2' }];

/** Record every payload a bus delivers, so a test can assert deltas. */
function busRecorder(bus: CockpitBus): { seen: Array<string | null>; off: () => void } {
  const seen: Array<string | null> = [];
  const off = bus.on(FOCUSED_ITEM_EVENT, (id) => seen.push(id));
  return { seen, off };
}

/**
 * The real wiring path a voice library sits behind: `applyWiring` subscribes the
 * manifest's `focused-item` → `voice.setCorrelationId` edge against the runtime's
 * own bus table (which imports the singleton). Returns the live correlation cell.
 */
function busWireVoice(): { correlation: { current: string | null }; teardown: () => void } {
  const correlation = { current: null as string | null };
  const handle: LibraryHandle = {
    setCorrelationId: (id: unknown) => {
      correlation.current = (id ?? null) as string | null;
    },
  };
  const handles: HandleRegistry = new Map([['voice', handle]]);
  const teardown = applyWiring(
    [{ on: FOCUSED_ITEM_EVENT, call: 'voice.setCorrelationId' }],
    handles,
  );
  return { correlation, teardown };
}

let busContainer: HTMLDivElement | null = null;
let busRoot: Root | null = null;

/** Mount a React tree into a fresh in-document container and flush effects. */
function busMount(ui: React.ReactElement): HTMLElement {
  busContainer = document.createElement('div');
  document.body.appendChild(busContainer);
  busRoot = createRoot(busContainer);
  act(() => {
    busRoot!.render(ui);
  });
  return busContainer;
}

/** Focus a tagged button and press a key on it (bubbles to its provider). */
function busPressOn(root: HTMLElement, focusTag: string, key: string) {
  const el = root.querySelector<HTMLButtonElement>(`[data-focus="${focusTag}"]`);
  if (!el) throw new Error(`no focusable for tag ${focusTag}`);
  el.focus();
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

/** Probe piece: focusable buttons so a test can steer keys into THIS provider. */
function BusProbe({ tag, items }: { tag: string; items: BusItem[] }) {
  const engine = useCockpitContext<BusItem>();
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

/**
 * A piece that subscribes through `useCockpitBus()` — i.e. it never names a bus,
 * it just reads whichever channel its enclosing provider publishes on.
 */
function BusContextSubscriber({ sink }: { sink: Array<string | null> }) {
  const bus = useCockpitBus();
  useEffect(() => bus.on(FOCUSED_ITEM_EVENT, (id) => sink.push(id)), [bus, sink]);
  return null;
}

/** Headless consumer of the engine — the `useCockpit` tier, no provider involved. */
function BusHeadless({ items, bus }: { items: BusItem[]; bus?: CockpitBus }) {
  const engine = useCockpit<BusItem>({
    items,
    actions: BUS_ACTIONS,
    onAction: () => {},
    ...(bus ? { bus } : {}),
  });
  return (
    <button type="button" data-focus="headless-next" onClick={() => engine.next()}>
      {engine.focusedIndex}
    </button>
  );
}

function busClickHeadlessNext(root: HTMLElement) {
  const el = root.querySelector<HTMLButtonElement>('[data-focus="headless-next"]');
  if (!el) throw new Error('no headless next button');
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

afterEach(() => {
  if (busRoot) act(() => busRoot!.unmount());
  busContainer?.remove();
  busRoot = null;
  busContainer = null;
});

// ── 1. Default-path regression guard ─────────────────────────────────────────
describe('bus default path — an unscoped cockpit still publishes on the module singleton', () => {
  it('useCockpit with NO bus option emits focus changes on cockpitBus', () => {
    const rec = busRecorder(cockpitBus);
    const root = busMount(<BusHeadless items={BUS_ITEMS_A} />);
    // Mount announces the initially-focused item.
    expect(rec.seen).toEqual(['a0']);
    busClickHeadlessNext(root);
    expect(rec.seen).toEqual(['a0', 'a1']);
    rec.off();
  });

  it('<CockpitProvider> with NO bus prop emits focus changes on cockpitBus', () => {
    const rec = busRecorder(cockpitBus);
    const root = busMount(
      <CockpitProvider items={BUS_ITEMS_A} actions={BUS_ACTIONS} onAction={() => {}}>
        <BusProbe tag="A" items={BUS_ITEMS_A} />
      </CockpitProvider>,
    );
    expect(rec.seen).toEqual(['a0']);
    busPressOn(root, 'A-a0', 'j');
    expect(rec.seen).toEqual(['a0', 'a1']);
    rec.off();
  });

  it('an unscoped provider reaches voice through the REAL applyWiring runtime', () => {
    // The end-to-end shape every current consumer relies on: real provider →
    // singleton bus → runtime wiring → voice.setCorrelationId. This is the test
    // that fails loudly if the default ever becomes a private bus.
    const wired = busWireVoice();
    const root = busMount(
      <CockpitProvider items={BUS_ITEMS_A} actions={BUS_ACTIONS} onAction={() => {}}>
        <BusProbe tag="A" items={BUS_ITEMS_A} />
      </CockpitProvider>,
    );
    expect(wired.correlation.current).toBe('a0');
    busPressOn(root, 'A-a0', 'j');
    expect(wired.correlation.current).toBe('a1');
    busPressOn(root, 'A-a0', 'j');
    expect(wired.correlation.current).toBe('a2');
    wired.teardown();
  });

  it('useCockpitBus() outside any provider resolves to the module singleton', () => {
    expect(busReadBusOutsideProvider()).toBe(cockpitBus);
  });
});

/** Render-once probe that returns what `useCockpitBus()` resolves to with no provider. */
function busReadBusOutsideProvider(): CockpitBus {
  const resolved: CockpitBus[] = [];
  function Probe() {
    resolved.push(useCockpitBus());
    return null;
  }
  busMount(<Probe />);
  const bus = resolved[0];
  if (!bus) throw new Error('probe did not render');
  return bus;
}

// ── 2. Cross-talk proof (the acceptance criterion) ────────────────────────────────────
describe('bus scoping — two providers on one page do not cross-talk', () => {
  it('each scoped provider publishes only to its OWN bus, and not to the singleton', () => {
    const busA = createCockpitBus();
    const busB = createCockpitBus();
    const recA = busRecorder(busA);
    const recB = busRecorder(busB);
    const recSingleton = busRecorder(cockpitBus);

    const root = busMount(
      <>
        <CockpitProvider
          items={BUS_ITEMS_A}
          actions={BUS_ACTIONS}
          onAction={() => {}}
          bus={busA}
        >
          <BusProbe tag="A" items={BUS_ITEMS_A} />
        </CockpitProvider>
        <CockpitProvider
          items={BUS_ITEMS_B}
          actions={BUS_ACTIONS}
          onAction={() => {}}
          bus={busB}
        >
          <BusProbe tag="B" items={BUS_ITEMS_B} />
        </CockpitProvider>
      </>,
    );

    // Mount: each bus hears only its own cockpit's initial focus.
    expect(recA.seen).toEqual(['a0']);
    expect(recB.seen).toEqual(['b0']);

    // Move focus in A only. B's channel must not see a thing.
    busPressOn(root, 'A-a0', 'j');
    expect(recA.seen).toEqual(['a0', 'a1']);
    expect(recB.seen).toEqual(['b0']);

    // Now move B twice. A's channel is frozen at its own last value.
    busPressOn(root, 'B-b0', 'j');
    busPressOn(root, 'B-b0', 'j');
    expect(recB.seen).toEqual(['b0', 'b1', 'b2']);
    expect(recA.seen).toEqual(['a0', 'a1']);

    // Neither scoped cockpit leaked onto the global channel — that is what makes
    // the scoping real rather than an extra copy of the same emissions.
    expect(recSingleton.seen).toEqual([]);

    recA.off();
    recB.off();
    recSingleton.off();
  });

  it('a piece under a scoped provider subscribes via useCockpitBus() with no cross-talk', () => {
    // Same proof one level up: the pieces never name a bus. Each reads its own
    // provider's channel off context, which is how a composition subscribes
    // without hardcoding the global import.
    const busA = createCockpitBus();
    const busB = createCockpitBus();
    const sinkA: Array<string | null> = [];
    const sinkB: Array<string | null> = [];

    const root = busMount(
      <>
        <CockpitProvider
          items={BUS_ITEMS_A}
          actions={BUS_ACTIONS}
          onAction={() => {}}
          bus={busA}
        >
          <BusProbe tag="A" items={BUS_ITEMS_A} />
          <BusContextSubscriber sink={sinkA} />
        </CockpitProvider>
        <CockpitProvider
          items={BUS_ITEMS_B}
          actions={BUS_ACTIONS}
          onAction={() => {}}
          bus={busB}
        >
          <BusProbe tag="B" items={BUS_ITEMS_B} />
          <BusContextSubscriber sink={sinkB} />
        </CockpitProvider>
      </>,
    );

    // React flushes CHILD effects before parent ones, so a subscriber piece is
    // already attached when its provider's engine announces the initial focus —
    // it sees the mount emission too. Asserted rather than worked around: a piece
    // that subscribes on mount should not miss the current focus.
    expect(sinkA).toEqual(['a0']);
    expect(sinkB).toEqual(['b0']);

    busPressOn(root, 'A-a0', 'j');
    busPressOn(root, 'A-a0', 'j');
    expect(sinkA).toEqual(['a0', 'a1', 'a2']);
    expect(sinkB).toEqual(['b0']);

    busPressOn(root, 'B-b0', 'j');
    expect(sinkB).toEqual(['b0', 'b1']);
    expect(sinkA).toEqual(['a0', 'a1', 'a2']);
  });

  it('mixing postures works: a scoped cockpit next to an unscoped one', () => {
    // The migration shape — one cockpit opts in, the legacy one keeps the
    // singleton. Each hears exactly one cockpit.
    const scoped = createCockpitBus();
    const recScoped = busRecorder(scoped);
    const recSingleton = busRecorder(cockpitBus);

    const root = busMount(
      <>
        <CockpitProvider
          items={BUS_ITEMS_A}
          actions={BUS_ACTIONS}
          onAction={() => {}}
          bus={scoped}
        >
          <BusProbe tag="A" items={BUS_ITEMS_A} />
        </CockpitProvider>
        <CockpitProvider items={BUS_ITEMS_B} actions={BUS_ACTIONS} onAction={() => {}}>
          <BusProbe tag="B" items={BUS_ITEMS_B} />
        </CockpitProvider>
      </>,
    );

    expect(recScoped.seen).toEqual(['a0']);
    expect(recSingleton.seen).toEqual(['b0']);

    busPressOn(root, 'A-a0', 'j');
    expect(recScoped.seen).toEqual(['a0', 'a1']);
    expect(recSingleton.seen).toEqual(['b0']);

    busPressOn(root, 'B-b0', 'j');
    expect(recSingleton.seen).toEqual(['b0', 'b1']);
    expect(recScoped.seen).toEqual(['a0', 'a1']);

    recScoped.off();
    recSingleton.off();
  });

  it('documents the bug: two UNSCOPED providers cross-talk on the shared singleton', () => {
    // The negative half of the contract, and the reason `bus` exists at all. Ported
    // from an independent implementation of bus scoping — the one assertion its
    // file made that this suite did not: with NO `bus` prop,
    // both providers publish on, and both wired voices subscribe to, the module
    // singleton, so advancing focus in A stamps BOTH voices with A's item.
    //
    // Pinning the defect deliberately: it is the DEFAULT behaviour, correct on a
    // one-cockpit page and wrong on a two-cockpit page, so "fixing" it would break
    // every existing consumer (see the default-path guard above). This test is what
    // keeps the scoped-bus tests above from reading as "scoping does nothing".
    const voiceA = busWireVoice();
    const voiceB = busWireVoice();

    const root = busMount(
      <>
        <CockpitProvider items={BUS_ITEMS_A} actions={BUS_ACTIONS} onAction={() => {}}>
          <BusProbe tag="A" items={BUS_ITEMS_A} />
        </CockpitProvider>
        <CockpitProvider items={BUS_ITEMS_B} actions={BUS_ACTIONS} onAction={() => {}}>
          <BusProbe tag="B" items={BUS_ITEMS_B} />
        </CockpitProvider>
      </>,
    );

    // Advance focus in A only. On the shared channel BOTH voices hear a1 — neither
    // can tell which cockpit moved. That is the cross-talk.
    busPressOn(root, 'A-a0', 'j');
    expect(voiceA.correlation.current).toBe('a1');
    expect(voiceB.correlation.current).toBe('a1');

    // Symmetric in the other direction: B's move stamps A's voice too.
    busPressOn(root, 'B-b0', 'j');
    expect(voiceA.correlation.current).toBe('b1');
    expect(voiceB.correlation.current).toBe('b1');

    voiceA.teardown();
    voiceB.teardown();
  });
});
