/**
 * @surface/cockpit-ui — default presentational display for the cockpit engine
 *
 * Owns ALL styling. Consumes @surface/cockpit (the headless engine). Three tiers
 * of agent leeway:
 *   1. headless — render your own panes off `useCockpit` (from @surface/cockpit)
 *   2. slots    — use <Cockpit> + renderRowAside / renderDetailBefore
 *   3. declarative — use <Cockpit> + mapItem only
 *
 * Theming seam (design brief): every color/radius/shadow/font is a `--cockpit-*`
 * CSS variable with an inline default fallback, so a bare mount renders the
 * default look with zero setup, and a consumer restyles by setting the variables
 * on any ancestor. Apply `themes.default` (or any theme) declaratively to make
 * sibling chrome match. Exported visual primitives: <Chip>, <QuoteBlock>.
 */

export { Cockpit } from './components/Cockpit.js';
export { Chip } from './primitives/Chip.js';
export { QuoteBlock } from './primitives/QuoteBlock.js';
export type { ChipProps } from './primitives/Chip.js';
export type { QuoteBlockProps } from './primitives/QuoteBlock.js';
export type {
  CockpitProps,
  CockpitDisplaySlots,
  DisplayItem,
} from './types.js';
export type { CockpitVar, CockpitTheme } from './tokens.js';
export { themes, defaultTheme } from './themes/index.js';
export type { ThemeName } from './themes/index.js';

// System-adaptive theming: a bare mount adapts to prefers-color-scheme
// (quiet-light | dark, live), plus a persisted tri-state user toggle. Explicit
// consumer themes still win. Theme state lives here (display), never the engine.
export { ThemeToggle } from './primitives/ThemeToggle.js';
export type { ThemeToggleProps } from './primitives/ThemeToggle.js';
export {
  useResolvedTheme,
  useThemeMode,
  useSystemPrefersDark,
  readThemeMode,
  writeThemeMode,
} from './useCockpitTheme.js';
export type { ResolvedCockpitTheme } from './useCockpitTheme.js';
export {
  resolveTheme,
  resolveScheme,
  themeForScheme,
  isThemeMode,
  THEME_MODES,
  DEFAULT_THEME_STORAGE_KEY,
  themeStorageKey,
} from './theme-resolution.js';
export type { ThemeMode, ResolvedScheme } from './theme-resolution.js';

// ── Responsive collapse (composable-layout impl node 4 / baked fix 1 part b) ──
// `useResponsiveCollapse` wraps a ResizeObserver + the pure `layout.ts` fns to
// derive `isNarrow`/`view` and returns the activate/back handlers bundled, so a
// free-form master-detail consumer wires ONE thing, not three (mount observer +
// flip view on activate + thread back). Composes independently of the engine.
export { useResponsiveCollapse } from './useResponsiveCollapse.js';
export type {
  ResponsiveCollapse,
  UseResponsiveCollapseOptions,
} from './useResponsiveCollapse.js';

// ─────────────────────────────────────────────────────────────────────────────
// Composable layout — provider + engine context (composable-layout impl node 2)
// ─────────────────────────────────────────────────────────────────────────────
// <CockpitProvider items actions onAction keymap> calls useCockpit ONCE and puts
// the engine result on React context; free-form pieces (node 3) call
// useCockpitContext() and self-wire wherever they sit — one shared focus/dispatch
// state, no prop drilling. The provider owns a CONTAINER-SCOPED key listener
// (target = its own root element), so the focus-within guard is structural and
// two cockpits coexist on one page without cross-firing (see CockpitProvider.tsx
// for the container-ref-vs-registry decision). keymap defaults to defaultKeymap
// (the j/k example) and is a pass-through override.
//
// BUS SCOPE: the provider also takes an optional `bus`. Omitted, it
// uses the module singleton `cockpitBus` — unchanged, and what every existing
// subscriber listens to. Given a `createCockpitBus()` instance (from
// @surface/cockpit), that provider and every piece under it use that private
// channel, so two cockpits on one page don't stamp each other's voice
// correlations. `useCockpitBus()` reads whichever channel the enclosing provider
// is actually publishing on (the singleton when there is none), so a subscriber
// inside a composition doesn't have to hardcode the global import.
export {
  CockpitProvider,
  useCockpitContext,
  useCockpitBus,
} from './components/CockpitProvider.js';
export type {
  CockpitProviderProps,
  CockpitContextValue,
} from './components/CockpitProvider.js';

// ─────────────────────────────────────────────────────────────────────────────
// Composable layout — promoted display pieces (composable-layout impl node 3)
// ─────────────────────────────────────────────────────────────────────────────
// `CockpitList` (the list pane) and `CockpitDetail` (the detail pane) are now
// first-class exports, so a consumer can ARRANGE them freely (stacked, three-
// column, sidebar-swapped) instead of being boxed into `<Cockpit>`'s two-pane
// default. Each reads the shared engine off `useCockpitContext()` BY DEFAULT —
// drop `<CockpitList mapItem={…}/>` anywhere under a <CockpitProvider> and it
// self-wires (focus, activation, dispatch) with no prop drilling. Each ALSO
// accepts explicit engine props (`items`/`focusedIndex`/`onSelect`; `item`/
// `actions`/`onAction`) as the prop-drill override, for a consumer NOT using a
// provider — the path `<Cockpit>` itself still uses this node.
//
// These are the STYLED convenience pieces, not the styling contract: their look
// is tunable through the `--cockpit-*` token seam + the `renderRowAside` /
// `renderDetailBefore` slots, and a consumer who wants a different look entirely
// renders their own off the headless `@surface/cockpit` engine (owning 100% of
// the pixels). See LIBRARY.md ("the styling boundary") for the full map of
// what is restylable at which layer.
export { CockpitList } from './components/CockpitList.js';
export { CockpitDetail } from './components/CockpitDetail.js';
export type { CockpitListProps } from './components/CockpitList.js';
export type { CockpitDetailProps } from './components/CockpitDetail.js';
