/**
 * System-adaptive theme resolution — the pure decision logic.
 *
 * Design call: the quiet-light theme stays the bare-mount
 * LIGHT default, and a bare mount additionally adapts to `prefers-color-scheme`,
 * with a user light/dark toggle layered on top. This module holds the pure
 * precedence + scheme→theme mapping so it is unit-testable without a DOM (mirrors
 * `layout.ts`). The React wiring — the `matchMedia` subscription, the localStorage
 * persistence, the toggle control — lives in `useCockpitTheme.ts` /
 * `primitives/ThemeToggle.tsx` and calls into these functions.
 *
 * Precedence (highest first):
 *   1. an explicit consumer theme (a `CockpitTheme` object, or `?theme=` in demos)
 *   2. the user's toggle choice (system | light | dark), persisted per surface
 *   3. the OS `prefers-color-scheme`
 * System-adaptive is the DEFAULT posture, not a straitjacket — an explicit theme
 * always wins. Note this deliberately reverses the design-pass non-goal "no
 * automatic prefers-color-scheme switching"; that non-goal was superseded by
 * a later design call.
 *
 * The resolver returns a whole `CockpitTheme` (the light `defaultTheme` or the
 * `darkTheme`) to apply at the themeable ancestor — it never emits a resolved
 * literal color, so both schemes stay routed through the `--cockpit-*` seam and
 * every var it varies over is exercised (frontend rule: hardcoding an
 * indirection's resolved value silently opts out of the states it varies over).
 */

import { defaultTheme, darkTheme } from './themes/index.js';
import type { CockpitTheme } from './tokens.js';

/** The user-facing toggle's tri-state. `system` defers to `prefers-color-scheme`. */
export type ThemeMode = 'system' | 'light' | 'dark';

/** The concrete scheme a mode resolves to once the system preference is known. */
export type ResolvedScheme = 'light' | 'dark';

/** The tri-state in canonical order (drives the toggle's segments). */
export const THEME_MODES: readonly ThemeMode[] = ['system', 'light', 'dark'];

/** Narrow an unknown (e.g. a raw localStorage string) to a valid `ThemeMode`. */
export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark';
}

/**
 * Resolve the tri-state mode to a concrete light/dark scheme. `system` defers to
 * the OS preference; `light` / `dark` are explicit user overrides.
 */
export function resolveScheme(mode: ThemeMode, systemPrefersDark: boolean): ResolvedScheme {
  if (mode === 'light') return 'light';
  if (mode === 'dark') return 'dark';
  return systemPrefersDark ? 'dark' : 'light';
}

/**
 * The applyable theme for a resolved scheme: quiet-light (`defaultTheme`) under
 * `light`, the `darkTheme` variant under `dark`. Both are the pre-validated,
 * contrast-checked palettes from the design pass (the four-theme WCAG sweep in
 * `packages/composition/src/cockpit-theme.test.ts` covers both).
 */
export function themeForScheme(scheme: ResolvedScheme): CockpitTheme {
  return scheme === 'dark' ? darkTheme : defaultTheme;
}

/**
 * The single precedence resolver. An explicit consumer theme wins outright;
 * otherwise the mode + system preference pick between quiet-light and dark.
 * Returns the `CockpitTheme` to apply at the cockpit's themeable ancestor.
 */
export function resolveTheme(args: {
  explicit?: CockpitTheme | null;
  mode: ThemeMode;
  systemPrefersDark: boolean;
}): CockpitTheme {
  const { explicit, mode, systemPrefersDark } = args;
  if (explicit) return explicit;
  return themeForScheme(resolveScheme(mode, systemPrefersDark));
}

/**
 * Default per-surface localStorage key. Consumers override per surface (via the
 * `themeStorageKey` prop / `themeStorageKey()` helper) so two surfaces don't
 * clobber each other's toggle choice.
 */
export const DEFAULT_THEME_STORAGE_KEY = 'surface-cockpit:theme-mode';

/** Build a per-surface storage key from a surface id. */
export function themeStorageKey(surfaceId: string): string {
  return `${DEFAULT_THEME_STORAGE_KEY}:${surfaceId}`;
}
