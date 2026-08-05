/**
 * Token-seam guard (cockpit-design-pass T1, brief §6).
 *
 * The theming seam requires that EVERY color / rgb-a / font-family stack the
 * cockpit-ui components paint goes through the `--cockpit-*` variable emitter
 * (tokens.ts), never as an orphan literal in a component — otherwise a themed
 * mount would show hard-coded values the theme can't reach. This scans the actual
 * component source for orphan literals and, as a positive control, renders the
 * real component and confirms the emitted markup carries `var(--cockpit-*)`.
 *
 * Explicitly covers the `richBodyCss` template string (inside CockpitDetail.tsx)
 * and Chip.tsx (round-1 N-7). tokens.ts itself is the seam DEFINITION and is not
 * scanned — the default hex/rgba/font-stack values legitimately live there.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Cockpit, Chip, QuoteBlock, type DisplayItem } from '@surface/cockpit-ui';

const COMPONENT_FILES = [
  '../../cockpit-ui/src/components/Cockpit.tsx',
  '../../cockpit-ui/src/components/CockpitList.tsx',
  '../../cockpit-ui/src/components/CockpitDetail.tsx',
  '../../cockpit-ui/src/primitives/Chip.tsx',
  '../../cockpit-ui/src/primitives/QuoteBlock.tsx',
];

/** Drop comments so prose can't produce a false positive (only ever hides one). */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const ORPHANS: Array<{ name: string; re: RegExp }> = [
  // Hex colors (3/4/6/8 digit). `#{expr}` (JSX) and `&#39;` (2 digits) don't match.
  { name: 'hex color', re: /#[0-9a-fA-F]{3,8}\b/ },
  // rgb()/rgba()/hsl()/hsla() functional colors.
  { name: 'rgb/hsl color', re: /\b(?:rgba?|hsla?)\s*\(/ },
  // Font-family stack fragments — every family must come from a font var.
  {
    name: 'font-family literal',
    re: /-apple-system|BlinkMacSystemFont|Segoe UI|ui-monospace|SFMono|Menlo|Consolas|Liberation Mono|Helvetica|Roboto|\bsans-serif\b|\bmonospace\b|\bserif\b/,
  },
];

describe('token seam — no orphan color/font literals in components', () => {
  for (const rel of COMPONENT_FILES) {
    const path = fileURLToPath(new URL(rel, import.meta.url));
    const raw = readFileSync(path, 'utf8');
    const code = stripComments(raw);

    describe(rel.split('/').pop()!, () => {
      // Positive control: the file must actually consume the seam (else "no
      // orphans" would be vacuously true for an empty/stub file).
      it('consumes the token seam (imports ../tokens)', () => {
        expect(raw).toMatch(/from '\.\.\/tokens\.js'/);
      });

      for (const { name, re } of ORPHANS) {
        it(`has no orphan ${name}`, () => {
          const m = code.match(re);
          expect(m, m ? `orphan ${name}: ${m[0]}` : '').toBeNull();
        });
      }
    });
  }
});

describe('token seam — emitted markup carries CSS variables (positive control)', () => {
  interface SeamItem {
    id: string;
    title: string;
    body: string;
    accent?: string;
  }
  const items: SeamItem[] = [
    { id: 'a', title: 'One', body: 'Body of one.', accent: '#3f9655' },
    { id: 'b', title: 'Two', body: 'Body of two.' },
  ];
  const mapItem = (it: SeamItem): DisplayItem => ({
    title: it.title,
    body: it.body,
    accent: it.accent,
  });
  const html = renderToStaticMarkup(
    createElement(Cockpit<SeamItem>, {
      items,
      actions: [{ id: 'keep', label: 'Keep', keybind: 'Enter' }],
      onAction: () => {},
      mapItem,
    }),
  );

  it('renders var(--cockpit-*) fallbacks rather than baked-in values', () => {
    expect(html).toContain('var(--cockpit-surface');
    expect(html).toContain('var(--cockpit-accent');
    expect(html).toContain('var(--cockpit-text');
  });

  it('Chip and QuoteBlock emit the seam too', () => {
    const chip = renderToStaticMarkup(createElement(Chip, { label: 'x', tone: 'accent' }));
    expect(chip).toContain('var(--cockpit-accent');
    const qb = renderToStaticMarkup(
      createElement(QuoteBlock, { label: 'notes', quotes: ['hi there'] }),
    );
    expect(qb).toContain('var(--cockpit-accent-soft');
    expect(qb).toContain('hi there');
  });

  it('focused-row wash derives from the live item accent (color-mix)', () => {
    // Item "a" is focused (engine drives focus to index 0) and carries an accent;
    // its row background is a color-mix tint of that hue, not an opaque card.
    expect(html).toContain('color-mix(in srgb, #3f9655');
  });
});
