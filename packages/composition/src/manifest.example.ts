/**
 * The worked-example-1 manifest (email triage) from the design brief, as typed
 * data. This is what a managing agent would write: cockpit + voice + one wiring
 * edge. The App reads this manifest and the runtime interprets it.
 *
 * `tokenProvider` here is a path string (matching the brief's example-1 JSON).
 * The App maps the path to an actual fetch-based provider — a managing agent
 * writing JSON can only express a path, not a function, so the path→provider
 * mapping is a consuming-app concern, not a manifest concern.
 */

import type { SurfaceManifest, TriageItem } from './manifest.js';
import type { CockpitAction } from '@surface/cockpit';

export const SAMPLE_ITEMS: TriageItem[] = [
  {
    id: 'msg-7',
    title: 'Re: schedule for next week',
    body: 'Just checking in — does Tuesday still work for you? Happy to move it if not.',
  },
  {
    id: 'msg-8',
    title: 'Quote for the rewire',
    body: 'Hi, attached is the quote for the rewire. Let me know if you have any questions about the timeline.',
  },
  {
    id: 'msg-9',
    title: 'Dentist appointment confirmed',
    body: '<p>Your <strong>cleaning</strong> is confirmed for <em>June 5 at 10am</em>.</p><p>Please bring your insurance card.</p>',
  },
  {
    id: 'msg-10',
    title: 'Dinner Thursday?',
    body: 'Are you free Thursday evening? A few of us are heading to that new Thai place on Main St.',
  },
];

export const SAMPLE_ACTIONS: CockpitAction[] = [
  { id: 'keep', label: 'Keep', keybind: 'Enter' },
  { id: 'archive', label: 'Archive', keybind: 'a' },
  { id: 'defer', label: 'Defer', keybind: 'd' },
];

/** Worked example 1: cockpit + voice, wired on focused-item. */
export const EMAIL_TRIAGE_MANIFEST: SurfaceManifest = {
  libraries: [
    {
      name: 'cockpit',
      config: {
        items: SAMPLE_ITEMS,
        actions: SAMPLE_ACTIONS,
      },
    },
    {
      name: 'voice',
      config: {
        tokenProvider: '/api/realtime/token',
      },
    },
  ],
  wiring: [{ on: 'focused-item', call: 'voice.setCorrelationId' }],
};
