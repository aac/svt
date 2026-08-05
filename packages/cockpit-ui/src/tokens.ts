/**
 * Cockpit design tokens — the library's self-contained default look, exposed
 * through a CSS-custom-property seam.
 *
 * Every color / radius / shadow / font-family the components paint is emitted as
 * `var(--cockpit-<name>, <fallback>)` (see `cssVar`). The fallback IS the default
 * look, so a bare `<Cockpit/>` with no consumer setup renders the (refined)
 * default with zero CSS import, provider, or build step. A consumer that wants a
 * different look sets the `--cockpit-*` variables on any shared ancestor (see
 * `themes` and the library docs) — the names are the public contract; the values
 * stay library-owned.
 *
 * The type scale (sizes/weights/line-height) and the spacing rhythm are
 * deliberately NOT in the seam — density/layout leeway is the headless tier's
 * job, not a theming knob (design brief §3.1, "withheld"). They stay as literal
 * `tokens.*` here.
 *
 * Visual direction: a clean neutral light surface — near-white / light-gray
 * panes, near-black ink, and a single calm desaturated-blue accent.
 */

/**
 * The public theming vocabulary — every `--cockpit-*` custom property a consumer
 * may set. Additive-only: renaming or removing one is a breaking change.
 */
export type CockpitVar =
  | '--cockpit-surface'
  | '--cockpit-surface-sunken'
  | '--cockpit-surface-raised'
  | '--cockpit-surface-hover'
  | '--cockpit-border'
  | '--cockpit-border-strong'
  | '--cockpit-border-focus'
  | '--cockpit-ink'
  | '--cockpit-text'
  | '--cockpit-text-muted'
  | '--cockpit-text-faint'
  | '--cockpit-accent'
  | '--cockpit-accent-text'
  | '--cockpit-accent-hover'
  | '--cockpit-accent-soft'
  | '--cockpit-radius-sm'
  | '--cockpit-radius-md'
  | '--cockpit-shadow-raised'
  | '--cockpit-shadow-button'
  | '--cockpit-font-family'
  | '--cockpit-font-family-display'
  | '--cockpit-font-family-mono';

/**
 * A theme is a plain object mapping any subset of the vocabulary to values.
 * Apply it declaratively on a shared ancestor: `<div style={theme as CSSProperties}>`.
 * (The cast is required under this repo's `@types/react` — its `CSSProperties`
 * has closed typing with no `--*` index signature. See the library docs.)
 */
export type CockpitTheme = Partial<Record<CockpitVar, string>>;

/**
 * Every theming variable, listed once. The exhaustiveness check below fails to
 * compile if a `CockpitVar` is added to the union but omitted here, so this array
 * (and everything derived from it — `VAR_DEFAULTS`, `themes.default`, the
 * completeness test) can never silently drift out of sync with the type.
 */
export const ALL_COCKPIT_VARS = [
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
  '--cockpit-radius-sm',
  '--cockpit-radius-md',
  '--cockpit-shadow-raised',
  '--cockpit-shadow-button',
  '--cockpit-font-family',
  '--cockpit-font-family-display',
  '--cockpit-font-family-mono',
] as const satisfies readonly CockpitVar[];

// Compile-time exhaustiveness: errors if a CockpitVar is missing from the array.
type MissingVar = Exclude<CockpitVar, (typeof ALL_COCKPIT_VARS)[number]>;
const _allVarsExhaustive: MissingVar extends never ? true : never = true;
void _allVarsExhaustive;

/** A real cross-platform UI/body font stack (replaces the old `inherit`). */
const SYSTEM_SANS =
  'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const SYSTEM_MONO =
  'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

/**
 * The canonical default value for every variable — the single source of truth
 * that `themes.default` re-exports and that the three copy-pasted consumer chrome
 * palettes collapse onto.
 *
 * Contrast note (design brief §3.2 M4): `--cockpit-text-muted` and
 * `--cockpit-text-faint` were darkened from the original grays so every real
 * fg/bg pair clears WCAG AA 4.5:1 on the darkest ground it renders on — muted on
 * the hover / focused-row wash grounds (#eef0f3 / #e8edf5), faint on the sunken
 * sidebar and sunken kbd chips (#f6f7f9). Verified by the contrast check.
 */
export const VAR_DEFAULTS: Record<CockpitVar, string> = {
  '--cockpit-surface': '#ffffff',
  '--cockpit-surface-sunken': '#f6f7f9',
  '--cockpit-surface-raised': '#ffffff',
  '--cockpit-surface-hover': '#eef0f3',

  '--cockpit-border': '#e5e7eb',
  '--cockpit-border-strong': '#d1d5db',
  // Focused-card border. Transparent by default (the light look leans on the
  // wash + shadow); dark/console themes trade shadows for a visible border here.
  '--cockpit-border-focus': 'transparent',

  '--cockpit-ink': '#111827',
  '--cockpit-text': '#374151',
  // Darkened from #6b7280 so row-preview text clears 4.5:1 on the hover/focus washes.
  '--cockpit-text-muted': '#5f6775',
  // Darkened from #9ca3af so kbd hints / labels clear 4.5:1 on the sunken ground.
  '--cockpit-text-faint': '#6b7280',

  '--cockpit-accent': '#3f5a8a',
  '--cockpit-accent-text': '#ffffff',
  '--cockpit-accent-hover': '#344b73',
  '--cockpit-accent-soft': '#e8edf5',

  '--cockpit-radius-sm': '0.25rem',
  '--cockpit-radius-md': '0.5rem',

  // Every shadow is settable to `none` by a theme (design brief §3.1).
  // The default raised shadow is `none` since the dogfood pass (craft review S8):
  // side-by-side screenshots showed the accent wash + rail fully carry the focused
  // state and the old 4–6%-alpha shadow read as invisible. The var stays in the
  // vocabulary so a theme can reintroduce depth.
  '--cockpit-shadow-raised': 'none',
  '--cockpit-shadow-button': '0 1px 2px rgba(63, 90, 138, 0.25)',

  '--cockpit-font-family': SYSTEM_SANS,
  '--cockpit-font-family-display': SYSTEM_SANS,
  '--cockpit-font-family-mono': SYSTEM_MONO,
};

/**
 * The seam emitter: every themeable value the components paint goes through this,
 * producing `var(--cockpit-x, <default>)`. Consumers override by setting the var
 * on an ancestor; with nothing set the default fallback renders.
 */
export function cssVar(name: CockpitVar): string {
  return `var(${name}, ${VAR_DEFAULTS[name]})`;
}

/**
 * Convenience accessors — the emitted `var(...)` string for each themeable value,
 * so component code reads `v.accent` instead of `cssVar('--cockpit-accent')`.
 */
export const v = {
  surface: cssVar('--cockpit-surface'),
  surfaceSunken: cssVar('--cockpit-surface-sunken'),
  surfaceRaised: cssVar('--cockpit-surface-raised'),
  surfaceHover: cssVar('--cockpit-surface-hover'),
  border: cssVar('--cockpit-border'),
  borderStrong: cssVar('--cockpit-border-strong'),
  borderFocus: cssVar('--cockpit-border-focus'),
  ink: cssVar('--cockpit-ink'),
  text: cssVar('--cockpit-text'),
  textMuted: cssVar('--cockpit-text-muted'),
  textFaint: cssVar('--cockpit-text-faint'),
  accent: cssVar('--cockpit-accent'),
  accentText: cssVar('--cockpit-accent-text'),
  accentHover: cssVar('--cockpit-accent-hover'),
  accentSoft: cssVar('--cockpit-accent-soft'),
  radiusSm: cssVar('--cockpit-radius-sm'),
  radiusMd: cssVar('--cockpit-radius-md'),
  shadowRaised: cssVar('--cockpit-shadow-raised'),
  shadowButton: cssVar('--cockpit-shadow-button'),
  fontFamily: cssVar('--cockpit-font-family'),
  fontFamilyDisplay: cssVar('--cockpit-font-family-display'),
  fontFamilyMono: cssVar('--cockpit-font-family-mono'),
} as const;

/**
 * A low-alpha tint of a color, for the focused row's own background. When the
 * managing agent has set a live item accent (e.g. the voice go/wait rail hue),
 * the focused row washes in that same hue so the state reinforces rather than
 * fights it (design brief §3.2). `transparent` is the mix endpoint (fade to
 * nothing), not a theme value.
 */
export function accentWash(color: string): string {
  return `color-mix(in srgb, ${color} 12%, transparent)`;
}

/**
 * A translucent layer of the accent-text color, for chrome painted ON the accent
 * button (e.g. its kbd chip). Re-themes with `--cockpit-accent-text` instead of
 * baking in a hard-coded translucent white.
 */
export function onAccentText(alphaPercent: number): string {
  return `color-mix(in srgb, ${v.accentText} ${alphaPercent}%, transparent)`;
}

/**
 * Non-themed scale: type sizes/weights/line-height and the 4px spacing rhythm.
 * Withheld from the seam on purpose (density is the headless tier's job).
 */
export const tokens = {
  space: {
    xs: '0.25rem', // 4
    sm: '0.5rem', // 8
    md: '0.75rem', // 12
    lg: '1rem', // 16
    xl: '1.5rem', // 24
    xxl: '2rem', // 32
  },
  font: {
    title: '1.375rem', // detail heading
    titleWeight: 650,
    rowTitle: '0.875rem',
    rowTitleWeight: 550,
    body: '0.9375rem',
    small: '0.75rem',
    micro: '0.6875rem',
    lineHeight: 1.6,
  },
} as const;
