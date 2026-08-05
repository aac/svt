/**
 * Reference surface server — submission store for local dev.
 *
 * Implements the surface wire's state shape (session_id, affordances, submissions).
 * Submissions arrive with an opaque `payload`; our composition app sends a
 * SubmissionEnvelope as that payload, and we read `itemId` out of it for the
 * dev-convenience grouping described below.
 *
 * ─── IMPORTANT: per-item grouping is CLIENT-SIDE, not a surface primitive ───
 *
 * The real surface server does NOT understand
 * `itemId` and does NOT offer a `?groupBy=item` query param. Surface's model:
 *   - The drain endpoint returns a flat stream of { id, payload } submissions.
 *   - `itemId` is a payload convention WE own — it rides inside the opaque payload,
 *     invisible to surface. Surface treats the entire payload as opaque JSON.
 *   - Grouping happens AFTER drain, CLIENT-SIDE, in the managing agent. The agent
 *     drains the flat stream and groups submissions by reading `payload.itemId` off
 *     each entry. No server-side grouping exists.
 *
 * `drainByItem()` below is a LOCAL DEV CONVENIENCE that mirrors what the managing
 * agent does post-drain. It is NOT something real surface provides and must NOT be
 * used as a model for what to expect from a live surface endpoint. The exported
 * `groupByItem()` function IS the model: it is the client-side logic the managing
 * agent runs against the flat drain output.
 *
 * This module is transport-agnostic (no http, no fs) so the grouping logic can be
 * unit-tested at the boundary that actually matters (the bucket shape the managing
 * agent consumes), not through an incidental HTTP layer. The Vite dev server
 * (vite.config.ts) wires this store to /submit and /drain routes.
 */

export interface SurfaceSubmission {
  /** Affordance id (opaque to the wire). */
  id: string;
  /** Payload as sent by the client — our composition app sends a SubmissionEnvelope. */
  payload: unknown;
  /**
   * Per-item key, extracted from the payload's `itemId` field for dev-convenience
   * grouping. NOT a surface wire concept — surface never reads or stores this field
   * separately; it exists only in this dev-server to support `drainByItem()`.
   */
  itemId?: string;
  /** RFC3339 timestamp. */
  at: string;
}

/**
 * Per-item bucket: the shape a managing agent assembles client-side after draining
 * the flat surface stream. See `groupByItem()` for the function that produces this.
 */
export interface ItemBucket {
  itemId: string;
  submissions: SurfaceSubmission[];
}

/**
 * Result of a per-item grouping pass — what the managing agent builds locally
 * after calling the real surface drain endpoint (which returns a flat stream).
 */
export interface GroupedDrain {
  items: ItemBucket[];
  /** Submissions with no itemId (e.g. voice-without-cockpit, worked example 3). */
  ungrouped: SurfaceSubmission[];
}

/** Extract an itemId from a submission payload, if the envelope carries one. */
function itemIdOf(payload: unknown): string | undefined {
  if (payload && typeof payload === 'object' && 'itemId' in payload) {
    const v = (payload as { itemId?: unknown }).itemId;
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

/**
 * Group a flat surface drain stream into per-item buckets.
 *
 * This is the CLIENT-SIDE function the managing agent runs after calling the real
 * surface drain endpoint. Surface returns a flat `{ id, payload }[]` array; the
 * agent calls `groupByItem(submissions)` to reconstruct the per-item view.
 *
 * `itemId` is a payload convention WE own — it lives inside the opaque payload
 * as `payload.itemId`. Surface has no knowledge of it (per surface's own
 * 2026-05-29). This function reads it out of each payload and groups accordingly.
 *
 * Bucket order: first-seen item order from the stream. Within a bucket:
 * chronological (stream order).
 */
export function groupByItem(submissions: SurfaceSubmission[]): GroupedDrain {
  const buckets = new Map<string, ItemBucket>();
  const ungrouped: SurfaceSubmission[] = [];

  for (const sub of submissions) {
    const id = itemIdOf(sub.payload);
    if (id == null) {
      ungrouped.push(sub);
      continue;
    }
    let bucket = buckets.get(id);
    if (!bucket) {
      bucket = { itemId: id, submissions: [] };
      buckets.set(id, bucket);
    }
    bucket.submissions.push(sub);
  }

  return { items: [...buckets.values()], ungrouped };
}

export class SurfaceStore {
  readonly sessionId: string;
  private readonly submissions: SurfaceSubmission[] = [];

  constructor(sessionId = `s_${Math.random().toString(36).slice(2, 10)}`) {
    this.sessionId = sessionId;
  }

  /** Append a submission. Returns the stored entry. */
  append(id: string, payload: unknown, at: string = new Date().toISOString()): SurfaceSubmission {
    const entry: SurfaceSubmission = { id, payload, itemId: itemIdOf(payload), at };
    this.submissions.push(entry);
    return entry;
  }

  /** Flat drain — mirrors the real surface drain endpoint's return shape. */
  drainFlat(): SurfaceSubmission[] {
    return [...this.submissions];
  }

  /**
   * LOCAL DEV SHIM: per-item drain for the development server.
   *
   * This is NOT a surface primitive — the real surface drain endpoint returns a
   * flat stream only. This method
   * exists so the local demo can show grouped output without requiring the
   * managing agent to be running. It delegates to `groupByItem()`, which is the
   * same function the real managing agent would call client-side after draining.
   *
   * Against a live surface endpoint, use:
   *   const flat = await fetch(`/${surfaceId}/drain`).then(r => r.json());
   *   const grouped = groupByItem(flat);
   */
  drainByItem(): GroupedDrain {
    return groupByItem(this.submissions);
  }

  /** Surface state-file shape (for parity with the wire's locked schema). */
  toState() {
    return {
      session_id: this.sessionId,
      affordances: {} as Record<string, { label: string; intent: unknown }>,
      submissions: this.submissions,
    };
  }
}
