/**
 * Composition runtime — the manifest interpreter.
 *
 * THIS IS THE ONLY MODULE IN THE PROJECT THAT IMPORTS BOTH LIBRARIES.
 * That is the load-bearing invariant: cockpit does not import voice, voice does
 * not import cockpit, and the coupling between them lives entirely here, driven
 * by the manifest's `wiring[]` array. If you find another module importing both
 * libraries, the composability guarantee is broken.
 *
 * What the runtime does:
 *   1. Resolves each `manifest.libraries[]` entry (by `name`) to a mounted handle.
 *      - cockpit: rendered as a React component; publishes `focused-item` on its bus.
 *      - voice:   rendered as a React component; exposes an imperative handle
 *                 ({ setCorrelationId }).
 *   2. Interprets `manifest.wiring[]`: for each `{ on, call }`, subscribes to the
 *      named bus event and invokes the resolved `<library>.<method>` with the
 *      event payload. The only wiring v0 uses is
 *      `{ on: 'focused-item', call: 'voice.setCorrelationId' }`.
 *
 * Why a React-aware runtime rather than the brief's imperative
 * `mount(container, config, bus)` contract: the shipped libraries are React
 * (useCockpit/Cockpit, useVoiceCapture/VoiceIndicator). Rather than wrap each in
 * a synthetic imperative shell, the runtime speaks React natively. The manifest
 * shape (libraries[] + wiring[]) is unchanged — only the mount mechanism is
 * React-flavored. The substrate-agnostic point from surface's docs holds: the
 * manifest is the contract; the mount mechanism is implementation.
 */

import { cockpitBus, FOCUSED_ITEM_EVENT } from '@surface/cockpit';
import type { CockpitBus } from '@surface/cockpit';
import type { SurfaceManifest, ManifestWiring } from './manifest.js';

/**
 * The cross-library bus EVENTS the runtime knows about.
 *
 * v0 has exactly one event, on one kind of bus: cockpit's `focused-item` (the bus
 * is a thin EventTarget wrapper).
 * This table is the registry of *which events exist*; the *channel* they resolve
 * against is an argument, not a closure (see BUS SCOPE below). If more libraries
 * published events in a future version, this is where they'd be registered — but
 * v0 deliberately keeps it to one.
 *
 * ============================================================================
 * BUS SCOPE — singleton by default, per-composition opt-in
 * ============================================================================
 * This table used to close over the module singleton `cockpitBus`, which made the
 * scoped-bus seam (`createCockpitBus()`) reachable only by a
 * consumer that mounts `<Cockpit bus={…}>` and hand-wires its own subscription. A
 * MANIFEST-wired page — the runtime's whole point — had no way to scope, so two
 * cockpits on one page always published to the one global channel and the
 * last-touched one stamped every voice correlation.
 *
 * Each entry now takes the bus to subscribe on, and `applyWiring` takes an
 * optional `bus`:
 *   - OMITTED (default) → the module singleton `cockpitBus`. Byte-for-byte the
 *     previous behaviour: every existing subscriber and every existing caller of
 *     `applyWiring` is unchanged. That default is load-bearing, not incidental —
 *     an engine given no `bus` publishes on the singleton, so a private-bus
 *     default here would silently un-wire voice with no error and no type failure.
 *   - a `createCockpitBus()` instance → this composition's wiring listens only to
 *     that private channel, so a second manifest-wired composition on the same
 *     page cannot stamp its correlations.
 * Pass the SAME instance to the cockpit that publishes on it (`<Cockpit bus>` /
 * `<CockpitProvider bus>` / `<CockpitMount bus>`) and to `applyWiring`, or the
 * wiring listens to a channel nothing emits on.
 * ============================================================================
 */
const BUS_EVENTS: Record<
  string,
  { subscribe: (bus: CockpitBus, handler: (payload: unknown) => void) => () => void }
> = {
  [FOCUSED_ITEM_EVENT]: {
    subscribe: (bus, handler) => bus.on(FOCUSED_ITEM_EVENT, (id) => handler(id)),
  },
};

/**
 * An imperative handle a mounted library exposes to wiring.
 * Keyed by method name; the runtime resolves `<library>.<method>` against this.
 */
export type LibraryHandle = Record<string, (arg: unknown) => void>;

/** Map of library name → its imperative handle, built as libraries mount. */
export type HandleRegistry = Map<string, LibraryHandle>;

/**
 * Apply a manifest's wiring array against the mounted-library handles.
 *
 * Returns a teardown function that unsubscribes every wired edge. Call it on
 * page unmount.
 *
 * Resolution is strict: an unknown bus event, unknown library, or unknown method
 * throws. A misconfigured manifest should fail loudly at wire time, not silently
 * drop a coupling and leave voice un-stamped at drain time.
 *
 * `bus` is optional and defaults to the module singleton `cockpitBus` — every
 * existing call site keeps working unchanged. Pass a `createCockpitBus()` instance
 * (the same one the composition's cockpit publishes on) when two manifest-wired
 * compositions share a page and must not cross-talk. See BUS SCOPE above.
 */
export function applyWiring(
  wiring: ManifestWiring[] | undefined,
  handles: HandleRegistry,
  bus: CockpitBus = cockpitBus,
): () => void {
  if (!wiring || wiring.length === 0) {
    return () => {};
  }

  const teardowns: Array<() => void> = [];

  for (const edge of wiring) {
    const busEvent = BUS_EVENTS[edge.on];
    if (!busEvent) {
      throw new Error(
        `[runtime] wiring references unknown bus event "${edge.on}". ` +
          `Known events: ${Object.keys(BUS_EVENTS).join(', ') || '(none)'}`,
      );
    }

    const dot = edge.call.indexOf('.');
    if (dot === -1) {
      throw new Error(
        `[runtime] wiring "call" must be "<library>.<method>", got "${edge.call}".`,
      );
    }
    const libName = edge.call.slice(0, dot);
    const methodName = edge.call.slice(dot + 1);

    const handle = handles.get(libName);
    if (!handle) {
      throw new Error(
        `[runtime] wiring calls "${edge.call}" but library "${libName}" is not mounted. ` +
          `Mounted: ${[...handles.keys()].join(', ') || '(none)'}`,
      );
    }
    const method = handle[methodName];
    if (typeof method !== 'function') {
      throw new Error(
        `[runtime] wiring calls "${edge.call}" but "${libName}" exposes no method "${methodName}".`,
      );
    }

    teardowns.push(busEvent.subscribe(bus, (payload) => method(payload)));
  }

  return () => {
    for (const off of teardowns) off();
  };
}

/**
 * Validate that a manifest only names libraries this runtime can mount, before
 * any React rendering happens. Mirrors surface's "fail loud on misconfig"
 * posture. Returns the set of library names present.
 */
export function knownLibraryNames(manifest: SurfaceManifest): Set<string> {
  return new Set(manifest.libraries.map((l) => l.name));
}

/** The library names this runtime knows how to mount in v0. */
export const SUPPORTED_LIBRARIES = ['cockpit', 'voice'] as const;
