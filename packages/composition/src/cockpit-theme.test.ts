/**
 * Theme vocabulary completeness, purity, and a four-theme WCAG contrast sweep
 * (cockpit-design-pass T1 + T3).
 *
 * `themes.default` is the single source of truth the copy-pasted consumer chrome
 * palettes collapse onto, so it MUST enumerate every variable in the vocabulary —
 * a missing one is a hole a consumer can't fill by reference. The variant themes
 * (`dark` / `paper` / `console`) are pure data: partial `CockpitTheme` objects
 * that touch only known vars and add zero component behavior (the purity block
 * below asserts the data shape; the plan's no-component-diff claim is enforced by
 * the token seam + confirmed in the worker report).
 *
 * The contrast sweep proves EVERY theme's text colors clear WCAG AA on the grounds
 * they actually render on, and that the non-text focus indicators (focus ring,
 * focused-card border) clear 3:1. On failure, fix the palette VALUE within the
 * theme's stated visual direction — never weaken the check.
 */

import { describe, it, expect } from 'vitest';
import { themes, defaultTheme, type CockpitVar } from '@surface/cockpit-ui';
import { ALL_COCKPIT_VARS, VAR_DEFAULTS } from '../../cockpit-ui/src/tokens';

describe('themes.default — enumerates the whole vocabulary', () => {
  it('has a value for every CockpitVar', () => {
    for (const name of ALL_COCKPIT_VARS) {
      expect(themes.default[name], `missing ${name}`).toBeTruthy();
      expect(typeof themes.default[name]).toBe('string');
    }
  });
  it('has no keys outside the vocabulary', () => {
    const allowed = new Set<string>(ALL_COCKPIT_VARS);
    for (const key of Object.keys(themes.default)) {
      expect(allowed.has(key), `unexpected key ${key}`).toBe(true);
    }
  });
  it('defaultTheme is the same object exported on themes.default', () => {
    expect(themes.default).toBe(defaultTheme);
  });
});

// ── Purity: variant themes are plain data over the known vocabulary ───────────
const VARIANT_NAMES = ['dark', 'paper', 'console'] as const;

// The color vars every variant re-grounds; the contrast sweep reads all of them,
// so a variant dropping one would both fail here and silently fall back to a
// default color that no longer matches its ground.
const REQUIRED_COLOR_VARS: readonly CockpitVar[] = [
  '--cockpit-surface',
  '--cockpit-surface-sunken',
  '--cockpit-surface-raised',
  '--cockpit-surface-hover',
  '--cockpit-border',
  '--cockpit-border-strong',
  '--cockpit-border-focus',
  '--cockpit-ink',
  '--cockpit-text',
  '--cockpit-text-muted',
  '--cockpit-text-faint',
  '--cockpit-accent',
  '--cockpit-accent-text',
  '--cockpit-accent-hover',
  '--cockpit-accent-soft',
];

describe('variant themes — pure data over the known vocabulary', () => {
  const allowed = new Set<string>(ALL_COCKPIT_VARS);

  it('registers exactly default + the three variants', () => {
    expect(Object.keys(themes).sort()).toEqual(
      ['console', 'dark', 'default', 'paper'].sort(),
    );
  });

  it.each(VARIANT_NAMES)('%s is a plain object of string values', (name) => {
    const theme = themes[name];
    expect(Object.getPrototypeOf(theme)).toBe(Object.prototype);
    for (const [key, value] of Object.entries(theme)) {
      expect(typeof value, `${name}.${key} must be a string`).toBe('string');
    }
  });

  it.each(VARIANT_NAMES)('%s touches only known --cockpit-* vars', (name) => {
    for (const key of Object.keys(themes[name])) {
      expect(allowed.has(key), `${name}: unexpected key ${key}`).toBe(true);
    }
  });

  it.each(VARIANT_NAMES)('%s re-grounds every color var', (name) => {
    const theme = themes[name];
    for (const v of REQUIRED_COLOR_VARS) {
      expect(theme[v], `${name} missing ${v}`).toBeTruthy();
    }
  });
});

// ── WCAG contrast ────────────────────────────────────────────────────────────
function channel(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function luminance(hex: string): number {
  const n = hex.replace('#', '');
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function contrast(fg: string, bg: string): number {
  const a = luminance(fg) + 0.05;
  const b = luminance(bg) + 0.05;
  return Math.max(a, b) / Math.min(a, b);
}

// A theme is partial (variants omit unchanged vars), so the effective painted
// value is the theme's own value or the component's inline fallback (= default).
function resolve(theme: (typeof themes)[keyof typeof themes], name: CockpitVar): string {
  return theme[name] ?? VAR_DEFAULTS[name];
}

/**
 * Every real fg/bg pair the components paint, as (fg var, bg var) — grounds
 * enumerated by reading the components:
 *  - list row preview (muted) sits on sunken (non-focused), hover, or the focused
 *    idle wash (accent-soft); focused row title (ink) on that same wash.
 *  - detail body (text) on surface; secondary action label (text) on raised;
 *    QuoteBlock body (text) + label (accent) on accent-soft.
 *  - kbd chip on a secondary button (faint) sits on the sunken ground; header /
 *    position / empty-state (faint) on sunken + surface.
 *  - accent as link/back/interactive text on surface + sunken; accent-text on the
 *    accent button.
 * color-mix grounds (the accent-wash live-item hue, the on-accent-text kbd chip)
 * are excluded: they reduce to solid pairs already covered (accent-text on accent,
 * muted on accent-soft).
 */
const TEXT_PAIRS: Array<[string, CockpitVar, CockpitVar]> = [
  ['ink on surface', '--cockpit-ink', '--cockpit-surface'],
  ['ink on focused wash', '--cockpit-ink', '--cockpit-accent-soft'],
  ['text on surface', '--cockpit-text', '--cockpit-surface'],
  ['text on sunken', '--cockpit-text', '--cockpit-surface-sunken'],
  ['text on raised', '--cockpit-text', '--cockpit-surface-raised'],
  ['text on focused wash', '--cockpit-text', '--cockpit-accent-soft'],
  ['muted on sunken', '--cockpit-text-muted', '--cockpit-surface-sunken'],
  ['muted on hover', '--cockpit-text-muted', '--cockpit-surface-hover'],
  ['muted on focused wash', '--cockpit-text-muted', '--cockpit-accent-soft'],
  ['faint on sunken (incl kbd-on-secondary)', '--cockpit-text-faint', '--cockpit-surface-sunken'],
  ['faint on surface', '--cockpit-text-faint', '--cockpit-surface'],
  ['accent on surface', '--cockpit-accent', '--cockpit-surface'],
  ['accent on sunken', '--cockpit-accent', '--cockpit-surface-sunken'],
  ['accent on focused wash', '--cockpit-accent', '--cockpit-accent-soft'],
  ['accent-text on accent', '--cockpit-accent-text', '--cockpit-accent'],
];

describe.each(Object.keys(themes) as Array<keyof typeof themes>)(
  '%s theme — WCAG contrast on real fg/bg pairs',
  (themeName) => {
    const theme = themes[themeName];

    it.each(TEXT_PAIRS)('%s clears 4.5:1', (_label, fg, bg) => {
      expect(contrast(resolve(theme, fg), resolve(theme, bg))).toBeGreaterThanOrEqual(4.5);
    });

    // Focus ring (accent) vs adjacent grounds is a non-text indicator → 3:1.
    it('focus ring (accent) clears 3:1 against surface + sunken', () => {
      const accent = resolve(theme, '--cockpit-accent');
      expect(contrast(accent, resolve(theme, '--cockpit-surface'))).toBeGreaterThanOrEqual(3);
      expect(contrast(accent, resolve(theme, '--cockpit-surface-sunken'))).toBeGreaterThanOrEqual(3);
    });

    // Focused-card border, when a theme opts into a visible one (shadows→borders).
    // Default leaves it transparent (leans on wash + shadow) → nothing to check.
    it('border-focus (when visible) clears 3:1 against raised + sunken', () => {
      const bf = resolve(theme, '--cockpit-border-focus');
      if (bf === 'transparent') return;
      expect(contrast(bf, resolve(theme, '--cockpit-surface-raised'))).toBeGreaterThanOrEqual(3);
      expect(contrast(bf, resolve(theme, '--cockpit-surface-sunken'))).toBeGreaterThanOrEqual(3);
    });
  },
);
