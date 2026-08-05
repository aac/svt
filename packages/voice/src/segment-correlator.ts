/**
 * SegmentCorrelator — decides which correlationId a transcript segment carries.
 *
 * Fixes two attribution bugs: boundary straddle, and anchoring too late. A
 * transcript must be attributed to the item focused when the user STARTED
 * speaking the segment — not when it finalized. OpenAI's transcription finalizes
 * a beat after speech (server VAD endpointing + STT latency); by then the user has
 * often pressed j/k, so stamping at completion lands the note on a later item.
 *
 * Anchor = speech onset. The hook calls noteSpeechStarted() on OpenAI's
 * `input_audio_buffer.speech_started` event, which fires at VAD-detected speech
 * onset — EARLIER than the first transcription delta (the delta is downstream of
 * STT processing, so it can arrive after the user has already navigated). The
 * earlier anchor captures focus while the user is much more likely still on the
 * item they're talking about. noteDelta() remains a fallback anchor for the rare
 * case where no speech_started preceded a transcript.
 *
 * FIFO, not a single slot. OpenAI's VAD splits continuous speech into separate
 * segments; a fast run-on can produce a second speech_started before the first
 * segment's transcript has completed (STT lags). A single captured slot would let
 * the later onset clobber the earlier one. So onsets enqueue and completions
 * dequeue in order, pairing each finished transcript with the focus its speech
 * began under. The hook closes EVERY completed segment (even an empty/silent one)
 * so the queue stays aligned with VAD's speech_started↔completed pairing.
 *
 * This is pure focus-timestamp bookkeeping — it never inspects transcript content,
 * preserving the v0 "voice is dumb: transcription only" invariant (design-spec.md).
 * No React; unit-tested in isolation. The hook wires its data-channel events here.
 */
/**
 * Ceiling on the onset FIFO depth. The FIFO stays aligned only if every enqueue
 * (speech onset) eventually pairs with a dequeue (segment completion). If an onset
 * ever fails to produce a matching completion — plausible under aggressive VAD
 * cutting, where a fragment can be too short for STT to emit a `completed` event —
 * the queue grows without bound and, worse, every SUBSEQUENT completion dequeues a
 * stale head, mis-attributing all later notes to earlier items (a candidate cause
 * of the observed idx-37 mis-attribution). No human overlaps this many un-
 * finalized utterances, so a depth past the ceiling is a desync signal, not real
 * concurrency: shed the stale head so the poisoning is bounded to one segment
 * instead of the rest of the session. Sheds are counted (`desyncDrops`) and
 * surfaced by the hook's onEvent logging so the desync is visible, not silent.
 */
const MAX_PENDING = 8;

export class SegmentCorrelator {
  /** The currently-focused correlationId (updated on every focus change). */
  private liveCorrelationId: string | null = null;
  /**
   * FIFO of focus captured at each speech-segment onset, awaiting completion.
   * Enqueued at speech_started (or the first delta as a fallback); dequeued — in
   * order — as each segment completes.
   */
  private pending: Array<string | null> = [];
  /** Count of stale anchors shed by the MAX_PENDING desync guard (observability). */
  private droppedAnchors = 0;

  /** Record a focus change (cockpit's focused-item → voice.setCorrelationId). */
  setCorrelation(id: string | null): void {
    this.liveCorrelationId = id;
  }

  /**
   * VAD detected speech onset (`input_audio_buffer.speech_started`). Capture the
   * focus live at onset and queue it for the segment that's about to transcribe.
   * This is the primary, earliest anchor.
   *
   * Guards against unbounded desync: if the queue is already at MAX_PENDING, an
   * earlier onset never got its completion, so shed the stale head before pushing —
   * bounding the mis-attribution to one segment rather than poisoning the rest of
   * the session. Returns true when a shed happened, so the hook can log it.
   */
  noteSpeechStarted(): boolean {
    let shed = false;
    if (this.pending.length >= MAX_PENDING) {
      this.pending.shift();
      this.droppedAnchors += 1;
      shed = true;
    }
    this.pending.push(this.liveCorrelationId);
    return shed;
  }

  /** Current onset-FIFO depth (segments awaiting completion). Observability only. */
  pendingDepth(): number {
    return this.pending.length;
  }

  /** Total stale anchors shed by the desync guard this session. Observability only. */
  desyncDrops(): number {
    return this.droppedAnchors;
  }

  /**
   * A non-empty transcript delta arrived. Only a FALLBACK anchor: if no
   * speech_started opened a segment (queue empty), capture the live focus now so
   * we still beat the completion-time focus. When a segment is already queued,
   * this is a no-op — the onset anchor stands.
   */
  noteDelta(): void {
    if (this.pending.length === 0) {
      this.pending.push(this.liveCorrelationId);
    }
  }

  /**
   * Resolve the correlationId for a completed (or force-finalized) segment and
   * dequeue it. Falls back to the live focus when the queue is empty (a
   * completion with no preceding onset/delta — the best signal available).
   */
  completeSegment(): string | null {
    if (this.pending.length > 0) {
      return this.pending.shift() ?? null;
    }
    return this.liveCorrelationId;
  }

  /** Discard any queued segments (new session, disconnect, or clearTranscript). */
  reset(): void {
    this.pending = [];
    this.droppedAnchors = 0;
  }
}
