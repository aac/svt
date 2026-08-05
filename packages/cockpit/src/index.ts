/**
 * @surface/cockpit — headless triage engine
 *
 * Owns triage STATE and BEHAVIOR; owns zero pixels. The display lives in a
 * separate package (@surface/cockpit-ui).
 *
 * v0 public surface:
 *   useCockpit({ items, actions, onAction, onActivate?, bus? })
 *                                              headless hook (state, nav, dispatch);
 *                                              returns event-free intent methods
 *                                              next/prev/activate/invokeAction
 *   useCockpitKeys(engine, { keymap?, target? })
 *                                              key→intent resolver; owns the
 *                                              input-suppression guard
 *   isTextEntryTarget(eventTarget)              that guard's predicate, exported so
 *                                              a consumer's own key listener can
 *                                              suppress on the same rule (native
 *                                              fields + contenteditable)
 *   eventOrigin(event)                          the event's true origin node —
 *                                              `composedPath()[0]` when present,
 *                                              else `target`; sees through
 *                                              shadow-DOM retargeting. Feed it to
 *                                              isTextEntryTarget.
 *   defaultKeymap                              the shipped j/k example keymap
 *   setFocusedItem(id)                          returned by useCockpit
 *   cockpitBus                                  shared event bus (focused-item);
 *                                              the DEFAULT channel every engine
 *                                              publishes on
 *   createCockpitBus()                          mint an independent bus for a
 *                                              cockpit that must not cross-talk
 *                                              with another on the same page
 *                                              (opt-in; pass it as `bus`)
 *   FOCUSED_ITEM_EVENT                          bus key constant ('focused-item')
 *
 * Keys are consumer-configurable: `defaultKeymap` (j/k) is the shipped EXAMPLE,
 * not the contract — see the key-ownership matrix in hooks/useCockpitKeys.ts.
 *
 * Items are opaque to the engine — it only reads `id` (the ItemId constraint).
 */

export { useCockpit } from './hooks/useCockpit.js';
export type { UseCockpitOptions } from './hooks/useCockpit.js';
export {
  useCockpitKeys,
  resolveCockpitKey,
  isTextEntryTarget,
  eventOrigin,
} from './hooks/useCockpitKeys.js';
export type {
  UseCockpitKeysOptions,
  CockpitKeyEvent,
} from './hooks/useCockpitKeys.js';
export { defaultKeymap } from './keymap.js';
export { FOCUSED_ITEM_EVENT, cockpitBus, createCockpitBus } from './bus.js';
export type {
  CockpitBus,
  CockpitEventMap,
  CockpitEventName,
  CockpitHandler,
} from './bus.js';
export type {
  CockpitAction,
  Intent,
  ItemId,
  Keymap,
  UseCockpitResult,
} from './types.js';
