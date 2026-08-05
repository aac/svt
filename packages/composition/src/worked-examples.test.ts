/**
 * Pressure-test: the four worked examples from the design brief
 * (`docs/design-spec.md` §Worked examples), validated against the real
 * composition machinery WITHOUT modifying either library.
 *
 * For each example this test drives the actual production code paths:
 *   - the manifest (`manifest.examples.ts`) the managing agent would write,
 *   - the runtime's `applyWiring` + `cockpitBus` (the real wiring interpreter),
 *   - the real submission-builders (`actionSubmission` / `voiceSubmission`),
 *   - the real `SurfaceStore.drainByItem()` (the per-item bucket path the
 *     managing agent consumes).
 *
 * The assertions are on the DRAIN-SHAPED OUTPUT (per-item buckets + ungrouped),
 * not on intermediate proxies — that is the boundary the brief specifies and the
 * acceptance criterion for this work.
 *
 * No library code is imported except its PUBLIC exports (the cockpit bus, used
 * via the composition runtime). If any example needed a change to cockpit or
 * voice to express it, that would surface here as an import or type error — and
 * would be a FINDING, filed as follow-up work, not patched.
 */

import { describe, it, expect } from 'vitest';
import { cockpitBus, FOCUSED_ITEM_EVENT } from '@surface/cockpit';
import { applyWiring, knownLibraryNames, SUPPORTED_LIBRARIES } from './runtime.js';
import type { HandleRegistry, LibraryHandle } from './runtime.js';
import { SurfaceStore } from './server/surface-store.js';
import { actionSubmission, voiceSubmission } from './submissions.js';
import {
  EMAIL_TRIAGE_MANIFEST,
  PHOTO_TRIAGE_MANIFEST,
  VOICE_ONLY_MANIFEST,
  SILENT_TRIAGE_MANIFEST,
  PHOTO_ITEMS,
  SILENT_ITEMS,
  RESTAURANT_CHOICES,
  RESTAURANT_SCOPE,
  WORKED_EXAMPLES,
} from './manifest.examples.js';

/**
 * Build a HandleRegistry mirroring what App.tsx registers at mount: cockpit
 * registers no wiring-target handle (it only publishes); voice registers
 * `setCorrelationId`. A fake voice handle lets us drive the wiring without a
 * browser/mic — `setCorrelationId` just records the last value it received.
 */
function fakeHandles(libraries: ReadonlyArray<{ name: string }>): {
  handles: HandleRegistry;
  voiceCorrelation: { current: string | null };
} {
  const voiceCorrelation = { current: null as string | null };
  const handles: HandleRegistry = new Map();
  for (const lib of libraries) {
    if (lib.name === 'voice') {
      const handle: LibraryHandle = {
        setCorrelationId: (id: unknown) => {
          voiceCorrelation.current = (id ?? null) as string | null;
        },
      };
      handles.set('voice', handle);
    }
    // cockpit registers no handle (matches CockpitMount — publish-only).
  }
  return { handles, voiceCorrelation };
}

describe('worked examples — manifest sanity (every example names only v0 libraries)', () => {
  it.each(Object.entries(WORKED_EXAMPLES))('%s names only supported libraries', (_name, manifest) => {
    for (const name of knownLibraryNames(manifest)) {
      expect(SUPPORTED_LIBRARIES).toContain(name);
    }
  });
});

// ── Example 1 — Email triage ──────────────────────────────────────────────────
describe('example 1 — email triage (cockpit + voice, wired)', () => {
  it('names both libraries and wires focus → voice.setCorrelationId', () => {
    expect(knownLibraryNames(EMAIL_TRIAGE_MANIFEST)).toEqual(new Set(['cockpit', 'voice']));
    expect(EMAIL_TRIAGE_MANIFEST.wiring).toEqual([
      { on: 'focused-item', call: 'voice.setCorrelationId' },
    ]);
  });

  it('focus change drives voice correlationId through the real runtime wiring', () => {
    const { handles, voiceCorrelation } = fakeHandles(EMAIL_TRIAGE_MANIFEST.libraries);
    const teardown = applyWiring(EMAIL_TRIAGE_MANIFEST.wiring, handles);

    // Simulate cockpit publishing focus changes (what useCockpit does on j/k).
    cockpitBus.emit(FOCUSED_ITEM_EVENT, 'msg-7');
    expect(voiceCorrelation.current).toBe('msg-7');
    cockpitBus.emit(FOCUSED_ITEM_EVENT, 'msg-8');
    expect(voiceCorrelation.current).toBe('msg-8');
    teardown();
    // After teardown the wiring is gone; further emits don't stamp voice.
    cockpitBus.emit(FOCUSED_ITEM_EVENT, 'msg-9');
    expect(voiceCorrelation.current).toBe('msg-8');
  });

  it('drains keep action + voice note into the correct per-item buckets', () => {
    const store = new SurfaceStore('s_email');
    // User focuses msg-7, hits keep, narrates a reason.
    const keep = actionSubmission('keep', 'msg-7');
    const note7 = voiceSubmission("this one's from the contractor, file it under the remodel", 'msg-7');
    // User focuses msg-8, only narrates.
    const note8 = voiceSubmission('remind me to follow up next month', 'msg-8');
    for (const env of [keep, note7, note8]) store.append(env.affordanceId, env);

    const drain = store.drainByItem();
    expect(drain.ungrouped).toHaveLength(0);
    expect(drain.items.map((b) => b.itemId)).toEqual(['msg-7', 'msg-8']);

    const msg7 = drain.items.find((b) => b.itemId === 'msg-7')!;
    expect(msg7.submissions.map((s) => s.id)).toEqual(['keep-msg-7', 'voice-note-msg-7']);
    const msg8 = drain.items.find((b) => b.itemId === 'msg-8')!;
    expect(msg8.submissions).toHaveLength(1);
    expect(msg8.submissions[0]?.payload).toMatchObject({
      value: 'remind me to follow up next month',
      itemId: 'msg-8',
    });
  });
});

// ── Example 2 — Photo triage ──────────────────────────────────────────────────
describe('example 2 — photo triage (cockpit + voice over image-shaped items)', () => {
  it('uses the SAME manifest shape as example 1 (only bodies differ)', () => {
    expect(knownLibraryNames(PHOTO_TRIAGE_MANIFEST)).toEqual(new Set(['cockpit', 'voice']));
    expect(PHOTO_TRIAGE_MANIFEST.wiring).toEqual(EMAIL_TRIAGE_MANIFEST.wiring);
  });

  it('items carry images in body (rendered by cockpit) and url in meta (pass-through)', () => {
    // Cockpit renders `body` as sanitized HTML; an <img> body needs no lib change.
    // `meta` is opaque pass-through for the managing agent. This asserts the items
    // ARE image-shaped — the thing the example pressure-tests.
    for (const item of PHOTO_ITEMS) {
      expect(item.body).toMatch(/<img\b/);
      expect((item.meta as { url?: string }).url).toMatch(/^https:\/\//);
    }
  });

  it('drains image-item actions + voice notes into per-item buckets', () => {
    const store = new SurfaceStore('s_photo');
    // "this is the holiday-card one" → favorite photo-103 + a narration.
    const fav = actionSubmission('favorite', 'photo-103');
    const note103 = voiceSubmission('this is the one for the holiday card', 'photo-103');
    // "this one is blurry, delete it" → delete photo-102.
    const del = actionSubmission('delete', 'photo-102');
    for (const env of [fav, note103, del]) store.append(env.affordanceId, env);

    const drain = store.drainByItem();
    expect(drain.ungrouped).toHaveLength(0);
    expect(new Set(drain.items.map((b) => b.itemId))).toEqual(new Set(['photo-103', 'photo-102']));

    const p103 = drain.items.find((b) => b.itemId === 'photo-103')!;
    expect(p103.submissions.map((s) => s.id)).toEqual(['favorite-photo-103', 'voice-note-photo-103']);
    const p102 = drain.items.find((b) => b.itemId === 'photo-102')!;
    expect(p102.submissions.map((s) => s.id)).toEqual(['delete-photo-102']);
  });
});

// ── Example 3 — Voice without cockpit ─────────────────────────────────────────
describe('example 3 — voice without cockpit (independent composability)', () => {
  it('names ONLY voice and has NO wiring (cockpit absent, none needed)', () => {
    expect(knownLibraryNames(VOICE_ONLY_MANIFEST)).toEqual(new Set(['voice']));
    // No wiring edge — voice composes without cockpit publishing focused-item.
    expect(VOICE_ONLY_MANIFEST.wiring ?? []).toEqual([]);
  });

  it('applyWiring is a no-op when there is no wiring (nothing to resolve)', () => {
    const { handles } = fakeHandles(VOICE_ONLY_MANIFEST.libraries);
    // Should not throw despite cockpit not being mounted — there is no edge.
    const teardown = applyWiring(VOICE_ONLY_MANIFEST.wiring, handles);
    expect(typeof teardown).toBe('function');
    teardown();
  });

  it('drains a multi-choice click + a rationale voice note', () => {
    const store = new SurfaceStore('s_voice_only');
    // The consuming app renders the choices (NOT cockpit). A choice click is a
    // plain surface affordance the app stamps with the static scope; the voice
    // note is stamped with the same scope (the app set it, no cockpit needed).
    const choice = {
      affordanceId: `choice-${RESTAURANT_CHOICES[1].id}`,
      value: RESTAURANT_CHOICES[1].id,
      itemId: RESTAURANT_SCOPE,
    };
    const rationale = voiceSubmission('the second one because Lyle wanted Thai', RESTAURANT_SCOPE);
    for (const env of [choice, rationale]) store.append(env.affordanceId, env);

    const drain = store.drainByItem();
    expect(drain.ungrouped).toHaveLength(0);
    expect(drain.items.map((b) => b.itemId)).toEqual([RESTAURANT_SCOPE]);
    const bucket = drain.items[0]!;
    expect(bucket.submissions.map((s) => s.id)).toEqual([
      'choice-opt-2',
      `voice-note-${RESTAURANT_SCOPE}`,
    ]);
  });

  it('voice with NO correlation (spoke before any scope set) lands in ungrouped', () => {
    const store = new SurfaceStore('s_voice_uncorrelated');
    // Worked-example-3 corner: a transcript finalized before any item/scope was
    // set carries no itemId → ungrouped. The managing agent still receives it.
    const env = voiceSubmission('wait, which one were we talking about?', null);
    expect(env.itemId).toBeUndefined();
    store.append(env.affordanceId, env);

    const drain = store.drainByItem();
    expect(drain.items).toHaveLength(0);
    expect(drain.ungrouped).toHaveLength(1);
    expect(drain.ungrouped[0]?.id).toMatch(/^voice-note-uncorrelated-/);
  });
});

// ── Example 4 — Cockpit without voice ─────────────────────────────────────────
describe('example 4 — cockpit without voice (independent composability)', () => {
  it('names ONLY cockpit and has NO wiring (voice absent, none needed)', () => {
    expect(knownLibraryNames(SILENT_TRIAGE_MANIFEST)).toEqual(new Set(['cockpit']));
    expect(SILENT_TRIAGE_MANIFEST.wiring ?? []).toEqual([]);
  });

  it('cockpit publishing focused-item with NO subscriber is harmless', () => {
    // Cockpit's focus publication is unconditional. With voice absent and no
    // wiring, emitting must not throw and must not stamp anything.
    const { handles } = fakeHandles(SILENT_TRIAGE_MANIFEST.libraries);
    const teardown = applyWiring(SILENT_TRIAGE_MANIFEST.wiring, handles);
    expect(() => cockpitBus.emit(FOCUSED_ITEM_EVENT, 'tab-1')).not.toThrow();
    teardown();
  });

  it('drains silent click-through: actions only, identical bucket shape, no voice', () => {
    const store = new SurfaceStore('s_silent');
    const keep = actionSubmission('keep', 'tab-1');
    const close2 = actionSubmission('close', 'tab-2');
    const close3 = actionSubmission('close', 'tab-3');
    for (const env of [keep, close2, close3]) store.append(env.affordanceId, env);

    const drain = store.drainByItem();
    expect(drain.ungrouped).toHaveLength(0);
    expect(drain.items.map((b) => b.itemId)).toEqual(['tab-1', 'tab-2', 'tab-3']);
    // Every bucket has exactly one interaction and ZERO voice transcripts.
    for (const bucket of drain.items) {
      expect(bucket.submissions).toHaveLength(1);
      expect(bucket.submissions[0]?.id.startsWith('voice-note-')).toBe(false);
    }
    // Sanity: the example actually triaged every item.
    expect(SILENT_ITEMS.map((i) => i.id).sort()).toEqual(
      drain.items.map((b) => b.itemId).sort(),
    );
  });
});
