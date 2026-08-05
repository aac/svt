/**
 * React wiring for system-adaptive theming.
 *
 * The pure precedence lives in `theme-resolution.ts`; this module adds the three
 * things that need a runtime: the live `matchMedia` subscription, the per-surface
 * localStorage persistence, and the combined `useResolvedTheme` a consumer calls.
 * All DOM access is guarded so the no-DOM test env / SSR never throws — an absent
 * `matchMedia` resolves to light, an absent/throwing `localStorage` degrades to a
 * non-persisted `system` choice.
 *
 * Theme STATE deliberately lives here (the DISPLAY tier), never in the headless
 * `@surface/cockpit` engine — this is the project's first piece of theme state and
 * the design constraint keeps it out of the engine.
 */

import { useCallback, useEffect, useState } from 'react';
import type { CockpitTheme } from './tokens.js';
import {
  DEFAULT_THEME_STORAGE_KEY,
  isThemeMode,
  resolveScheme,
  resolveTheme,
  type ResolvedScheme,
  type ThemeMode,
} from './theme-resolution.js';

/**
 * Read the persisted toggle choice. Guarded for SSR / no-DOM / a `localStorage`
 * that throws (privacy mode) — falls back to `system`.
 */
export function readThemeMode(storageKey: string = DEFAULT_THEME_STORAGE_KEY): ThemeMode {
  try {
    if (typeof localStorage === 'undefined') return 'system';
    const raw = localStorage.getItem(storageKey);
    return isThemeMode(raw) ? raw : 'system';
  } catch {
    return 'system';
  }
}

/** Persist the toggle choice. Guarded — an absent/throwing `localStorage` is a no-op. */
export function writeThemeMode(
  mode: ThemeMode,
  storageKey: string = DEFAULT_THEME_STORAGE_KEY,
): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(storageKey, mode);
  } catch {
    /* best-effort persistence; a failure just means the choice isn't remembered */
  }
}

const DARK_QUERY = '(prefers-color-scheme: dark)';

function matchMediaSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function';
}

/**
 * Subscribe to the OS dark-mode preference, live-updating on change. Guarded for
 * environments without `matchMedia` (SSR, the node test env) — returns false and
 * never subscribes there. Cleans up its listener on unmount.
 */
export function useSystemPrefersDark(): boolean {
  const [prefersDark, setPrefersDark] = useState<boolean>(() =>
    matchMediaSupported() ? window.matchMedia(DARK_QUERY).matches : false,
  );
  useEffect(() => {
    if (!matchMediaSupported()) return;
    const mql = window.matchMedia(DARK_QUERY);
    const onChange = () => setPrefersDark(mql.matches);
    // Sync once in case the preference changed between initial render and effect.
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return prefersDark;
}

/**
 * The persisted tri-state toggle choice + a setter that writes through to
 * localStorage. Per-surface via `storageKey`; re-seeds if the key changes.
 */
export function useThemeMode(
  storageKey: string = DEFAULT_THEME_STORAGE_KEY,
): [ThemeMode, (mode: ThemeMode) => void] {
  const [mode, setModeState] = useState<ThemeMode>(() => readThemeMode(storageKey));
  useEffect(() => {
    setModeState(readThemeMode(storageKey));
  }, [storageKey]);
  const setMode = useCallback(
    (next: ThemeMode) => {
      setModeState(next);
      writeThemeMode(next, storageKey);
    },
    [storageKey],
  );
  return [mode, setMode];
}

export interface ResolvedCockpitTheme {
  /** The `CockpitTheme` to apply at the themeable ancestor. */
  theme: CockpitTheme;
  /** The persisted tri-state (drives the toggle). */
  mode: ThemeMode;
  /** Persist a new tri-state choice. */
  setMode: (mode: ThemeMode) => void;
  /** The concrete scheme actually resolved (`light` | `dark`). */
  scheme: ResolvedScheme;
  /** True when an explicit consumer theme is overriding system-adaptive (toggle inert). */
  explicitOverride: boolean;
}

/**
 * The full system-adaptive resolution for a consumer. Combines the persisted
 * toggle choice, the live OS preference, and any explicit consumer theme into the
 * `CockpitTheme` to apply — honoring the precedence in `resolveTheme`. Apply
 * `theme` at the shared ancestor of the cockpit (and any sibling chrome that reads
 * the `--cockpit-*` seam); drive a `<ThemeToggle>` from `mode` / `setMode`.
 */
export function useResolvedTheme(
  opts: {
    storageKey?: string;
    /** An explicit consumer theme that overrides system-adaptive (e.g. `?theme=`). */
    explicit?: CockpitTheme | null;
  } = {},
): ResolvedCockpitTheme {
  const { storageKey = DEFAULT_THEME_STORAGE_KEY, explicit = null } = opts;
  const [mode, setMode] = useThemeMode(storageKey);
  const systemPrefersDark = useSystemPrefersDark();
  const scheme = resolveScheme(mode, systemPrefersDark);
  const theme = resolveTheme({ explicit, mode, systemPrefersDark });
  return { theme, mode, setMode, scheme, explicitOverride: explicit != null };
}
