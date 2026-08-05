/**
 * Client half of voice usage accounting.
 *
 * Folds the voice library's capture events into per-session totals and ships the
 * running totals to the app's `/usage` route on every usage-bearing event — never
 * once at session end, because a closed tab would take the whole session's spend
 * with it.
 *
 * The sink is an OBSERVER, not a participant: it is wired to `useVoiceCapture`'s
 * `onEvent` alongside nothing else, it never touches the transcript path, and every
 * failure it can produce is swallowed. A dead journal must degrade to "we lose the
 * measurement", never to "the mic stops working".
 */

import { emptyVoiceUsageTotals, foldVoiceUsage } from '@surface-voice-triage/voice';
import type { VoiceCaptureEvent, VoiceUsageTotals } from '@surface-voice-triage/voice';

/** Route the dev server (vite.config.ts) exposes for usage rows. */
export const USAGE_ROUTE = '/usage';

export interface UsageSinkDeps {
  /**
   * POST the totals. Injected so tests drive the sink without a network — and so
   * a consumer can send them somewhere other than the dev server.
   */
  post?: (totals: VoiceUsageTotals) => void | Promise<void>;
  /** Reported when a post rejects. Defaults to a console warning. */
  onError?: (err: unknown) => void;
}

export interface UsageSink {
  /** Wire this straight into `useVoiceCapture({ onEvent })`. */
  onEvent: (event: VoiceCaptureEvent) => void;
  /** Current running totals — exposed for tests and any live display. */
  totals: () => VoiceUsageTotals;
}

function defaultPost(totals: VoiceUsageTotals): Promise<void> {
  return fetch(USAGE_ROUTE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(totals),
  }).then((res) => {
    if (!res.ok) throw new Error(`usage journal rejected the row (${res.status})`);
  });
}

export function createUsageSink(deps: UsageSinkDeps = {}): UsageSink {
  const post = deps.post ?? defaultPost;
  const onError =
    deps.onError ??
    ((err: unknown) => {
      // eslint-disable-next-line no-console
      console.warn('[usage] row not journaled — spend for this segment is unrecorded:', err);
    });

  let totals: VoiceUsageTotals = { ...emptyVoiceUsageTotals };

  return {
    totals: () => totals,
    onEvent: (event) => {
      totals = foldVoiceUsage(totals, event);
      // Only usage-bearing events produce a row; VAD/partial/final events just
      // advance the wall clock, and journaling those would be noise.
      if (event.kind !== 'usage') return;
      const snapshot = totals;
      try {
        // Fire-and-forget: the mic must not wait on a disk write.
        void Promise.resolve(post(snapshot)).catch(onError);
      } catch (err) {
        onError(err);
      }
    },
  };
}
