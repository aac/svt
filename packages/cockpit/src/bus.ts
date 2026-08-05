/**
 * Shared event bus for cockpit library.
 *
 * Design: a tiny typed pub/sub channel. The module exports a ready-made
 * singleton, `cockpitBus`, which is the DEFAULT channel every cockpit engine
 * publishes on. Libraries that want to coordinate with cockpit subscribe to
 * events here without importing cockpit's internals — they only need the bus
 * export and the event-name constant.
 *
 * The voice library subscribes to `focused-item` events to call its own
 * setCorrelationId; the wiring is done in the surface manifest, not here.
 *
 * Implemented as a thin wrapper around the browser's EventTarget so we don't
 * pull in a pub/sub dependency. The custom event detail is typed via the
 * CockpitEventMap below.
 *
 * Usage:
 *   import { cockpitBus, FOCUSED_ITEM_EVENT } from '@surface/cockpit/bus';
 *
 *   // Subscribe (in the voice library, or any other consumer):
 *   cockpitBus.on(FOCUSED_ITEM_EVENT, (id) => setCorrelationId(id));
 *
 *   // Unsubscribe:
 *   const off = cockpitBus.on(FOCUSED_ITEM_EVENT, handler);
 *   off(); // call the returned teardown function
 *
 * ============================================================================
 * ONE PAGE, TWO COCKPITS — SCOPED BUSES (opt-in)
 * ============================================================================
 * The singleton is a single global channel: two independent cockpits on one page
 * both publish `focused-item` to it, so a subscriber cannot tell which cockpit
 * moved and the last-touched cockpit wins every correlation. That is correct and
 * wanted for the overwhelmingly common ONE-cockpit page (a subscriber needs no
 * reference to anything to hear focus), and wrong for a two-cockpit page.
 *
 * The fix is opt-in and additive: `createCockpitBus()` mints an INDEPENDENT
 * channel, and every publisher takes an optional `bus`:
 *
 *   const paneBus = createCockpitBus();            // module scope or useMemo —
 *                                                   // must be a STABLE reference
 *   useCockpit({ items, actions, onAction, bus: paneBus });
 *   // or, in @surface/cockpit-ui:
 *   <CockpitProvider items={…} actions={…} onAction={…} bus={paneBus}>
 *
 * A cockpit given no `bus` publishes on `cockpitBus` exactly as before — pass
 * nothing and nothing changes. See packages/cockpit/LIBRARY.md ("When to scope
 * the bus") for the decision rule.
 * ============================================================================
 */

export const FOCUSED_ITEM_EVENT = 'focused-item' as const;

export type CockpitEventMap = {
  [FOCUSED_ITEM_EVENT]: string | null;
};

export type CockpitEventName = keyof CockpitEventMap;
export type CockpitHandler<K extends CockpitEventName> = (
  payload: CockpitEventMap[K],
) => void;

/**
 * A cockpit event channel: subscribe with `on`, publish with `emit`.
 *
 * The shape both the module singleton (`cockpitBus`) and every scoped instance
 * (`createCockpitBus()`) satisfy, so a consumer can accept "some cockpit bus"
 * without caring which. There is exactly ONE event name (`focused-item`);
 * multi-event bus design is deliberately out of scope for v0.
 */
export interface CockpitBus {
  /**
   * Subscribe to a bus event.
   * Returns an unsubscribe function.
   */
  on<K extends CockpitEventName>(event: K, handler: CockpitHandler<K>): () => void;
  /** Publish an event to all current subscribers OF THIS BUS. */
  emit<K extends CockpitEventName>(event: K, payload: CockpitEventMap[K]): void;
}

/**
 * Mint an independent cockpit bus.
 *
 * Events published on the returned bus reach ONLY its own subscribers — not the
 * module singleton, and not any other instance. Create one per cockpit that must
 * not cross-talk with another cockpit on the same page, and keep the reference
 * STABLE (module scope, `useMemo`, or a ref) — subscribers hold onto the
 * instance they subscribed to, so re-minting a bus per render silently orphans
 * them.
 */
export function createCockpitBus(): CockpitBus {
  const target = new EventTarget();
  return {
    on<K extends CockpitEventName>(event: K, handler: CockpitHandler<K>): () => void {
      const listener = (e: Event) => {
        handler((e as CustomEvent<CockpitEventMap[K]>).detail);
      };
      target.addEventListener(event, listener);
      return () => target.removeEventListener(event, listener);
    },
    emit<K extends CockpitEventName>(event: K, payload: CockpitEventMap[K]): void {
      target.dispatchEvent(new CustomEvent(event, { detail: payload }));
    },
  };
}

/**
 * The singleton cockpit bus instance — the DEFAULT channel for every cockpit
 * engine that isn't handed an explicit `bus`.
 *
 * Import this in any library that needs to coordinate with cockpit. Its identity
 * and behaviour are unchanged by the scoped-bus addition: existing subscribers
 * (composition's wiring runtime, the demos, downstream apps) keep hearing focus
 * changes with no code change.
 */
export const cockpitBus: CockpitBus = createCockpitBus();
