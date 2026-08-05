/**
 * Demo entry point for @surface/cockpit.
 *
 * Acceptance checklist:
 *   [x] Cockpit renders a list + detail pane from items prop
 *   [x] j/k keyboard nav moves focus between items
 *   [x] Action keybinds fire onAction (Enter = keep, a = archive, d = defer)
 *   [x] setFocusedItem("msg-3") button demonstrates programmatic focus
 *   [x] Action log panel shows each onAction call with itemId + actionId
 *   [x] cockpitBus focused-item subscriber proves bus events fire on focus change
 */
import './styles.css';
import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Cockpit } from '../src/index.js';
import { FOCUSED_ITEM_EVENT, cockpitBus, useCockpit, useCockpitKeys } from '@surface/cockpit';

// --- Sample data -----------------------------------------------------------

/** The demo's own item shape — the engine only requires `id`; title/body are the
 *  display fields this demo maps in via `mapItem`. */
interface DemoItem {
  id: string;
  title: string;
  body: string;
}

const ITEMS: DemoItem[] = [
  {
    id: 'msg-1',
    title: 'Re: schedule for next week',
    body: 'Just checking in — does Tuesday still work for you? Happy to move it if not.',
  },
  {
    id: 'msg-2',
    title: 'Quote for the rewire',
    body: 'Hi, attached is the quote for the rewire. Let me know if you have questions.',
  },
  {
    id: 'msg-3',
    title: 'Dentist appointment confirmed',
    body: '<p>Your <strong>cleaning</strong> is confirmed for <em>June 5 at 10am</em>.</p><p>Please bring your insurance card and arrive 15 minutes early.</p>',
  },
  {
    id: 'msg-4',
    title: 'Dinner Thursday?',
    body: 'Are you free Thursday evening? A few of us are heading to that new Thai place on Main St.',
  },
  {
    id: 'msg-5',
    title: 'Invoice #4021',
    body: 'Please find attached invoice #4021 for $1,200. Payment is due within 30 days.',
  },
];

const ACTIONS = [
  { id: 'keep', label: 'Keep', keybind: 'Enter' },
  { id: 'archive', label: 'Archive', keybind: 'a' },
  { id: 'defer', label: 'Defer', keybind: 'd' },
];

// --- App -------------------------------------------------------------------

interface LogEntry {
  ts: number;
  message: string;
}

function App() {
  const [log, setLog] = useState<LogEntry[]>([]);
  const [busLog, setBusLog] = useState<string[]>([]);

  const addLog = useCallback((message: string) => {
    setLog((prev) => [{ ts: Date.now(), message }, ...prev].slice(0, 20));
  }, []);

  // Demonstrate programmatic setFocusedItem via useCockpit directly.
  const engine = useCockpit({
    items: ITEMS,
    actions: ACTIONS,
    onAction: (actionId, itemId) => {
      addLog(`onAction: ${actionId} on ${itemId}`);
    },
  });
  const { setFocusedItem } = engine;

  // Wire keyboard nav via the engine's key→intent resolver (same resolver the
  // shipped <Cockpit> uses). The default keymap gives j/k nav plus the numeric
  // and named action keybinds (Enter/a/d) over `window`.
  useCockpitKeys(engine, {});

  // Subscribe to the bus to demonstrate cross-library coordination.
  useEffect(() => {
    const off = cockpitBus.on(FOCUSED_ITEM_EVENT, (id) => {
      setBusLog((prev) => [`focused-item: ${id ?? 'null'}`, ...prev].slice(0, 10));
    });
    return off;
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#09090b' }}>
      {/* Top bar */}
      <div
        style={{
          flexShrink: 0,
          padding: '8px 16px',
          borderBottom: '1px solid #27272a',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: '#d4d4d8' }}>
          @surface/cockpit demo
        </span>
        <button
          type="button"
          onClick={() => {
            setFocusedItem('msg-3');
            addLog('setFocusedItem("msg-3") called programmatically');
          }}
          style={{
            fontSize: 11,
            padding: '4px 8px',
            borderRadius: 4,
            background: '#065f46',
            color: '#d1fae5',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          Focus msg-3 programmatically
        </button>
        <span style={{ fontSize: 11, color: '#71717a' }}>
          j/k to navigate · Enter/a/d for actions
        </span>
      </div>

      {/* Two-pane area + log sidebar */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Cockpit — takes up most of the space */}
        <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
          <Cockpit
            items={ITEMS}
            actions={ACTIONS}
            mapItem={(it) => ({ title: it.title, body: it.body })}
            onAction={(actionId, itemId) => {
              addLog(`onAction: ${actionId} on ${itemId}`);
            }}
          />
        </div>

        {/* Log sidebar */}
        <aside
          style={{
            width: 256,
            flexShrink: 0,
            borderLeft: '1px solid #27272a',
            display: 'flex',
            flexDirection: 'column',
            fontSize: 11,
            color: '#a1a1aa',
            background: 'rgba(24, 24, 27, 0.5)',
          }}
        >
          <div
            style={{
              padding: '8px 12px',
              borderBottom: '1px solid #27272a',
              fontWeight: 600,
              color: '#d4d4d8',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              fontSize: 10,
            }}
          >
            Bus events (focused-item)
          </div>
          <ul
            style={{
              flex: 'none',
              padding: '8px 12px',
              margin: 0,
              listStyle: 'none',
              borderBottom: '1px solid #27272a',
            }}
          >
            {busLog.length === 0 ? (
              <li style={{ color: '#52525b', fontStyle: 'italic' }}>none yet</li>
            ) : (
              busLog.map((entry, i) => (
                <li key={i} style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>
                  {entry}
                </li>
              ))
            )}
          </ul>
          <div
            style={{
              padding: '8px 12px',
              borderBottom: '1px solid #27272a',
              fontWeight: 600,
              color: '#d4d4d8',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              fontSize: 10,
              marginTop: 8,
            }}
          >
            onAction log
          </div>
          <ul
            style={{
              flex: 1,
              overflow: 'auto',
              padding: '8px 12px',
              margin: 0,
              listStyle: 'none',
            }}
          >
            {log.length === 0 ? (
              <li style={{ color: '#52525b', fontStyle: 'italic' }}>no actions yet</li>
            ) : (
              log.map((entry) => (
                <li key={entry.ts} style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>
                  {entry.message}
                </li>
              ))
            )}
          </ul>
        </aside>
      </div>
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('No #root element found');
createRoot(root).render(<App />);
