import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react';
import {
  cockpitBus,
  useCockpit,
  useCockpitKeys,
  type CockpitAction,
  type CockpitBus,
  type ItemId,
  type Keymap,
  type UseCockpitResult,
} from '@surface/cockpit';

/**
 * Composable-layout provider + engine context (composable-layout impl node 2).
 *
 * `<CockpitProvider>` calls `useCockpit` ONCE and exposes the engine result on
 * React context. Pieces (`CockpitList` / `CockpitDetail`, impl node 3) call
 * `useCockpitContext()` and self-wire wherever the consumer places them in a
 * free-form arrangement — no prop drilling, one shared focus/dispatch state.
 * This is the primitive the design brief's decision 1 (option B, "shared engine
 * context") settles on: the framework's own way for siblings to share one hook's
 * state, not a bespoke protocol.
 *
 * ============================================================================
 * KEY SCOPE — container-ref vs document-registry (design-brief OPEN QUESTION,
 * settled here: CONTAINER-REF)
 * ============================================================================
 * The provider owns a root element and attaches the key listener to THAT element
 * (via `useCockpitKeys({ target: rootEl })`), not to `window`. Because a
 * `keydown` dispatches to the focused element and bubbles up the DOM, a
 * container-scoped listener only ever receives a key when focus is within its
 * own subtree. So:
 *   - the FOCUS-WITHIN GUARD is STRUCTURAL — the container attachment *is* the
 *     guard; an event reaches this listener only when `document.activeElement`
 *     is inside this provider's `rootEl`, with no `contains()` check to maintain
 *     and no global "active instance" bookkeeping;
 *   - TWO COCKPITS COEXIST on one page without cross-firing — each provider
 *     listens on its own container, so a key routes to exactly the provider
 *     whose subtree holds focus (proven by `cockpit-provider.test.tsx`).
 *
 * Why container-ref over the document-listener-registry alternative (the design
 * brief's other candidate): the registry approach would put every provider's
 * listener on `document`, firing all of them on every key, then need an explicit
 * `rootEl.contains(activeElement)` guard PLUS a registry to decide which
 * instance "wins" — strictly more machinery for the same routing the DOM already
 * gives us for free. Container-ref has no global registry (per the design brief: no plugin
 * protocol / registry), self-scopes, and tears down with the element. The engine
 * package already anticipated this: `useCockpitKeys` takes a `target` for exactly
 * this reason (see its key-ownership-matrix header).
 *
 * The input-suppression guard (don't hijack keys inside input/textarea/select,
 * ignore modified chords) still lives in `resolveCockpitKey` / `useCockpitKeys`,
 * so no consumer re-derives it here.
 * ============================================================================
 *
 * ============================================================================
 * BUS SCOPE — opt-in, singleton by default
 * ============================================================================
 * Container-ref scoped the KEY listener but not the BUS: the engine's
 * `focused-item` emission went to the module singleton `cockpitBus` regardless,
 * so two providers on one page published to one global channel and a subscriber
 * heard whichever cockpit the user last touched. The provider now takes an
 * optional `bus`:
 *   - OMITTED (default) → the module singleton `cockpitBus`. Unchanged behaviour:
 *     composition's wiring runtime, voice's correlation setter, and downstream
 *     apps all subscribe to that singleton by import, and defaulting to a private
 *     bus would silently kill focus correlation everywhere with no error and no
 *     type failure. So the default MUST stay the singleton (pinned by
 *     `cockpit-bus-scope.test.tsx`).
 *   - a `createCockpitBus()` instance → THIS provider (and every piece under it,
 *     via `useCockpitBus()`) uses that private channel instead, so a second
 *     cockpit on the page cannot stamp its correlations.
 * Scoping is per-page-composition policy, which is the consumer's call — the
 * library supplies the seam, not a policy.
 * ============================================================================
 *
 * The wrapper element is `display: contents` — it exists in the DOM (so keys
 * bubble through it and `contains()` works) but generates NO layout box, so it
 * never disturbs the consumer's free-form arrangement. Arrangement stays the
 * consumer's JSX; the provider only supplies shared state + key scope.
 */

/**
 * The value carried on cockpit engine context: the full `useCockpit` result
 * (focus, activation, dispatch, the intent methods, the item/action set). Pieces
 * read this off context instead of receiving it as props.
 */
export type CockpitContextValue<T extends ItemId = ItemId> = UseCockpitResult<T>;

const CockpitContext = createContext<UseCockpitResult | null>(null);

/**
 * The bus the nearest provider's engine publishes `focused-item` on.
 *
 * `null` means "no provider above me" — readers fall back to the module singleton
 * `cockpitBus`, which is exactly what an engine with no `bus` publishes on, so the
 * fallback is the truth rather than a guess. (Contrast `CockpitContext`, whose
 * public reader throws outside a provider: there is no correct default engine.)
 */
const CockpitBusContext = createContext<CockpitBus | null>(null);

export interface CockpitProviderProps<T extends ItemId = ItemId> {
  items: T[];
  actions: CockpitAction[];
  /** Fired when a registered action is invoked, with the action + focused-item ids. */
  onAction: (actionId: string, itemId: string) => void;
  /**
   * Optional. Fired when the focused item is ACTIVATED (the `activate` intent —
   * e.g. a `keymap` that binds `activate: ['Enter']`). Omit it and `activate()`
   * is a no-op, matching the shipped `<Cockpit>` (which uses per-action keybinds).
   */
  onActivate?: (itemId: string) => void;
  /**
   * The active keymap, passed straight through to `useCockpitKeys`:
   *   - omitted (`undefined`) → `defaultKeymap` (the j/k example);
   *   - a `Keymap` → replaces it (rebind nav/activation keys);
   *   - `null` → disable the global key listener entirely (headless keyboard).
   * No nav logic is re-derived by rebinding — only the key→intent binding is data.
   */
  keymap?: Keymap | null;
  /**
   * Optional. The bus this provider's engine publishes `focused-item` on, and the
   * bus every piece under it reads via `useCockpitBus()`.
   *
   * Omitted (default) → the module singleton `cockpitBus`, i.e. today's exact
   * behaviour and what existing subscribers listen to. Pass a stable
   * `createCockpitBus()` instance when two cockpits share a page and must not
   * cross-talk. See the BUS SCOPE header block.
   */
  bus?: CockpitBus;
  children: ReactNode;
}

/**
 * Provider that owns one shared cockpit engine + a container-scoped key listener.
 * Wrap a free-form arrangement of pieces in it; each piece reads the shared engine
 * via `useCockpitContext()`.
 */
export function CockpitProvider<T extends ItemId = ItemId>({
  items,
  actions,
  onAction,
  onActivate,
  keymap,
  bus,
  children,
}: CockpitProviderProps<T>) {
  // Resolve ONCE and use the same reference for the engine and the context, so a
  // piece calling `useCockpitBus()` always gets the channel its own engine is
  // actually publishing on. No `bus` prop → the module singleton (see BUS SCOPE).
  const resolvedBus = bus ?? cockpitBus;
  const engine = useCockpit<T>({ items, actions, onAction, onActivate, bus: resolvedBus });

  // The provider's own root element, published into state via a callback ref so
  // the key listener's effect re-runs and binds to the real container once it
  // mounts (a plain ref wouldn't trigger the effect). `useCockpitKeys` keys off
  // `target` identity, so this is what moves the listener from the initial
  // (pre-mount) state onto the scoped container.
  const [rootEl, setRootEl] = useState<HTMLDivElement | null>(null);
  const attachRoot = useCallback((el: HTMLDivElement | null) => {
    setRootEl(el);
  }, []);

  // Container-scoped key listener. `target = rootEl` is the whole focus-within
  // mechanism (see the header). `keymap` passes through untouched.
  useCockpitKeys(engine, { keymap, target: rootEl });

  return (
    <CockpitBusContext.Provider value={resolvedBus}>
      <CockpitContext.Provider value={engine as UseCockpitResult}>
        {/* Layout-neutral wrapper: in the DOM for event bubbling + focus scoping,
            but `display: contents` so it imposes no box on the arrangement. */}
        <div ref={attachRoot} data-cockpit-provider="" style={{ display: 'contents' }}>
          {children}
        </div>
      </CockpitContext.Provider>
    </CockpitBusContext.Provider>
  );
}

/**
 * Read the shared cockpit engine off context. Call inside a `<CockpitProvider>`.
 *
 * Throws (fail-loud, per the integration-and-contracts preference and the brief's
 * resolved leaning) when called outside a provider — a null-object return would
 * silently no-op every piece, which is exactly the kind of context-dependent
 * "success" that hides a wiring bug.
 */
export function useCockpitContext<T extends ItemId = ItemId>(): CockpitContextValue<T> {
  const ctx = useContext(CockpitContext);
  if (ctx === null) {
    throw new Error(
      'useCockpitContext() must be called inside a <CockpitProvider>. ' +
        'Wrap the piece (or your custom arrangement) in <CockpitProvider items actions onAction> ' +
        'so it can read the shared engine.',
    );
  }
  return ctx as UseCockpitResult<T>;
}

/**
 * Read the bus the surrounding cockpit publishes `focused-item` on.
 *
 * Use this to subscribe from inside a composition instead of importing
 * `cockpitBus` directly — the import is correct only while the page has one
 * cockpit, whereas this resolves to whichever channel the enclosing provider is
 * actually publishing on:
 *
 *   const bus = useCockpitBus();
 *   useEffect(() => bus.on(FOCUSED_ITEM_EVENT, setCorrelationId), [bus]);
 *
 * Outside any provider — or under a provider given no `bus` — this returns the
 * module singleton `cockpitBus`, which is what such an engine publishes on. It
 * deliberately does NOT throw: unlike the engine, the bus has one correct
 * default, so a bus-only consumer needs no provider.
 */
export function useCockpitBus(): CockpitBus {
  return useContext(CockpitBusContext) ?? cockpitBus;
}

/**
 * Package-internal, NON-throwing read of the engine context — returns `null`
 * outside a provider instead of throwing.
 *
 * The promoted pieces (`CockpitList` / `CockpitDetail`, impl node 3) use THIS,
 * not `useCockpitContext()`, precisely because they support BOTH mounting modes:
 * self-wired under a provider (context present) AND prop-drilled with no provider
 * (context absent — e.g. today's `<Cockpit>`, which threads engine state as
 * props). A throwing read would make the prop-override path impossible; the piece
 * resolves each engine field as `prop ?? context?.field` and fails loud only when
 * BOTH are missing. Not re-exported from `index.ts` — this is wiring, not public
 * API; consumers use the throwing `useCockpitContext()`.
 */
export function useOptionalCockpitEngine<
  T extends ItemId = ItemId,
>(): UseCockpitResult<T> | null {
  return useContext(CockpitContext) as UseCockpitResult<T> | null;
}
