/**
 * Composition surface page.
 *
 * Renders whichever manifest `?example=` selects (default: `triage`, the dogfood
 * reading-queue example). All examples — the dogfood triage list and
 * the four design-brief worked examples — run through THIS one page + runtime;
 * only the manifest data differs.
 *
 * Hosts BOTH libraries on one surface page, driven by a manifest. Demonstrates:
 *   - cockpit list+detail with j/k nav + per-item actions
 *   - voice capture mounted alongside
 *   - the manifest's wiring[] edge connecting cockpit's `focused-item` bus event
 *     to voice.setCorrelationId, so the voice correlationId tracks focus
 *   - submissions stamped with itemId and POSTed
 *     to the surface server, which drains them in per-item buckets (?groupBy=item)
 *
 * The App is the consuming-app layer. It interprets the manifest by iterating
 * libraries, mounting each by name, registering imperative handles, and applying
 * the wiring through the runtime.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { chrome } from './tokens.js';
import { applyWiring, knownLibraryNames, SUPPORTED_LIBRARIES } from './runtime.js';
import type { HandleRegistry, LibraryHandle } from './runtime.js';
import { CockpitMount, VoiceMount } from './mounts.js';
import {
  actionSubmission,
  clearVoiceSubmission,
  postSubmission,
  sessionDoneSubmission,
  undoSubmission,
  voiceSubmission,
} from './submissions.js';
import { DetailRecovery } from './recovery-controls.js';
import { triageProgress, type TriageProgress } from './triage-progress.js';
import {
  Chip,
  ThemeToggle,
  themes,
  themeStorageKey,
  useResolvedTheme,
  type CockpitTheme,
  type DisplayItem,
  type ThemeName,
} from '@surface/cockpit-ui';
import { WORKED_EXAMPLES } from './manifest.examples.js';
import type { TriageItem } from './manifest.js';
import type { CockpitAction } from '@surface/cockpit';

/**
 * Which manifest to render. Selected by `?example=` so every example runs through
 * the SAME page + runtime (not parallel one-off pages):
 *   ?example=triage (default) — DOGFOOD: ~12-item reading queue
 *   ?example=email            — cockpit + voice, email bodies      (worked example 1)
 *   ?example=photo            — cockpit + voice, image bodies      (worked example 2)
 *   ?example=voiceOnly        — voice only, no cockpit            (worked example 3)
 *   ?example=silent           — cockpit only, no voice            (worked example 4)
 *
 * The composition layer below is unchanged across examples — it iterates the
 * manifest, mounts whatever libraries it names, and applies whatever wiring it
 * declares. Omitting a library from the manifest is all it takes to drop it; that
 * is what proves each library composes independently.
 */
const EXAMPLE_KEYS = Object.keys(WORKED_EXAMPLES) as Array<keyof typeof WORKED_EXAMPLES>;
function selectedExample(): keyof typeof WORKED_EXAMPLES {
  const fromUrl =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('example')
      : null;
  return fromUrl && fromUrl in WORKED_EXAMPLES
    ? (fromUrl as keyof typeof WORKED_EXAMPLES)
    : 'triage';
}

const SELECTED = selectedExample();
const MANIFEST = WORKED_EXAMPLES[SELECTED];

/**
 * An EXPLICIT cockpit theme forced via `?theme=<name>` (demos/screenshots). This
 * is the consumer side of the export-and-apply contract (design brief §3.1): the
 * app imports the exported `themes` record and applies the chosen theme at the
 * shared ancestor of the chrome + cockpit mount, so both re-skin as one. When set,
 * it OVERRIDES system-adaptive resolution and the toggle (precedence: explicit >
 * toggle > system). Absent/unknown → `null` = system-adaptive default.
 */
function explicitTheme(): CockpitTheme | null {
  const fromUrl =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('theme')
      : null;
  return fromUrl && fromUrl in themes ? themes[fromUrl as ThemeName] : null;
}

const EXPLICIT_THEME = explicitTheme();
// Persist the toggle choice PER SURFACE (per worked-example manifest) so different
// surfaces don't clobber each other's light/dark preference.
const THEME_STORAGE_KEY = themeStorageKey(SELECTED);

// Focused-row rail colors while voice is live — a talk/wait signal on the item:
//   GO   (green): talk freely (including WHILE you're talking about this item).
//   WAIT (amber): you've moved to a DIFFERENT item while your last utterance
//          hasn't committed yet — let it land before talking here, or the next
//          thing glues onto the previous item. Amber is the
//          "switched too soon" warning, not "a segment exists".
const VOICE_GO = '#3f9655';
const VOICE_WAIT = '#d98324';

interface SentRow {
  ts: number;
  affordanceId: string;
  itemId?: string;
  value: unknown;
}

/**
 * One applied disposition, tracked so the "undo last" recovery affordance can
 * reverse it. `prevActionId` is the status the item carried BEFORE
 * this action, so undo restores the prior state rather than blindly un-marking.
 */
interface Disposition {
  itemId: string;
  actionId: string;
  /** The status this item had before actionId was applied (null = untriaged). */
  prevActionId: string | null;
}

/**
 * ─── Action semantics live HERE, in the consuming app — not in cockpit ───
 *
 * Cockpit is dumb: it renders a list, navigates with j/k, and calls onAction
 * with (actionId, itemId). It does NOT know what "add to cart" or "skip" mean —
 * that belongs to whoever wrote the manifest. So the in-list feedback (a triaged
 * row visibly changes) is produced HERE, driven ENTIRELY by the manifest's own
 * actions: applying an action folds its `marker` into the row title, and an
 * action flagged `sink` drops the row to the bottom. Swap the manifest's action
 * set (see manifest.triage.ts) and this reacts with no code changes; cockpit
 * gains zero new knowledge — it just re-renders the data it was handed. If this
 * needed a new cockpit capability, that would be the signal to stop — it doesn't.
 *
 * `marker` / `description` / `sink` are app-side fields the manifest's actions
 * may carry; cockpit only ever reads id/label/keybind off the same objects.
 */
type AppAction = CockpitAction & { marker?: string; description?: string; sink?: boolean };

/**
 * Fold the action applied to each item into the items cockpit renders. Pure
 * app-side data transform: prefix the title with the action's `marker` (falling
 * back to its label) and push items whose action is `sink` to the bottom so the
 * list visibly reorganizes as you triage. Cockpit renders the result verbatim —
 * it never learns what the prefix or the order means.
 */
function applyStatus(
  items: TriageItem[],
  applied: Record<string, string>,
  actions: AppAction[],
): TriageItem[] {
  const byId = new Map(actions.map((a) => [a.id, a] as const));
  const decorated = items.map((it) => {
    const action = byId.get(applied[it.id]);
    if (!action) return it;
    return { ...it, title: `${action.marker ?? action.label} · ${it.title}` };
  });
  // Stable partition: "sink" actions' items to the bottom, order preserved within.
  const sinks = new Set(actions.filter((a) => a.sink).map((a) => a.id));
  const active = decorated.filter((it) => !sinks.has(applied[it.id]));
  const sunk = decorated.filter((it) => sinks.has(applied[it.id]));
  return [...active, ...sunk];
}

/**
 * Map a triage item to what the cockpit DISPLAY renders. The engine holds items
 * opaquely (id only); this app-owned mapping supplies title/body/accent. Pure +
 * module-level so it's referentially stable. (Replaces the old direct
 * title/body/accent fields cockpit used to read off the item.)
 */
const mapTriageItem = (it: TriageItem): DisplayItem => ({
  title: it.title,
  body: it.body,
  accent: it.accent,
});

/**
 * Trim + drop empty/whitespace-only voice fragments (the phantom fragments) so
 * they neither inflate the row chip count nor clutter the detail notes block.
 * Presentation hygiene — same filter the old foldAnnotations applied, now at the
 * slot boundary instead of crammed into the item strings.
 */
function realNotes(notes: string[] | undefined): string[] {
  return (notes ?? []).map((n) => n.trim()).filter((n) => n.length > 0);
}

/**
 * Compact mic/capture status mirrored INTO the item preview (detail pane), where
 * the eyes actually rest during triage — not just the top nav. It
 * replicates the focused-ROW rail's GO/WAIT semantics at the preview, so the
 * live/capturing signal is glanceable without looking up to the header.
 *
 * Renders ONLY when voice is live AND this detail item is the one voice is
 * pointed at (`itemId === correlation`); otherwise null. States mirror the rail:
 *   - live, idle          → GREEN "🎤 listening"    (talk freely)
 *   - live, capturing here → GREEN "🎤 capturing…"   (a segment is in flight)
 *   - moved-while-pending  → AMBER "let last note land" (you switched to this item
 *       before the last utterance committed — the same WAIT warning the rail
 *       paints; when focus moves, `correlation` is the NEW item, so this shows on
 *       the item now in the preview).
 *
 * Pure function of its props — no memo, so it re-renders every time App hands it
 * fresh voiceLive / voiceBusy / correlation state (no stale closure).
 */
export function CaptureStatus({
  itemId,
  correlation,
  voiceLive,
  voiceBusy,
  captureStartItem,
}: {
  itemId: string;
  correlation: string | null;
  voiceLive: boolean;
  voiceBusy: boolean;
  captureStartItem: string | null;
}): ReactNode {
  // Only on the item voice is aimed at, and only while the mic is live.
  if (!voiceLive || correlation === null || itemId !== correlation) return null;
  // Same GO/WAIT split as the row rail (see the cockpitItems useMemo): amber only
  // when the last utterance is still in flight AND focus has moved off where it
  // started; green otherwise (idle-listening or capturing on this item).
  const movedWhilePending = voiceBusy && correlation !== captureStartItem;
  const state = movedWhilePending ? 'wait' : voiceBusy ? 'capturing' : 'listening';
  const color = movedWhilePending ? VOICE_WAIT : VOICE_GO;
  const label = movedWhilePending
    ? '⏳ let last note land'
    : voiceBusy
      ? '🎤 capturing…'
      : '🎤 listening';
  return (
    <span
      data-testid="preview-capture-status"
      data-capture-state={state}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        fontSize: chrome.font.small,
        fontWeight: 600,
        color,
        background: chrome.color.surfaceSunken,
        border: `1px solid ${color}`,
        borderRadius: chrome.radius.sm,
        padding: '3px 9px',
        whiteSpace: 'nowrap',
      }}
    >
      <span
        aria-hidden
        style={{
          flexShrink: 0,
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: color,
        }}
      />
      {label}
    </span>
  );
}

/**
 * True when the viewport is too narrow (<640px) to comfortably fit the fixed
 * 340px Activity sidebar beside the cockpit. A MINIMAL app-chrome responsive
 * adjustment (design brief §6): below the boundary the sidebar is dropped so the
 * cockpit — whose own narrow collapse already works — takes the full width and
 * the notes example stays usable on a phone. The Activity feed is the secondary
 * (submissions-debug) pane; the triage flow itself is unaffected. 640px matches
 * the cockpit library's own narrow boundary. Guarded for non-browser envs.
 */
function useNarrowViewport(): boolean {
  const query = '(max-width: 639px)';
  const hasMM = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function';
  const [narrow, setNarrow] = useState(() => (hasMM() ? window.matchMedia(query).matches : false));
  useEffect(() => {
    if (!hasMM()) return;
    const mql = window.matchMedia(query);
    const onChange = () => setNarrow(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return narrow;
}

export function App() {
  const narrowViewport = useNarrowViewport();
  // System-adaptive theme resolution for the whole page. The App is
  // the consumer that owns theme state here: it resolves prefers-color-scheme + the
  // persisted toggle choice (or an explicit `?theme=` override) into a CockpitTheme
  // and applies it at the page ancestor below, so the chrome AND the cockpit mount
  // re-skin as one. The cockpit itself is mounted with theme="inherit" so it reads
  // these vars rather than resolving its own. Live-updates on OS scheme change.
  const resolvedTheme = useResolvedTheme({
    storageKey: THEME_STORAGE_KEY,
    explicit: EXPLICIT_THEME,
  });
  const [sent, setSent] = useState<SentRow[]>([]);
  const [correlation, setCorrelation] = useState<string | null>(null);
  // True while the mic session is live. Drives a green accent rail on the
  // selected row so you can see, at the item, that voice is armed and pointed
  // here — a steady color (no flicker). The chrome caption keeps the finer
  // capturing / ✓-sent detail.
  const [voiceLive, setVoiceLive] = useState(false);
  // True while a voice segment is in flight (open / finalizing).
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Amber = "moved to a different item while the last utterance is still in
  // flight." Track the item an utterance STARTED on (captured when busy goes
  // true), and compare to the current focus. Refs so the busy-start handler reads
  // the live focus without re-subscribing.
  const correlationRef = useRef<string | null>(null);
  const voiceBusyRef = useRef(false);
  const captureStartItemRef = useRef<string | null>(null);
  useEffect(() => {
    correlationRef.current = correlation;
  }, [correlation]);
  const handleVoiceBusy = useCallback((busy: boolean) => {
    // On the false→true edge, the utterance is starting — anchor it to the item
    // focused right now (where speech began).
    if (busy && !voiceBusyRef.current) {
      captureStartItemRef.current = correlationRef.current;
    }
    voiceBusyRef.current = busy;
    setVoiceBusy(busy);
  }, []);
  // itemId -> the id of the last action applied to it (drives in-list feedback).
  const [itemStatus, setItemStatus] = useState<Record<string, string>>({});
  // itemId -> the voice notes spoken about it, oldest first. Folded
  // into the rendered items so an annotated row carries what was said about it.
  const [itemNotes, setItemNotes] = useState<Record<string, string[]>>({});

  // Applied-disposition history for the "undo last" recovery affordance
  // Each entry records the action applied AND the status the item
  // carried BEFORE it, so undo can restore the prior state (not just delete) —
  // an item re-dispositioned after an undo still reverses correctly. A stack:
  // undo pops the newest. Single-level is enough for what was asked, but a stack
  // costs nothing and lets him walk back several slips.
  const [dispositions, setDispositions] = useState<Disposition[]>([]);
  // Refs so the recovery callbacks read live state without re-subscribing (and
  // without stale closures over itemStatus / dispositions).
  const itemStatusRef = useRef(itemStatus);
  useEffect(() => {
    itemStatusRef.current = itemStatus;
  }, [itemStatus]);
  const dispositionsRef = useRef(dispositions);
  useEffect(() => {
    dispositionsRef.current = dispositions;
  }, [dispositions]);
  // Latest triage progress, mirrored into a ref so the (stable) session-done
  // handler can read it without re-subscribing. Kept current by an effect below,
  // once `progress` is computed.
  const progressRef = useRef<TriageProgress | null>(null);

  // Handle registry the wiring resolves against. Stable across renders.
  const handlesRef = useRef<HandleRegistry>(new Map());
  const wiringTeardownRef = useRef<(() => void) | null>(null);

  // Validate the manifest names only libraries we can mount (fail loud, early).
  useEffect(() => {
    const present = knownLibraryNames(MANIFEST);
    for (const name of present) {
      if (!SUPPORTED_LIBRARIES.includes(name as (typeof SUPPORTED_LIBRARIES)[number])) {
        throw new Error(`[composition] manifest names unsupported library "${name}"`);
      }
    }
  }, []);

  const recordSent = useCallback(
    (affordanceId: string, itemId: string | undefined, value: unknown) => {
      setSent((prev) => [{ ts: Date.now(), affordanceId, itemId, value }, ...prev].slice(0, 50));
    },
    [],
  );

  // Cockpit action → (1) update app-owned item status so the row visibly
  // changes, (2) emit the surface submission. The status update is the
  // app-driven in-list feedback; cockpit only told us "action X on item Y".
  const onAction = useCallback(
    (actionId: string, itemId: string) => {
      // Any action marks the item; how it looks (marker / sink) is resolved from
      // the manifest's action set at render time in applyStatus.
      const prevActionId = itemStatusRef.current[itemId] ?? null;
      setItemStatus((prev) => ({ ...prev, [itemId]: actionId }));
      // Push onto the undo stack, capturing the pre-action status so undo restores
      // it rather than blindly clearing.
      setDispositions((prev) => [...prev, { itemId, actionId, prevActionId }]);
      const env = actionSubmission(actionId, itemId);
      recordSent(env.affordanceId, env.itemId, env.value);
      void postSubmission(env).catch((e) => setSubmitError(String(e)));
    },
    [recordSent],
  );

  // ── Recovery affordances ───────────────────────────────────────
  // Clear the CURRENT item's captured voice so the operator can re-record — the
  // "capture went wrong, start over" ask. Re-record = clear + talk again (capture
  // is continuous while live), so no separate record control is needed. Drops the
  // local notes AND emits a compensating clear submission so the drain reflects
  // that the already-POSTed transcripts for this item were disowned.
  const clearVoice = useCallback(
    (itemId: string) => {
      setItemNotes((prev) => {
        if (!prev[itemId]) return prev;
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
      const env = clearVoiceSubmission(itemId);
      recordSent(env.affordanceId, env.itemId, env.value);
      void postSubmission(env).catch((e) => setSubmitError(String(e)));
    },
    [recordSent],
  );

  // Undo the most recent disposition — the "I wish I had an undo button"
  // after hitting Enter unintentionally. Reverts the local itemStatus for that
  // item (restoring whatever it was before, or un-marking it), pops the stack,
  // and emits an honest reversal submission (the original action was already
  // POSTed — undo can't un-send it, only compensate).
  const undoLastDisposition = useCallback(() => {
    const stack = dispositionsRef.current;
    if (stack.length === 0) return;
    const last = stack[stack.length - 1];
    setDispositions((prev) => prev.slice(0, -1));
    setItemStatus((prev) => {
      const next = { ...prev };
      if (last.prevActionId == null) delete next[last.itemId];
      else next[last.itemId] = last.prevActionId;
      return next;
    });
    const env = undoSubmission(last.actionId, last.itemId);
    recordSent(env.affordanceId, env.itemId, env.value);
    void postSubmission(env).catch((e) => setSubmitError(String(e)));
  }, [recordSent]);

  // Voice final → surface submission (itemId from correlationId).
  const onFinal = useCallback(
    (t: { text: string; correlationId: string | null }) => {
      const env = voiceSubmission(t.text, t.correlationId);
      recordSent(env.affordanceId, env.itemId, env.value);
      // Accumulate the note against its item so it renders inline on the row
      // Uncorrelated transcripts have no item to attach to.
      if (t.correlationId) {
        setItemNotes((prev) => ({
          ...prev,
          [t.correlationId as string]: [...(prev[t.correlationId as string] ?? []), t.text],
        }));
      }
      void postSubmission(env).catch((e) => setSubmitError(String(e)));
    },
    [recordSent],
  );

  // Page-level "session done" → surface submission. NOT item-scoped: a single
  // deliberate operator signal that the triage session is over, which a DRAINING
  // consuming agent interprets as "kick off your downstream processing" (e.g.
  // rebuild the review page). This repo only EMITS the signal — executing the
  // downstream work is the consuming agent's concern (design principle), and data
  // durability does not depend on this (every submission is already journaled).
  // Uses the SAME recordSent + postSubmission path as every other submission.
  const onSessionDone = useCallback(() => {
    const summary =
      progressRef.current && progressRef.current.total > 0
        ? { triaged: progressRef.current.triaged, total: progressRef.current.total }
        : undefined;
    const env = sessionDoneSubmission(summary);
    recordSent(env.affordanceId, env.itemId, env.value);
    void postSubmission(env).catch((e) => setSubmitError(String(e)));
  }, [recordSent]);

  // Register a library's imperative handle, then (re)apply wiring once present.
  const registerHandle = useCallback((name: string, handle: LibraryHandle) => {
    handlesRef.current.set(name, handle);
    // Re-apply wiring whenever a handle registers — idempotent: tear down prior.
    wiringTeardownRef.current?.();
    wiringTeardownRef.current = applyWiring(MANIFEST.wiring, handlesRef.current);
  }, []);

  const registerVoiceHandle = useCallback(
    (handle: LibraryHandle) => registerHandle('voice', handle),
    [registerHandle],
  );

  useEffect(() => () => wiringTeardownRef.current?.(), []);

  // Pull each library's config out of the manifest (typed narrowing).
  const cockpitConfig = MANIFEST.libraries.find((l) => l.name === 'cockpit')?.config as
    | { items: TriageItem[]; actions: CockpitAction[] }
    | undefined;
  const voiceConfig = MANIFEST.libraries.find((l) => l.name === 'voice')?.config as
    | { tokenProvider: string }
    | undefined;

  // The items cockpit renders, with app-owned triage status folded in. Cockpit
  // re-renders whenever this changes — that's the in-list feedback loop.
  const cockpitItems = useMemo(() => {
    if (!cockpitConfig) return [];
    const decorated = applyStatus(
      cockpitConfig.items,
      itemStatus,
      cockpitConfig.actions as AppAction[],
    );
    // Paint the focused row's accent rail while voice is live. Green by default
    // (talk freely); amber only when you've moved to a DIFFERENT item than the
    // one your still-uncommitted utterance started on — the "switched too soon,
    // let it land" warning. The accent rides on the item; the display reads it
    // through mapTriageItem. (Voice NOTES no longer ride on the item — they render
    // through the display's annotation slots; see the CockpitMount below.)
    if (voiceLive && correlation) {
      const movedWhilePending = voiceBusy && correlation !== captureStartItemRef.current;
      const accent = movedWhilePending ? VOICE_WAIT : VOICE_GO;
      return decorated.map((it) => (it.id === correlation ? { ...it, accent } : it));
    }
    return decorated;
  }, [cockpitConfig, itemStatus, voiceLive, voiceBusy, correlation]);

  // App-side triage progress. Drives the progress readout and the
  // "all triaged" completion state so reaching the end isn't a silent wraparound.
  // Cockpit stays unaware of "triaged" / "cleared" — this is app-owned, like applyStatus.
  const progress = useMemo(
    () => (cockpitConfig ? triageProgress(cockpitConfig.items, itemStatus) : null),
    [cockpitConfig, itemStatus],
  );
  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  return (
    <div
      style={{
        // Apply the resolved cockpit theme's `--cockpit-*` vars here, at the
        // shared ancestor of the chrome AND the cockpit mount, so both resolve
        // the same palette (export-and-apply contract, design brief §3.1). The
        // cast is the documented one-liner (cockpit-theme-typing.assert.tsx): this
        // repo's @types/react has closed `CSSProperties` typing with no `--*` index
        // signature, so a CockpitTheme needs `as CSSProperties` to sit in `style`.
        ...(resolvedTheme.theme as CSSProperties),
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        background: chrome.color.surface,
        fontFamily: chrome.font.family,
        color: chrome.color.text,
      }}
    >
      {/* Top bar: title, example nav, voice controls, correlation readout */}
      <header
        style={{
          flexShrink: 0,
          padding: `${chrome.space.sm} ${chrome.space.xl}`,
          borderBottom: `1px solid ${chrome.color.border}`,
          background: chrome.color.surfaceRaised,
          display: 'flex',
          alignItems: 'center',
          gap: chrome.space.xl,
        }}
      >
        <span
          style={{
            fontWeight: 650,
            color: chrome.color.ink,
            fontSize: 14,
            letterSpacing: '-0.01em',
          }}
        >
          surface{' '}
          <span style={{ color: chrome.color.accent }}>·</span> triage
        </span>

        <nav
          style={{
            display: 'flex',
            gap: chrome.space.xs,
            alignItems: 'center',
            background: chrome.color.surfaceSunken,
            borderRadius: chrome.radius.pill,
            padding: '3px',
          }}
        >
          {EXAMPLE_KEYS.map((key) => {
            const active = key === SELECTED;
            return (
              <a
                key={key}
                href={`?example=${key}`}
                style={{
                  fontSize: chrome.font.small,
                  fontWeight: active ? 600 : 500,
                  color: active ? chrome.color.accentText : chrome.color.textMuted,
                  background: active ? chrome.color.accent : 'transparent',
                  textDecoration: 'none',
                  padding: '4px 11px',
                  borderRadius: chrome.radius.pill,
                  transition: 'background 140ms, color 140ms',
                }}
              >
                {key}
              </a>
            );
          })}
        </nav>

        {voiceConfig && (
          <VoiceMount
            config={voiceConfig}
            onFinal={onFinal}
            onHandle={registerVoiceHandle}
            onCorrelationChange={setCorrelation}
            onLiveChange={setVoiceLive}
            onBusyChange={handleVoiceBusy}
          />
        )}

        {/* System/light/dark toggle. Hidden when an explicit `?theme=` overrides
            system-adaptive, since the toggle would be inert (precedence:
            explicit > toggle > system). */}
        {!resolvedTheme.explicitOverride && (
          <span style={{ marginLeft: 'auto' }}>
            <ThemeToggle mode={resolvedTheme.mode} onChange={resolvedTheme.setMode} />
          </span>
        )}

        <span
          style={{
            marginLeft: resolvedTheme.explicitOverride ? 'auto' : undefined,
            fontSize: chrome.font.small,
            color: chrome.color.textMuted,
            display: 'inline-flex',
            alignItems: 'center',
            gap: chrome.space.sm,
          }}
        >
          correlationId
          <code
            style={{
              fontFamily: chrome.font.mono,
              fontSize: chrome.font.micro,
              color: correlation ? chrome.color.accent : chrome.color.textFaint,
              background: chrome.color.surfaceSunken,
              border: `1px solid ${chrome.color.border}`,
              borderRadius: chrome.radius.sm,
              padding: '2px 7px',
            }}
            data-testid="correlation-readout"
          >
            {correlation ?? 'null'}
          </code>
        </span>

        {/* Page-level session-done affordance — the rightmost control. Ends the
            triage session and emits ONE page-level "done" submission a draining
            consumer acts on. Deliberately two-step (arm → confirm) so a stray
            click doesn't end the session; acknowledges on-screen once sent. */}
        <SessionDoneControl onDone={onSessionDone} />
      </header>

      {/* Keyboard legend — lives in the app chrome, not the cockpit library:
          the APP knows the full key set (j/k are cockpit-native nav; Enter/a/f
          are this manifest's app-defined affordances). Cockpit stays unaware. */}
      {cockpitConfig && (
        <div
          style={{
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            gap: chrome.space.lg,
            padding: `6px ${chrome.space.xl}`,
            borderBottom: `1px solid ${chrome.color.border}`,
            background: chrome.color.surfaceSunken,
            fontSize: chrome.font.small,
            color: chrome.color.textMuted,
            flexWrap: 'wrap',
          }}
          data-testid="keyboard-legend"
        >
          <span
            style={{
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              fontSize: chrome.font.micro,
              fontWeight: 600,
              color: chrome.color.textFaint,
            }}
          >
            Keys
          </span>
          <Legend keys={['j', 'k']} label="navigate" />
          {(cockpitConfig.actions as AppAction[]).map((a) => (
            <Legend
              key={a.id}
              keys={[a.keybind ?? '?']}
              label={a.label}
              hint={a.description}
            />
          ))}
          {voiceConfig && (
            <span style={{ color: chrome.color.textFaint }}>
              · speak while an item is focused to annotate it
            </span>
          )}
          {progress && progress.total > 0 && (
            <span
              style={{
                marginLeft: 'auto',
                fontSize: chrome.font.micro,
                fontWeight: 600,
                color: progress.allDone ? chrome.color.accent : chrome.color.textMuted,
                whiteSpace: 'nowrap',
              }}
              data-testid="triage-progress"
            >
              {progress.triaged} / {progress.total} triaged
            </span>
          )}
        </div>
      )}

      {/* Main: cockpit + sent-submissions sidebar */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {/* All-triaged completion state: the list still renders
              below (every row sunk + marked), but this banner answers "what do I
              do now?" instead of leaving the user to silently wrap focus. */}
          {progress?.allDone && (
            <div
              data-testid="triage-cleared"
              style={{
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                gap: chrome.space.sm,
                padding: `${chrome.space.sm} ${chrome.space.xl}`,
                background: chrome.color.accentSoft,
                borderBottom: `1px solid ${chrome.color.border}`,
                color: chrome.color.accent,
                fontSize: chrome.font.small,
                fontWeight: 600,
              }}
            >
              <span aria-hidden>✓</span>
              <span>
                Queue cleared — all {progress.total} items triaged.
              </span>
              <span style={{ fontWeight: 500, color: chrome.color.textMuted }}>
                Nothing left to review.
              </span>
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
            {cockpitConfig && (
              <CockpitMount
                config={{ items: cockpitItems, actions: cockpitConfig.actions }}
                onAction={onAction}
                mapItem={mapTriageItem}
                // The App resolves + applies the theme at the page ancestor above,
                // so the cockpit inherits those vars instead of resolving its own.
                theme="inherit"
                renderRowAside={(it) => {
                  const n = realNotes(itemNotes[it.id]);
                  return n.length ? <Chip label={`🎤 ${n.length}`} /> : null;
                }}
                renderDetailBefore={(it) => {
                  const n = realNotes(itemNotes[it.id]);
                  // Mic/capture status mirrored into the preview sits
                  // above the recovery toolbar + voice notes. Shows only when voice
                  // is live on THIS (focused/correlated) item; CaptureStatus returns
                  // null otherwise. The closure reads live voiceLive/voiceBusy/
                  // correlation each render (renderDetailBefore is re-created per
                  // render, so no stale closure); captureStartItemRef gives WAIT.
                  const showStatus =
                    voiceLive && correlation !== null && it.id === correlation;
                  // The recovery toolbar (clear-voice + undo) and the
                  // voice-notes <QuoteBlock> (design brief §3.4) both live inside
                  // DetailRecovery: the app owns the data (this item's notes, whether
                  // there's a disposition to reverse), the component owns styling.
                  return (
                    <>
                      {showStatus && (
                        <div style={{ marginBottom: chrome.space.sm }}>
                          <CaptureStatus
                            itemId={it.id}
                            correlation={correlation}
                            voiceLive={voiceLive}
                            voiceBusy={voiceBusy}
                            captureStartItem={captureStartItemRef.current}
                          />
                        </div>
                      )}
                      <DetailRecovery
                        notes={n}
                        onClearVoice={() => clearVoice(it.id)}
                        canUndo={dispositions.length > 0}
                        onUndo={undoLastDisposition}
                      />
                    </>
                  );
                }}
              />
            )}
          </div>
        </div>

        {/* Activity (submissions) sidebar — the secondary, debug-oriented pane.
            Dropped below ~640px (design brief §6) so the cockpit gets the full
            width and the notes example stays usable on a phone; the cockpit's own
            narrow collapse handles the primary triage flow. */}
        {!narrowViewport && (
        <aside
          style={{
            width: 340,
            flexShrink: 0,
            borderLeft: `1px solid ${chrome.color.border}`,
            display: 'flex',
            flexDirection: 'column',
            background: chrome.color.surfaceSunken,
          }}
        >
          <div
            style={{
              padding: `${chrome.space.md} ${chrome.space.lg} ${chrome.space.xs}`,
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
            }}
          >
            <span
              style={{
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                fontSize: chrome.font.micro,
                fontWeight: 600,
                color: chrome.color.textFaint,
              }}
            >
              Activity
            </span>
            <span style={{ fontSize: chrome.font.micro, color: chrome.color.textFaint }}>
              {sent.length} {sent.length === 1 ? 'submission' : 'submissions'}
            </span>
          </div>
          <div
            style={{
              padding: `0 ${chrome.space.lg} ${chrome.space.sm}`,
              fontSize: chrome.font.micro,
              color: chrome.color.textFaint,
              lineHeight: 1.4,
            }}
          >
            What got sent to surface — each triage action and voice note, newest
            first.
          </div>
          {submitError && (
            <div
              style={{
                margin: `0 ${chrome.space.lg} ${chrome.space.sm}`,
                padding: `${chrome.space.sm} ${chrome.space.md}`,
                color: chrome.color.danger,
                background: chrome.color.dangerSoft,
                border: `1px solid ${chrome.color.dangerBorder}`,
                borderRadius: chrome.radius.md,
                fontSize: chrome.font.small,
              }}
            >
              {submitError}
            </div>
          )}
          <ul
            style={{
              listStyle: 'none',
              margin: 0,
              padding: `0 ${chrome.space.md} ${chrome.space.md}`,
              overflow: 'auto',
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              gap: chrome.space.sm,
            }}
          >
            {sent.length === 0 ? (
              <li
                style={{
                  padding: `${chrome.space.lg} ${chrome.space.md}`,
                  color: chrome.color.textFaint,
                  fontSize: chrome.font.small,
                  lineHeight: 1.5,
                }}
              >
                Nothing sent yet —{' '}
                {cockpitConfig
                  ? `press ${cockpitConfig.actions
                      .map((a) => a.keybind ?? '?')
                      .join(' / ')} on an item`
                  : 'act on an item'}
                {voiceConfig ? ', or speak while one is focused' : ''}.
              </li>
            ) : (
              sent.map((row) => (
                <li
                  key={row.ts}
                  style={{
                    background: chrome.color.surfaceRaised,
                    border: `1px solid ${chrome.color.border}`,
                    borderRadius: chrome.radius.md,
                    padding: `${chrome.space.sm} ${chrome.space.md}`,
                  }}
                  data-testid="sent-row"
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: chrome.space.sm,
                      marginBottom: '3px',
                    }}
                  >
                    <span
                      style={{
                        fontSize: chrome.font.body,
                        fontWeight: 600,
                        color: chrome.color.ink,
                      }}
                    >
                      {row.affordanceId}
                    </span>
                    <span
                      style={{
                        fontSize: chrome.font.micro,
                        fontFamily: chrome.font.mono,
                        color: chrome.color.accent,
                        background: chrome.color.accentSoft,
                        borderRadius: chrome.radius.sm,
                        padding: '1px 6px',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {row.itemId ?? 'ungrouped'}
                    </span>
                  </div>
                  <code
                    style={{
                      display: 'block',
                      fontSize: chrome.font.micro,
                      fontFamily: chrome.font.mono,
                      color: chrome.color.textMuted,
                      wordBreak: 'break-word',
                    }}
                  >
                    {JSON.stringify(row.value)}
                  </code>
                </li>
              ))
            )}
          </ul>
        </aside>
        )}
      </div>
    </div>
  );
}

/**
 * Page-level "Done" affordance for the app chrome (app-owned, not a library).
 *
 * Ending the session is deliberate, so this is TWO-STEP: the first click arms a
 * confirm ("End session?"), and only the confirm actually fires `onDone` (which
 * emits the page-level session-done submission). A stray single click can't end
 * the session. After firing it shows a persistent "session ended ✓" acknowledgement
 * so the operator has clear on-screen feedback that the done signal was sent. The
 * button stays clickable again afterward (re-sending is harmless — data safety does
 * not depend on it), which also lets the ack toggle back if they change their mind.
 */
function SessionDoneControl({ onDone }: { onDone: () => void }) {
  const [phase, setPhase] = useState<'idle' | 'confirming' | 'done'>('idle');

  const baseButton: CSSProperties = {
    fontFamily: 'inherit',
    fontWeight: 600,
    fontSize: chrome.font.small,
    padding: '5px 12px',
    borderRadius: chrome.radius.md,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  };

  if (phase === 'confirming') {
    return (
      <span
        style={{ display: 'inline-flex', alignItems: 'center', gap: chrome.space.sm }}
        data-testid="session-done-control"
      >
        <span style={{ fontSize: chrome.font.small, color: chrome.color.textMuted }}>
          End session?
        </span>
        <button
          type="button"
          onClick={() => {
            onDone();
            setPhase('done');
          }}
          data-testid="session-done-confirm"
          style={{
            ...baseButton,
            background: chrome.color.accent,
            border: `1px solid ${chrome.color.accent}`,
            color: chrome.color.accentText,
          }}
        >
          Confirm
        </button>
        <button
          type="button"
          onClick={() => setPhase('idle')}
          data-testid="session-done-cancel"
          style={{
            ...baseButton,
            fontWeight: 500,
            background: 'transparent',
            border: `1px solid ${chrome.color.border}`,
            color: chrome.color.textMuted,
          }}
        >
          Cancel
        </button>
      </span>
    );
  }

  if (phase === 'done') {
    return (
      <span
        style={{ display: 'inline-flex', alignItems: 'center', gap: chrome.space.sm }}
        data-testid="session-done-control"
      >
        <span
          data-testid="session-done-ack"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            fontSize: chrome.font.small,
            fontWeight: 600,
            color: chrome.color.accent,
            background: chrome.color.accentSoft,
            border: `1px solid ${chrome.color.accent}`,
            borderRadius: chrome.radius.md,
            padding: '4px 11px',
          }}
        >
          <span aria-hidden>✓</span> session ended
        </span>
        <button
          type="button"
          onClick={() => setPhase('confirming')}
          data-testid="session-done-button"
          title="Send the session-done signal again."
          style={{
            ...baseButton,
            fontWeight: 500,
            background: 'transparent',
            border: `1px solid ${chrome.color.border}`,
            color: chrome.color.textMuted,
          }}
        >
          Done again
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setPhase('confirming')}
      data-testid="session-done-button"
      title="End the triage session and signal the consumer to run downstream processing."
      style={{
        ...baseButton,
        background: chrome.color.surfaceRaised,
        border: `1px solid ${chrome.color.borderStrong}`,
        color: chrome.color.text,
      }}
    >
      Done
    </button>
  );
}

/**
 * One key-hint in the keyboard legend (chrome-only, app-owned). Shows the
 * keybind chip + the action label, plus — when the manifest's action carries a
 * `description` — a faint one-line explanation of what the action means, so the
 * verbs aren't opaque. `title` mirrors it as a hover tooltip.
 */
function Legend({ keys, label, hint }: { keys: string[]; label: string; hint?: string }) {
  return (
    <span
      style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
      title={hint ? `${label} — ${hint}` : undefined}
    >
      {keys.map((k) => (
        <kbd
          key={k}
          style={{
            fontFamily: chrome.font.mono,
            fontSize: chrome.font.micro,
            lineHeight: 1,
            padding: '2px 6px',
            borderRadius: chrome.radius.sm,
            background: chrome.color.surfaceRaised,
            border: `1px solid ${chrome.color.borderStrong}`,
            color: chrome.color.text,
          }}
        >
          {k}
        </kbd>
      ))}
      <span>{label}</span>
      {hint ? (
        <span style={{ color: chrome.color.textFaint }}>— {hint}</span>
      ) : null}
    </span>
  );
}
