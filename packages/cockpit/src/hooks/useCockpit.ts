import { useCallback, useEffect, useRef, useState } from 'react';
import { FOCUSED_ITEM_EVENT, cockpitBus, type CockpitBus } from '../bus.js';
import type { CockpitAction, ItemId, UseCockpitResult } from '../types.js';

export interface UseCockpitOptions<T extends ItemId = ItemId> {
  items: T[];
  actions: CockpitAction[];
  /**
   * Called when the user invokes an action.
   * @param actionId - the action's id from the actions array
   * @param itemId - the currently-focused item's id
   */
  onAction: (actionId: string, itemId: string) => void;
  /**
   * Optional. Called when the focused item is ACTIVATED (the `activate` intent —
   * e.g. Enter, when a consumer binds it). Distinct from `onAction`: activation
   * is the "open/select the focused item" signal, not the firing of a registered
   * action. Omit it and `activate()` is a no-op (the shipped `<Cockpit>` does not
   * wire one — it uses per-action keybinds instead).
   * @param itemId - the currently-focused item's id
   */
  onActivate?: (itemId: string) => void;
  /**
   * Optional. The bus this engine publishes `focused-item` on.
   *
   * Omitted (the default) → the module singleton `cockpitBus`, which is what
   * every existing subscriber (composition's wiring runtime, voice's correlation
   * setter, the demos) listens to. Pass a `createCockpitBus()` instance to give
   * THIS cockpit its own channel, so two cockpits on one page don't stamp each
   * other's correlations. Must be a stable reference across renders — see
   * `createCockpitBus`.
   */
  bus?: CockpitBus;
}

/**
 * Headless hook for cockpit list+detail+keyboard-nav state.
 *
 * The hook manages:
 * - focusedIndex / focusedItem (the currently-highlighted item)
 * - keyboard navigation (j/k for prev/next, action keybinds)
 * - publishing `focused-item` on the cockpit bus when focus changes (the module
 *   singleton by default; pass `bus` to scope it to this engine)
 *
 * The hook does NOT:
 * - render anything
 * - know about surface, voice, or email
 * - remove items from the list (call a state mutation in the consuming app)
 */
export function useCockpit<T extends ItemId = ItemId>({
  items,
  actions,
  onAction,
  onActivate,
  bus = cockpitBus,
}: UseCockpitOptions<T>): UseCockpitResult<T> {
  const [focusedIndex, setFocusedIndex] = useState<number>(() =>
    items.length > 0 ? 0 : -1,
  );

  // Keep focusedIndex in bounds when items change.
  const clampedIndex = items.length === 0 ? -1 : Math.min(focusedIndex, items.length - 1);
  const focusedItem = clampedIndex >= 0 ? (items[clampedIndex] ?? null) : null;

  // Stable ref to the focused item id so the bus emit effect doesn't need
  // to re-subscribe every time items change.
  const focusedItemIdRef = useRef<string | null>(focusedItem?.id ?? null);
  focusedItemIdRef.current = focusedItem?.id ?? null;

  // Publish focused-item on the bus whenever focus changes. `bus` defaults to the
  // module singleton (see the option's doc) and is in the dep list so a genuine
  // bus swap re-announces the current focus to the new channel; a caller who
  // re-mints a bus every render gets an emit per render, which is why the factory
  // documents the stable-reference requirement.
  useEffect(() => {
    bus.emit(FOCUSED_ITEM_EVENT, focusedItem?.id ?? null);
  }, [focusedItem?.id, bus]);

  // Sync clampedIndex back to state if items shrink.
  useEffect(() => {
    if (clampedIndex !== focusedIndex) {
      setFocusedIndex(clampedIndex);
    }
  }, [clampedIndex, focusedIndex]);

  const setFocusedItem = useCallback(
    (id: string) => {
      const idx = items.findIndex((it) => it.id === id);
      if (idx !== -1) setFocusedIndex(idx);
    },
    [items],
  );

  const moveSelection = useCallback(
    (delta: number) => {
      if (items.length === 0) return;
      setFocusedIndex((prev) => {
        const current = Math.max(0, prev);
        return (current + delta + items.length) % items.length;
      });
    },
    [items.length],
  );

  // Stable refs to onAction/onActivate/focusedItem so the intent methods don't
  // need to re-register on every render.
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;
  const onActivateRef = useRef(onActivate);
  onActivateRef.current = onActivate;

  // Event-free imperative intents. These are the public intent surface a key
  // resolver (`useCockpitKeys`) or a consumer drives directly — they carry NO
  // KeyboardEvent, so the input-suppression guard cannot and does not live here
  // (it belongs in the key→intent layer, where the event still exists).
  const next = useCallback(() => moveSelection(1), [moveSelection]);
  const prev = useCallback(() => moveSelection(-1), [moveSelection]);

  const activate = useCallback(() => {
    const id = focusedItemIdRef.current;
    if (id) onActivateRef.current?.(id);
  }, []);

  const invokeAction = useCallback(
    (index: number) => {
      const action = actions[index];
      const id = focusedItemIdRef.current;
      if (action && id) onActionRef.current(action.id, id);
    },
    [actions],
  );

  return {
    items,
    focusedIndex: clampedIndex,
    focusedItem,
    setFocusedItem,
    moveSelection,
    next,
    prev,
    activate,
    invokeAction,
    actions,
  };
}
