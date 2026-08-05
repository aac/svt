# @surface-voice-triage/composition

Prototype surface page that composes the **cockpit** and **voice** libraries via
a manifest. It serves three purposes:

- **Dogfood:** a realistic, usable **talk-to-triage** app — a ~12-item
  reading queue you navigate with `j`/`k`, triage with `keep`/`archive`/`flag`, and
  annotate by *talking* while an item is focused. This is the default page
  (`?example=triage`). See **Dogfood: talk-to-triage** below.
- **Manifest proof:** proves the `libraries[]` + `wiring[]` manifest shape against a
  working composition and exercises the per-item-grouping drain.
- **Worked examples:** pressure-tests all **four worked examples** from the design
  brief against the unmodified libraries.

This is a **spike**, not a shipped product. It demonstrates the composition model;
a real consuming app migrating onto these libraries would own its
own surface page. The libraries are used **as-is** — no cockpit or voice source was
modified to build any of this.

## Dogfood: talk-to-triage (the human-validation example)

The dogfood proves a human can actually triage a list while talking, end to end,
through cockpit + voice on a real surface page. It is the **same** composition
layer as everything else — only the manifest data is different (a richer item list
+ a `keep`/`archive`/`flag` action set, in `src/manifest.triage.ts`). That is the
whole point: standing up "talk through my reading backlog" is just *writing a
different manifest*, not writing an app.

**From a fresh clone** (no other setup — `pnpm triage` builds the cockpit + voice
libraries first via its `pre*` script, then starts the page):

```
pnpm install                       # once, from the repo root
cd packages/composition && pnpm triage
```

Then open **http://localhost:5173** (defaults to `?example=triage`). Cockpit
renders correctly styled with zero styling setup — the libraries are
inline-styled, so there is no CSS to import and no Tailwind to configure.

**With voice** (the OpenAI engine needs your OpenAI key in the environment; keep the
literal out of shell history by reading it from your own secret store rather than
inlining it):

```
cd packages/composition && OPENAI_API_KEY="$YOUR_OPENAI_KEY" pnpm triage
```

> **Mic prompt gotcha:** some browsers' developer modes suppress the
> `getUserMedia` permission prompt, leaving voice stuck at "connecting". If the mic
> prompt never appears, use a standard browser profile; granting the permission
> connects the loop.

How to use it:

- **Navigate** with `j` (next) / `k` (previous). Watch the `voice correlationId`
  readout in the header track the focused item — that is the focus→voice wiring.
- **Triage** the focused item: `Enter` = keep, `a` = archive, `f` = flag. Each fires
  an `itemId`-stamped submission (visible in the "submissions sent" sidebar).
- **Talk** while an item is focused: click "voice off" to connect the mic, then
  narrate *why* ("keep this, want it for the write-up"). The finalized transcript
  is stamped with the focused item's id and submitted as `voice-note-<itemId>`.

Cockpit works without the key (silent click-through). Voice needs it.

### What the dogfood drains

Submissions drain **flat** (the real surface model) and group **client-side** via
`groupByItem()`:

```
curl http://localhost:5173/drain                 # flat stream — what real surface returns
curl http://localhost:5173/drain?groupBy=item    # LOCAL DEV SHIM mirroring groupByItem()
```

`?groupBy=item` is a dev convenience only — real surface returns the flat stream and
the managing agent calls `groupByItem(flat)` itself.
The headless half of the loop is validated in `src/triage-dogfood.test.ts`, which
drives a simulated triage session through the real wiring + submission builders and
asserts the flat stream groups per-item correctly.

## The four worked examples

All four design-brief worked examples are expressed as manifests in
`src/manifest.examples.ts` and run through the **same** page + runtime — selected
by `?example=`:

| `?example=` | Libraries | Wiring | Pressure-tests |
|-------------|-----------|--------|----------------|
| `triage` (default) | cockpit + voice | focus → voice | **dogfood** — ~12-item reading queue, real talk-to-triage |
| `email` | cockpit + voice | focus → voice | the obvious case (email bodies) |
| `photo` | cockpit + voice | focus → voice | cockpit renders arbitrary bodies (`<img>` in body) |
| `voiceOnly` | voice only | none | voice composes **independently** of cockpit |
| `silent` | cockpit only | none | cockpit composes **independently** of voice |

Examples 3 (`voiceOnly`) and 4 (`silent`) are the load-bearing ones: each library
must compose alone. Their manifests deliberately omit the other
library **and** the wiring edge. Dropping a library is just a manifest edit — the
composition layer (App/runtime/mounts) is unchanged across all four examples.

`src/worked-examples.test.ts` drives every example through the real
submission-builders + `SurfaceStore.drainByItem()` and asserts the per-item
bucket shape — the drain-shaped output a managing
agent consumes. **Verdict: all four compose cleanly with no library changes.**

## What it demonstrates

1. **One page, both libraries.** The page hosts cockpit (list+detail+keyboard nav)
   and voice (mic capture), composed from a manifest — not hand-wired.
2. **The wiring array works.** The manifest's
   `{ on: 'focused-item', call: 'voice.setCorrelationId' }` edge is interpreted by
   the runtime: cockpit publishes `focused-item` on its bus when focus changes
   (j/k), and the runtime forwards it to `voice.setCorrelationId`. The voice
   correlationId tracks focus with no direct import between the libraries.
   By default that edge rides cockpit's module-singleton bus. A page mounting
   **two** manifest-wired compositions passes one `createCockpitBus()` instance to
   both halves of each — `<CockpitMount bus={…}>` and
   `applyWiring(wiring, handles, bus)` — so neither stamps the other's
   correlations (`src/wiring-bus-scope.test.tsx`). One composition: change nothing.
3. **Per-item-grouping drain.** Cockpit actions and voice transcripts are submitted
   to the surface server stamped with `itemId`.
   `GET /drain?groupBy=item` returns per-item buckets; itemId-less submissions land
   in `ungrouped`.

## Architecture — the composition layer

The composition layer is the **only** place that imports both libraries. The
libraries never import each other.

| File | Role |
|------|------|
| `src/manifest.ts` | Manifest types (`libraries[]` + `wiring[]`). Imports neither library. |
| `src/manifest.example.ts` | The worked-example-1 manifest (email triage), as typed data. |
| `src/runtime.ts` | **The manifest interpreter.** Resolves `wiring[]` edges to mounted-library handle methods and subscribes them to bus events — on the cockpit singleton by default, or on a per-composition bus passed to `applyWiring`. |
| `src/mounts.tsx` | React mount registry — maps a library `name` to its React component + imperative handle. Imports both libraries (it's the composition layer). |
| `src/submissions.ts` | Builds surface submission envelopes (`itemId`-stamped) and POSTs them to `/submit`. |
| `src/App.tsx` | The surface page. Interprets the manifest, mounts each library, applies the wiring, wires submissions. |
| `src/server/surface-store.ts` | Surface submission store + per-item-grouping drain (transport-agnostic, unit-tested). |
| `vite.config.ts` | Dev server playing the surface server: `/submit`, `/drain[?groupBy=item]`, `/api/realtime/token`. Emits the canonical `SUBMIT <id> <payload>` stdout line per submission. |

## Running

```
# from packages/composition/ — pnpm demo builds cockpit+voice first (pre-script),
# so a fresh clone needs only `pnpm install` at the repo root beforehand.
OPENAI_API_KEY=sk-... pnpm demo
```

Then open http://localhost:5173. Cockpit is correctly styled with no styling
setup — the libraries are inline-styled (no CSS import, no Tailwind config).

- **Cockpit works without the key** — navigate with `j`/`k`, invoke actions with
  `Enter`/`a`/`d`. Watch the correlationId readout in the header track focus, and
  the "submissions sent" sidebar fill with itemId-stamped envelopes.
- **Voice needs the key** — click "voice off" to connect the mic. Spoken
  transcripts finalize stamped with the focused item's id and submit as
  `voice-note-<itemId>`.

Drain the submissions:

```
curl http://localhost:5173/drain?groupBy=item   # per-item buckets
curl http://localhost:5173/drain                 # flat stream
```

Each submission also prints a `SUBMIT <id> <payload-json>` line to the dev server's
stdout — the canonical surface autonomous-drain signal.

## Decisions settled

This prototype settled two design questions the brief left open: libraries are
**pre-bundled into the deploy** (no registry, no install-at-manifest-time), and
the cross-library bus is a thin **EventTarget** wrapper.

## Tests

```
pnpm typecheck
pnpm test     # per-item-grouping drain shape, incl. the ungrouped (voice-without-cockpit) path
pnpm build
```
