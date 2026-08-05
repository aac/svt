/**
 * Composition-chrome design tokens.
 *
 * The composition page is the consuming-app layer (the dogfood host), not a
 * library, so it owns its own look. It is also the worked example of the
 * export-and-apply consumer contract (design brief §3.1): App.tsx applies
 * `themes.default` (from @surface/cockpit-ui) at the shared ancestor of the
 * chrome + cockpit mount, so the chrome reads the SAME palette the cockpit paints
 * by referencing the bare `--cockpit-*` variables below — no copied hex, no drift.
 *
 * Because these are live variable references resolved at the CSS layer (not
 * baked-in values), a library palette re-tune propagates to the chrome on the next
 * build, and a `?theme=<name>` switch re-skins the chrome and the cockpit together.
 * Never re-supply fallback hex here — the applied theme is the single source of
 * truth (design brief §3.1: "never re-supply fallback hex in chrome").
 *
 * Only genuinely app-specific values the cockpit vocabulary does NOT cover — the
 * inline-error danger family, the pill radius, the type/space scale (withheld from
 * the seam) — stay as literals, in clearly separated blocks below.
 */

export const chrome = {
  color: {
    // ── Themed: read straight from the applied cockpit theme. Bare vars, no
    //    fallback hex — App.tsx applies themes.default (or ?theme=) at a shared
    //    ancestor, so these resolve to the cockpit's own palette. ──
    surface: 'var(--cockpit-surface)',
    surfaceSunken: 'var(--cockpit-surface-sunken)',
    surfaceRaised: 'var(--cockpit-surface-raised)',
    surfaceHover: 'var(--cockpit-surface-hover)',

    border: 'var(--cockpit-border)',
    borderStrong: 'var(--cockpit-border-strong)',

    ink: 'var(--cockpit-ink)',
    text: 'var(--cockpit-text)',
    textMuted: 'var(--cockpit-text-muted)',
    textFaint: 'var(--cockpit-text-faint)',

    accent: 'var(--cockpit-accent)',
    accentText: 'var(--cockpit-accent-text)',
    accentHover: 'var(--cockpit-accent-hover)',
    accentSoft: 'var(--cockpit-accent-soft)',

    // ── App-specific: NOT in the cockpit vocabulary, so the app owns these
    //    literals. The inline-error danger family for the submissions panel. ──
    danger: '#b91c1c',
    /** Soft danger fill + border for inline error messages. */
    dangerSoft: '#fef2f2',
    dangerBorder: '#fecaca',
  },
  space: {
    xs: '0.25rem',
    sm: '0.5rem',
    md: '0.75rem',
    lg: '1rem',
    xl: '1.5rem',
  },
  font: {
    // Body/UI + mono families ride the seam so a font-changing theme reaches the
    // chrome too (the vocabulary exposes these; the type SCALE stays app-owned).
    family: 'var(--cockpit-font-family)',
    mono: 'var(--cockpit-font-family-mono)',
    micro: '0.6875rem',
    small: '0.75rem',
    body: '0.8125rem',
  },
  radius: {
    // sm/md are in the cockpit vocabulary; pill is app-specific (nav/readout).
    sm: 'var(--cockpit-radius-sm)',
    md: 'var(--cockpit-radius-md)',
    pill: '999px',
  },
} as const;
