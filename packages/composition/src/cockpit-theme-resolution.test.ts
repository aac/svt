/**
 * System-adaptive theme resolution + precedence + per-surface persistence.
 *
 * The resolution logic is factored into pure functions in cockpit-ui's
 * `theme-resolution` module (mirroring `layout`), so it is unit-testable at the
 * boundary that holds the rules without a DOM (no DOM env is configured in this
 * repo; the live matchMedia subscription + the rendered toggle are dogfood items).
 * The OS `prefers-color-scheme` signal is the `systemPrefersDark` boolean here — a
 * faked matchMedia — so both system schemes are exercised directly.
 *
 * The persistence helpers are tested against a fake `localStorage` global; the
 * hooks that wrap them (useSystemPrefersDark / useThemeMode / useResolvedTheme)
 * are thin React adapters over these functions.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_THEME_STORAGE_KEY,
  isThemeMode,
  resolveScheme,
  resolveTheme,
  themeForScheme,
  themeStorageKey,
  type ThemeMode,
} from '../../cockpit-ui/src/theme-resolution';
import { defaultTheme, darkTheme } from '../../cockpit-ui/src/themes/index';
import { readThemeMode, writeThemeMode } from '../../cockpit-ui/src/useCockpitTheme';

describe('resolveScheme — tri-state → concrete scheme', () => {
  it('system defers to the OS preference (the faked matchMedia signal)', () => {
    expect(resolveScheme('system', false)).toBe('light');
    expect(resolveScheme('system', true)).toBe('dark');
  });
  it('light / dark are explicit user overrides, ignoring the OS preference', () => {
    expect(resolveScheme('light', true)).toBe('light');
    expect(resolveScheme('light', false)).toBe('light');
    expect(resolveScheme('dark', false)).toBe('dark');
    expect(resolveScheme('dark', true)).toBe('dark');
  });
});

describe('themeForScheme — maps to the contrast-verified palettes', () => {
  it('light → the quiet-light default theme', () => {
    expect(themeForScheme('light')).toBe(defaultTheme);
  });
  it('dark → the dark variant theme', () => {
    expect(themeForScheme('dark')).toBe(darkTheme);
  });
});

describe('resolveTheme — precedence: explicit > toggle > system', () => {
  it('a bare mount (system mode) tracks the OS preference', () => {
    expect(resolveTheme({ mode: 'system', systemPrefersDark: false })).toBe(defaultTheme);
    expect(resolveTheme({ mode: 'system', systemPrefersDark: true })).toBe(darkTheme);
  });

  it('the user toggle choice overrides the OS preference', () => {
    // OS says dark, user forced light → light wins.
    expect(resolveTheme({ mode: 'light', systemPrefersDark: true })).toBe(defaultTheme);
    // OS says light, user forced dark → dark wins.
    expect(resolveTheme({ mode: 'dark', systemPrefersDark: false })).toBe(darkTheme);
  });

  it('an explicit consumer theme wins over BOTH toggle and system', () => {
    const paper = { '--cockpit-surface': '#faf6ee' };
    // Even with mode=dark and OS=dark, the explicit theme is returned.
    expect(resolveTheme({ explicit: paper, mode: 'dark', systemPrefersDark: true })).toBe(paper);
    expect(resolveTheme({ explicit: paper, mode: 'light', systemPrefersDark: false })).toBe(paper);
  });

  it('a null/absent explicit falls through to system-adaptive', () => {
    expect(resolveTheme({ explicit: null, mode: 'system', systemPrefersDark: true })).toBe(darkTheme);
    expect(resolveTheme({ explicit: undefined, mode: 'system', systemPrefersDark: false })).toBe(
      defaultTheme,
    );
  });
});

describe('isThemeMode — narrows a raw persisted string', () => {
  it('accepts the three valid modes', () => {
    for (const m of ['system', 'light', 'dark']) expect(isThemeMode(m)).toBe(true);
  });
  it('rejects anything else (garbage in localStorage, null, numbers)', () => {
    for (const bad of ['auto', 'DARK', '', null, undefined, 0, {}]) {
      expect(isThemeMode(bad)).toBe(false);
    }
  });
});

describe('themeStorageKey — per-surface keys never collide', () => {
  it('namespaces each surface under the default key', () => {
    expect(themeStorageKey('triage')).toBe(`${DEFAULT_THEME_STORAGE_KEY}:triage`);
  });
  it('two different surfaces get distinct keys', () => {
    expect(themeStorageKey('triage')).not.toBe(themeStorageKey('email'));
  });
});

// ── Persistence helpers against a fake localStorage ──────────────────────────
class FakeStorage {
  private map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.has(k) ? (this.map.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, String(v));
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
}

describe('readThemeMode / writeThemeMode — per-surface persistence, guarded', () => {
  const g = globalThis as { localStorage?: unknown };
  const hadLS = 'localStorage' in g;
  const prior = g.localStorage;

  beforeEach(() => {
    g.localStorage = new FakeStorage();
  });
  afterEach(() => {
    if (hadLS) g.localStorage = prior;
    else delete g.localStorage;
  });

  it('round-trips a written choice under its key', () => {
    writeThemeMode('dark', 'k1');
    expect(readThemeMode('k1')).toBe('dark');
  });

  it('defaults to system when nothing is persisted', () => {
    expect(readThemeMode('never-written')).toBe('system');
  });

  it('ignores a corrupt persisted value (falls back to system)', () => {
    (g.localStorage as FakeStorage).setItem('k2', 'nonsense');
    expect(readThemeMode('k2')).toBe('system');
  });

  it('keeps two surfaces independent (no clobber)', () => {
    writeThemeMode('dark', themeStorageKey('triage'));
    writeThemeMode('light', themeStorageKey('email'));
    expect(readThemeMode(themeStorageKey('triage'))).toBe('dark');
    expect(readThemeMode(themeStorageKey('email'))).toBe('light');
  });

  it('does not throw when localStorage is absent (SSR / no-DOM)', () => {
    delete g.localStorage;
    let mode: ThemeMode = 'dark';
    expect(() => {
      writeThemeMode('dark', 'k3');
      mode = readThemeMode('k3');
    }).not.toThrow();
    expect(mode).toBe('system');
  });
});
