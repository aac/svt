---
title: Composable Triage — Design Brief
date: 2026-05-27
rev: 1
status: draft (pre-feasibility)
---

# surface-voice-triage — design brief

> This is the **original design brief**, written before the libraries were built and
> preserved as the design rationale. It records the reasoning and the non-goals, not the
> shipped API — for that, read each package's `LIBRARY.md`. Where the brief and the code
> disagree, the code is authoritative.

> **Name:** `surface-voice-triage` names the three players (surface, voice, triage). Anchored to the triage use case for now; libraries may generalize beyond triage in v1+.

## Origin

This brief emerged from a question about two existing triage tools, and converged on a different one: are there reusable primitives hiding inside them that, when composed with `surface`, produce a *general* voice-driven triage capability for any list of items?

Three projects sit upstream:

- **An email-triage app** — voice-assisted email triage, built on OpenAI Realtime (WebRTC transcription) plus an LLM reasoning step and a Gmail CLI. The list+detail+keyboard cockpit UI and the voice transcription pipeline are the interesting reusable bits.
- **A browser-tab triage tool** — tab classifier and clustering pipeline plus a vanilla-JS triage UI with keyboard shortcuts. The list+detail+keyboard cockpit UI is the reusable bit; the classifier and source adapters are domain-specific.
- **[surface](https://github.com/aac/surface)** — a pattern + toolkit for agents to generate ephemeral, distributable UI surfaces with affordances and drain submissions autonomously. The substrate this project plugs into.

Both triage tools independently converged on the same UX shape: list sidebar + detail pane + keyboard nav (j/k) + per-item action affordances. That convergence is the signal that the shape itself is a primitive.

## Goal

Produce two composable libraries — **cockpit** and **voice** — that a managing agent can drop into a `surface`-hosted page to construct a voice-and-keyboard-driven triage interface for any list of items, without writing a new app per source.

When the libraries exist, building "triage my Gmail," "triage my open tabs," "triage my Airtable backlog," or "triage these photos" becomes: agent fetches items from the source, mints a surface with cockpit + voice libraries configured, ships the URL, drains per-item interactions + voice transcripts, executes decisions against the source. The libraries don't know about Gmail or tabs or photos; the agent does.

## Non-goals

- **Not a triage app.** This project produces libraries, not an end-user product. The existing triage tools are the products; this project is the substrate they would migrate onto.
- **Not a voice assistant.** The voice library captures audio and emits transcripts. It does not reason about meaning. Reasoning happens server-side in whatever endpoint the managing agent stands up.
- **Not surface.** This project does not modify `surface`. The libraries plug into surface via its existing affordance + drain mechanisms. If surface needs a small extension (per-item submission grouping is the only known one — see Open Questions), that's a surface-side ticket, not work in this repo.
- **Not source adapters.** Fetching items from Gmail, Chrome history, Airtable, etc. is the managing agent's job. Same for executing decisions back against the source. Those are domain-specific concerns and live in the consuming app, not here.
- **Not enrichment.** Per-item context-gathering (page screenshots, content extraction, AI summarization) belongs to the consuming app.

## The composition model

```
                     ┌─────────────────────────────────┐
                     │      Managing Agent             │
                     │  (knows the domain, has items,  │
                     │   reads library docs, composes) │
                     └─────────────────────────────────┘
                                  │
                                  ▼
              ┌─────────────────────────────────────────┐
              │              Surface page               │
              │   (URL, wire, opaque IDs, drain)        │
              │  ┌─────────────────┐ ┌──────────────┐  │
              │  │ Cockpit library │ │ Voice library│  │
              │  │ (list+detail UI)│ │ (mic + STT)  │  │
              │  └────────┬────────┘ └───────┬──────┘  │
              │           │ correlationId    │         │
              │           └──┬───────────────┘         │
              │              ▼                         │
              │     surface submission wire            │
              └─────────────────────────────────────────┘
```

**Three composables, each independently useful:**

1. **surface** — wire, opaque IDs, submission drain. Already exists. Stays minimal.
2. **cockpit library** — list+detail UI with keyboard nav and per-item action slots. New.
3. **voice library** — per-item voice capture + transcription. New.

**One thin coupling** — the cockpit stamps a `correlationId = currentItemId` on the voice library whenever focus changes. The voice library stamps it on outbound transcript submissions. Neither library imports the other; the wiring is glue code in the surface manifest.

The managing agent owns everything else: where items come from, how they're enriched, what actions are available, what to do when a decision is drained, how to execute it against the source system.

## The four protocol contracts

A "library" in this project is a **JS module + helper doc**. The doc tells the managing agent what the library does, how to configure it, what submissions it emits, and what state it exposes on the shared bus. The agent reads the doc and assembles a surface manifest.

The minimum protocol is four contracts. Each library implements all four.

### 1. Mount contract

Each library exposes `mount(container, config, bus) → handle`. Surface allocates a container element, passes the agent-supplied config, hands over the shared bus. Library returns a teardown handle. No framework assumptions; the libraries can use React internally, vanilla JS, or anything else.

### 2. Config contract

Plain JSON, library-defined. Documented in each library's helper doc. The agent assembles config by reading the docs.

### 3. Submission contract

Libraries do not have their own wire. They emit submissions through surface's existing API as opaque-ID payloads — the same envelope a button click produces. A voice transcript for item-A becomes:

```json
{ "affordanceId": "voice-note-item-A", "value": "this one's for the basket thing", "t": 1748390123 }
```

A click on the "keep" affordance for item-A becomes:

```json
{ "affordanceId": "keep-item-A", "value": true, "t": 1748390145 }
```

The agent drains both uniformly. Surface joins per-item submissions before handing them off; the managing agent receives:

```json
{
  "itemId": "item-A",
  "interactions": [ { "action": "keep" } ],
  "voiceTranscripts": [ { "text": "this one's for the basket thing", "t": 1748390123 } ]
}
```

### 4. Cross-library bus contract

A shared event bus on the page lets libraries coordinate without knowing about each other. Bus keys are namespaced strings; libraries declare what they publish and what they subscribe to in their docs.

For v0, the only bus key in use is `focused-item: <id>`, published by cockpit on focus change, subscribed by voice via a `setCorrelationId` callback wired in the manifest. The bus is the load-bearing piece — without it, every consuming app reinvents the per-item-attribution pattern. With it, voice and cockpit each stay independently useful.

## The two libraries

### Voice library

**What it does:** captures microphone input, streams to a transcription service, emits finalized transcripts with attached correlationId. Stays oblivious to "items" — that's cockpit's concept.

**v0 engine:** OpenAI Realtime API in transcription-only mode (the same setup the upstream email-triage app already used). Cheap STT, server-mints ephemeral tokens via a broker, master key never leaves the server.

**v0 exports:**

```ts
useVoiceCapture({ tokenProvider, onPartial, onFinal })  // headless hook
<VoiceIndicator />                                      // optional presentational
setCorrelationId(id)                                    // attribution setter
forceFinalize()                                         // push-to-talk fallback
states: idle | connecting | live | error
```

**onFinal payload:** `{ text, sessionId, correlationId, t }`

**Auth contract:** `tokenProvider: () => Promise<{clientSecret, expiresAt}>`. Library never holds API keys. The consuming app brings its own token-minting backend.

**What v0 does NOT do:**
- No intent classification (no "the user said 'archive,' emit an archive event"). Just raw transcripts.
- No item context injection into the STT session. Item-aware reasoning happens server-side in the managing agent's own endpoint at drain time.
- No bidirectional coupling with cockpit (no voice-drives-focus). See Future Direction below.

### Cockpit library

**What it does:** renders a list+detail layout with keyboard navigation (j/k), per-item action affordance slots, and publishes `focused-item` on the bus when focus changes.

**v0 exports:**

```ts
useCockpit({ items, actions, onAction })                // headless hook
<Cockpit />                                             // pre-styled component
setFocusedItem(id)                                      // programmatic focus
publishes: focused-item
```

**Item shape:**

```ts
{ id: string, title: string, body: string|HTML, meta?: Record<string,unknown> }
```

**Action shape:**

```ts
{ id: string, label: string, keybind?: string }
```

When the user invokes an action on an item, the cockpit emits a surface submission `{ affordanceId: "<action.id>-<item.id>", value: true }`.

**Layout heuristics inherited from both upstream projects:**
- List sidebar left, detail pane right
- j/k for next/previous item
- Number keys (1/2/3) for picking among candidate actions if displayed
- Enter for primary action; explicit per-action keybind for everything else
- Dark cockpit aesthetic by default; light theme as opt-in v1

## Worked examples

### Example 1 — Email triage (the obvious one)

Managing agent fetches emails from Gmail, mints a manifest:

```json
{
  "libraries": [
    {
      "name": "cockpit",
      "config": {
        "items": [
          { "id": "msg-7", "title": "Re: schedule for next week", "body": "<email body>" },
          { "id": "msg-8", "title": "Quote for the rewire", "body": "<email body>" }
        ],
        "actions": [
          { "id": "keep", "label": "Keep", "keybind": "Enter" },
          { "id": "archive", "label": "Archive", "keybind": "a" },
          { "id": "defer", "label": "Defer", "keybind": "d" }
        ]
      }
    },
    {
      "name": "voice",
      "config": {
        "tokenProvider": "/api/realtime/token"
      }
    }
  ],
  "wiring": [
    { "on": "focused-item", "call": "voice.setCorrelationId" }
  ]
}
```

The user opens the URL and talks through 50 emails — hitting keybinds on some, just narrating others. Surface drains:

```json
[
  { "itemId": "msg-7", "interactions": [{"action": "keep"}], "voiceTranscripts": [{"text": "this one's from the contractor, file it under the remodel"}] },
  { "itemId": "msg-8", "interactions": [], "voiceTranscripts": [{"text": "remind me to follow up next month"}] }
]
```

Managing agent reasons over each bucket, decides destinations (a notes path, a task list, a defer date), executes against Gmail. Done.

### Example 2 — Photo triage (pressure test: different item type, same shape)

Managing agent has 200 vacation photos. Cockpit's items have image URLs in `meta`. Actions are `keep`, `delete`, `favorite`. Voice library is mounted identically. The user talks through photos: "this one's blurry, archive it," "this is the one for the holiday card." Managing agent drains, executes against Photos library.

The cockpit library doesn't need to know about images — it renders whatever the item's body is. A consuming app could ship a `<PhotoItem>` component as the body renderer; cockpit composes it.

### Example 3 — Voice without cockpit (pressure test: composability of voice alone)

Managing agent presents a multi-choice surface ("which restaurant should we go to?") with three options and a voice annotation slot. No cockpit. Voice library stamps correlationId="restaurant-choice" on its transcripts. The user clicks an option AND records a rationale ("the second one, because someone in the group wanted Thai"). Manager drains both.

This works because voice has no dependency on cockpit. The correlationId is a setter, not a subscription — it can be set by anything.

### Example 4 — Cockpit without voice (pressure test: composability of cockpit alone)

Managing agent uses cockpit alone for silent click-through triage. No mic permission required. Identical drain shape, just no voice transcripts in the per-item buckets.

These four examples should be the verification checklist for v0 — the libraries are right if all four compose cleanly.

## Future direction: voice-drives-focus

It would be *very* smooth for the user to start talking about the next item in the list and have focus shift automatically. "Actually, about that rewire quote again..." should re-focus that item.

This is the future capability that earns this section's existence. It is **not** v0. It's documented now because it has architectural implications worth respecting from the start.

**The naive design (rejected):** the voice library detects intent ("user is referring to a different item") and shifts focus. This breaks the v0 invariant that voice is dumb (transcription only) and oblivious to items. It also requires the voice library to know the full list of items, which is cockpit's responsibility.

**The cleaner design (recommended for v1):** the voice library stays dumb. The managing agent receives streaming partial transcripts (which the v0 voice library already emits), runs a near-real-time classifier server-side, and pushes a "focus shift" message back through surface to the cockpit library when it detects a reference to a different item.

This requires one new piece of plumbing: a **surface back-channel** from the managing agent to libraries on the page. Surface today is one-way (libraries → drain). Adding a one-way reverse channel (agent → library) is a small extension that unlocks not just voice-drives-focus, but also things like agent-suggested actions appearing as candidate affordances mid-session.

**v0 architectural decision driven by v1's needs:**

- The cockpit library MUST expose `setFocusedItem(id)` as a programmatic API, not just user-triggered. This is the entry point the back-channel will call when v1 lands.
- The voice library MUST emit partial transcripts as well as finals. This is the input the v1 classifier consumes. (The OpenAI Realtime API already emits these as `conversation.item.input_audio_transcription.delta` events — it's a non-issue if v0 plumbs them through.)

Both of these are cheap to do in v0 and impossible to retrofit cleanly. Get them right the first time.

## Open questions

1. **Bundling.** Does surface npm-install the libraries at manifest-process time, or are they pre-bundled into surface's deploy? Probably pre-bundled for v0 (smaller blast radius, no registry to design). Settle in feasibility spike.

2. **Surface needs per-item submission grouping.** Currently surface drains a flat stream of `{affordanceId, value}` submissions. For triage to be ergonomic, the agent wants pre-grouped per-item buckets. This is a small addition to surface's drain semantics — it belongs on the surface side, not in this repo. Worth confirming whether it belongs in surface proper or whether the managing agent should do the grouping itself.

3. **Voice-cockpit wiring location.** The "on focused-item, call voice.setCorrelationId" wiring lives in the surface manifest in this brief. Alternative: surface ships a tiny "glue runtime" that interprets a `wiring:` array. Or alternative: each library exports a `dependsOn(otherLibraryHandle)` method and they self-wire. The manifest approach is simplest for v0; the others are options if it gets unergonomic.

4. **Bus implementation.** Is the bus a literal EventTarget on the page, a tiny pub/sub library, a redux-style store, or just a property on a global `surface` object? Pick the simplest that lets two libraries coordinate without importing each other. EventTarget is probably it.

## Feasibility next steps

These are the prerequisites to a real v0 build.

1. **Test the upstream app's voice loop end-to-end.** This validates the highest-risk unknown — does OpenAI Realtime transcription actually feel good for spoken-thought capture? Without confirming this, lifting the code into a library is premature. A human has to do this one.

2. **Extract the voice library spike.** Once the loop is validated, lift the transcription hook, the realtime broker, and the token route from the email-triage app into a standalone library package. Strip the inbox-specific bits (the decision endpoint stays in the app; the library emits raw transcripts only). Add `setCorrelationId` and `forceFinalize`. Ship the headless hook + optional `<VoiceIndicator>`.

3. **Extract the cockpit library spike.** Lift the list+detail+keyboard-nav layout from the app's React UI (or build fresh — it's <500 lines). Add `setFocusedItem`, the `focused-item` bus publication, and the action-affordance slot machinery.

4. **Prototype the surface manifest + composition wiring.** Wire one library into a surface page. Then two. Then run worked example #1 (email triage) end-to-end against fake data. Then worked example #3 (voice without cockpit) to confirm the libraries compose independently.

5. **Pressure-test against examples #2 and #4.** Photo triage and silent click-through. If the libraries handle these without modification, the v0 surface is right.

6. **Surface back-channel design.** Separate ticket (surface-side). Required for v1 voice-drives-focus; not needed for v0.
