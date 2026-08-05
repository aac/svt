/**
 * Dogfood manifest — "talk-to-triage" over a fruit shopping list.
 *
 * This is the DOGFOOD example: a list big enough to triage end-to-end while
 * talking. It is deliberately a LOW-CONTEXT domain — a fruit shopping list —
 * because the point of the dogfood is to exercise the *voice-annotation* loop,
 * and that only feels real if you have something to say. Realistic, specific
 * items (a reading queue of actual essays) turned out to be hard to narrate:
 * there's no situation around them. A shopping list is the opposite — everyone
 * instantly has context to speak ("get a big batch, we're hosting", "skip,
 * nobody eats these", "only if they're not mushy"). The body text is short and
 * neutral on purpose; the real context is whatever YOU say out loud while an
 * item is focused, which is exactly what the transcript captures and correlates.
 *
 * It is NOT a new code path. It is the SAME `libraries[] + wiring[]` manifest
 * shape, mounted by the SAME composition runtime/App, with the SAME per-item
 * grouping drain. The only thing that changes is the data.
 *
 * ── Actions fit the content, and they're programmable ──
 * "Keep / archive / flag" means nothing for a shopping list. So the action set
 * here is "Add to cart / Skip / Save for later" — verbs that fit the domain. The
 * actions are just manifest data: cockpit renders the labels + keybinds and emits
 * (actionId, itemId); it never learns what they MEAN. The meaning — the in-list
 * feedback (a row marks "in cart" or drops to the bottom) and the one-line
 * explanation in the legend — lives in the consuming App (see App.tsx), driven
 * by the `marker` / `sink` / `description` fields below. Swap this action set for
 * a different situation's verbs and the App reacts with zero code changes; the
 * cockpit library is untouched. That is the whole "cockpit is dumb" thesis.
 */

import type { SurfaceManifest, TriageItem } from './manifest.js';
import type { CockpitAction } from '@surface/cockpit';

/**
 * App-side action shape: a cockpit affordance (id/label/keybind — ALL that
 * cockpit sees and renders) PLUS app-only semantics the consuming App reads to
 * react. Cockpit ignores everything past `keybind`.
 *   - `description` — the human explanation shown in the app legend.
 *   - `marker`      — folded into the row title when the action is applied.
 *   - `sink`        — if set, applying the action drops the row to the bottom.
 */
export interface TriageAction extends CockpitAction {
  description: string;
  marker: string;
  sink?: boolean;
}

/**
 * ~12 fruits. Short, low-context bodies — enough to fill the detail pane, but the
 * situation (how many, for what, whether they look any good) is whatever you
 * narrate. A couple use light HTML to exercise cockpit's sanitized-HTML body
 * rendering the same way the email worked example does.
 */
export const FRUIT_ITEMS: TriageItem[] = [
  {
    id: 'fruit-01',
    title: 'Strawberries',
    body: 'Peak season right now — sold by the pint at the stand on the corner.',
  },
  {
    id: 'fruit-02',
    title: 'Bananas',
    body: 'The default fruit. Goes from green to spotty in about four days, so timing matters.',
  },
  {
    id: 'fruit-03',
    title: 'Avocados',
    body: '<p>Impossible to time: <strong>rock-hard</strong> today, <em>brown inside</em> tomorrow.</p>',
  },
  {
    id: 'fruit-04',
    title: 'Blueberries',
    body: 'In season locally and cheap right now. They freeze well if you over-buy.',
  },
  {
    id: 'fruit-05',
    title: 'Mangoes',
    body: 'The small yellow Ataulfo ones, not the big stringy red ones, if there’s a choice.',
  },
  {
    id: 'fruit-06',
    title: 'Honeycrisp apples',
    body: 'Crisp and sweet, and priced like it. Cold-stored ones go mealy by spring.',
  },
  {
    id: 'fruit-07',
    title: 'Pineapple',
    body: 'Whole is half the price of pre-cut, but breaking one down is a whole project.',
  },
  {
    id: 'fruit-08',
    title: 'Red grapes',
    body: 'Seedless and snackable. They always go soft at the bottom of the bag first.',
  },
  {
    id: 'fruit-09',
    title: 'Lemons',
    body: 'Not a snack — for cooking and drinks. Worth keeping a few around at all times.',
  },
  {
    id: 'fruit-10',
    title: 'Peaches',
    body: '<p>Sublime ripe, tragic hard. Smell the <strong>stem end</strong> before buying.</p>',
  },
  {
    id: 'fruit-11',
    title: 'Kiwi',
    body: 'Sold rock-hard; needs three or four days on the counter to come good.',
  },
  {
    id: 'fruit-12',
    title: 'Pomegranate',
    body: 'Worth the mess. Once you’ve seeded one, the arils keep about a week.',
  },
];

/**
 * Shopping-list actions — they fit the content, and each carries a one-line
 * meaning the app surfaces in the legend. "Add to cart" (buy it this week) is the
 * primary action (Enter); "Skip" drops the item to the bottom; "Save for later"
 * parks it on the list. Change this set for a different situation and the App
 * reacts via `marker`/`sink`/`description`; cockpit never learns what they mean.
 */
export const FRUIT_ACTIONS: TriageAction[] = [
  {
    id: 'cart',
    label: 'Add to cart',
    keybind: 'Enter',
    description: 'buy it this week',
    marker: '\u{1F6D2} in cart',
  },
  {
    id: 'skip',
    label: 'Skip',
    keybind: 's',
    description: 'not this week',
    marker: 'skipped',
    sink: true,
  },
  {
    id: 'later',
    label: 'Save for later',
    keybind: 'l',
    description: 'keep on the list, decide later',
    marker: '↩ later',
  },
];

/**
 * The dogfood manifest: cockpit (the fruit shopping list) + voice, wired so the
 * focused item drives voice's correlationId. Identical shape to worked example 1;
 * only the data and the action set differ. This is what a managing agent would
 * write to stand up a "talk through my shopping list" surface.
 */
export const TRIAGE_MANIFEST: SurfaceManifest = {
  libraries: [
    {
      name: 'cockpit',
      config: { items: FRUIT_ITEMS, actions: FRUIT_ACTIONS },
    },
    {
      name: 'voice',
      config: { tokenProvider: '/api/realtime/token' },
    },
  ],
  wiring: [{ on: 'focused-item', call: 'voice.setCorrelationId' }],
};
