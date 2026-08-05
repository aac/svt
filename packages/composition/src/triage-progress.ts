/**
 * Pure triage-progress computation for the composition dogfood.
 *
 * The App folds each applied action into per-item status (itemStatus); this turns
 * that status map into a progress readout and an "all triaged" signal. Lives
 * APP-SIDE on purpose: cockpit stays dumb (it renders a list, navigates, emits
 * actions — it does not know what "triaged" means or that the queue can be
 * "cleared"). No new cockpit capability is introduced; this is the same app-owned
 * data transform family as applyStatus().
 *
 * `allDone` answers the dogfood's "what do I do now?" gap: when every item carries
 * a status, the App can render a clear completion state instead of silently
 * wrapping focus back to the top.
 */
export interface TriageProgress {
  /** Total items in the queue. */
  total: number;
  /** How many have had any action applied. */
  triaged: number;
  /** total - triaged. */
  remaining: number;
  /** True only when there is at least one item and every item is triaged. */
  allDone: boolean;
}

export function triageProgress(
  items: ReadonlyArray<{ id: string }>,
  status: Record<string, string>,
): TriageProgress {
  const total = items.length;
  const triaged = items.reduce((n, it) => (status[it.id] != null ? n + 1 : n), 0);
  return {
    total,
    triaged,
    remaining: total - triaged,
    // An empty queue is "empty", not "done" — don't flash a completion state
    // before anything has loaded.
    allDone: total > 0 && triaged === total,
  };
}
