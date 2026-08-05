/**
 * Engine types for the cockpit library.
 *
 * The engine is headless: it owns triage state and behavior (the item set,
 * selection, keyboard nav, action dispatch, the focused-item bus) and knows
 * NOTHING about pixels. Items are opaque to the engine — it only ever reads
 * `id`. Presentation fields (title, body, accent) live in the display package
 * (`@surface/cockpit-ui`), not here.
 */

/** The only thing the engine requires of an item: a stable id. */
export interface ItemId {
  id: string;
}

/**
 * Generic action the managing agent registers with the engine.
 * When the user invokes an action (keybind or click), the engine calls onAction
 * with the action id and the currently-focused item id. The engine never learns
 * what an action means.
 */
export interface CockpitAction {
  id: string;
  label: string;
  /** Optional single-character keybind. Case-insensitive. */
  keybind?: string;
}

/**
 * An arrangement-independent, event-free action the engine understands. This is
 * the FIXED, SMALL intent set the keymap binds keys to — navigation plus
 * activation only. It is deliberately NOT extensible per-consumer: growing it is
 * a Rule-of-Three decision made in the library, not a configurability knob. See
 * the key-ownership matrix in `hooks/useCockpitKeys.ts` for why `1-9`/named
 * action keybinds are NOT intents (they stay on the action objects).
 */
export type Intent = 'next' | 'prev' | 'activate';

/**
 * A flat map from an intent to the keyboard keys that trigger it. Keys are
 * matched against `KeyboardEvent.key` (e.g. `'j'`, `'ArrowDown'`, `'Enter'`),
 * case-insensitively. This is the ENTIRE key-configuration surface — no chords,
 * no modes, no per-item bindings, no remap UI. `defaultKeymap` is the shipped
 * example; a consumer overrides it or passes `null` to disable global keys.
 */
export type Keymap = Record<Intent, string[]>;

/** Return shape of the useCockpit hook. */
export interface UseCockpitResult<T extends ItemId = ItemId> {
  items: T[];
  focusedIndex: number;
  focusedItem: T | null;
  /** Programmatically move focus to an item by id. No-op if id unknown. */
  setFocusedItem: (id: string) => void;
  /** Move focus by delta (-1 = previous, +1 = next). Wraps. */
  moveSelection: (delta: number) => void;
  /**
   * Move focus to the NEXT item (wraps). Event-free imperative intent — the
   * `next` intent's implementation, callable by a key resolver or directly.
   */
  next: () => void;
  /**
   * Move focus to the PREVIOUS item (wraps). Event-free imperative intent — the
   * `prev` intent's implementation.
   */
  prev: () => void;
  /**
   * Activate the currently-focused item — the `activate` intent. Fires the
   * `onActivate` callback (if the consumer wired one) with the focused item id;
   * a no-op when nothing is focused or no `onActivate` was given. Distinct from
   * `invokeAction`: activation is the "open/select the focused item" signal,
   * separate from firing one of the item's registered actions.
   */
  activate: () => void;
  /**
   * Fire the action at `index` (0-based) against the focused item. No-op if the
   * index is out of range or nothing is focused. This is the event-free
   * primitive behind BOTH the numeric `1-9` positional keys and the named
   * `action.keybind` bindings (the resolver maps a key → index → this call).
   */
  invokeAction: (index: number) => void;
  actions: CockpitAction[];
}
