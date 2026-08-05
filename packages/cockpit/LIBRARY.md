# @surface/cockpit — Library Helper Doc

Read this to configure the cockpit library in a surface manifest. This is the only doc a managing agent needs.

## What it does

Renders a two-pane list+detail UI with keyboard navigation and per-item action affordances. Publishes `focused-item` events on a shared bus when focus changes. Exports a programmatic `setFocusedItem(id)` API for back-channel focus control.

## v0 exports

```ts
useCockpit({ items, actions, onAction, bus? })  // headless hook
<Cockpit />                                // self-contained two-pane component (inline-styled)
setFocusedItem(id)                         // returned by useCockpit
cockpitBus                                 // shared event bus singleton (the DEFAULT channel)
createCockpitBus()                         // mint an independent bus (opt-in scoping)
FOCUSED_ITEM_EVENT                         // 'focused-item' (bus key constant)
```

## Styling: zero setup, no CSS to import

`<Cockpit />` is styled entirely with **inline styles**. There is no stylesheet
to import, no Tailwind to configure, no build step to run over the library. Mount
the component and it renders correctly — the same self-contained precedent the
voice library's `VoiceIndicator` follows. A consuming app needs no styling setup
of any kind for cockpit to look right.

If you use the headless `useCockpit` hook instead of `<Cockpit />`, you render
the panes yourself and style them however you like — the hook ships no styling
at all.

## Item shape

```ts
interface CockpitItem {
  id: string;
  title: string;         // shown in list sidebar
  body: string;          // shown in detail pane; may be HTML or plain text
  meta?: Record<string, unknown>;  // passed through unchanged; cockpit ignores it
}
```

## Action shape

```ts
interface CockpitAction {
  id: string;
  label: string;
  keybind?: string;   // single-character or 'Enter'; case-insensitive
}
```

When the user invokes an action, cockpit calls `onAction(actionId, itemId)`. It does NOT submit to surface directly — that's the consuming app's job.

## Keyboard nav (always active)

| Key | Effect |
|-----|--------|
| `j` | Focus next item |
| `k` | Focus previous item |
| `1`–`9` | Invoke the nth action (1-indexed) |
| action's `keybind` | Invoke that action on the focused item |

Keys are suppressed when DOM focus is inside an `input`, `textarea`, `select`, or a
`contenteditable` region. Editability is inherited, so a plain `<span>` inside a
`<div contenteditable>` suppresses too; a nested `contenteditable="false"` opts back
out (nearest declaration wins). Modified chords (meta/ctrl/alt) are never intercepted.

If you run your own key listener alongside the cockpit's, apply the same rule rather
than re-deriving it:

```ts
import { eventOrigin, isTextEntryTarget } from '@surface/cockpit';

window.addEventListener('keydown', (e) => {
  if (isTextEntryTarget(eventOrigin(e))) return;   // user is typing — hands off
  // …your own shortcut
});
```

Shadow DOM is handled: events crossing a shadow boundary are retargeted to the host,
so `e.target` cannot see a field inside a shadow root — `eventOrigin(e)` reads the
true origin from `e.composedPath()[0]` and falls back to `e.target` when there is no
path. The cockpit's own guard uses it, and so should yours (as above).

## Shared bus contract

The bus is a tiny typed pub/sub singleton exported as `cockpitBus`. It is NOT coupled to voice — voice imports the bus, cockpit does not import voice.

```ts
import { cockpitBus, FOCUSED_ITEM_EVENT } from '@surface/cockpit/bus';

// Subscribe (e.g. in the voice library's setCorrelationId wiring):
const off = cockpitBus.on(FOCUSED_ITEM_EVENT, (itemId: string | null) => {
  voiceHandle.setCorrelationId(itemId);
});

// Teardown:
off();
```

Cockpit publishes `focused-item` with the focused item's `id` (a string) or `null` when the list is empty. The event fires on every focus change, including programmatic ones via `setFocusedItem`.

### When to scope the bus (and when not to)

`cockpitBus` is one **global** channel. That is the right default: a subscriber
needs no reference to anything to hear focus changes, which is why voice's
correlation wiring, the composition runtime, and the demos all just import it.

It is the **wrong** channel as soon as a page mounts two independent cockpits.
Both publish `focused-item` to the same singleton, so a subscriber cannot tell
which cockpit moved and the last-touched one stamps everyone's correlation.

The decision rule:

| Page has… | Use |
|---|---|
| one cockpit (the overwhelmingly common case) | nothing — the singleton, by default |
| two+ cockpits, but only one is voice-correlated | nothing; scope the *other* one if its emissions are noise |
| two+ cockpits that each need their own voice correlation | one `createCockpitBus()` per cockpit |
| a cockpit that must publish to nobody | its own `createCockpitBus()` with no subscriber |

Scoping is **opt-in and additive**. Pass no `bus` and behaviour is byte-for-byte
what it was: the singleton. That default is load-bearing, not incidental — every
existing subscriber (including two downstream apps consuming these packages
through a `file:` dep) subscribes to the singleton *by import*, so a private-bus
default would silently kill focus correlation everywhere with no error and no type
failure. `packages/composition/src/cockpit-bus-scope.test.tsx` pins it.

```ts
import { createCockpitBus, useCockpit, FOCUSED_ITEM_EVENT } from '@surface/cockpit';

// Module scope (or useMemo / a ref) — the reference MUST be stable across
// renders; subscribers hold the instance they subscribed to, so re-minting a bus
// per render silently orphans them.
const inboxBus = createCockpitBus();
const tabsBus = createCockpitBus();

useCockpit({ items, actions, onAction, bus: inboxBus });
inboxBus.on(FOCUSED_ITEM_EVENT, (id) => inboxVoice.setCorrelationId(id));
```

Nothing crosses between instances: an emission on `inboxBus` reaches only
`inboxBus` subscribers — not `tabsBus`, and not the singleton.

**Display tier (`@surface/cockpit-ui`).** `<CockpitProvider bus={…}>` and
`<Cockpit bus={…}>` take the same option and thread it to their engine. A provider
also publishes its resolved bus on context, so a piece inside the arrangement
subscribes without naming a channel:

```tsx
import { useCockpitBus } from '@surface/cockpit-ui';
import { FOCUSED_ITEM_EVENT } from '@surface/cockpit';

const bus = useCockpitBus();   // this provider's bus; the singleton if there is none
useEffect(() => bus.on(FOCUSED_ITEM_EVENT, setCorrelationId), [bus]);
```

Prefer `useCockpitBus()` over importing `cockpitBus` inside a component — the
import is correct only while the page has exactly one cockpit, and it is the line
you would have to find and change later.

**Manifest-wired pages.** The composition runtime's `applyWiring` takes the bus as
an optional third argument, defaulting to the singleton — so a manifest-wired page
scopes exactly the way hand-wired code does. Scope **both halves** with the same
instance: the mount that publishes, and the wiring that listens.

```ts
const inboxBus = createCockpitBus();

<CockpitMount config={cockpitConfig} onAction={onAction} mapItem={mapItem} bus={inboxBus} />;
applyWiring(MANIFEST.wiring, handles, inboxBus);
```

Scoping only one half is **silent**, not an error — a bus with no publisher is a
legitimate state, so the wiring simply never fires. `packages/composition/src/wiring-bus-scope.test.tsx`
pins that, along with the singleton default and the two-composition isolation.

There is still exactly ONE event name (`focused-item`). Scoping adds channels, not
events; multi-event bus design stays out of scope for v0.

## Surface manifest wiring (example)

```json
{
  "libraries": [
    {
      "name": "cockpit",
      "config": {
        "items": [
          { "id": "msg-7", "title": "Re: schedule for next week", "body": "Just checking in…" }
        ],
        "actions": [
          { "id": "keep",    "label": "Keep",    "keybind": "Enter" },
          { "id": "archive", "label": "Archive", "keybind": "a" },
          { "id": "defer",   "label": "Defer",   "keybind": "d" }
        ]
      }
    },
    {
      "name": "voice",
      "config": { "tokenProvider": "/api/realtime/token" }
    }
  ],
  "wiring": [
    { "on": "focused-item", "call": "voice.setCorrelationId" }
  ]
}
```

The `wiring` block is interpreted by the surface runtime. Cockpit does not know about voice; voice does not know about cockpit.

## Using cockpit without voice

Voice is not required. Omit the voice library and the wiring block:

```json
{
  "libraries": [
    {
      "name": "cockpit",
      "config": {
        "items": [ … ],
        "actions": [ { "id": "pick", "label": "Pick", "keybind": "Enter" } ]
      }
    }
  ]
}
```

## Programmatic focus (setFocusedItem)

```tsx
const { setFocusedItem, focusedItem } = useCockpit({ items, actions, onAction });

// Callable from anywhere — e.g. a surface back-channel message in v1:
setFocusedItem('msg-3');
```

Calling `setFocusedItem` with an unknown id is a no-op. It also publishes `focused-item` on the bus, so the voice library tracks it automatically.

## HTML body sanitization

Bodies that contain HTML tags are sanitized via DOMPurify before rendering. Plain-text bodies skip sanitization and render inside a `whitespace-pre-wrap` container. The managing agent does not need to pre-sanitize HTML; cockpit handles it.

## Build output

`dist/` contains ESM + type declarations. Import via:

```ts
import { Cockpit, useCockpit, cockpitBus, FOCUSED_ITEM_EVENT } from '@surface/cockpit';
import { cockpitBus, FOCUSED_ITEM_EVENT } from '@surface/cockpit/bus'; // bus-only import
```

No bundler lock-in — standard ESM, works with Vite, webpack, esbuild, or plain `<script type="module">`. No CSS import — styling is inline (see above).

**Build order (workspace consumers):** `dist/` is gitignored, so a fresh clone
has no built library to import. Build it before a consumer can resolve
`@surface/cockpit`:

```
pnpm --filter @surface/cockpit build
```

In this repo's composition package this is automatic — its `pre*` scripts build
cockpit + voice before `triage`/`demo`/`build`/`typecheck`/`test` run, so a fresh
clone needs only `pnpm install` then `pnpm triage` (see the composition README).
