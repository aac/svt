/**
 * First-class, applyable themes for the cockpit display.
 *
 * A theme is a plain `CockpitTheme` object mapping `--cockpit-*` variables to
 * values (see `../tokens.ts`). Apply one declaratively on a shared ancestor
 * (`<div style={themes.default as CSSProperties}>`, or a server-rendered `:root`
 * rule) and read bare `var(--cockpit-*)` in sibling chrome — that is how a
 * consuming app makes its own chrome match the cockpit without re-supplying hex
 * (design brief §3.1).
 *
 * `themes.default` enumerates EVERY variable → its default value: the single
 * source of truth the previously copy-pasted consumer palettes collapse onto.
 * Because it is imported by reference, a library re-tune propagates on rebuild.
 *
 * Variant themes (dark / paper / console) are added here as pure data — no
 * component edits. Each is a `CockpitTheme` mapping vars to values; the values
 * are the pre-validated, contrast-checked palettes from the design pass (every
 * real fg/bg pair clears WCAG AA 4.5:1 on its worst actual ground, and the
 * focus-ring / border-focus non-text indicators clear 3:1 — proved by the
 * four-theme sweep in `packages/composition/src/cockpit-theme.test.ts`).
 *
 * Variants are partial: they enumerate every COLOR var (all of which differ from
 * the default) plus only the shape/type vars a theme actually changes. An omitted
 * var falls through to the component's own inline fallback (= the default value),
 * so "keep the default" is expressed by omission (e.g. dark keeps the default
 * radii and body font; paper keeps the default shadows).
 */

import { VAR_DEFAULTS, type CockpitTheme } from '../tokens.js';

/** The canonical default palette, applyable as a theme. */
export const defaultTheme: CockpitTheme = { ...VAR_DEFAULTS };

/** A cross-platform serif stack for paper's detail-title display font. */
const SERIF_DISPLAY =
  "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif";
/** A cross-platform monospace stack for console's mono chrome/display. */
const MONO_STACK =
  'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

/**
 * `dark` — true dark for late-night triage. Near-black blue-gray surfaces, the
 * accent lifted for dark-ground contrast. Trades depth-shadows for a visible
 * focused-card border (shadows → borders as pure data, per brief §3.3 / MF-2):
 * `--cockpit-shadow-*: none` + a real `--cockpit-border-focus`. Radii and body
 * font stay at the default (omitted).
 */
export const darkTheme: CockpitTheme = {
  '--cockpit-surface': '#15181e',
  '--cockpit-surface-sunken': '#101318',
  '--cockpit-surface-raised': '#1c2028',
  '--cockpit-surface-hover': '#232833',
  '--cockpit-border': '#2a303c',
  '--cockpit-border-strong': '#39414f',
  '--cockpit-border-focus': '#66758c',
  '--cockpit-ink': '#f2f4f8',
  '--cockpit-text': '#c6ccd6',
  '--cockpit-text-muted': '#98a1af',
  '--cockpit-text-faint': '#8791a1',
  '--cockpit-accent': '#7d9bd1',
  '--cockpit-accent-text': '#0e1116',
  '--cockpit-accent-hover': '#92adde',
  '--cockpit-accent-soft': '#232c3d',
  '--cockpit-shadow-raised': 'none',
  '--cockpit-shadow-button': 'none',
};

/**
 * `paper` — warm paper ground, ink text, a serif detail-title display font,
 * hairline borders, minimal radius. Reading register (inbox/notes triage); proves
 * the type + radius vars. Shadows keep the default (omitted).
 */
export const paperTheme: CockpitTheme = {
  '--cockpit-surface': '#faf6ee',
  '--cockpit-surface-sunken': '#f1ebdf',
  '--cockpit-surface-raised': '#fffdf8',
  '--cockpit-surface-hover': '#ece4d4',
  '--cockpit-border': '#ddd3bf',
  '--cockpit-border-strong': '#c8bca2',
  '--cockpit-border-focus': '#7a3b2e',
  '--cockpit-ink': '#1f1b14',
  '--cockpit-text': '#3d3629',
  '--cockpit-text-muted': '#5f5745',
  '--cockpit-text-faint': '#6d6450',
  '--cockpit-accent': '#7a3b2e',
  '--cockpit-accent-text': '#fffdf8',
  '--cockpit-accent-hover': '#653023',
  '--cockpit-accent-soft': '#f0e2dc',
  '--cockpit-radius-sm': '0.125rem',
  '--cockpit-radius-md': '0.25rem',
  '--cockpit-font-family-display': SERIF_DISPLAY,
};

/**
 * `console` — agent-console register. Dark phosphor ground,
 * mono for chrome/kbd/detail-title/meta but a SANS body so long-form rationale
 * stays readable, flat depth (shadows none, radius 0), a single phosphor accent.
 * Body font stays at the default sans (omitted).
 */
export const consoleTheme: CockpitTheme = {
  '--cockpit-surface': '#0d1210',
  '--cockpit-surface-sunken': '#0a0e0c',
  '--cockpit-surface-raised': '#131a16',
  '--cockpit-surface-hover': '#1a231e',
  '--cockpit-border': '#223028',
  '--cockpit-border-strong': '#32463a',
  '--cockpit-border-focus': '#48915f',
  '--cockpit-ink': '#e8f5ec',
  '--cockpit-text': '#b8ccbe',
  '--cockpit-text-muted': '#93ac9b',
  '--cockpit-text-faint': '#7f997f',
  '--cockpit-accent': '#4ade80',
  '--cockpit-accent-text': '#06120a',
  '--cockpit-accent-hover': '#6ee7a0',
  '--cockpit-accent-soft': '#12291a',
  '--cockpit-radius-sm': '0',
  '--cockpit-radius-md': '0',
  '--cockpit-shadow-raised': 'none',
  '--cockpit-shadow-button': 'none',
  '--cockpit-font-family-display': MONO_STACK,
  '--cockpit-font-family-mono': MONO_STACK,
};

/**
 * The theme registry. `default` always enumerates every variable; variant themes
 * are partial data-only entries (see each theme's doc comment).
 */
export const themes = {
  default: defaultTheme,
  dark: darkTheme,
  paper: paperTheme,
  console: consoleTheme,
} satisfies Record<string, CockpitTheme>;

export type ThemeName = keyof typeof themes;
