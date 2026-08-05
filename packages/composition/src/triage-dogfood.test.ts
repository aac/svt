/**
 * Dogfood drain check.
 *
 * Validates the headless slice of the talk-to-triage loop: a realistic
 * triage session over the fruit shopping-list manifest produces a FLAT submission
 * stream that groups correctly by item via the CLIENT-SIDE `groupByItem()` model
 * — client-side grouping, NOT a server-side groupBy primitive.
 *
 * What this can and can't cover: the live mic loop (getUserMedia → WebRTC → STT)
 * needs a real browser + mic + OpenAI key and is a human validation gate. What
 * it DOES cover headlessly:
 *   - the focus→correlationId wiring stamps voice transcripts with the focused
 *     item's id through the REAL runtime (applyWiring + cockpitBus),
 *   - cockpit actions + voice notes flow through the REAL submission builders,
 *   - the flat stream groups per-item via the REAL groupByItem() — the function a
 *     managing agent runs after a flat drain.
 *
 * It simulates the human's interaction order: navigate (j/k → focus events) +
 * act (keybinds) + talk (voice finals stamped by whatever was focused), exactly
 * the loop the live test exercises by hand.
 */

import { describe, it, expect } from 'vitest';
import { cockpitBus, FOCUSED_ITEM_EVENT } from '@surface/cockpit';
import { applyWiring } from './runtime.js';
import type { HandleRegistry, LibraryHandle } from './runtime.js';
import { groupByItem } from './server/surface-store.js';
import type { SurfaceSubmission } from './server/surface-store.js';
import { actionSubmission, voiceSubmission } from './submissions.js';
import {
  TRIAGE_MANIFEST,
  FRUIT_ITEMS,
  FRUIT_ACTIONS,
} from './manifest.triage.js';
import { knownLibraryNames, SUPPORTED_LIBRARIES } from './runtime.js';

describe('dogfood — fruit shopping-list triage manifest', () => {
  it('is a realistic list and names only v0 libraries, wired focus → voice', () => {
    // Sized for real triage, not a 3-item contract assertion.
    expect(FRUIT_ITEMS.length).toBeGreaterThanOrEqual(10);
    expect(FRUIT_ITEMS.length).toBeLessThanOrEqual(15);
    // Every item has a title + a body (so the detail pane has something to show).
    for (const item of FRUIT_ITEMS) {
      expect(item.title.length).toBeGreaterThan(0);
      expect(item.body.length).toBeGreaterThan(20);
    }
    // Domain-fitting actions: add to cart / skip / save for later, each carrying
    // an app-side explanation + marker (cockpit only reads id/label/keybind).
    expect(FRUIT_ACTIONS.map((a) => a.id)).toEqual(['cart', 'skip', 'later']);
    for (const a of FRUIT_ACTIONS) {
      expect(a.description.length).toBeGreaterThan(0);
      expect(a.marker.length).toBeGreaterThan(0);
    }
    // Composition contract: only supported libraries, wired focus→correlationId.
    for (const name of knownLibraryNames(TRIAGE_MANIFEST)) {
      expect(SUPPORTED_LIBRARIES).toContain(name);
    }
    expect(TRIAGE_MANIFEST.wiring).toEqual([
      { on: 'focused-item', call: 'voice.setCorrelationId' },
    ]);
  });

  it('focus drives voice correlationId through the real runtime wiring', () => {
    const voiceCorrelation = { current: null as string | null };
    const handles: HandleRegistry = new Map();
    const handle: LibraryHandle = {
      setCorrelationId: (id: unknown) => {
        voiceCorrelation.current = (id ?? null) as string | null;
      },
    };
    handles.set('voice', handle);
    const teardown = applyWiring(TRIAGE_MANIFEST.wiring, handles);

    // j/k navigation publishes focused-item; the wiring stamps voice.
    cockpitBus.emit(FOCUSED_ITEM_EVENT, 'fruit-01');
    expect(voiceCorrelation.current).toBe('fruit-01');
    cockpitBus.emit(FOCUSED_ITEM_EVENT, 'fruit-03');
    expect(voiceCorrelation.current).toBe('fruit-03');
    teardown();
  });

  it('a triage session drains FLAT and groups per-item via the client-side model', () => {
    // Simulate a real pass: navigate, act on some, talk on some. The voice
    // correlationId tracks focus (driven through the wiring), so each note is
    // stamped with the item that was focused when it finalized.
    const voiceCorrelation = { current: null as string | null };
    const handles: HandleRegistry = new Map();
    handles.set('voice', {
      setCorrelationId: (id: unknown) => {
        voiceCorrelation.current = (id ?? null) as string | null;
      },
    });
    const teardown = applyWiring(TRIAGE_MANIFEST.wiring, handles);

    // The FLAT stream — exactly what surface's real drain endpoint returns.
    const flat: SurfaceSubmission[] = [];
    const push = (env: { affordanceId: string; value: unknown; itemId?: string }) =>
      flat.push({ id: env.affordanceId, payload: env, itemId: env.itemId, at: new Date().toISOString() });

    // Focus fruit-01 (strawberries), add to cart, narrate why.
    cockpitBus.emit(FOCUSED_ITEM_EVENT, 'fruit-01');
    push(actionSubmission('cart', 'fruit-01'));
    push(voiceSubmission('get two pints, we are hosting brunch this weekend', voiceCorrelation.current));

    // Focus fruit-03 (avocados), talk first, then save for later.
    cockpitBus.emit(FOCUSED_ITEM_EVENT, 'fruit-03');
    push(voiceSubmission('only if they are not rock hard, check before buying', voiceCorrelation.current));
    push(actionSubmission('later', 'fruit-03'));

    // Focus fruit-08 (grapes), skip (nobody finishes the bag), no talk.
    cockpitBus.emit(FOCUSED_ITEM_EVENT, 'fruit-08');
    push(actionSubmission('skip', 'fruit-08'));

    teardown();

    // CLIENT-SIDE grouping — the canonical model (not a server primitive).
    const grouped = groupByItem(flat);

    expect(grouped.ungrouped).toHaveLength(0);
    expect(grouped.items.map((b) => b.itemId)).toEqual(['fruit-01', 'fruit-03', 'fruit-08']);

    const r1 = grouped.items.find((b) => b.itemId === 'fruit-01')!;
    expect(r1.submissions.map((s) => s.id)).toEqual(['cart-fruit-01', 'voice-note-fruit-01']);

    const r3 = grouped.items.find((b) => b.itemId === 'fruit-03')!;
    // Note finalized while fruit-03 was focused, then "save for later"; both here.
    expect(r3.submissions.map((s) => s.id)).toEqual(['voice-note-fruit-03', 'later-fruit-03']);

    const r8 = grouped.items.find((b) => b.itemId === 'fruit-08')!;
    expect(r8.submissions.map((s) => s.id)).toEqual(['skip-fruit-08']);
    expect(r8.submissions.every((s) => !s.id.startsWith('voice-note-'))).toBe(true);
  });

  it('a transcript finalized before any focus lands in ungrouped (real-use corner)', () => {
    // If the user talks before navigating to anything, correlationId is null and
    // the note has no itemId — the managing agent still gets it, in ungrouped.
    const env = voiceSubmission('ok what do we actually need this week', null);
    expect(env.itemId).toBeUndefined();
    const grouped = groupByItem([
      { id: env.affordanceId, payload: env, itemId: env.itemId, at: new Date().toISOString() },
    ]);
    expect(grouped.items).toHaveLength(0);
    expect(grouped.ungrouped).toHaveLength(1);
  });
});
