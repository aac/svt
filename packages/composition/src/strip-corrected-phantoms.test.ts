/**
 * Tests for stripCorrectedPhantoms — downstream, app-side cleanup that removes a
 * spoken-correction voice note ("I didn't say that") together with the phantom
 * voice note it refers to.
 *
 * The bug: gpt-4o-transcribe hallucinates text from non-speech audio (keyboard,
 * trackpad, ambient). The operator flags it in the moment by SAYING a correction. This
 * cleanup lives HERE (consuming app), not in the voice library, because it is
 * content-aware — v0 voice stays dumb (docs/design-spec.md non-goals).
 *
 * The cleanup runs on the flat drain BEFORE groupByItem:
 *   groupByItem(stripCorrectedPhantoms(flat))
 */

import { describe, it, expect } from 'vitest';
import {
  stripCorrectedPhantoms,
  isCorrectionText,
  PHANTOM_CORRECTION_PHRASES,
  voiceSubmission,
  actionSubmission,
} from './submissions.js';
import { groupByItem, SurfaceStore, type SurfaceSubmission } from './server/surface-store.js';

/**
 * Build a drained-stream entry the way the surface store would after a POST:
 * id = affordanceId, payload = the SubmissionEnvelope, itemId lifted out of it.
 * Typed as SurfaceSubmission (the real flat-drain shape) so the cleaned output
 * feeds straight into groupByItem.
 */
function drained(env: { affordanceId: string; value: unknown; itemId?: string }): SurfaceSubmission {
  return { id: env.affordanceId, payload: env, itemId: env.itemId, at: '2026-07-24T00:00:00Z' };
}

/** A voice note on an item, as it lands in the drain. */
function voice(text: string, itemId: string): SurfaceSubmission {
  return drained(voiceSubmission(text, itemId));
}

/** An action submission on an item, as it lands in the drain. */
function action(actionId: string, itemId: string): SurfaceSubmission {
  return drained(actionSubmission(actionId, itemId));
}

describe('isCorrectionText', () => {
  it('matches each configured phrase', () => {
    for (const phrase of PHANTOM_CORRECTION_PHRASES) {
      expect(isCorrectionText(phrase)).toBe(true);
    }
  });

  it('is case- and punctuation-tolerant', () => {
    expect(isCorrectionText("I DIDN'T say that!")).toBe(true);
    expect(isCorrectionText('  scratch that.  ')).toBe(true);
    expect(isCorrectionText("That's not what I said…")).toBe(true);
    expect(isCorrectionText('Strike that,')).toBe(true);
  });

  it('does NOT match genuine speech that merely contains a phrase (no false positive)', () => {
    // Whole-utterance matching: a phrase embedded in a longer sentence is real speech.
    expect(isCorrectionText("I didn't say that loudly enough, resend it")).toBe(false);
    expect(isCorrectionText('scratch that itch on the follow-up email')).toBe(false);
    expect(isCorrectionText('keep this one for later')).toBe(false);
    expect(isCorrectionText("this one's from the contractor, file it under the remodel")).toBe(false);
  });
});

describe('stripCorrectedPhantoms', () => {
  it('strips the phantom AND its correction on the same item (basic case)', () => {
    const stream = [
      voice('keep this one for later', 'msg-7'),
      voice('the quick brown fox', 'msg-7'), // phantom from a trackpad click
      voice("I didn't say that", 'msg-7'), // the operator flags it
    ];

    const clean = stripCorrectedPhantoms(stream);

    expect(clean).toHaveLength(1);
    expect((clean[0]!.payload as { value: unknown }).value).toBe('keep this one for later');
  });

  it('does NOT strip normal speech (no correction present → identity)', () => {
    const stream = [
      voice("this one's from the contractor, file it under the remodel", 'msg-7'),
      action('keep', 'msg-7'),
      voice('remind me to follow up next month', 'msg-8'),
    ];

    const clean = stripCorrectedPhantoms(stream);

    expect(clean).toEqual(stream);
  });

  it('scopes the strip to the same item — never strips a phantom across items', () => {
    const stream = [
      voice('phantom on eight', 'msg-8'),
      voice('real note on seven', 'msg-7'),
      voice('scratch that', 'msg-7'), // corrects the msg-7 note, not the msg-8 one
    ];

    const clean = stripCorrectedPhantoms(stream);

    // msg-8 phantom survives (different item); msg-7 note + its correction are gone.
    expect(clean).toHaveLength(1);
    expect(clean[0]!.itemId).toBe('msg-8');
    expect((clean[0]!.payload as { value: unknown }).value).toBe('phantom on eight');
  });

  it('correction with no preceding voice note on the item is a no-op (lone correction kept)', () => {
    const stream = [
      action('keep', 'msg-7'), // an action is not a phantom to pair against
      voice('delete that', 'msg-7'), // nothing before it to correct
    ];

    const clean = stripCorrectedPhantoms(stream);

    expect(clean).toEqual(stream);
  });

  it('skips action submissions when locating the immediately-preceding voice note', () => {
    const stream = [
      voice('the phantom text', 'msg-7'),
      action('keep', 'msg-7'), // an action between phantom and correction must not shield it
      voice('ignore that', 'msg-7'),
    ];

    const clean = stripCorrectedPhantoms(stream);

    // Phantom + correction removed; the action survives.
    expect(clean).toHaveLength(1);
    expect(clean[0]!.id).toBe('keep-msg-7');
  });

  it('handles case/punctuation variants of the correction phrase', () => {
    const stream = [
      voice('actual note', 'msg-1'),
      voice('keyboard clack phantom', 'msg-1'),
      voice("I DIDN'T say that!!", 'msg-1'),
    ];

    const clean = stripCorrectedPhantoms(stream);
    expect(clean.map((s) => (s.payload as { value: unknown }).value)).toEqual(['actual note']);
  });

  it('strips corrections independently across multiple items', () => {
    const stream = [
      voice('note A', 'a'),
      voice('phantom A', 'a'),
      voice('strike that', 'a'),
      voice('phantom B', 'b'),
      voice("that's not what I said", 'b'),
      voice('note C survives', 'c'),
    ];

    const clean = stripCorrectedPhantoms(stream);
    const byItem = groupByItem(clean);

    expect(byItem.items.find((x) => x.itemId === 'a')!.submissions.map((s) => (s.payload as { value: unknown }).value)).toEqual(['note A']);
    expect(byItem.items.find((x) => x.itemId === 'b')).toBeUndefined(); // both b entries gone
    expect(byItem.items.find((x) => x.itemId === 'c')!.submissions).toHaveLength(1);
  });

  it('leaves the input array and its elements unmutated (pure)', () => {
    const stream = [
      voice('phantom', 'msg-7'),
      voice('scratch that', 'msg-7'),
    ];
    const snapshot = JSON.parse(JSON.stringify(stream));

    stripCorrectedPhantoms(stream);

    expect(stream).toEqual(snapshot);
    expect(stream).toHaveLength(2);
  });

  it('composes with groupByItem: buckets reflect the cleaned stream', () => {
    const stream = [
      voice('real note', 'msg-7'),
      voice('trackpad phantom', 'msg-7'),
      voice('delete that', 'msg-7'),
      action('keep', 'msg-7'),
    ];

    const { items } = groupByItem(stripCorrectedPhantoms(stream));
    const msg7 = items.find((b) => b.itemId === 'msg-7')!;

    // Phantom + correction stripped; real note + action remain.
    expect(msg7.submissions.map((s) => s.id)).toEqual(['voice-note-msg-7', 'keep-msg-7']);
    expect((msg7.submissions[0]!.payload as { value: unknown }).value).toBe('real note');
  });

  // ── REGRESSION GUARD ──────────────────────────────────────────────────────
  // Encodes the exact dogfood bug: a phantom voice note survives into the drain.
  // The two assertions below are the before/after of the fix on ONE stream:
  //   1. The RAW drain (no stripper) still contains the phantom — this is the bug.
  //      This models what a "version without the stripper" produces; if the
  //      stripper's effect ever regressed to identity, assertion 2 would fail.
  //   2. After stripCorrectedPhantoms, the phantom (and its correction) are gone.
  it('REGRESSION: phantom present in raw drain, absent after the stripper', () => {
    const phantom = 'thumping the desk';
    const stream = [
      voice('genuine note about the invoice', 'msg-42'),
      voice(phantom, 'msg-42'), // hallucinated from a non-speech thump
      voice("I didn't say that", 'msg-42'), // the operator's spoken flag
    ];

    const rawTexts = stream.map((s) => (s.payload as { value: unknown }).value);
    // The bug, as it reaches the managing agent WITHOUT this cleanup:
    expect(rawTexts).toContain(phantom);
    expect(rawTexts).toContain("I didn't say that");

    const cleanTexts = stripCorrectedPhantoms(stream).map((s) => (s.payload as { value: unknown }).value);
    // The fix: phantom + correction stripped, genuine note preserved.
    expect(cleanTexts).not.toContain(phantom);
    expect(cleanTexts).not.toContain("I didn't say that");
    expect(cleanTexts).toEqual(['genuine note about the invoice']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cross-consumer payload coverage (review finding A4)
//
// Detection used to be `sub.id.startsWith('voice-note-') && typeof value ===
// 'string'` — two shape assumptions about THIS app's payloads. A second shipped
// consumer app satisfies NEITHER: it POSTs `env.value`
// (not the whole envelope) under an affordance id of `voice-<row>`, so the drained
// payload is the FLAT object `{ text, itemId }`. The stripper was therefore a
// silent no-op there from the day it shipped, and nobody noticed — a safety
// mechanism switched off in production with no error and no signal.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a drained stream from a SECOND consumer app's real wire shape.
 *
 * That consumer's `postSubmission` sends `{ id: env.affordanceId, payload: env.value }`,
 * so the payload that lands in the drain is the flat value object, NOT a
 * SubmissionEnvelope. Assembled through `SurfaceStore` (byte-identical to that
 * consumer's own copy) so `itemId` is lifted out of the payload exactly as the
 * real dev server lifts it, rather than being hand-stamped by the fixture.
 */
function phantomFlatDrain(
  entries: readonly { affordanceId: string; payload: unknown }[],
): SurfaceSubmission[] {
  const store = new SurfaceStore('s_phantom_flat');
  for (const e of entries) store.append(e.affordanceId, e.payload, '2026-07-24T00:00:00Z');
  return store.drainFlat();
}

/** Second-consumer voice note: id `voice-<row>`, flat payload `{ text, itemId }`. */
function phantomFlatVoice(text: string, rowId: string) {
  return { affordanceId: `voice-${rowId}`, payload: { text, itemId: rowId } };
}

/**
 * Second-consumer disposition (its action envelope): id = the row id, flat
 * payload `{ decision, note, itemId }`. `note` carries the operator's accumulated spoken
 * reaction — text-bearing, but this is an ACTION submission and stripping one is
 * data loss.
 */
function phantomFlatDisposition(decision: string, rowId: string, note: string) {
  return { affordanceId: rowId, payload: { decision, note, itemId: rowId } };
}

describe('stripCorrectedPhantoms — external consumer payload shapes', () => {
  it('REGRESSION: strips phantoms on second-consumer payloads (`voice-<row>` id, `{text}` value)', () => {
    const phantom = 'the quick brown fox';
    const drain = phantomFlatDrain([
      phantomFlatVoice('this is a duplicate of the earlier one', 'row-3'),
      phantomFlatVoice(phantom, 'row-3'), // hallucinated from a trackpad tap
      phantomFlatVoice('scratch that', 'row-3'), // the operator's spoken flag
    ]);

    // Precondition: the store lifts itemId out of the flat payload, so there IS
    // something to scope a strip to. If this ever breaks, the strip can't work.
    expect(drain.map((s) => s.itemId)).toEqual(['row-3', 'row-3', 'row-3']);

    const clean = stripCorrectedPhantoms(drain);

    expect(clean.map((s) => (s.payload as { text: string }).text)).toEqual([
      'this is a duplicate of the earlier one',
    ]);
  });

  it('never strips a second-consumer disposition, even when its note is a correction phrase', () => {
    // The disposition's `note` is text-bearing, so text-based detection must be
    // guarded by a positive exclusion on action markers (`decision`). Without it
    // this disposition reads as a correction and takes the real note down with it.
    const drain = phantomFlatDrain([
      phantomFlatVoice('genuine reaction to this move', 'row-9'),
      phantomFlatDisposition('drop', 'row-9', 'scratch that'),
    ]);

    expect(stripCorrectedPhantoms(drain)).toEqual(drain);
  });

  it('finds the transcript under value.note on an object-valued envelope (range-annotation payload)', () => {
    // The other half of A4: an annotation payload keeps its text at `value.note`
    // under an `annotation-<range>` id. Detection must be structural, not prefixed.
    const annotation = (note: string, rangeId: string): SurfaceSubmission => ({
      id: `annotation-${rangeId}`,
      payload: { affordanceId: `annotation-${rangeId}`, value: { kind: 'annotation', note }, itemId: rangeId },
      itemId: rangeId,
      at: '2026-07-24T00:00:00Z',
    });

    const stream = [
      annotation('this paragraph contradicts the intro', 'r-1'),
      annotation('mary had a little lamb', 'r-1'), // phantom
      annotation('ignore that', 'r-1'),
    ];

    const clean = stripCorrectedPhantoms(stream);

    expect(clean.map((s) => (s.payload as { value: { note: string } }).value.note)).toEqual([
      'this paragraph contradicts the intro',
    ]);
  });

  it('lets a consumer override detection and text extraction', () => {
    // The escape hatch for a payload shape the defaults do not know: text under a
    // nested key, gated on the consumer's own notion of "this is a voice note".
    type Weird = SurfaceSubmission & { payload: { spoken?: { words: string }; act?: string } };
    const spoken = (words: string, itemId: string): Weird => ({
      id: `utterance-${itemId}`,
      payload: { spoken: { words } },
      itemId,
      at: '2026-07-24T00:00:00Z',
    });
    const stream: Weird[] = [
      spoken('the real note', 'x'),
      spoken('phantom words', 'x'),
      spoken('delete that', 'x'),
      { id: 'act-x', payload: { act: 'archive' }, itemId: 'x', at: '2026-07-24T00:00:00Z' },
    ];

    const clean = stripCorrectedPhantoms(stream, {
      isVoice: (sub) => (sub as Weird).payload.spoken != null,
      getText: (sub) => (sub as Weird).payload.spoken?.words ?? '',
    });

    expect(clean.map((s) => s.id)).toEqual(['utterance-x', 'act-x']);
    expect(clean[0]!.payload.spoken!.words).toBe('the real note');
  });
});
