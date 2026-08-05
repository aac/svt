/**
 * UNRESTRAINED HEADLESS DEMO — "Triage Orbit"
 * ============================================================================
 * A consumer-authored renderer that draws the triage queue as an orbital
 * mission-control console: a rotating constellation of item-nodes around a
 * glowing detail core. It looks NOTHING like the shipped two-pane <Cockpit>.
 *
 * The entire point of this file: it imports ONLY the headless engine
 * (@surface/cockpit) and NOTHING from @surface/cockpit-ui. Every pixel below is
 * bespoke — but focus, navigation, action dispatch, and the focused-item bus
 * are all the *real shipped engine*, driven through its public contract:
 *
 *   useCockpit()      → focusedIndex / focusedItem / setFocusedItem / invokeAction
 *   useCockpitKeys()  → a CUSTOM keymap (arrows + wasd + Enter) over the same engine
 *   cockpitBus        → the same 'focused-item' bus the voice library subscribes to
 *
 * If the styling boundary were real ("locked into predetermined styling"), this
 * page could not exist. It does. That's the demonstration.
 * ============================================================================
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  useCockpit,
  useCockpitKeys,
  cockpitBus,
  FOCUSED_ITEM_EVENT,
  type Keymap,
} from '@surface/cockpit';

/* ── The sample triage queue — ordinary data, rendered in a wildly
   non-default skin. ────────────────────────────────────────────────────────*/
interface TriageItem {
  id: string;
  title: string;
  glyph: string;
  aside?: string;
  body: string;
}

const SEED: TriageItem[] = [
  {
    id: 'ssl',
    title: 'Renew SSL cert — api.example.com expires Sunday',
    glyph: '🔒',
    aside: 'DUE',
    body:
      'The TLS certificate for api.example.com expires in 3 days. Auto-renewal failed twice this week — the ACME challenge can’t reach the validation endpoint behind the new WAF rule. Either roll back the WAF change or add an allowlist for the ACME path, then re-trigger the renewal.',
  },
  {
    id: 'deck',
    title: 'Re: Q3 board deck — needs your revenue numbers',
    glyph: '📊',
    body:
      'Priya has the narrative slides done but is blocked on the revenue build. She needs the net-new vs. expansion split for Q3 and the updated churn figure before Thursday’s dry run.',
  },
  {
    id: 'prs',
    title: '[GitHub] 4 pull requests awaiting your review',
    glyph: '🔀',
    body:
      'Four PRs have been waiting more than 48 hours, two of them blocking a release branch. Oldest is the auth-refactor PR (opened Monday).',
  },
  {
    id: 'costco',
    title: 'Costco membership auto-renewed — $65.00',
    glyph: '🧾',
    body:
      'Your Gold Star membership renewed automatically. Receipt attached. No action needed unless you’re downgrading.',
  },
  {
    id: 'team-sync',
    title: 'Team sync notes: voice engine seam landed',
    glyph: '🎙️',
    body:
      'The engine/keymap seam merged overnight — 224 tests green. Next up is the mic-gated voice cluster and consumer dogfood.',
  },
];

const ACTIONS = [
  { id: 'keep', label: 'Keep', keybind: 'e', tone: '#4ade80', arc: '✦' },
  { id: 'archive', label: 'Archive', keybind: 'a', tone: '#60a5fa', arc: '⤓' },
  { id: 'snooze', label: 'Snooze', keybind: 's', tone: '#fbbf24', arc: '☾' },
];

/* A CUSTOM keymap — proof the keys are consumer-configurable. The shipped
   default is j/k; here rotation is on the arrows AND w/s, activate on Enter.
   (Numeric 1–3 → nth action is engine-owned and works regardless.) */
const ORBIT_KEYMAP: Keymap = {
  next: ['ArrowRight', 'ArrowDown', 'd', 's'],
  prev: ['ArrowLeft', 'ArrowUp', 'a', 'w'],
  activate: ['Enter', ' '],
};

interface Decision {
  n: number;
  action: string;
  tone: string;
  title: string;
}

interface BusPing {
  n: number;
  id: string | null;
}

function TriageOrbit() {
  // Consumer-owned list state. The engine never removes items — deciding an
  // item is the consuming app mutating its own state, exactly per the contract.
  const [items, setItems] = useState<TriageItem[]>(SEED);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [pings, setPings] = useState<BusPing[]>([]);
  const [flash, setFlash] = useState<Decision | null>(null);
  const decisionCount = useRef(0);
  const pingCount = useRef(0);

  // ── THE REAL HEADLESS ENGINE ──────────────────────────────────────────────
  const engine = useCockpit<TriageItem>({
    items,
    actions: ACTIONS,
    onAction: (actionId, itemId) => {
      const item = items.find((it) => it.id === itemId);
      const action = ACTIONS.find((a) => a.id === actionId);
      if (!item || !action) return;
      const d: Decision = {
        n: ++decisionCount.current,
        action: action.label,
        tone: action.tone,
        title: item.title,
      };
      setDecisions((prev) => [d, ...prev].slice(0, 8));
      setFlash(d);
      // Consumer-side removal: the decided item leaves the orbit; focus wraps
      // to whatever the engine now clamps to. Pure app state — not the engine.
      setItems((prev) => prev.filter((it) => it.id !== itemId));
    },
    onActivate: (itemId) => {
      // 'activate' just re-centers / pulses the focused node here.
      const item = items.find((it) => it.id === itemId);
      if (item) setFlash({ n: -1, action: 'Focused', tone: '#a78bfa', title: item.title });
    },
  });

  // The engine's key→intent resolver, over OUR keymap. Same resolver the
  // shipped <Cockpit> uses; different bindings.
  useCockpitKeys(engine, { keymap: ORBIT_KEYMAP });

  // Subscribe to the SAME bus the voice library listens on. Every focus change
  // the engine emits shows up here — visible proof of the cross-library seam.
  // A layout effect so we're attached BEFORE the engine's (passive) mount emit
  // fires — that way the very first focus lands in the monitor too.
  useLayoutEffect(() => {
    const off = cockpitBus.on(FOCUSED_ITEM_EVENT, (id) => {
      setPings((prev) => [{ n: ++pingCount.current, id }, ...prev].slice(0, 6));
    });
    return off;
  }, []);

  // Clear the transient decision flash.
  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), 1400);
    return () => window.clearTimeout(t);
  }, [flash]);

  const { items: live, focusedIndex, focusedItem } = engine;
  const n = live.length;

  const reset = () => {
    setItems(SEED);
    setDecisions([]);
    setFlash(null);
  };

  return (
    <div className="stage-root">
      <div className="constellation">
        <OrbitRing
          items={live}
          focusedIndex={focusedIndex}
          onDock={(id) => engine.setFocusedItem(id)}
        />
        <Core
          item={focusedItem}
          index={focusedIndex}
          total={n}
          flash={flash}
          onAction={(i) => engine.invokeAction(i)}
          onReset={reset}
          cleared={n === 0}
        />
      </div>

      <aside className="telemetry">
        <BusMonitor pings={pings} focusedId={focusedItem?.id ?? null} />
        <DecisionLog decisions={decisions} remaining={n} />
        <KeyLegend />
      </aside>
    </div>
  );
}

/* ── The orbital ring: item-nodes on a circle, focused node docked at 12 o'clock.
   Rotating focus animates every node to a new seat via CSS transitions. ─────*/
function OrbitRing({
  items,
  focusedIndex,
  onDock,
}: {
  items: TriageItem[];
  focusedIndex: number;
  onDock: (id: string) => void;
}) {
  const n = items.length;
  return (
    <div className="ring" aria-hidden={n === 0}>
      <svg className="ring-svg" viewBox="-200 -200 400 400" role="presentation">
        <defs>
          <radialGradient id="halo" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(129,140,248,.35)" />
            <stop offset="70%" stopColor="rgba(129,140,248,.05)" />
            <stop offset="100%" stopColor="rgba(129,140,248,0)" />
          </radialGradient>
        </defs>
        <circle cx="0" cy="0" r="185" className="orbit-path" />
        <circle cx="0" cy="0" r="150" fill="url(#halo)" />
        {/* the docking marker at 12 o'clock */}
        <g className="dock-marker">
          <path d="M0,-198 l-9,-16 l18,0 z" />
        </g>
        {/* sweep tick marks */}
        {Array.from({ length: 60 }).map((_, i) => {
          const a = (i / 60) * Math.PI * 2 - Math.PI / 2;
          const r0 = 178;
          const r1 = i % 5 === 0 ? 168 : 173;
          return (
            <line
              key={i}
              x1={Math.cos(a) * r0}
              y1={Math.sin(a) * r0}
              x2={Math.cos(a) * r1}
              y2={Math.sin(a) * r1}
              className="tick"
            />
          );
        })}
      </svg>

      {items.map((it, i) => {
        // Seat angle: focused item at -90° (top); others fan around the ring.
        const step = (Math.PI * 2) / Math.max(n, 1);
        const angle = (i - focusedIndex) * step - Math.PI / 2;
        const radius = 185;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        const focused = i === focusedIndex;
        const due = it.aside === 'DUE';
        return (
          <button
            key={it.id}
            type="button"
            className={
              'node' + (focused ? ' node--focused' : '') + (due ? ' node--due' : '')
            }
            style={{ transform: `translate(${x}px, ${y}px)` }}
            onClick={() => onDock(it.id)}
            title={it.title}
          >
            <span className="node-glyph">{it.glyph}</span>
            {due && !focused && <span className="node-pip" />}
          </button>
        );
      })}
    </div>
  );
}

/* ── The glowing core: the focused item's full detail + the action HUD. ──────*/
function Core({
  item,
  index,
  total,
  flash,
  onAction,
  onReset,
  cleared,
}: {
  item: TriageItem | null;
  index: number;
  total: number;
  flash: Decision | null;
  onAction: (i: number) => void;
  onReset: () => void;
  cleared: boolean;
}) {
  if (cleared) {
    return (
      <div className="core core--clear">
        <div className="clear-glyph">✧</div>
        <h2>Orbit clear</h2>
        <p>Every item triaged. The engine clamped focus to nothing and emitted a final null on the bus.</p>
        <button type="button" className="reset-btn" onClick={onReset}>
          ↺ Repopulate queue
        </button>
      </div>
    );
  }
  if (!item) return <div className="core" />;

  return (
    <div className="core">
      {flash && (
        <div className="flash" style={{ ['--flash' as string]: flash.tone }}>
          {flash.action === 'Focused' ? '◎ ' : '✓ '}
          {flash.action}
          {flash.n > 0 ? ` · #${flash.n}` : ''}
        </div>
      )}
      <div className="core-pos">
        <span className="core-glyph">{item.glyph}</span>
        <span className="core-counter">
          DOCKED · {index + 1}
          <span className="of">/ {total}</span>
        </span>
        {item.aside && <span className="core-badge">{item.aside}</span>}
      </div>
      <h2 className="core-title">{item.title}</h2>
      <p className="core-body">{item.body}</p>
      <div className="hud">
        {ACTIONS.map((a, i) => (
          <button
            key={a.id}
            type="button"
            className="hud-btn"
            style={{ ['--tone' as string]: a.tone }}
            onClick={() => onAction(i)}
          >
            <span className="hud-arc">{a.arc}</span>
            <span className="hud-label">{a.label}</span>
            <kbd className="hud-key">{i + 1}</kbd>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Live bus monitor: renders every 'focused-item' emission from cockpitBus. */
function BusMonitor({ pings, focusedId }: { pings: BusPing[]; focusedId: string | null }) {
  return (
    <section className="panel">
      <header className="panel-head">
        <span className="dot dot--live" />
        cockpitBus · <code>focused-item</code>
      </header>
      <p className="panel-note">
        The same headless bus the voice library subscribes to. Each focus change the
        engine emits lands here.
      </p>
      <ul className="ping-list">
        {pings.map((p) => (
          <li key={p.n} className={p.id === focusedId ? 'ping ping--current' : 'ping'}>
            <span className="ping-n">{String(p.n).padStart(2, '0')}</span>
            <span className="ping-arrow">→</span>
            <code className="ping-id">{p.id ?? 'null'}</code>
          </li>
        ))}
        {pings.length === 0 && <li className="ping ping--idle">awaiting focus…</li>}
      </ul>
    </section>
  );
}

/* ── Decision feed: proof the action affordances actually dispatch. ──────────*/
function DecisionLog({ decisions, remaining }: { decisions: Decision[]; remaining: number }) {
  return (
    <section className="panel">
      <header className="panel-head">
        <span className="dot" />
        decisions · <code>onAction</code>
        <span className="panel-count">{remaining} in orbit</span>
      </header>
      <ul className="dec-list">
        {decisions.map((d) => (
          <li key={d.n} className="dec">
            <span className="dec-tag" style={{ color: d.tone, borderColor: d.tone }}>
              {d.action}
            </span>
            <span className="dec-title">{d.title}</span>
          </li>
        ))}
        {decisions.length === 0 && <li className="dec dec--idle">nothing triaged yet</li>}
      </ul>
    </section>
  );
}

function KeyLegend() {
  return (
    <section className="panel panel--legend">
      <header className="panel-head">
        <span className="dot" />
        keymap · <code>useCockpitKeys</code>
      </header>
      <div className="legend-grid">
        <kbd>← →</kbd><span>rotate ring</span>
        <kbd>W / S</kbd><span>rotate ring</span>
        <kbd>1 2 3</kbd><span>keep / archive / snooze</span>
        <kbd>↵</kbd><span>pulse focus</span>
        <kbd>click</kbd><span>dock a node</span>
      </div>
      <p className="panel-note">
        A consumer keymap — the shipped default is <code>j/k</code>. Same resolver,
        different bindings.
      </p>
    </section>
  );
}

const root = document.getElementById('stage');
if (root) createRoot(root).render(<TriageOrbit />);
