# @surface-voice-triage/voice — Library Helper Doc

Read this to configure the voice library in a surface manifest and to pick an
interaction mode. This is the only doc a managing agent needs — you do not need
to read the hook source to choose an engine or a mode.

## What it does

Captures microphone speech and emits raw transcripts — partials as the user
speaks, plus a finalized `FinalTranscript` per completed segment. Each final is
stamped with a `correlationId` (whichever item was focused when the user *started*
speaking that segment) and a per-session `sessionId`. Voice is annotation, not
command: transcripts come out, reasoning lives in the consuming agent's own
endpoint (design brief non-goals).

Two engines ship, behind one identical hook contract:

- **`openai-realtime`** — `useVoiceCapture` (OpenAI Realtime API, WebRTC). The
  default engine; needs a server token broker.
- **`web-speech`** — `useWebSpeechCapture` (browser Web Speech API). Keyless, no
  server piece; Chromium only for hands-free (see caveats below).

Both hooks return the **exact same shape** (`VoiceEngineResult`), so a consumer
treats them interchangeably. The only per-engine difference at the config level is
auth/transport: OpenAI takes a `tokenProvider`; Web Speech takes none.

## v0 exports

```ts
useVoiceCapture({ tokenProvider, onPartial?, onFinal?, onEvent? })  // OpenAI Realtime hook
useWebSpeechCapture({ lang?, onPartial?, onFinal? })                // Web Speech hook
openAiCapabilities      // EngineCapabilities for 'openai-realtime'
webSpeechCapabilities   // EngineCapabilities for 'web-speech'
<VoiceIndicator />      // optional state-colored button (inline-styled)
```

Both hooks return `VoiceEngineResult`: `{ state, partial, speechActive, finals,
transcript, connect, disconnect, clearTranscript, setCorrelationId, forceFinalize }`.
See `README.md` for the field-by-field API and the server-side token route.

## Tuning segmentation for spontaneous speech (server VAD)

The OpenAI engine cuts continuous mic audio into transcribed segments using server
VAD. **How aggressively it cuts is the single biggest driver of whether unprepared,
thinking-out-loud speech survives** — pauses, gaps, ums, and mid-sentence restarts
are the normal case, not an edge case. An over-eager silence window cuts a thought
mid-sentence: the pre-pause audio becomes a fragment STT often returns *empty* (a
silent drop), and the resume gets its first words clipped.

These params are **tunable, not hardcoded**, on `makeTranscriptionBroker` (they're
baked into the ephemeral token, so they live server-side, not in the browser hook):

```ts
makeTranscriptionBroker({
  apiKey,
  vad: {
    silenceDurationMs,  // silence before VAD ENDS a segment. THE knob. Higher =
                        //   tolerates thinking pauses (fewer drops). Default 1200.
    threshold,          // 0..1 speech-confidence to OPEN a segment. Default 0.5.
    prefixPaddingMs,    // audio kept before onset (protects the first word). Default 500.
    noiseReduction,     // 'far_field' (laptop/room, default) | 'near_field' | 'none'
  },
})
```

Every field also reads from an env var when the option is omitted, so an operator
can **tune a running deployment with zero code change**: `OPENAI_VAD_SILENCE_MS`,
`OPENAI_VAD_THRESHOLD`, `OPENAI_VAD_PREFIX_MS`, `OPENAI_VAD_NOISE_REDUCTION`.
Precedence is explicit option → env var → `DEFAULT_VAD_TUNING`.

The defaults favor **spontaneous speech** (the general case). A triage consumer that
wants a run-on to split eagerly between items passes a *lower* `silenceDurationMs`
(e.g. `400`) — VAD then cuts on the brief pauses between items so each gets its own
onset-anchored correlationId. `resolveVadTuning()` and `buildTranscriptionSessionBody()`
are exported pure functions if you want to see exactly what a config resolves to.

## Seeing drops live (`onEvent`)

`useVoiceCapture` takes an optional `onEvent: (e: VoiceCaptureEvent) => void` — a
purely observational stream of capture-lifecycle events. It changes no behavior and
inspects no transcript content; it exists to make drops **visible while they happen**:

```ts
useVoiceCapture({
  tokenProvider,
  onFinal,
  onEvent: (e) => {
    if (e.kind === 'final' && e.empty) console.warn('DROP — STT returned no text', e);
    if (e.kind === 'desync') console.warn('correlation FIFO desync', e);
  },
});
```

Event kinds: `speech-started` (VAD onset, with FIFO `pendingDepth`), `speech-stopped`,
`partial`, `final` (**`empty: true` is a silent drop**), `desync` (the onset FIFO shed
a stale anchor — an onset that never completed, the mis-attribution hazard),
`force-finalize`, and `usage` (audio spend — see the next section). Wire
`onEvent: console.log` to watch a live pass and see exactly where speech is being lost.

## Knowing what a session cost (`usage` events)

The OpenAI engine also emits a **`usage`** event on the same `onEvent` stream, right
after each `final`, carrying the audio usage the Realtime API reported for that
segment. The library only **exposes** it — no writes, no `fetch`, no pricing. Rates,
dollars, and persistence are the consuming app's job.

```ts
import { createUsageSink } from 'your-app/usage-sink'; // your code, not ours
useVoiceCapture({ tokenProvider, onFinal, onEvent: usageSink.onEvent });
```

Fold events into per-session totals with the exported pure helpers:

```ts
import { foldVoiceUsage, emptyVoiceUsageTotals } from '@surface-voice-triage/voice';

let totals = { ...emptyVoiceUsageTotals };
totals = foldVoiceUsage(totals, event); // cumulative: `totals` is always "so far"
// → { sessionId, segments, audioTokens, textTokens, inputTokens, outputTokens,
//     totalTokens, audioSeconds, wallClockMs, variants }
```

Three things to know before you build on this:

- **`null` means the wire did not report it — not zero.** Do not render an
  unreported audio duration as `$0.00`; that reintroduces the exact "we don't know
  what we spent" problem the instrument exists to remove.
- **A new `sessionId` starts fresh.** `foldVoiceUsage` refuses to merge two
  sessions' spend, so you don't have to detect reconnects yourself.
- **The wire shape is documented, not verified.** `parseSegmentUsage` (exported)
  handles both variants OpenAI documents — `{ type: 'tokens', input_tokens,
  output_tokens, total_tokens, input_token_details: { audio_tokens, text_tokens } }`
  and `{ type: 'duration', seconds }` — sniffs the variant when `type` is missing or
  unrecognised, returns `null` on anything unusable, and never throws. No live mic
  session has confirmed the payload; if it differs, you get no `usage` events and
  transcription is unaffected. Read the doc comment in `usage-accumulator.ts` for
  the provenance.

Empty finals emit usage too: a dropped segment still burnt audio.

## Engine capabilities — the exported objects are the source of truth

Each engine ships a tiny static `EngineCapabilities` object the managing agent
reads at compose time. **These two exported objects are canonical** — import them
rather than trusting a copy:

```ts
import { openAiCapabilities, webSpeechCapabilities } from '@surface-voice-triage/voice';
```

The type is `EngineCapabilities` in `src/types.ts`; the concrete declarations are
`openAiCapabilities` (exported next to `useVoiceCapture`) and `webSpeechCapabilities`
(exported next to `useWebSpeechCapture`). The table below **renders those objects
for orientation** — but if any value here ever disagrees with the shipped object,
the object wins. Read the fields off the export, not off this prose.

| `EngineCapabilities` field | `openAiCapabilities` | `webSpeechCapabilities` | What it gates |
|---|---|---|---|
| `engine` | `'openai-realtime'` | `'web-speech'` | Stable id; also the `VoiceState.live.model` string |
| `streamingPartials` | `true` | `true` | **The hands-free gate** (see below) |
| `preTextOnset` | `true` | `false` | Onset-anchor latency only — **not** a mode gate |
| `serverAuth` | `true` | `false` | Needs a `tokenProvider` token broker |
| `privacy` | `'cloud-keyed'` | `'cloud-keyless'` | Drives the privacy caveat below |

There is intentionally **no** `interactionModes` field. The available modes are
*derived* from `streamingPartials` (rule below), so storing a list would be a
drift-prone duplicate. Don't look for one.

## Interaction modes

### Mode-derivation rule (apply this)

- **Hands-free narration is available iff `streamingPartials` is `true`.** That's
  the whole gate.
- `preTextOnset` only *sharpens* onset latency; it is **not** a gate. An engine
  with `streamingPartials: true` and `preTextOnset: false` still qualifies for
  hands-free — its correlation anchor is just slightly coarser.
- **Push-to-talk is available for any engine** (the record gesture is itself the
  onset anchor). It's the documented fallback for batch engines with no streaming
  partials. **Not built this arc** — see below.

Both shipped engines have `streamingPartials: true`, so **both qualify for
hands-free.**

### Hands-free narration

The user speaks continuously; segments finalize on their own (silence
endpointing) and each final is auto-attributed to the item focused at speech
onset. No button per utterance. Requires `streamingPartials` **and** the
correlator's onset anchor (both engines provide this).

- **`openai-realtime`** anchors on a **pre-text VAD signal**
  (`input_audio_buffer.speech_started`), which fires *before* any transcript text
  — the tightest possible attribution.
- **`web-speech`** anchors on the **first interim result**, which is downstream of
  STT (`preTextOnset: false`). This still beats finalization — the user is very
  likely still on the item they're describing — but it is a **weaker, coarser**
  onset than OpenAI's pre-text VAD. Good enough for hands-free; not as sharp.

### Push-to-talk (fallback — NOT implemented this arc)

The intended fallback for an engine that streams no partials: the user holds a
record gesture, and the gesture's start is the onset anchor. **No push-to-talk UI
or mode is built in v0.** Both current engines stream partials, so hands-free
covers them; push-to-talk is documented for when a batch engine is added, and
built only on real consumer demand. Do not wire a manifest expecting a
push-to-talk mode to exist.

(`forceFinalize()` — flushing the current partial as a final — exists on the hook
and is a *building block* a future push-to-talk mode would use. Its presence is
not a push-to-talk implementation.)

## Onset-anchoring contract

The correlation guarantee: **a transcript is attributed to the item focused when
the user *started* the segment, not when it finalized.** By finalization the user
has often navigated away (pressed `j`/`k`); stamping at completion would land the
note on the wrong item. The library captures focus at segment onset, queues it,
and dequeues it in order as each segment completes (a FIFO — a fast run-on can
open a second segment before the first finalizes).

Anchor strength differs by engine, per `preTextOnset`:

- **Strong (`openai-realtime`)** — anchors at pre-text VAD onset, ahead of any
  transcript text.
- **Weaker (`web-speech`)** — anchors at the first interim result (STT-downstream).

**Documented fallback for a weaker engine:** if no onset anchor is available for a
segment when it completes, the segment is stamped with the **live focus at
finalization** rather than dropped. This is a best-effort degradation, not the
happy path — it only fires when the onset queue is empty (e.g. a silent completion
with no preceding onset). Attribution still happens; it's just coarser.

You configure none of this — it's automatic in both hooks. It's documented so you
know the attribution is onset-based, and that a weaker engine's attribution can be
coarser but never absent.

## Privacy caveat — keyless is NOT local/private

`web-speech` has `privacy: 'cloud-keyless'`. **Keyless does not mean on-device.**
The browser streams microphone audio to a **remote server** for recognition:
**Google's servers on Chrome/Edge, Apple's on Safari.** "No API key" only means
you don't supply one — the audio still leaves the machine. A consuming app must
surface this to users; the demo does.

`openai-realtime` is `privacy: 'cloud-keyed'` — audio goes to OpenAI under the
consumer's key. Neither engine is local/private; both send audio to a cloud
service.

## Browser scope for hands-free (`web-speech`)

"Hands-free works" for `web-speech` is scoped to **Chromium (Chrome/Edge)**:

- **Chromium** — full hands-free. Continuous `SpeechRecognition` with reliable
  `interimResults`.
- **Safari** — exposes `webkitSpeechRecognition`, but its `interimResults` are
  **unreliable**, so onset-anchoring degrades (**documented-degraded**) without
  raising a catchable error. Treat Safari `web-speech` as not-hands-free-grade.
- **Firefox** — no `SpeechRecognition` at all → the hook resolves to
  `state.kind === 'unavailable'` (a clean, non-throwing degrade, not an error).

`useWebSpeechCapture` ships its own `detectWebSpeechCapability` probe
(`SpeechRecognition ?? webkitSpeechRecognition` presence + secure context) and
lands in `unavailable` when the engine can't run, rather than presenting a control
that fails obscurely. `openai-realtime` has no such browser-engine restriction
(any secure-context browser with WebRTC + mic).

## Picking an engine (managing-agent decision)

- Want **keyless, no server** and target **Chromium**? → `web-speech`
  (`useWebSpeechCapture`, no `tokenProvider`). Accept the weaker onset and the
  cloud-keyless privacy caveat.
- Want the **tightest attribution**, cross-browser reach, and can stand up a
  **token broker**? → `openai-realtime` (`useVoiceCapture` + `tokenProvider`).
  This is the default engine.
- Either way, **both** compose without cockpit (voice-only is a valid use case)
  and wire to cockpit through the single `setCorrelationId` coupling point — see
  the cockpit LIBRARY.md's manifest example (`{ "on": "focused-item", "call":
  "voice.setCorrelationId" }`).

## Build output

`dist/` contains ESM + type declarations and is gitignored, so a fresh clone must
build voice before a consumer can resolve `@surface-voice-triage/voice`:

```
pnpm --filter @surface-voice-triage/voice build
```

The composition package's `pre*` scripts build voice + cockpit automatically
before its own scripts run (see the composition README).
