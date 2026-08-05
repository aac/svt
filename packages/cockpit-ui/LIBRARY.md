# @surface/cockpit-ui — Library Helper Doc

Read this to render and style the cockpit UI. This is the display half of the
cockpit split: `@surface/cockpit` is the headless **engine** (state, keyboard
nav, action dispatch — zero pixels), and `@surface/cockpit-ui` is the default
**display** for it (owns every pixel).

There are three ways to consume this package, in rising order of custom-ness:

- **`<Cockpit>` — the pre-arranged worked example.** One component, two-pane
  list+detail, j/k keys, zero setup. It is a *convenience arrangement* of the
  pieces below, not the required frame — mount it when its layout fits.
- **The composable pieces — `CockpitProvider` + `CockpitList` / `CockpitDetail`.**
  Arrange the panes yourself (stacked, three-column, sidebar-swapped); they
  self-wire to one shared engine off context. Same styling as `<Cockpit>`,
  your layout.
- **Headless — skip this package entirely.** Render your own DOM off the engine's
  `useCockpit` from `@surface/cockpit` and own 100% of the pixels.

The contract this package realizes is *"iterate a list of items with these
affordances"* — **not** the two-pane layout or the j/k bindings. Those are the
shipped defaults, and every one of them is something you can rearrange, rebind,
or replace (see "The styling & replacement boundary" below for exactly what you
restyle vs. replace, and where the true no-lock-in path is).

## What it does

Renders the engine's item queue as a two-pane list + detail UI: a list sidebar
on the left, a detail pane on the right, with an action bar under the detail. It
maps each opaque engine item to what shows on screen, paints the focused-row
highlight the keyboard nav drives, sanitizes HTML bodies, collapses to a single
pane on narrow screens, and exposes a CSS-variable theming seam so a consuming
app can restyle it (and match its own surrounding chrome to it).

It owns styling only. It does not hold triage state, classify items, sort them,
or know what an action means — all of that is the engine's or the consuming
agent's job.

## Exports

```ts
import {
  // ── Pre-arranged component ──
  Cockpit,            // the two-pane list+detail display (a worked arrangement)

  // ── Composable layout: provider + promoted pieces ──
  CockpitProvider,    // holds ONE shared engine; pieces read it off context
  useCockpitContext,  // read the shared engine inside a provider (throws outside one)
  useCockpitBus,      // read the focused-item bus this provider publishes on
  CockpitList,        // the list pane, as a standalone piece
  CockpitDetail,      // the detail pane, as a standalone piece
  useResponsiveCollapse, // one-wire master-detail → single-pane collapse helper

  // ── Visual primitives ──
  Chip,               // small styled pill primitive
  QuoteBlock,         // labeled list of quoted lines primitive

  // ── Theming ──
  themes,             // { default, dark, paper, console } — applyable theme objects
  defaultTheme,       // same object as themes.default, exported standalone
  ThemeToggle,        // system/light/dark tri-state control (controlled)
  useResolvedTheme,   // resolve prefers-color-scheme + persisted toggle → CockpitTheme
  themeStorageKey,    // per-surface localStorage key builder
} from '@surface/cockpit-ui';

import type {
  CockpitProps,          // props of <Cockpit>
  CockpitProviderProps,  // props of <CockpitProvider>
  CockpitContextValue,   // the engine value carried on context (= UseCockpitResult)
  CockpitListProps,      // props of <CockpitList>
  CockpitDetailProps,    // props of <CockpitDetail>
  ResponsiveCollapse,    // { ref, isNarrow, view, onActivate, onBack }
  UseResponsiveCollapseOptions,
  CockpitDisplaySlots,   // the two slot render-props
  DisplayItem,           // { title, body, accent? } — what a row/detail shows
  ChipProps,
  QuoteBlockProps,
  CockpitVar,            // union of every '--cockpit-*' variable name
  CockpitTheme,          // Partial<Record<CockpitVar, string>>
  ThemeName,             // keyof typeof themes
} from '@surface/cockpit-ui';
```

The **keymap seam lives in the engine package**, not here — `defaultKeymap`,
`useCockpitKeys`, and the `Intent` / `Keymap` types are exported from
`@surface/cockpit` (see "The keymap seam" below). You pass a `keymap` to
`<Cockpit>` or `<CockpitProvider>` without importing anything; you import from
`@surface/cockpit` only for the `Keymap` *type* on your own map, or to drive keys
yourself in the headless tier:

```ts
import { useCockpit, useCockpitKeys, defaultKeymap } from '@surface/cockpit';
import type { Intent, Keymap } from '@surface/cockpit';
```

There is one entry point (`.`). React 18 or 19 is a peer dependency the consumer
provides.

## Zero-setup default look

`<Cockpit>` is styled with **inline styles plus one small scoped stylesheet it
injects itself**. There is no CSS file to import, no Tailwind to configure, no
build step to run over the library. Mount it and it renders the finished default
look:

```tsx
import { Cockpit } from '@surface/cockpit-ui';

<Cockpit
  items={items}                 // your domain items (opaque to the engine; must have an `id`)
  actions={actions}             // [{ id, label, keybind? }]
  onAction={(actionId, itemId) => { /* your call */ }}
  mapItem={(item) => ({ title: item.subject, body: item.html })}
/>
```

Every color, radius, shadow, and font it paints is a `--cockpit-*` CSS variable
with the default baked in as the fallback — so a bare mount with no theme set
renders the default, and setting variables on any ancestor restyles it (see
"Theming" below).

## How much of the display you take

How much of the display you take is a choice, from most-custom to least. The two
middle positions are new with the composable-layout work — before it, the only
options were "all of `<Cockpit>`" or "fully headless":

1. **Headless — draw your own panes.** Skip this package. Call `useCockpit` from
   `@surface/cockpit` and render whatever JSX you want off its
   `items / focusedIndex / focusedItem / setFocusedItem / next / prev / activate /
   invokeAction / actions`, optionally driving keys with `useCockpitKeys`. Full
   control, no styling from us. (This is the true no-lock-in path — see "The
   styling & replacement boundary".)
2. **Composable pieces — your arrangement, our styling.** Mount `CockpitProvider`
   and place `CockpitList` / `CockpitDetail` (and your own chrome) in any layout;
   they self-wire to one shared engine off context. You own the *arrangement*; the
   pieces keep the library's row/detail styling (tunable via tokens + slots). See
   "Composing the pieces yourself" below.
3. **Default display + slots — mostly ours, small inserts.** Mount `<Cockpit>`
   and inject your own nodes into two regions via `renderRowAside` and
   `renderDetailBefore` (below). The display owns layout and styling; you add
   content into spots it styles.
4. **Declarative — all ours.** Mount `<Cockpit>` with just `mapItem`. No custom
   JSX at all.

## Mapping items to what's shown (`mapItem` + `DisplayItem`)

The engine holds items as opaque objects keyed by `id`. The display learns what
to draw for each through `mapItem`, which returns a `DisplayItem`:

```ts
interface DisplayItem {
  title: string;    // list row + detail header
  body: string;     // detail pane; plain text OR HTML (sanitized on render)
  accent?: string;  // optional presentational state color (see below)
}
```

- **`body`** may be plain text or HTML. HTML is sanitized with DOMPurify before
  it renders and gets real typographic styling (headings, lists, links,
  blockquotes, code, tables) from a scoped stylesheet — you do not pre-sanitize
  or import any CSS. The list row shows a clean text preview with tags stripped.
- **`accent`** is a purely visual state hint. When set, the focused row's ground
  washes in that hue and a matching rail/top-bar paints it. The display has no
  idea what it means — a managing agent uses it for signals like the voice
  go/wait cue (green while recording, amber while it lands). Leave it unset and
  the row uses the calm default accent wash.

## Actions

```ts
interface CockpitAction {
  id: string;
  label: string;
  keybind?: string;   // single character or 'Enter'/'Escape'; case-insensitive
}
```

`actions` render as buttons in the detail action bar (the first reads as
primary — purely visual weight, not meaning). Invoking one calls
`onAction(actionId, itemId)`. The display does not submit anywhere itself; what
an action does is the consuming app's job.

## The two additive slots

```ts
interface CockpitDisplaySlots<T> {
  renderRowAside?: (item: T) => ReactNode;      // trailing region of a list row
  renderDetailBefore?: (item: T) => ReactNode;  // block above the detail body
}
```

Slots add your content into regions the display styles; they never override
layout (that's the headless tier). Two is the whole set — more are added only
when a real need appears, not pre-built. The intended pattern: a status chip in
the row aside, an annotations block above the detail body.

## Visual primitives: `<Chip>` and `<QuoteBlock>`

So slot (or headless) content matches the cockpit look without you reinventing
it, the display exports two styled, purely-visual primitives. Both read the same
`--cockpit-*` variables, so they re-theme with everything else. Neither carries
any domain meaning — you own what they say.

**`<Chip label tone? />`** — a small pill. `tone` is `'default'` (neutral) or
`'accent'` (uses the cockpit accent).

```tsx
<Chip label={`\u{1F3A4} ${count}`} tone="accent" />
```

**`<QuoteBlock label quotes />`** — a labeled list of quoted lines in a soft,
accent-tinted box. `label` is a short heading (a `ReactNode`); `quotes` is an
array of strings, each rendered on its own line inside typographic quotes.

```tsx
<QuoteBlock label="Voice notes" quotes={["keep this one", "follow up Monday"]} />
```

`<QuoteBlock>` exists because two of the three consumers had hand-rolled a
near-identical quoted-notes block; it's the shared, themeable version. It knows
nothing about "voice" or "notes" — it just renders quoted lines.

## Composing the pieces yourself (`CockpitProvider` + `CockpitList` / `CockpitDetail`)

`<Cockpit>` is a two-pane arrangement of `CockpitList` and `CockpitDetail`. Those
two panes are now **first-class exports**, so when the two-pane frame doesn't fit
you arrange them yourself — stacked, three-column, sidebar-swapped — instead of
being boxed into `<Cockpit>`. They keep the same styling; you own the layout.

**One shared engine via `CockpitProvider`.** Wrap your arrangement in
`<CockpitProvider items actions onAction>`. It calls the engine **once** and puts
the focus/dispatch state on React context; each piece reads it off
`useCockpitContext()` internally, so pieces stay in sync with no state threaded
between them. The provider's wrapper is `display: contents` — it adds no layout
box, so your JSX *is* the arrangement.

```tsx
import { CockpitProvider, CockpitList, CockpitDetail } from '@surface/cockpit-ui';

<CockpitProvider items={items} actions={actions} onAction={onAction}>
  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
    <CockpitDetail mapItem={mapItem} />   {/* detail first → stacked above */}
    <CockpitList mapItem={mapItem} />
  </div>
</CockpitProvider>
```

- **`CockpitProviderProps`** — `items`, `actions`, `onAction`, plus optional
  `onActivate(itemId)` (fired by the `activate` intent — e.g. a `keymap` binding
  `Enter`) and `keymap` (see "The keymap seam"). The provider also owns a
  **container-scoped** key listener (attached to its own root, not `window`), so
  two cockpits on one page never cross-fire — the one whose subtree holds focus
  gets the key.
- **`useCockpitContext()`** — read the shared engine (the full `useCockpit`
  result) inside your own component under a provider. It **throws** if called
  outside a `<CockpitProvider>` (fail-loud — a silent null-object would no-op
  every piece and hide the wiring bug).

**Two cockpits on one page: scope the bus too.** The container-scoped key listener
above stops keys cross-firing, but the `focused-item` **bus** is a separate seam
and defaults to the global singleton — so without opting in, two cockpits publish
to one channel and the last-touched one stamps everyone's voice correlation. Give
each one its own channel:

```tsx
import { createCockpitBus } from '@surface/cockpit';

const inboxBus = createCockpitBus();   // module scope / useMemo — must be STABLE
const tabsBus = createCockpitBus();

<CockpitProvider items={inbox} actions={actions} onAction={onAction} bus={inboxBus}>…</CockpitProvider>
<CockpitProvider items={tabs}  actions={actions} onAction={onAction} bus={tabsBus}>…</CockpitProvider>
```

- **`bus?`** on `CockpitProviderProps` (and on `CockpitProps`, threaded to the
  provider `<Cockpit>` mounts). Omit it and you get the module singleton
  `cockpitBus` — today's exact behaviour, which is what every existing subscriber
  listens to, so scoping is strictly opt-in.
- **`useCockpitBus()`** — the channel the enclosing provider is publishing on (the
  singleton when there is no provider, which is what such an engine publishes on,
  so it does not throw). Prefer it over importing `cockpitBus` inside a component:
  the import is only correct while the page has exactly one cockpit.

The decision rule for when to scope — and the manifest-wired form, where the same
instance goes to `<CockpitMount bus>` and to `applyWiring(wiring, handles, bus)` —
are in `packages/cockpit/LIBRARY.md` → "When to scope the bus".

**Context by default, props as the override.** Each piece defaults its engine
wiring to the context engine, so `<CockpitList mapItem={…}/>` self-wires under a
provider. Each *also* accepts explicit engine props as a prop-drill escape hatch
for a consumer **not** using a provider (this is the path `<Cockpit>` itself
uses):

- **`CockpitListProps`** — `mapItem` (required), `renderRowAside?`; override
  props `items?`, `focusedIndex?`, `onSelect?`. A resolved `items`/`onSelect` must
  come from *either* context or props, or the piece throws.
- **`CockpitDetailProps`** — provide `mapItem?` **or** a pre-mapped `display?`
  (the prop-drill form `<Cockpit>` uses; `display` wins when both are set);
  `renderDetailBefore?`; `onBack?` (renders the narrow-mode back affordance —
  always a prop, never sourced from the engine, since it's a view concern).

**Worked, runnable arrangements** — a stacked arrow-key example and a
collapsing master-detail example — live in
the worked arrangements in `packages/composition/src/example-arrangements.tsx`, backed by
`packages/composition/src/example-arrangements.tsx` (both driven end-to-end by
`example-arrangements.test.tsx`, using only public exports). Start there when you
build your own layout.

## Keyboard

Out of the box, keys work regardless of which element has focus:

| Key | Effect |
|-----|--------|
| `j` | Focus next item (the `next` intent) |
| `k` | Focus previous item (the `prev` intent) |
| `1`–`9` | Invoke the nth action (1-indexed) |
| an action's `keybind` | Invoke that action on the focused item |
| `Escape` | (narrow single-pane mode only) return from detail to the list |

Keys are ignored while DOM focus is inside an `input`, `textarea`, or `select`,
and modified chords (⌘/Ctrl/Alt) are never intercepted. The `Escape`-to-list
behavior yields if one of your actions binds `Escape`.

### The keymap seam — `j`/`k` is the shipped example, not the contract

Navigation keys are **consumer-configurable**. `j`/`k` come from `defaultKeymap`
(exported from `@surface/cockpit`), which is just the shipped *example* binding —
you rebind or silence it without any library change. Both `<Cockpit>` and
`<CockpitProvider>` take a `keymap` prop passed straight through to the engine's
resolver:

- **omitted** (`keymap` not passed) → `defaultKeymap` — the `j`/`k` example.
- **a `Keymap`** → replaces it. A `Keymap` is `Record<Intent, string[]>` over the
  fixed intent set `'next' | 'prev' | 'activate'`; each binding is an **array** of
  keys matched against `KeyboardEvent.key` (e.g. `'ArrowDown'`, `'Enter'`),
  case-insensitively. That is the entire key-config surface — no chords, no modes,
  no per-item bindings.

  ```tsx
  import type { Keymap } from '@surface/cockpit';
  const arrowKeys: Keymap = {
    next: ['ArrowDown', 'ArrowRight'],
    prev: ['ArrowUp', 'ArrowLeft'],
    activate: ['Enter'],
  };
  <CockpitProvider items={items} actions={actions} onAction={onAction} keymap={arrowKeys}>…</CockpitProvider>
  ```

- **`null`** → **disables the global key listener entirely.** One listener drives
  all global keys, so `keymap={null}` silences *everything at once* — nav (`j`/`k`),
  the numeric `1`–`9` positional keys, **and** the named `action.keybind` keys —
  because they share that listener. It means "the consumer is taking over the
  keyboard." Note what it does **not** silence: each `action.keybind` is still
  valid **data** — it still renders as a hint chip on the action button and still
  fires on click, and you can wire it to your own key handling. Only the
  library's global key→intent listener is switched off.

### Where the listener attaches — the `target` option

`target` is the headless tier's option, not a component prop. `<Cockpit>` and
`<CockpitProvider>` each own their attach point and expose no `target`:
`<Cockpit>` omits it, so its keys are global, and `<CockpitProvider>`
passes its own root element (the container-scoped listener described under
"Composing the pieces yourself"). You pick an attach point only when you call
`useCockpitKeys` from `@surface/cockpit` yourself.

It splits omitted from explicit `null` exactly the way `keymap` does:

| `target` | Where the `keydown` listener goes |
|---|---|
| **omitted** (`undefined`) | `window` — global keys, the shipped `<Cockpit>` posture |
| **`null`** (explicit) | nowhere — no listener is attached at all |
| **an `EventTarget`** | that element — it sees a key only while focus is inside it |

`null` means *off*, not *default*, and that matters because of the case that
produces it: a consumer holding a container element that hasn't mounted yet passes
`null` for one commit. Resolving that to `window` would hand it a global listener
it never asked for, so instead nothing is attached until the element arrives —
"I passed a target and got a window listener" is the surprise being avoided.
`packages/composition/src/cockpit-keys-target.test.tsx` pins all three rows.

Two things follow from attaching to an element:

- **Hand over the element itself, not a ref.** The listener re-binds when the
  `target` *identity* changes, so publish the element into state with a callback
  ref. A plain `useRef` never re-runs the effect, so the listener stays where it
  first bound — which, on the first commit, is nowhere.
- **A scoped listener fires only when focus is inside its subtree.** A `keydown`
  dispatches to the focused element and bubbles, so a container whose subtree
  never holds focus never sees a key. Make the container focusable
  (`tabIndex={-1}`) and focus it, or let the rows take focus.

```tsx
import { useCallback, useState } from 'react';
import { useCockpit, useCockpitKeys, type CockpitAction } from '@surface/cockpit';

type Msg = { id: string; title: string };

function ScopedList({
  items,
  actions,
  onAction,
}: {
  items: Msg[];
  actions: CockpitAction[];
  onAction: (actionId: string, itemId: string) => void;
}) {
  const engine = useCockpit({ items, actions, onAction });

  // Callback ref → state: the element identity is what re-binds the listener.
  const [rootEl, setRootEl] = useState<HTMLDivElement | null>(null);
  const attachRoot = useCallback((el: HTMLDivElement | null) => setRootEl(el), []);

  // `null` on the first commit → nothing attached; the container from then on.
  // Another cockpit elsewhere on the page keeps its own keys.
  useCockpitKeys(engine, { target: rootEl });

  return (
    <div ref={attachRoot} tabIndex={-1}>
      {engine.items.map((item, i) => (
        <div key={item.id} onClick={() => engine.setFocusedItem(item.id)}>
          {i === engine.focusedIndex ? '▸ ' : '  '}
          {item.title}
        </div>
      ))}
    </div>
  );
}
```

`keymap` and `target` are independent choices, but `keymap={null}` wins: it
attaches no listener regardless of what `target` says.

**Why `1`–`9` and named keybinds aren't in the keymap.** The keymap covers only
the fixed nav+activation intents. Positional `1`–`9` is over the variable-length
actions array, and named keybinds already live on each action object (their single
source of truth) — folding either into the keymap would split ownership. So the
resolver maps a numeric/named key → an action index → invoke, separately from the
keymap.

**Discoverability gap (mount it aware of this).** The display renders **no
built-in key legend**. It deliberately doesn't, because it can only ever know part
of the keyset — the nav keys you bound, not the action keys you define. If your
users need to see the keymap, render your own legend in your chrome. Both live
consumers already do.

## Responsive collapse

On a **narrow root element** (measured with a `ResizeObserver` on the component's
own width, threshold ~640px — element width, not viewport, because the cockpit is
embeddable and a narrow column on a wide desktop must collapse too), the two-pane
layout becomes one pane:

- `j`/`k` move focus and **stay in the list**;
- tapping/clicking a row opens that item's detail full-width;
- a "Back to list" affordance (and `Escape`) returns to the list;
- in the detail view, `j`/`k` advance through items in place (carousel-style —
  intended, not a bug).

On a wide element both panes always render, exactly as today.

This collapse is a **JavaScript progressive-enhancement layer** — it needs
scripting to run (the `ResizeObserver` and the view state). Without JavaScript,
the two-pane layout still renders: degraded on a phone, but functional. Theming,
by contrast, is fully declarative and works with no JavaScript at all (the
variables resolve at the CSS layer, so server-rendered and no-JS pages are
themed correctly).

### The same collapse in your own arrangement — `useResponsiveCollapse`

`<Cockpit>` gets the collapse for free. When you compose the pieces yourself (a
free-form master-detail), `useResponsiveCollapse` gives you the same behavior in
**one wire** instead of three (mount an observer + flip the view on activate +
thread a back handler). It observes the element's **own** inline-size (a narrow
column on a wide desktop still collapses) and returns a single object:

```tsx
import { CockpitProvider, CockpitList, CockpitDetail,
         useCockpitContext, useResponsiveCollapse } from '@surface/cockpit-ui';

function MasterDetail() {
  const engine = useCockpitContext();
  const { ref, isNarrow, view, onActivate, onBack } =
    useResponsiveCollapse({ onActivate: engine.setFocusedItem });

  const showList = !isNarrow || view === 'list';
  const showDetail = !isNarrow || view === 'detail';
  return (
    <div ref={ref} style={{ display: 'flex', gap: isNarrow ? 0 : '1rem' }}>
      {showList && <CockpitList mapItem={mapItem} onSelect={onActivate} />}
      {showDetail && <CockpitDetail mapItem={mapItem} onBack={isNarrow ? onBack : undefined} />}
    </div>
  );
}
```

The returned `ResponsiveCollapse` object:

- **`ref`** — attach to the element whose width gates the collapse.
- **`isNarrow` / `view`** — whether it's collapsed and which pane to show (`view`
  stays `'list'` and is inert while wide).
- **`onActivate(id)`** — focuses the item (via the `onActivate` option you passed,
  e.g. `engine.setFocusedItem`) **and**, when narrow, opens the detail. Wire it as
  the list's `onSelect`. Focus and activation stay separate: keyboard nav moves the
  cursor without opening the detail; a tap/click opens it.
- **`onBack()`** — return to the list; wire it as the detail's `onBack`. Inert
  while wide, so it's safe to leave wired.

On a wide container both panes render and there's no back affordance — the same
code, no branch you write. The hook is engine-independent (it owns only view/narrow
state); pass `setFocusedItem` as `onActivate` when you also want engine focus, or
omit it to use the hook purely for view state. The full runnable example is
arrangement 2 in `packages/composition/src/example-arrangements.tsx`.

## The styling & replacement boundary

The single most important thing to be honest about: **the styled pieces are not
"freely restyled."** You can *arrange* them freely and *re-skin* them within a
bounded seam, but reshaping them is not on the styled pieces — for that you drop to
the headless engine, which is the real no-lock-in path. There are three layers,
buying progressively more freedom at progressively more cost. The full write-up
(with the code evidence behind each claim) is
the composable-layout design work; this is the honest summary.

**Layer 1 — the token / theme seam (re-skin, no JSX).** Restyle every color,
radius, shadow, and font by setting `--cockpit-*` variables (the 22-variable
closed vocabulary in the "Theming" section below). Ship one of the four themes or
your own partial map on a shared ancestor. This goes a long way — the `paper`
(warm serif), `console` (mono phosphor terminal), and `dark` themes are visibly
different products from the same pieces, via data only. **Where it stops:** the
type scale (font sizes, weights, line-heights) and the spacing rhythm are
*deliberately withheld* from the seam — they're internal constants, not variables.
So the token seam **re-skins the pieces; it does not re-shape them.** You can't
change the two-line row height, the detail header padding, or the layout density
through it.

**Layer 2 — slots + `mapItem` (inject content, not structure).** Beyond color, the
pieces expose exactly three content hooks: `mapItem` (what text/accent each item
shows) and the two additive slots `renderRowAside` / `renderDetailBefore`. These
add *your* content into two fixed regions the pieces style; they never override the
row/detail **anatomy** (the row is a button with an accent rail, a title, and a
two-line preview; the detail is an accent bar, a header, a scrolling body, and an
action footer). Swappable: content and item text/accent. Fixed: the structure. To
change the anatomy you leave the styled pieces.

**Layer 3 — the headless engine (`@surface/cockpit`) — the true no-lock-in path.**
This is why "are consumers locked into cockpit's styling?" is **no**. `@surface/cockpit`
is a **separate, published, zero-pixel package**. Its `useCockpit` hands you the
whole state machine — `items / focusedIndex / focusedItem / setFocusedItem /
next / prev / activate / invokeAction / actions` — and owns none of the rendering;
`useCockpitKeys` adds keyboard (your bindings or none). Write your own rows, your
own detail, your own buttons, in any DOM / CSS framework / design system, and drive
them off those values. The styled pieces are themselves *just one renderer* built
on this same public engine — your renderer sits at the same level, not downstream
of theirs. `cockpitBus` / `FOCUSED_ITEM_EVENT` still publish the focused item so a
voice rail can correlate, with zero coupling back into any display.

**The boundary, stated once:**

- **Arrangement** of the styled pieces — free (put them anywhere; they self-wire
  via `CockpitProvider`).
- **Re-skinning** the styled pieces — free within the 22-variable token seam + the
  two slots + `mapItem`.
- **Re-shaping** them (structure, density, spacing, type scale) — **not** available
  on the styled pieces. That is the lock, and it's intrinsic to their being
  *styled* pieces.
- **Any styling at all** — optional. Drop to `@surface/cockpit` and own every pixel.

So the accurate phrasing is not "freely-arrangeable *and* freely-styled pieces."
It is: **freely-arrangeable styled pieces whose look is tunable through a token
seam and two slots, sitting on a headless engine that imposes no styling at all.**
Pick the layer that matches how far your look departs from the default — token
seam for a re-skin, slots for injected content, headless for a different product.

## Theming: the `--cockpit-*` seam

Everything the display paints comes from a CSS variable. Setting those variables
on any ancestor restyles the cockpit inside it. Two surfaces on one page can
carry different themes; `:root` themes the whole app.

### The variables (name, default, what it paints)

| Variable | Default | Paints |
|----------|---------|--------|
| `--cockpit-surface` | `#ffffff` | main pane background (detail pane, root) |
| `--cockpit-surface-sunken` | `#f6f7f9` | list sidebar, action bar, kbd chips, code blocks |
| `--cockpit-surface-raised` | `#ffffff` | secondary action buttons |
| `--cockpit-surface-hover` | `#eef0f3` | row hover wash, hovered secondary button |
| `--cockpit-border` | `#e5e7eb` | pane dividers, hairlines, chip/quote borders |
| `--cockpit-border-strong` | `#d1d5db` | secondary action button border |
| `--cockpit-border-focus` | `transparent` | focused row's border (themes trade shadow for this) |
| `--cockpit-ink` | `#111827` | strongest text — titles, focused row title, headings, bold |
| `--cockpit-text` | `#374151` | body text, default row title |
| `--cockpit-text-muted` | `#5f6775` | row preview text, blockquotes |
| `--cockpit-text-faint` | `#6b7280` | keybind hints, position readout, queue label, empty-state hint |
| `--cockpit-accent` | `#3f5a8a` | accent — primary button, focus ring, focused rail, links, QuoteBlock label |
| `--cockpit-accent-text` | `#ffffff` | text/chrome sitting on the accent button |
| `--cockpit-accent-hover` | `#344b73` | primary button hover |
| `--cockpit-accent-soft` | `#e8edf5` | idle focused-row wash, QuoteBlock box background |
| `--cockpit-radius-sm` | `0.25rem` | small radius — chips, kbd, inline code |
| `--cockpit-radius-md` | `0.5rem` | medium radius — rows, buttons, QuoteBlock, images |
| `--cockpit-shadow-raised` | soft two-layer shadow | focused-row lift |
| `--cockpit-shadow-button` | blue-tinted shadow | primary button lift |
| `--cockpit-font-family` | system sans stack | body / UI text |
| `--cockpit-font-family-display` | system sans stack | detail title (paper theme overrides to serif) |
| `--cockpit-font-family-mono` | system mono stack | kbd chips, position readout, code |

Every shadow variable can be set to `none`; `--cockpit-border-focus` exists so a
theme that drops shadows can still mark the focused row with a border instead.

The variable **names are the public contract** — additive-only; renaming or
removing one is a breaking change. The **values stay library-owned**: a consumer
reads them at runtime rather than baking them in, so the library can re-tune the
palette and consumers pick it up for free.

### The export-and-apply contract (how to make your chrome match)

The inline fallbacks live *inside* the cockpit's own elements. They do **not**
reach a sibling header or toolbar you render next to the cockpit — a bare
`var(--cockpit-accent)` in your chrome with nothing set resolves to nothing. So
to make surrounding chrome match the cockpit, do this — and only this:

1. **Import a theme and apply it declaratively to a shared ancestor** of both
   your chrome and the cockpit. A theme is a plain object; React needs a one-line
   cast because `@types/react`'s `CSSProperties` has no `--*` index signature:

   ```tsx
   import { Cockpit, themes } from '@surface/cockpit-ui';
   import type { CSSProperties } from 'react';

   <div style={themes.default as CSSProperties}>
     <header style={{ background: 'var(--cockpit-surface-sunken)', color: 'var(--cockpit-ink)' }}>
       {/* your chrome reads bare var(--cockpit-*) — no hex here */}
     </header>
     <Cockpit items={items} actions={actions} onAction={onAction} mapItem={mapItem} />
   </div>
   ```

   Server-side, the same object can render a `:root { --cockpit-…: … }` rule
   instead — either way the variables resolve at the CSS layer, so this works
   with no JavaScript.

2. **Read bare `var(--cockpit-*)` in your chrome. Never re-supply a hex
   fallback there.** Writing `var(--cockpit-accent, #3f5a8a)` in chrome
   re-hardcodes the value and resurrects exactly the copy-paste drift the seam
   exists to kill — when the library re-tunes, your fallback is now wrong. Apply
   a theme so the bare variable resolves, and leave the value to the library.

Because `themes.default` enumerates **every** variable, applying it at a shared
ancestor is the single source of truth all your chrome collapses onto. Across
repos the theme is read live from the built `dist/` (see
the repo README's quickstart), so a library re-tune propagates on the next
build with no edit to your chrome.

### Blending into host typography

The three font variables accept `inherit` as a supported value. Set
`--cockpit-font-family: inherit` (and/or the display/mono ones) to make the
cockpit adopt the host page's typography instead of the bundled system stacks.

### What's deliberately not themeable (withheld)

The **type scale and weights** and the **layout spacing rhythm** are *not*
variables — they stay internal. Density and layout leeway are the headless
tier's job: if you need different spacing, render your own panes off the engine.
A theme that needed spacing would be a deliberate vocabulary decision, not a
silent one. Layout (the two-pane structure, the narrow collapse) is a
library-owned default too, not a consumer knob.

## Themes

Four applyable themes ship as pure data under `themes` (each a `CockpitTheme`
object — nothing but variable values, no component changes):

- **`default`** — clean neutral light. Near-white / light-gray panes, near-black
  ink, one calm desaturated-blue accent. The zero-setup look.
- **`dark`** — true dark for late-night triage. Near-black blue-gray surfaces,
  a lifted accent for dark contrast; shadows are dropped and the focused row is
  marked with a visible `--cockpit-border-focus` border instead.
- **`paper`** — a warm paper ground with ink text, a **serif** detail title,
  hairline borders, and minimal radius. A quiet reading register for inbox/notes
  triage.
- **`console`** — an agent-ops register: a dark green-black ground, **mono**
  chrome / keys / detail title (but a **sans body** so long rationale stays
  readable), flat depth (no shadows, zero radius), and a single phosphor-green
  accent.

### System-adaptive default + the user toggle

A **bare `<Cockpit>` mount is system-adaptive**: with no
`theme` prop and no consumer-applied ancestor vars, it resolves the OS
`prefers-color-scheme` to `default` (light) or `dark`, applies that theme's vars
on its own root, and **live-updates** when the OS scheme changes. So the
zero-setup look now follows the system instead of pinning light. Precedence is
**explicit theme > user toggle choice > system**:

- **`<Cockpit theme={themes.paper} />`** (or any `CockpitTheme`) — an explicit
  theme that wins over system-adaptive.
- **`<Cockpit theme="inherit" />`** — the display sets *no* vars and inherits
  whatever you applied at an ancestor. Use this when you resolve + apply the theme
  yourself to share the palette with sibling chrome (the export-and-apply contract
  above). This is what the composition layer does.
- **omitted** — system-adaptive self-apply (the default posture).

For a user-facing switch, mount the **`ThemeToggle`** (a conventional
system/light/dark segmented control) and drive it from **`useResolvedTheme`**,
which combines the live OS preference, the persisted toggle choice, and any
explicit override into the `CockpitTheme` to apply:

```tsx
import { Cockpit, ThemeToggle, useResolvedTheme, themeStorageKey } from '@surface/cockpit-ui';
import type { CSSProperties } from 'react';

function Page() {
  // Persist per surface so two surfaces don't clobber each other's choice.
  const t = useResolvedTheme({ storageKey: themeStorageKey('inbox') });
  return (
    <div style={t.theme as CSSProperties}>
      <header>
        <ThemeToggle mode={t.mode} onChange={t.setMode} />
      </header>
      {/* App owns theme application at the ancestor → cockpit inherits it. */}
      <Cockpit theme="inherit" items={items} actions={actions} onAction={onAction} mapItem={mapItem} />
    </div>
  );
}
```

The choice is persisted in `localStorage` under the per-surface key (guarded, so
an SSR / no-DOM / privacy-mode environment degrades to a non-persisted `system`
choice rather than throwing). When an explicit theme is in force,
`t.explicitOverride` is true — hide the toggle, since it would be inert.

## Accessibility

- **Focus-visible rings.** Every interactive element gets a `:focus-visible` ring
  (2px `var(--cockpit-accent)`, 2px offset) via the scoped stylesheet, so the ring
  re-themes with the accent. This is DOM-focus hygiene, kept distinct from the
  row-selection highlight the `j`/`k` loop reads.
- **Reduced motion.** Under `prefers-reduced-motion: reduce`, all transitions and
  animations inside the cockpit are suppressed (a scoped `!important` rule that
  overrides the inline transitions). No motion is added anywhere regardless.
- **Contrast.** The default theme and all three variants are contrast-checked, not
  eyeballed: every text pair clears WCAG AA 4.5:1 on the *actual* background it
  renders on (including the sunken sidebar, the kbd chips, and the focus/hover
  washes), and focus rings / focused-row borders clear 3:1 against the grounds
  next to them.
- **Semantics.** The list is a `role="listbox"` of `role="option"` rows with
  `aria-selected` tracking focus; decorative rails and bars are `aria-hidden`; the
  narrow-mode back control is a labeled button.

## Building and consuming

`dist/` (ESM + type declarations) is gitignored, so a fresh clone has no build to
import. Build it before a consumer can resolve `@surface/cockpit-ui`:

```sh
pnpm build:libs      # from the repo root — builds cockpit, cockpit-ui, voice
```

In this repo's composition package the build is automatic (its `pre*` scripts
build the libraries first). For consuming from a **different repo** (the `file:`
directory-dependency seam, picking up new variables and themes on the next
`pnpm build:libs`), see the repo README.
