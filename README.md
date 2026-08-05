# svt — surface voice triage

Two composable libraries for building **voice-and-keyboard-driven triage interfaces** over
any list of items:

- **cockpit** — a list + detail UI with keyboard navigation and per-item action
  affordances. Ships as a **headless engine** (state, keyboard nav, action dispatch — zero
  pixels) plus a default **display** you can use as-is, rearrange, restyle, or replace
  wholesale.
- **voice** — per-item microphone capture + transcription. Speak context while an item is
  focused; a finalized transcript comes out stamped with that item's id. Two interchangeable
  engines behind one hook contract, including a **zero-key** browser engine.

They compose into a page hosted by [`surface`](https://github.com/aac/surface) (an agent
toolkit for ephemeral, distributable UI), coupled by exactly one thin wire: the cockpit
publishes which item is focused; the voice library stamps that id on its transcripts. Neither
library imports the other, and **each works on its own** — voice without cockpit and cockpit
without voice are both valid.

> **What this is not:** not a triage app, not a voice assistant, not a source/enrichment
> layer. The libraries are dumb on purpose — where items come from, what actions mean, and
> what happens to a decision are the consuming agent's concern. See
> [`docs/design-spec.md`](docs/design-spec.md) for the full non-goals.

## The two engines (voice)

Voice ships two engines with the **exact same hook shape**, so a consumer swaps between them
by config alone:

| Engine | Hook | Setup | Notes |
|--------|------|-------|-------|
| **OpenAI Realtime** | `useVoiceCapture` | server token broker (holds your OpenAI key) | default; high-quality STT via WebRTC |
| **Web Speech** | `useWebSpeechCapture` | **none — keyless** | browser-native; hands-free is Chromium-only |

The keyless Web Speech engine means you can stand up a working voice-triage page with **no
backend and no API key** — the OpenAI engine is the upgrade when you want higher-quality
transcription and can run a token-mint route.

## Composable layout (cockpit)

The cockpit display is not a locked 3-column/`j`-`k` frame. Its contract is *"iterate a list
of items with these affordances"* — the two-pane layout and the default keybinds are shipped
*defaults*, and each is something you can rearrange, rebind, or replace:

- **`<Cockpit>`** — the pre-arranged two-pane component. Zero setup; mount it when its layout
  fits.
- **`CockpitProvider` + `CockpitList` / `CockpitDetail`** — the composable pieces. Arrange the
  panes yourself (stacked, three-column, sidebar-swapped); they self-wire to one shared engine
  and keep the shipped styling.
- **Headless `useCockpit`** — skip the display package entirely, render your own DOM off the
  engine, and own 100% of the pixels. This is the true no-lock-in path.

Consumer-configurable keybinds, a CSS-variable theming seam, system-adaptive light/dark, and
responsive single-pane collapse are all built in.

## Quickstart

The libraries build from a clone with pnpm — no registry, no publish step:

```
git clone https://github.com/aac/svt.git
cd svt
pnpm install
pnpm build:libs      # builds cockpit, cockpit-ui, and voice into their dist/
```

Then see them working end-to-end in the in-repo composition example (a real
talk-to-triage page — navigate with `j`/`k`, triage with keybinds, annotate by talking):

```
cd packages/composition
pnpm triage          # builds the libs + starts the page at http://localhost:5173
```

Open `http://localhost:5173` (defaults to a reading-queue triage demo). Cockpit renders
correctly styled with **zero styling setup** — the display is inline-styled, so there's no CSS
to import and no Tailwind to configure. The keyless Web Speech engine works with no further
setup; the OpenAI engine additionally needs an `OPENAI_API_KEY` in the environment for the
demo's token route.

## Using the libraries

A consuming agent reads each library's helper doc and writes a surface manifest — that's the
whole integration contract. No plugin registry, no protocol negotiation.

- **[`packages/cockpit/LIBRARY.md`](packages/cockpit/LIBRARY.md)** — the headless engine:
  `useCockpit`, the `focused-item` bus, programmatic `setFocusedItem(id)`.
- **[`packages/cockpit-ui/LIBRARY.md`](packages/cockpit-ui/LIBRARY.md)** — the display:
  `<Cockpit>`, the composable pieces, the theming/replacement boundary.
- **[`packages/voice/LIBRARY.md`](packages/voice/LIBRARY.md)** — the two engines, the shared
  `VoiceEngineResult` contract, interaction modes, and the server-side token route.
- **[`packages/composition/README.md`](packages/composition/README.md)** — the worked
  composition example: how a `libraries[] + wiring[]` manifest wires cockpit + voice into one
  page, and the four pressure-test arrangements.

## Layout

```
svt/
├── packages/
│   ├── cockpit/         # headless engine (@surface/cockpit)
│   ├── cockpit-ui/      # default display (@surface/cockpit-ui)
│   ├── voice/           # mic capture + transcription, two engines
│   └── composition/     # worked example: both libraries composed via a manifest
└── docs/                # design spec + design rationale
```

## Status

The libraries are built, tested (200+ passing tests across the packages), and dogfooded on a
real voice-triage session. Distribution today is clone + `pnpm build:libs`; whether to also
publish installable packages or ship a runnable out-of-the-box app is an open packaging
question, not yet decided.

## License

Apache License 2.0 — see [`LICENSE`](LICENSE).
