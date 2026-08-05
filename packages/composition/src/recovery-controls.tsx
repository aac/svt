/**
 * Recovery affordances for the composition page.
 *
 * Two "recover from a mistake" controls asked for by name in a dogfood
 * pass: a way to CLEAR a note's captured voice when capture goes wrong so he can
 * re-record from scratch, and an UNDO for a disposition he triggered by accident.
 * Both are the same surface — recover the operator's working state after a slip —
 * so they live together in a small toolbar rendered in the detail preview area
 * (where the eyes already are, alongside the voice-notes block and the
 * mic-status caption).
 *
 * These are APP-SIDE controls. Cockpit and voice stay dumb: cockpit renders a
 * list and emits (actionId, itemId); voice captures audio and emits transcripts.
 * Neither knows what "clear my voice" or "undo" means. The App owns the state
 * (itemNotes / itemStatus / a disposition history) these buttons mutate, and the
 * App emits the compensating submissions downstream (see submissions.ts). This
 * component is purely presentational — it renders the buttons and reports clicks;
 * all state and side effects belong to its caller.
 *
 * They are BUTTONS, deliberately, not keybinds: the ask was for an "undo button",
 * and the cockpit's j/k nav plus the manifest's Enter/s/l action keybinds already
 * own the keyboard — a recovery keybind would risk colliding with them.
 */

import type { CSSProperties } from 'react';
import { QuoteBlock } from '@surface/cockpit-ui';
import { chrome } from './tokens.js';

export interface DetailRecoveryProps {
  /** The focused item's real (trimmed, non-empty) voice notes. */
  notes: string[];
  /** Discard this item's captured voice so the operator can re-record. */
  onClearVoice: () => void;
  /** Whether there is a disposition to reverse (drives the undo button's enabled state). */
  canUndo: boolean;
  /** Reverse the most recent disposition applied anywhere in the queue. */
  onUndo: () => void;
}

const buttonBase: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '5px',
  fontFamily: 'inherit',
  fontWeight: 500,
  fontSize: chrome.font.small,
  padding: '4px 10px',
  borderRadius: chrome.radius.md,
  whiteSpace: 'nowrap',
};

/**
 * The detail-preview recovery block: a thin toolbar (clear-voice + undo) above the
 * voice-notes quote block. The clear-voice button appears only when the focused
 * item actually has captured notes to discard; the undo button is always present
 * (so the affordance is glanceable and discoverable) but disabled when there is
 * nothing to reverse. Both render off the SAME cockpit-ui `QuoteBlock` primitive
 * the notes already used, so a palette re-tune reaches them too.
 */
export function DetailRecovery({ notes, onClearVoice, canUndo, onUndo }: DetailRecoveryProps) {
  const hasNotes = notes.length > 0;
  return (
    <div data-testid="detail-recovery">
      <div
        data-testid="recovery-controls"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: chrome.space.sm,
          marginBottom: hasNotes ? chrome.space.sm : 0,
          flexWrap: 'wrap',
        }}
      >
        {hasNotes && (
          <button
            type="button"
            data-testid="recovery-clear-voice"
            onClick={onClearVoice}
            title="Discard the voice captured on this item so you can re-record it — just start talking again."
            style={{
              ...buttonBase,
              background: chrome.color.surfaceRaised,
              border: `1px solid ${chrome.color.borderStrong}`,
              color: chrome.color.text,
              cursor: 'pointer',
            }}
          >
            ↺ clear voice
          </button>
        )}
        <button
          type="button"
          data-testid="recovery-undo"
          onClick={onUndo}
          disabled={!canUndo}
          title={
            canUndo
              ? 'Reverse the most recent disposition — un-mark the item it was applied to.'
              : 'Nothing to undo yet.'
          }
          style={{
            ...buttonBase,
            background: canUndo ? chrome.color.surfaceRaised : chrome.color.surfaceSunken,
            border: `1px solid ${canUndo ? chrome.color.borderStrong : chrome.color.border}`,
            color: canUndo ? chrome.color.text : chrome.color.textFaint,
            cursor: canUndo ? 'pointer' : 'default',
          }}
        >
          ⎌ undo last
        </button>
      </div>
      {hasNotes ? <QuoteBlock label="🎤 voice notes" quotes={notes} /> : null}
    </div>
  );
}
