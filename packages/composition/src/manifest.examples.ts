/**
 * The four worked-example manifests from the design brief (`docs/design-spec.md`
 * §Worked examples), expressed as typed `SurfaceManifest` data. This is what a
 * managing agent would write per example: a `libraries[]` + `wiring[]` blob.
 *
 * Example 1 (email triage) lives in `manifest.example.ts` and is re-exported here
 * so all four sit in one place for the pressure-test (`worked-examples.test.ts`).
 *
 * The point of this file is to prove the manifest shape and the libraries express
 * all four examples WITHOUT modifying either library:
 *
 *   1. Email triage    — cockpit + voice, email-shaped bodies, wired on focus.
 *   2. Photo triage    — cockpit + voice, image-shaped bodies (img in body),
 *                        wired on focus. Same manifest shape as #1; only the item
 *                        bodies differ. Proves cockpit renders arbitrary bodies.
 *   3. Voice w/o cockpit — voice ONLY, no cockpit library, no wiring. Proves voice
 *                        composes independently; transcripts carry no itemId.
 *   4. Cockpit w/o voice — cockpit ONLY, no voice library, no wiring. Proves
 *                        cockpit composes independently; silent click-through.
 *
 * Examples 3 and 4 are the load-bearing ones: each library must
 * compose alone. Their manifests deliberately omit the other library AND the
 * wiring edge — if either example needed the other library or a wiring edge to
 * function, the "both libraries compose independently" v0 requirement would be
 * violated.
 */

import type { SurfaceManifest, TriageItem } from './manifest.js';
import type { CockpitAction } from '@surface/cockpit';
import { EMAIL_TRIAGE_MANIFEST } from './manifest.example.js';
import { TRIAGE_MANIFEST } from './manifest.triage.js';

export { EMAIL_TRIAGE_MANIFEST } from './manifest.example.js';
export { TRIAGE_MANIFEST } from './manifest.triage.js';

// ── Example 2 — Photo triage ──────────────────────────────────────────────────
// Pressure test: a different item TYPE (images) on the SAME manifest shape as
// example 1. The design brief notes a consuming app "could ship a <PhotoItem>
// component as the body renderer; cockpit composes it." The pre-styled Cockpit
// renders `body` as sanitized HTML, so an image is expressible as an <img> in the
// body with no library change. A managing app needing richer rendering would use
// the headless `useCockpit` and compose its own detail pane — also no lib change.
//
// The image URL is ALSO carried in `meta` (the brief's "image URLs in meta"
// phrasing). Cockpit passes `meta` through untouched; the consuming app decides
// what to do with it. Here the body carries the rendered <img> and meta carries
// the raw URL for the managing agent's downstream reasoning.

export const PHOTO_ITEMS: TriageItem[] = [
  {
    id: 'photo-101',
    title: 'IMG_101.jpg — beach, midday',
    body: '<img src="https://example.test/photos/101.jpg" alt="beach at midday" style="max-width:100%" />',
    meta: { url: 'https://example.test/photos/101.jpg', takenAt: '2026-04-02T12:14:00Z' },
  },
  {
    id: 'photo-102',
    title: 'IMG_102.jpg — group, slightly blurry',
    body: '<img src="https://example.test/photos/102.jpg" alt="group photo" style="max-width:100%" />',
    meta: { url: 'https://example.test/photos/102.jpg', takenAt: '2026-04-02T18:31:00Z' },
  },
  {
    id: 'photo-103',
    title: 'IMG_103.jpg — sunset, holiday-card candidate',
    body: '<img src="https://example.test/photos/103.jpg" alt="sunset" style="max-width:100%" />',
    meta: { url: 'https://example.test/photos/103.jpg', takenAt: '2026-04-02T19:48:00Z' },
  },
];

export const PHOTO_ACTIONS: CockpitAction[] = [
  { id: 'keep', label: 'Keep', keybind: 'Enter' },
  { id: 'delete', label: 'Delete', keybind: 'x' },
  { id: 'favorite', label: 'Favorite', keybind: 'f' },
];

/** Worked example 2: cockpit + voice over image-shaped items, wired on focus. */
export const PHOTO_TRIAGE_MANIFEST: SurfaceManifest = {
  libraries: [
    { name: 'cockpit', config: { items: PHOTO_ITEMS, actions: PHOTO_ACTIONS } },
    { name: 'voice', config: { tokenProvider: '/api/realtime/token' } },
  ],
  wiring: [{ on: 'focused-item', call: 'voice.setCorrelationId' }],
};

// ── Example 3 — Voice without cockpit ─────────────────────────────────────────
// Pressure test: voice composes alone. The surface is a multi-choice decision
// ("which restaurant?") rendered by the CONSUMING APP, not by cockpit. Voice is
// the only library in the manifest. There is NO wiring edge — nothing publishes
// `focused-item`, so voice's correlationId stays whatever the app sets it to
// (here: a single static scope, "restaurant-choice", set by the app — see the
// test). The choice-click is a plain surface affordance the consuming app emits,
// not a cockpit action.
//
// The brief: "This works because voice has no dependency on cockpit. The
// correlationId is a setter, not a subscription — it can be set by anything."

export const VOICE_ONLY_MANIFEST: SurfaceManifest = {
  libraries: [{ name: 'voice', config: { tokenProvider: '/api/realtime/token' } }],
  // No wiring: cockpit isn't present to publish focused-item, and voice needs no
  // wiring to function — the app sets correlationId directly.
};

// The multi-choice options the consuming app renders (NOT cockpit items). Listed
// here only so the test can emit a choice submission with the same shape a real
// surface multi-choice affordance would.
export const RESTAURANT_CHOICES = [
  { id: 'opt-1', label: 'Sushi Kappo' },
  { id: 'opt-2', label: 'Thai Basil' },
  { id: 'opt-3', label: 'Trattoria Nove' },
] as const;

/** The static correlation scope the app stamps on voice in example 3. */
export const RESTAURANT_SCOPE = 'restaurant-choice';

// ── Example 4 — Cockpit without voice ─────────────────────────────────────────
// Pressure test: cockpit composes alone. Silent click-through triage, no mic.
// Voice is absent from the manifest; there is NO wiring edge (nothing to wire
// voice to). Cockpit still publishes `focused-item` on its bus — that publication
// is unconditional and harmless with no subscriber. Drain shape is identical to
// example 1, just with no voice transcripts in the buckets.

export const SILENT_ITEMS: TriageItem[] = [
  { id: 'tab-1', title: 'GitHub — svt', body: 'github.com/.../svt' },
  { id: 'tab-2', title: 'MDN — EventTarget', body: 'developer.mozilla.org/.../EventTarget' },
  { id: 'tab-3', title: 'OpenAI Realtime docs', body: 'platform.openai.com/docs/.../realtime' },
];

export const SILENT_ACTIONS: CockpitAction[] = [
  { id: 'keep', label: 'Keep', keybind: 'Enter' },
  { id: 'close', label: 'Close', keybind: 'x' },
];

/** Worked example 4: cockpit only, no voice, no wiring. */
export const SILENT_TRIAGE_MANIFEST: SurfaceManifest = {
  libraries: [{ name: 'cockpit', config: { items: SILENT_ITEMS, actions: SILENT_ACTIONS } }],
  // No wiring: voice isn't present, and cockpit needs no wiring to function.
};

/**
 * Selectable manifests for the composition page (`?example=`).
 *
 * `triage` is the DOGFOOD example: a realistic ~12-item reading
 * queue sized for a human to actually triage end-to-end while talking. It is the
 * default the page renders. The other four are the design-brief WORKED EXAMPLES
 * — small, contract-shaped manifests that prove the composition model and pressure
 * -test independent composability. All of them run through the same page + runtime;
 * only the manifest data differs.
 */
const BUILTIN_EXAMPLES: Record<string, SurfaceManifest> = {
  triage: TRIAGE_MANIFEST,
  email: EMAIL_TRIAGE_MANIFEST,
  photo: PHOTO_TRIAGE_MANIFEST,
  voiceOnly: VOICE_ONLY_MANIFEST,
  silent: SILENT_TRIAGE_MANIFEST,
};

/**
 * Local, gitignored examples (`*.local.ts`, ignored per .gitignore) let you point
 * this page at your own real data for a dogfood run without committing it. Each
 * such module default-exports a `Record<string, SurfaceManifest>` merged in below.
 * The glob is resolved at build time by Vite/Vitest; in a fresh clone or CI no file
 * matches, `localModules` is `{}`, and only the built-ins are selectable — so the
 * repo stays green with zero personal data present.
 */
const localModules = import.meta.glob('./*.local.ts', { eager: true }) as Record<
  string,
  { default?: Record<string, SurfaceManifest> }
>;
const LOCAL_EXAMPLES: Record<string, SurfaceManifest> = Object.assign(
  {},
  ...Object.values(localModules).map((m) => m.default ?? {}),
);

export const WORKED_EXAMPLES: Record<string, SurfaceManifest> = {
  ...BUILTIN_EXAMPLES,
  ...LOCAL_EXAMPLES,
};
