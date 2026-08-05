import type { Keymap } from './types.js';

/**
 * The shipped EXAMPLE keymap — j/k navigation, exactly as the engine has always
 * behaved. It is a default, not the contract: a consumer passes their own
 * `Keymap` to rebind, or `null` to disable global keys entirely.
 *
 * Why `activate` is empty by default:
 *   Historically the engine had no "activate the focused item" key — `Enter`
 *   (and any other activation-ish key) was a *named action keybind* owned by the
 *   action object (`{ id: 'keep', keybind: 'Enter' }`, seen across every shipped
 *   manifest). Binding `activate` to `Enter` HERE would silently steal `Enter`
 *   from those actions, because keymap intents resolve BEFORE action keybinds
 *   (see `useCockpitKeys`). So the default leaves `activate` unbound and lets the
 *   action-keybind layer keep `Enter`. A consumer who genuinely wants a distinct
 *   "open the focused item" gesture wires `onActivate` on `useCockpit` and binds
 *   `activate: ['Enter']` (or any key) in their own keymap — deliberately opting
 *   into keymap-over-action precedence for that key.
 */
export const defaultKeymap: Keymap = {
  next: ['j'],
  prev: ['k'],
  activate: [],
};
