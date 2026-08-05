/**
 * React mount registry for the composition runtime.
 *
 * Part of the composition layer (alongside runtime.ts and App.tsx). Like the
 * runtime, this module legitimately imports both libraries — that is what the
 * composition layer is for. The invariant the project protects is that the
 * *libraries* don't import each other; the composition layer is the single place
 * that knows about both.
 *
 * Each entry maps a manifest library `name` to:
 *   - a React component rendering that library, configured from the manifest's
 *     `config` blob, and
 *   - registration of an imperative handle (for wiring targets) via `onHandle`.
 *
 * The runtime's `applyWiring` consumes the registered handles.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Cockpit, type CockpitProps, type DisplayItem } from '@surface/cockpit-ui';
import type { CockpitAction } from '@surface/cockpit';
import type { TriageItem } from './manifest.js';
import { useVoiceCapture, VoiceIndicator } from '@surface-voice-triage/voice';
import type { FinalTranscript, TokenResponse } from '@surface-voice-triage/voice';
import { chrome } from './tokens.js';
import { createUsageSink } from './usage-sink.js';
import type { LibraryHandle } from './runtime.js';

// ── Cockpit mount ────────────────────────────────────────────────────────────

export interface CockpitMountProps {
  config: { items: TriageItem[]; actions: CockpitAction[] };
  onAction: (actionId: string, itemId: string) => void;
  /** Map a domain item to the display's title/body/accent. */
  mapItem: (item: TriageItem) => DisplayItem;
  /** Additive display slots (app-rendered nodes — e.g. annotations). */
  renderRowAside?: (item: TriageItem) => ReactNode;
  renderDetailBefore?: (item: TriageItem) => ReactNode;
  /**
   * Theme posture forwarded to <Cockpit>. This composition resolves + applies the
   * theme itself at the page ancestor (so the chrome re-skins with the cockpit as
   * one), so it passes `'inherit'` — the cockpit sets no vars and reads the shared
   * palette instead of fighting it (see App.tsx).
   */
  theme?: CockpitProps['theme'];
  /**
   * Optional. The channel this cockpit publishes `focused-item` on, forwarded to
   * `<Cockpit bus>`.
   *
   * Omitted (default) → the module singleton `cockpitBus`, unchanged. Pass a
   * stable `createCockpitBus()` instance — the SAME one handed to `applyWiring`
   * for this composition's manifest — when two manifest-wired compositions share
   * a page and must not stamp each other's voice correlations. Scoping only one
   * half (mount or wiring) leaves the wiring listening to a silent channel.
   */
  bus?: CockpitProps['bus'];
}

/**
 * The engine (@surface/cockpit) publishes `focused-item` on its bus automatically
 * (useCockpit effect), so the wiring's subscribe side needs nothing from this
 * mount. The engine exposes no wiring-target methods in v0, so it registers no
 * handle. This mount renders the default DISPLAY (@surface/cockpit-ui) fed by the
 * app's `mapItem` + annotation slots.
 */
export function CockpitMount({
  config,
  onAction,
  mapItem,
  renderRowAside,
  renderDetailBefore,
  theme,
  bus,
}: CockpitMountProps) {
  return (
    <Cockpit
      items={config.items}
      actions={config.actions}
      onAction={onAction}
      mapItem={mapItem}
      renderRowAside={renderRowAside}
      renderDetailBefore={renderDetailBefore}
      theme={theme}
      bus={bus}
    />
  );
}

// ── Voice mount ──────────────────────────────────────────────────────────────

export interface VoiceMountProps {
  config: { tokenProvider: string };
  onFinal: (transcript: FinalTranscript) => void;
  /** Register the voice imperative handle so wiring can call setCorrelationId. */
  onHandle: (handle: LibraryHandle) => void;
  /** Surface the latest correlationId for the page's debug panel. */
  onCorrelationChange?: (id: string | null) => void;
  /** Fires when the mic session goes live / idle, so the App can show a voice
   *  cue (accent rail) on the selected item while voice is armed. */
  onLiveChange?: (live: boolean) => void;
  /** Fires when a segment is in flight (open + not yet committed) vs clear, so
   *  the App can color the rail "wait" vs "safe to talk". Stays solid through a
   *  continuous utterance; flips clear only when the segment commits. */
  onBusyChange?: (busy: boolean) => void;
}

export function VoiceMount({
  config,
  onFinal,
  onHandle,
  onCorrelationChange,
  onLiveChange,
  onBusyChange,
}: VoiceMountProps) {
  // The manifest gives a token-endpoint *path*; turn it into a fetch provider.
  const tokenProvider = useMemo(
    () => async (): Promise<TokenResponse> => {
      const res = await fetch(config.tokenProvider, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(`token mint failed (${res.status}): ${body.message ?? res.statusText}`);
      }
      return (await res.json()) as TokenResponse;
    },
    [config.tokenProvider],
  );

  // Briefly flag the moment a segment commits (onFinal) so the capture indicator
  // can flash "✓ sent" — the go-signal that it's safe to advance to the next
  // item. We wrap the caller's onFinal rather than touch the library: VAD commit
  // = a final fired. (The pause that commits a segment is what splits
  // a run-on, so the UI's job is to make that commit moment legible.)
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;
  const sentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [justSent, setJustSent] = useState(false);
  const handleFinal = useCallback((t: FinalTranscript) => {
    setJustSent(true);
    if (sentTimer.current) clearTimeout(sentTimer.current);
    sentTimer.current = setTimeout(() => setJustSent(false), 1400);
    onFinalRef.current(t);
  }, []);
  useEffect(
    () => () => {
      if (sentTimer.current) clearTimeout(sentTimer.current);
    },
    [],
  );

  // Voice usage/cost journal. Every session before this one was
  // unmeasured. The sink observes onEvent, folds per-session totals, and POSTs the
  // running totals to /usage per usage-bearing event so a closed tab can't take
  // the session's spend with it. Purely observational — it cannot affect capture.
  const usageSink = useMemo(() => createUsageSink(), []);
  const voice = useVoiceCapture({
    tokenProvider,
    onFinal: handleFinal,
    onEvent: usageSink.onEvent,
  });

  // Register voice's imperative handle for wiring. We wrap setCorrelationId so
  // the page can also observe correlation changes (debug panel) — the wiring
  // calls handle.setCorrelationId(id); this forwards to voice and notifies.
  const onCorrelationChangeRef = useRef(onCorrelationChange);
  onCorrelationChangeRef.current = onCorrelationChange;
  useEffect(() => {
    const handle: LibraryHandle = {
      setCorrelationId: (id: unknown) => {
        const corr = (id ?? null) as string | null;
        voice.setCorrelationId(corr);
        onCorrelationChangeRef.current?.(corr);
      },
    };
    onHandle(handle);
  }, [voice, onHandle]);

  const live = voice.state.kind === 'live';
  const hasPartial = voice.partial.length > 0;
  const speechActive = voice.speechActive;

  // Tell the App when the mic goes live/idle so it can paint the selected row's
  // accent rail while voice is armed.
  const onLiveChangeRef = useRef(onLiveChange);
  onLiveChangeRef.current = onLiveChange;
  useEffect(() => {
    onLiveChangeRef.current?.(live);
  }, [live]);

  // "Busy" = a segment is in flight: open (speechActive) or finalizing (partial
  // still present, pre-commit). Solid through a continuous utterance, clears only
  // at commit — so the rail reads "wait" while busy, "safe to talk" when clear.
  const busy = speechActive || hasPartial;
  const onBusyChangeRef = useRef(onBusyChange);
  onBusyChangeRef.current = onBusyChange;
  useEffect(() => {
    onBusyChangeRef.current?.(busy);
  }, [busy]);
  // Force-finalize is only meaningful with an in-flight partial to push; when
  // live but silent, the button is present but reads as nothing-to-do.
  const canFinalize = live && hasPartial;
  const errorMessage = voice.state.kind === 'error' ? voice.state.message : null;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: chrome.space.md, minWidth: 0 }}>
      <VoiceIndicator
        state={voice.state}
        onConnect={() => void voice.connect()}
        onDisconnect={() => void voice.disconnect()}
      />
      <button
        type="button"
        onClick={() => voice.forceFinalize()}
        disabled={!canFinalize}
        title={
          canFinalize
            ? 'Push the current partial transcript through as a final segment.'
            : live
              ? 'Nothing to finalize yet — speak first.'
              : 'Connect the voice session to use this.'
        }
        style={{
          background: canFinalize ? chrome.color.surfaceRaised : chrome.color.surfaceSunken,
          border: `1px solid ${canFinalize ? chrome.color.borderStrong : chrome.color.border}`,
          borderRadius: chrome.radius.md,
          color: canFinalize ? chrome.color.text : chrome.color.textFaint,
          cursor: canFinalize ? 'pointer' : 'default',
          fontFamily: 'inherit',
          fontWeight: 500,
          fontSize: chrome.font.small,
          padding: '5px 12px',
          whiteSpace: 'nowrap',
        }}
      >
        force finalize
      </button>

      {/* Live capture indicator. Three states make the segment-commit moment
          legible so the user learns to pause between items:
            - capturing: a segment is open (partial streaming) — your words are
              still flowing into ONE note; don't advance yet. Amber, pulsing.
            - sent: a segment just committed (VAD found your pause) — the note
              landed; safe to move on. Green ✓, brief.
            - listening: live but idle, waiting for speech. Faint.
          In a run-on with no pause it stays stuck on "capturing" and never
          reaches "✓ sent" — which is itself the cue that a pause is needed. */}
      {live &&
        (() => {
          const phase = hasPartial || speechActive ? 'capturing' : justSent ? 'sent' : 'idle';
          const dotColor =
            phase === 'sent'
              ? '#3f9655'
              : phase === 'capturing'
                ? chrome.color.accent
                : chrome.color.textFaint;
          const label =
            phase === 'sent'
              ? '✓ sent'
              : phase === 'capturing'
                ? 'capturing — pause to send'
                : 'listening…';
          return (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                minWidth: 0,
                maxWidth: 380,
                fontSize: chrome.font.body,
                color: hasPartial ? chrome.color.text : chrome.color.textFaint,
                fontStyle: hasPartial ? 'normal' : 'italic',
              }}
              data-testid="voice-partial"
              data-capture-phase={phase}
            >
              <span
                aria-hidden
                style={{
                  flexShrink: 0,
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: dotColor,
                  animation:
                    phase === 'capturing' ? 'voicePulse 1.4s ease-in-out infinite' : 'none',
                }}
              />
              <span style={{ flexShrink: 0, fontStyle: 'normal', fontWeight: 500 }}>{label}</span>
              {hasPartial && (
                <span
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    color: chrome.color.textMuted,
                  }}
                >
                  {voice.partial}
                </span>
              )}
            </span>
          );
        })()}

      {/* Token-mint 503 (no OPENAI_API_KEY) and other connection failures land
          here as a legible inline message, not just the indicator's tooltip. */}
      {errorMessage && (
        <span
          style={{
            fontSize: chrome.font.small,
            color: chrome.color.danger,
            maxWidth: 320,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={errorMessage}
          data-testid="voice-error"
        >
          {errorMessage}
        </span>
      )}
    </div>
  );
}
