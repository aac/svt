import type { ReactNode } from 'react';
import type { CockpitAction, CockpitBus, ItemId } from '@surface/cockpit';
import type { CockpitTheme } from './tokens.js';

/**
 * Display package types for @surface/cockpit-ui.
 *
 * The engine (@surface/cockpit) holds opaque items keyed by `id`. The display
 * needs to know what to render for each — that mapping is the agent's job, via
 * `mapItem`. The display owns ALL styling; the agent owns composition + semantics.
 *
 */

/** What the default display needs to render an item. The agent maps its domain item to this. */
export interface DisplayItem {
  /** Primary label shown in the list row + detail header. */
  title: string;
  /** Full content for the detail pane. Plain text OR HTML (sanitized on render). */
  body: string;
  /**
   * Optional accent color for the focused row's rail + detail top bar. A purely
   * presentational state hint (e.g. an active voice session). The display just
   * paints it; it has no idea what it means.
   */
  accent?: string;
}

/**
 * Additive slot render-props. Slots inject agent-rendered nodes into regions the
 * display styles; they NEVER override core layout (that is the headless tier —
 * compose your own panes with useCockpit). Kept minimal on purpose.
 */
export interface CockpitDisplaySlots<T extends ItemId = ItemId> {
  /** Trailing region of a list row (e.g. a status/voice chip). */
  renderRowAside?: (item: T) => ReactNode;
  /** Block above the detail body (e.g. annotations). */
  renderDetailBefore?: (item: T) => ReactNode;
}

/** Props for the default `<Cockpit>` display. */
export interface CockpitProps<T extends ItemId = ItemId> extends CockpitDisplaySlots<T> {
  items: T[];
  actions: CockpitAction[];
  onAction: (actionId: string, itemId: string) => void;
  /** Map a domain item to what the display should render. */
  mapItem: (item: T) => DisplayItem;
  /**
   * Optional. Pass-through to the underlying `<CockpitProvider bus>`: the channel
   * this display's engine publishes `focused-item` on.
   *
   * Omitted (default) → the module singleton `cockpitBus`, unchanged. Pass a
   * stable `createCockpitBus()` instance when TWO `<Cockpit>`s share a page and
   * must not stamp each other's voice correlations — without this the scoped-bus
   * seam is unreachable from the styled tier.
   */
  bus?: CockpitBus;
  /**
   * Theme control. Three postures:
   *   - omitted (default) — SYSTEM-ADAPTIVE: the display resolves
   *     `prefers-color-scheme` to quiet-light | dark, live-updates on OS change,
   *     and honors a persisted user toggle choice (see `themeStorageKey`). It sets
   *     the `--cockpit-*` vars on its own root, so a bare `<Cockpit/>` adapts with
   *     zero consumer setup.
   *   - a `CockpitTheme` object — EXPLICIT: force that theme; wins over
   *     system-adaptive (precedence: explicit > toggle > system).
   *   - `'inherit'` — the display sets NO vars and inherits whatever a consumer
   *     applied at an ancestor. Use this when the consumer already resolves + applies
   *     the theme itself to share the palette with sibling chrome (as the composition
   *     layer does), so the two don't fight over the same vars.
   */
  theme?: CockpitTheme | 'inherit';
  /**
   * Per-surface localStorage key for the persisted toggle choice. Default posture
   * only (ignored when `theme` is set). Give each surface a distinct key so their
   * toggle choices don't clobber each other; defaults to a shared key.
   */
  themeStorageKey?: string;
}
