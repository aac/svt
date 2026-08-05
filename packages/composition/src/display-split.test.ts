/**
 * Render-boundary check for the cockpit engine/display split.
 *
 * Verifies the ACTUAL rendered output of the default display (@surface/cockpit-ui)
 * driven by the headless engine — not a proxy. Renders <Cockpit> to static markup
 * with a `mapItem` and the two additive slots and asserts:
 *   - the engine drives focus (item 0 is the detail) and the list renders both rows
 *   - `mapItem` supplies title/body (engine items are opaque — no title/body on them)
 *   - `renderRowAside` injects an app-rendered <Chip> into the row (annotations)
 *   - `renderDetailBefore` injects an app-rendered notes block into the detail
 * This is the annotation-count resolution exercised through the real split: the display
 * renders agent-supplied nodes, with zero "annotation" knowledge in either library.
 */

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Cockpit, Chip, type DisplayItem } from '@surface/cockpit-ui';

interface DemoItem {
  id: string;
  title: string;
  body: string;
  accent?: string;
}

const items: DemoItem[] = [
  { id: 'a', title: 'Strawberries', body: 'Peak season right now.', accent: '#3f9655' },
  { id: 'b', title: 'Avocados', body: 'Check ripeness before buying.' },
];
const notes: Record<string, string[]> = { a: ['get two pints', 'we are hosting'] };
const mapItem = (it: DemoItem): DisplayItem => ({
  title: it.title,
  body: it.body,
  accent: it.accent,
});

function render(): string {
  return renderToStaticMarkup(
    createElement(Cockpit<DemoItem>, {
      items,
      actions: [{ id: 'cart', label: 'Add to cart', keybind: 'Enter' }],
      onAction: () => {},
      mapItem,
      renderRowAside: (it) =>
        notes[it.id]?.length ? createElement(Chip, { label: `\u{1F3A4} ${notes[it.id].length}` }) : null,
      renderDetailBefore: (it) =>
        notes[it.id]?.length
          ? createElement(
              'div',
              { 'data-testid': 'app-notes' },
              notes[it.id].map((n, i) => createElement('span', { key: i }, `“${n}”`)),
            )
          : null,
    }),
  );
}

describe('engine/display split — render boundary', () => {
  const html = render();

  it('renders both rows from mapItem (engine items are opaque)', () => {
    expect(html).toContain('Strawberries');
    expect(html).toContain('Avocados');
  });

  it('renders the focused item (engine drives focus to index 0) in the detail pane', () => {
    expect(html).toContain('Peak season right now.');
    expect(html).toContain('cockpit-detail-title');
  });

  it('injects the app-rendered row chip via renderRowAside (annotation count)', () => {
    expect(html).toContain('\u{1F3A4} 2');
  });

  it('injects the app-rendered notes block via renderDetailBefore', () => {
    expect(html).toContain('cockpit-detail-before');
    expect(html).toContain('app-notes');
    expect(html).toContain('get two pints');
  });

  it('paints the mapped accent on the focused row rail (presentational state)', () => {
    expect(html).toContain('#3f9655');
  });
});
