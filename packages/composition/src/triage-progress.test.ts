import { describe, expect, test } from 'vitest';
import { triageProgress } from './triage-progress.js';

/**
 * The dogfood needs a recognizable "all triaged / cleared" signal so
 * the user isn't left silently wrapping the list asking "what do I do now?".
 * triageProgress is the app-side computation that drives both the progress readout
 * and the completion state.
 */
const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

describe('triageProgress', () => {
  test('reports zero progress on an untouched queue', () => {
    expect(triageProgress(items, {})).toEqual({
      total: 3,
      triaged: 0,
      remaining: 3,
      allDone: false,
    });
  });

  test('counts items that carry any applied action', () => {
    expect(triageProgress(items, { a: 'cart', c: 'skip' })).toEqual({
      total: 3,
      triaged: 2,
      remaining: 1,
      allDone: false,
    });
  });

  test('allDone is true only when every item is triaged', () => {
    expect(triageProgress(items, { a: 'cart', b: 'later', c: 'skip' }).allDone).toBe(true);
  });

  test('ignores status entries for ids not in the current list', () => {
    // A stale id (e.g. an item removed from the manifest) must not inflate the count.
    expect(triageProgress(items, { a: 'cart', gone: 'skip' }).triaged).toBe(1);
  });

  test('an empty queue is empty, not done', () => {
    expect(triageProgress([], {}).allDone).toBe(false);
  });
});
