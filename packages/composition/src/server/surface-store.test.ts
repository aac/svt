/**
 * Tests for SurfaceStore (local dev server) and groupByItem (the client-side
 * grouping function the managing agent calls after a real surface flat drain).
 *
 * The per-item bucket shape is documented in the composition package README.
 * Exercises worked example 1 (cockpit+voice grouped) and the ungrouped path
 * (worked example 3, voice-without-cockpit).
 *
 * Note on groupByItem vs drainByItem: drainByItem() is a LOCAL DEV SHIM that
 * delegates to groupByItem(). groupByItem() is the canonical client-side function
 * the managing agent runs against a real surface flat drain. Both are tested here.
 */

import { describe, it, expect } from 'vitest';
import { SurfaceStore, groupByItem } from './surface-store.js';

describe('SurfaceStore per-item grouping', () => {
  it('joins same-itemId submissions into per-item buckets', () => {
    const store = new SurfaceStore('s_test');
    // msg-7: a keep action + a voice note (the worked-example-1 shape).
    store.append('keep-msg-7', { affordanceId: 'keep-msg-7', value: true, itemId: 'msg-7' }, '2026-05-29T00:00:01Z');
    store.append(
      'voice-note-msg-7',
      { affordanceId: 'voice-note-msg-7', value: "this one's from the contractor, file it under the remodel", itemId: 'msg-7' },
      '2026-05-29T00:00:02Z',
    );
    // msg-8: only a voice note.
    store.append(
      'voice-note-msg-8',
      { affordanceId: 'voice-note-msg-8', value: 'remind me to follow up next month', itemId: 'msg-8' },
      '2026-05-29T00:00:03Z',
    );

    const drain = store.drainByItem();

    expect(drain.items).toHaveLength(2);
    expect(drain.ungrouped).toHaveLength(0);

    const msg7 = drain.items.find((b) => b.itemId === 'msg-7');
    expect(msg7?.submissions).toHaveLength(2);
    // Chronological within the bucket.
    expect(msg7?.submissions[0]?.id).toBe('keep-msg-7');
    expect(msg7?.submissions[1]?.id).toBe('voice-note-msg-7');

    const msg8 = drain.items.find((b) => b.itemId === 'msg-8');
    expect(msg8?.submissions).toHaveLength(1);
  });

  it('preserves first-seen item order across buckets', () => {
    const store = new SurfaceStore();
    store.append('a', { itemId: 'msg-8', value: 1 });
    store.append('b', { itemId: 'msg-7', value: 1 });
    store.append('c', { itemId: 'msg-8', value: 2 });

    const drain = store.drainByItem();
    expect(drain.items.map((b) => b.itemId)).toEqual(['msg-8', 'msg-7']);
  });

  it('routes itemId-less submissions to ungrouped (voice without cockpit)', () => {
    const store = new SurfaceStore();
    // worked example 3: voice stamps no itemId when nothing is focused.
    store.append('voice-note-uncorrelated-1', { affordanceId: 'voice-note-uncorrelated-1', value: 'the second one' });
    store.append('keep-msg-7', { affordanceId: 'keep-msg-7', value: true, itemId: 'msg-7' });

    const drain = store.drainByItem();
    expect(drain.items).toHaveLength(1);
    expect(drain.ungrouped).toHaveLength(1);
    expect(drain.ungrouped[0]?.id).toBe('voice-note-uncorrelated-1');
  });

  it('flat drain returns all submissions chronologically', () => {
    const store = new SurfaceStore();
    store.append('a', { itemId: 'x', value: 1 }, '2026-05-29T00:00:01Z');
    store.append('b', { value: 2 }, '2026-05-29T00:00:02Z');
    expect(store.drainFlat().map((s) => s.id)).toEqual(['a', 'b']);
  });
});

// ── groupByItem — the client-side function the managing agent calls post-drain ──
// This is the canonical grouping path against a real surface endpoint.
// SurfaceStore.drainByItem() is a local dev shim that delegates here.
describe('groupByItem — client-side grouping of a flat drain stream', () => {
  it('groups submissions by payload.itemId into per-item buckets', () => {
    const store = new SurfaceStore('s_test');
    store.append('keep-msg-7', { affordanceId: 'keep-msg-7', value: true, itemId: 'msg-7' }, '2026-05-29T00:00:01Z');
    store.append('voice-note-msg-7', { affordanceId: 'voice-note-msg-7', value: 'noted', itemId: 'msg-7' }, '2026-05-29T00:00:02Z');
    store.append('keep-msg-8', { affordanceId: 'keep-msg-8', value: true, itemId: 'msg-8' }, '2026-05-29T00:00:03Z');

    // groupByItem receives the flat drain, identical to what real surface returns.
    const flat = store.drainFlat();
    const { items, ungrouped } = groupByItem(flat);

    expect(items).toHaveLength(2);
    expect(ungrouped).toHaveLength(0);
    expect(items.find((b) => b.itemId === 'msg-7')?.submissions).toHaveLength(2);
    expect(items.find((b) => b.itemId === 'msg-8')?.submissions).toHaveLength(1);
  });

  it('places submissions without payload.itemId into ungrouped', () => {
    const store = new SurfaceStore();
    store.append('voice-note-uncorrelated-1', { affordanceId: 'voice-note-uncorrelated-1', value: 'no focus' });
    store.append('keep-msg-7', { affordanceId: 'keep-msg-7', value: true, itemId: 'msg-7' });

    const { items, ungrouped } = groupByItem(store.drainFlat());
    expect(items).toHaveLength(1);
    expect(ungrouped).toHaveLength(1);
    expect(ungrouped[0]?.id).toBe('voice-note-uncorrelated-1');
  });

  it('preserves first-seen item order and chronological order within buckets', () => {
    const store = new SurfaceStore();
    store.append('a', { itemId: 'msg-8', value: 1 });
    store.append('b', { itemId: 'msg-7', value: 1 });
    store.append('c', { itemId: 'msg-8', value: 2 });

    const { items } = groupByItem(store.drainFlat());
    expect(items.map((b) => b.itemId)).toEqual(['msg-8', 'msg-7']);
    expect(items[0]?.submissions.map((s) => s.id)).toEqual(['a', 'c']);
  });

  it('drainByItem() (dev shim) produces identical output to groupByItem(drainFlat())', () => {
    const store = new SurfaceStore('s_eq');
    store.append('x', { itemId: 'p1', value: 1 });
    store.append('y', { value: 2 });
    store.append('z', { itemId: 'p1', value: 3 });

    expect(store.drainByItem()).toEqual(groupByItem(store.drainFlat()));
  });
});
