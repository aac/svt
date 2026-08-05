import { useEffect, useRef } from 'react';
import { defaultKeymap } from '../keymap.js';
import type { Intent, ItemId, Keymap, UseCockpitResult } from '../types.js';

/**
 * ============================================================================
 * KEY-OWNERSHIP MATRIX (resolved — composable-layout impl node 1)
 * ============================================================================
 * Nodes 2-7 of the composable-layout fanout build against THIS closed decision,
 * not the design brief's open questions. Three questions were open; here is the
 * resolution the source is implemented against.
 *
 * 1. WHAT DOES `keymap={null}` SILENCE?
 *    Everything this resolver listens for. `keymap === null` attaches NO global
 *    `keydown` listener at all — nav intents (j/k), the numeric `1-9` positional
 *    keys, AND the named `action.keybind` keys are all silenced together, because
 *    they share this one listener. Rationale: "disable global keys entirely"
 *    (brief decision 2) means the consumer is taking over the keyboard; a library
 *    listener still firing action keybinds would contradict that and surprise.
 *    Action `keybind` values remain valid DATA (rendered as hint chips, still fire
 *    on click / explicit consumer wiring) — only the global key→intent listener
 *    is off. `keymap === undefined` (omitted) → `defaultKeymap`. A provided map
 *    replaces it.
 *
 * 2. DOES `1-9 → nth action` FOLD INTO THE KEYMAP, OR STAY AN ACTION BINDING?
 *    It STAYS an action-object binding; it is NOT a keymap intent. The keymap is
 *    a flat `Record<Intent, string[]>` over a FIXED, SMALL intent set; `1-9 → nth
 *    action` is positional over a VARIABLE-LENGTH actions array, which cannot be a
 *    fixed intent without an unbounded intent set (`invokeAction1…9` — the
 *    configurability-matrix smell the design brief warns against). Named keybinds already
 *    live on the action object (`action.keybind`), the single source of truth;
 *    folding them into the keymap would split that ownership across two places.
 *    So the keymap covers NAV + ACTIVATION intents only, and this resolver maps
 *    numeric/named keys → an action index → `engine.invokeAction(index)`.
 *
 * 3. WHERE DOES THE KEYMAP SEAM LIVE — `useCockpit` OR THE PROVIDER?
 *    In the engine package (`@surface/cockpit`, this node). `Intent`,
 *    `defaultKeymap`, `useCockpitKeys`, and the pure `resolveCockpitKey` all ship
 *    from `@surface/cockpit`, so the headless tier gets keymap-configurable keys
 *    with ZERO dependency on the display/provider package. `useCockpit` itself
 *    stays keymap-free (pure state + event-free intents); `useCockpitKeys` is the
 *    separate opt-in resolver that a headless consumer — or the future
 *    `CockpitProvider` (node 2) — composes over it. The provider passes its
 *    container element as `target`; see Q4 for what the `target` values mean.
 *
 * 4. WHAT DOES `target={null}` MEAN — "default" OR "off"?
 *    OFF. `target` follows the same undefined-vs-null split as `keymap`:
 *    `undefined` (omitted) → `window`, matching the shipped `<Cockpit>`;
 *    an EXPLICIT `null` → attach NOTHING; a target → attach there. It resolves
 *    with a strict `=== undefined` check, never `target ?? window`, which would
 *    collapse the two. Rationale: a consumer holding a container element that
 *    hasn't mounted yet passes `null` for one commit (`CockpitProvider`'s `rootEl`
 *    state does exactly this), and silently promoting that to a GLOBAL listener
 *    contradicts what the consumer asked for — "I passed a target and got a window
 *    listener" is the surprise. It also keeps `null` meaning the same thing across
 *    the option set as it already does for `keymap`: off, not default.
 *
 * RESOLUTION ORDER (guard-first):
 *    input-suppression guard → keymap intents (nav + activate) → numeric `1-9`
 *    positional → named `action.keybind`. First match wins; `preventDefault` is
 *    called only when a match actually fires.
 * ============================================================================
 */

/**
 * Minimal structural view of the fields the resolver reads off a keyboard event.
 * A real DOM `KeyboardEvent` satisfies this, so the resolver can be exercised in
 * a plain (non-DOM) environment with a hand-built event.
 */
export interface CockpitKeyEvent {
  key: string;
  target: EventTarget | null;
  /**
   * Optional because the resolver must stay drivable from a plain object. A real
   * DOM event always has it, and it is the ONLY way to see through a shadow-DOM
   * boundary — see `eventOrigin`.
   */
  composedPath?: () => EventTarget[];
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}

export interface UseCockpitKeysOptions {
  /**
   * The active keymap. `undefined` (omitted) → `defaultKeymap`. `null` → disable
   * global keys entirely (no listener attached; see matrix Q1).
   */
  keymap?: Keymap | null;
  /**
   * Where to attach the `keydown` listener. `undefined` (omitted) → `window` (the
   * shipped `<Cockpit>` posture). `null` → attach nothing, same "off, not default"
   * reading `null` has for `keymap` (see matrix Q4); a consumer whose container
   * hasn't mounted yet passes `null` and gets NO listener rather than a global one.
   * The provider (node 2) passes its scoped container element so multiple cockpits
   * on one page don't fight over `j`.
   */
  target?: EventTarget | null;
}

const TEXT_ENTRY_TAGS = new Set(['input', 'textarea', 'select']);

/**
 * The subset of an element the guard probes. Everything is optional because the
 * resolver is deliberately drivable from a NON-DOM environment: `e.target` may be
 * a hand-built plain object with nothing but `tagName`. So the guard reads only
 * fields it has type-checked at runtime — never `closest()`, never `ownerDocument`.
 */
interface EditableProbe {
  tagName?: unknown;
  isContentEditable?: unknown;
  contentEditable?: unknown;
  getAttribute?: unknown;
  parentElement?: unknown;
}

/**
 * The nearest `contenteditable` DECLARATION on this node, or null when it makes
 * none. Prefers the attribute (definitively absent → `null`) over the property
 * (a real DOM node reports the string `'inherit'` when unset, and happy-dom
 * reports `'inherit'` unconditionally — see `contentEditableChain`).
 */
function contentEditableDeclaration(node: EditableProbe): string | null {
  if (typeof node.getAttribute === 'function') {
    const attr = (node.getAttribute as (name: string) => string | null)(
      'contenteditable',
    );
    return typeof attr === 'string' ? attr : null;
  }
  return typeof node.contentEditable === 'string' ? node.contentEditable : null;
}

/**
 * Resolve `contenteditable` by walking ancestors, nearest declaration wins:
 *   - `true` / `''` / `'plaintext-only'` → editable (INHERITED by descendants, so
 *     a bare `<span>` inside `<div contenteditable>` resolves editable here)
 *   - `'false'` → NOT editable, even inside an editable region (nearest wins)
 *   - `'inherit'` / anything unrecognized / absent → keep walking
 * Returns null when no ancestor declares anything.
 *
 * Why the walk rather than just `element.isContentEditable`: that property is the
 * browser's own inheritance-aware answer, but it is not universally implemented —
 * happy-dom 15 (this repo's DOM test env) hardcodes it to `false` and
 * `contentEditable` to `'inherit'`, so an `isContentEditable`-only guard is
 * untestable here and silently absent under any similarly partial DOM. The walk
 * is the portable path; `isContentEditable === true` is still honored below as a
 * belt-and-braces catch for editability with no attribute behind it (e.g.
 * `document.designMode`). A `false` from it is never trusted, for the reason above.
 *
 * The depth cap makes a malformed/cyclic hand-built parent chain terminate.
 */
function contentEditableChain(start: EditableProbe): boolean | null {
  let node: EditableProbe | null = start;
  for (let depth = 0; node && depth < 100; depth += 1) {
    const declared = contentEditableDeclaration(node);
    if (declared !== null) {
      const value = declared.toLowerCase();
      if (value === 'false') return false;
      if (value === 'true' || value === '' || value === 'plaintext-only') return true;
    }
    const parent: unknown = node.parentElement;
    node = parent && typeof parent === 'object' ? (parent as EditableProbe) : null;
  }
  return null;
}

/**
 * True when focus is inside a text-entry element we must not hijack: a native
 * `input`/`textarea`/`select`, OR a `contenteditable` region (including a nested
 * element that merely INHERITS editability from an ancestor). Exported because
 * the display package's Escape guard must apply the identical rule — one guard,
 * two listeners, no second copy to drift.
 */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  const probe = target as EditableProbe | null;
  if (!probe) return false;

  const tag =
    typeof probe.tagName === 'string' ? probe.tagName.toLowerCase() : undefined;
  if (tag && TEXT_ENTRY_TAGS.has(tag)) return true;

  const chained = contentEditableChain(probe);
  if (chained !== null) return chained;

  return probe.isContentEditable === true;
}

/**
 * The node the event actually came FROM, seeing through shadow-DOM retargeting.
 *
 * A listener outside a shadow root never sees the inner node in `e.target`: the
 * DOM retargets it to the shadow HOST, so an `<input>` (or a contenteditable
 * region) inside a web component is invisible to any `e.target`-based guard and
 * the cockpit would hijack `j`/`k` mid-typing. `composedPath()[0]` is the real
 * origin — the first entry is the innermost node, before any retargeting.
 *
 * Falls back to `e.target` when `composedPath` is absent (the bare structural
 * `CockpitKeyEvent` the resolver is deliberately drivable with) or returns an
 * empty array (the DOM's answer for an event that is not currently dispatching).
 */
export function eventOrigin(e: {
  target: EventTarget | null;
  composedPath?: unknown;
}): EventTarget | null {
  if (typeof e.composedPath === 'function') {
    const path = (e.composedPath as () => EventTarget[])();
    if (Array.isArray(path) && path.length > 0) return path[0] ?? e.target;
  }
  return e.target;
}

/** First keymap intent whose bound keys include `key` (case-insensitive). */
function matchIntent(keymap: Keymap, key: string): Intent | null {
  const lower = key.toLowerCase();
  for (const intent of Object.keys(keymap) as Intent[]) {
    if (keymap[intent].some((k) => k.toLowerCase() === lower)) return intent;
  }
  return null;
}

/**
 * Pure resolver core: given an engine, the active keymap, and a key event,
 * dispatch the matching intent/action against the engine and report whether it
 * handled the event. Calls NO `preventDefault` (the caller decides that from the
 * return value) — the only side effects are the engine intent calls, which are
 * the whole point. Owns the input-suppression guard (matrix + brief nit).
 *
 * `keymap === null` (disabled) or `undefined` → the disabled/`defaultKeymap`
 * resolution matches the hook, so this is the single source of truth the hook
 * and the tests both drive.
 *
 * @returns true iff an intent or action fired (caller should `preventDefault`).
 */
export function resolveCockpitKey<T extends ItemId = ItemId>(
  engine: UseCockpitResult<T>,
  keymap: Keymap | null | undefined,
  e: CockpitKeyEvent,
): boolean {
  const active = keymap === undefined ? defaultKeymap : keymap;
  if (active === null) return false; // disabled — nothing resolves

  // Input-suppression guard: never hijack keys inside text entry (native fields
  // OR a contenteditable region, inherited cases included), and never intercept
  // modified chords. Lives HERE (the event layer), not in the event-free intent
  // methods. `eventOrigin` (not `e.target`) so a field inside a shadow root —
  // whose target is retargeted to the host — still suppresses.
  if (isTextEntryTarget(eventOrigin(e))) return false;
  if (e.metaKey || e.ctrlKey || e.altKey) return false;

  // 1. Keymap intents (nav + activation). Highest precedence.
  const intent = matchIntent(active, e.key);
  if (intent === 'next') {
    engine.next();
    return true;
  }
  if (intent === 'prev') {
    engine.prev();
    return true;
  }
  if (intent === 'activate') {
    engine.activate();
    return true;
  }

  // 2. Numeric 1-9 → nth action (0-indexed), positional over the actions array.
  if (/^[1-9]$/.test(e.key)) {
    const index = Number.parseInt(e.key, 10) - 1;
    if (engine.focusedItem && engine.actions[index]) {
      engine.invokeAction(index);
      return true;
    }
    // No action at that slot / nothing focused → fall through (a digit could in
    // principle be a named keybind), mirroring the legacy handler.
  }

  // 3. Named action keybinds (Enter, a, d, …), read off the action objects.
  const normalized = e.key === 'Enter' ? 'enter' : e.key.toLowerCase();
  const index = engine.actions.findIndex(
    (a) => a.keybind?.toLowerCase() === normalized,
  );
  if (index !== -1 && engine.focusedItem) {
    engine.invokeAction(index);
    return true;
  }

  return false;
}

/**
 * The key→intent resolver hook. Attaches a `keydown` listener, reads the keymap,
 * and calls the engine's event-free intent methods via `resolveCockpitKey`.
 * OWNS the input-suppression guard (this is the layer where the `KeyboardEvent`
 * still exists). Side-effect hook; returns nothing.
 *
 * Compose it over `useCockpit` for a headless-but-keyboard-driven consumer:
 *
 *   const engine = useCockpit({ items, actions, onAction });
 *   useCockpitKeys(engine, { keymap: { next: ['ArrowDown'], prev: ['ArrowUp'], activate: ['Enter'] } });
 *
 * Nav logic (wraparound, dispatch, the input guard) is entirely library-owned;
 * rebinding `keymap` re-derives none of it.
 */
export function useCockpitKeys<T extends ItemId = ItemId>(
  engine: UseCockpitResult<T>,
  options: UseCockpitKeysOptions = {},
): void {
  const { keymap, target } = options;

  // Latest resolver closure in a ref so the listener registers once per
  // enabled/target change, not on every render (keymap/engine identity churn is
  // read live through the ref, matching the legacy handler's ref pattern).
  const onKeyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  onKeyRef.current = (e: KeyboardEvent) => {
    if (resolveCockpitKey(engine, keymap, e)) e.preventDefault();
  };

  const disabled = keymap === null;

  // Strict `=== undefined`, mirroring how `keymap` resolves: omitted → `window`,
  // explicit `null` → attach nothing (matrix Q4). `target ?? window` would collapse
  // the two and hand a global listener to a consumer that asked for a container.
  const el =
    target === undefined ? (typeof window !== 'undefined' ? window : null) : target;

  useEffect(() => {
    if (disabled || el === null) return;
    const listener = (e: Event) => onKeyRef.current(e as KeyboardEvent);
    el.addEventListener('keydown', listener);
    return () => el.removeEventListener('keydown', listener);
  }, [disabled, el]);
}
