# @surface-voice-triage/voice

Headless voice-capture library — wraps OpenAI Realtime transcription for surface-hosted pages.

**v0 scope:** transcription only. No intent classification, no item-context injection into the STT session. Raw transcripts out.

**Composing this into a surface?** Read [`LIBRARY.md`](./LIBRARY.md) — the
managing-agent-facing helper doc. It covers the two engines (`openai-realtime`,
`web-speech`), their capability declarations, how to pick an interaction mode
(hands-free vs. push-to-talk), the onset-anchoring contract, the privacy caveat,
and browser scope — everything needed to write a manifest without reading source.
This README is the hook/server API reference; LIBRARY.md is the compose-time guide.

---

## Running the demo

**Prerequisite:** an OpenAI API key with access to `gpt-4o-transcribe`.

```
cd packages/voice
OPENAI_API_KEY=sk-... pnpm demo
```

Then open http://localhost:5173. You can:
- Click "voice off" to connect the mic and start transcription
- See partial transcripts appear live as you speak
- See finalized transcripts appear in the log below with their `correlationId`, `sessionId`, and timestamp
- Set a correlation ID (simulating cockpit focus change) and verify it stamps the next finals
- Click "force finalize" to flush the partial buffer (push-to-talk fallback)
- Click "voice live" to disconnect

The demo has no dependency on any consuming app, no email code, no other libraries on the page.

If `OPENAI_API_KEY` is not set, the token endpoint returns 503 and the UI shows a useful error in the voice state indicator.

---

## Usage

### Browser hook

```typescript
import { useVoiceCapture } from '@surface-voice-triage/voice';

function MyComponent() {
  const voice = useVoiceCapture({
    // Consumer provides the token-minting callback — library never holds API keys.
    tokenProvider: () =>
      fetch('/api/realtime/token', { method: 'POST' }).then((r) => r.json()),

    onPartial: (text) => {
      // Live partial transcript as user speaks (replaces on each delta)
    },
    onFinal: ({ text, sessionId, correlationId, t }) => {
      // Finalized speech segment — stamp correlationId to route to the right item
    },
  });

  // Cross-library coupling: cockpit calls this on focus change
  // Works without cockpit — setCorrelationId takes any string or null
  voice.setCorrelationId('item-42');

  return (
    <>
      <VoiceIndicator
        state={voice.state}
        onConnect={() => void voice.connect()}
        onDisconnect={() => void voice.disconnect()}
      />
      <p>Partial: {voice.partial}</p>
    </>
  );
}
```

### Optional presentational component

```tsx
import { VoiceIndicator } from '@surface-voice-triage/voice';

// Shows state-colored button (idle/connecting/live/error).
// Uses inline styles — no Tailwind dependency.
<VoiceIndicator state={voice.state} onConnect={...} onDisconnect={...} />
```

### Server-side token route

```typescript
// server.ts (any framework)
import { makeTranscriptionBroker } from '@surface-voice-triage/voice/server';

const broker = makeTranscriptionBroker({ apiKey: process.env.OPENAI_API_KEY });

// Hono example:
app.post('/api/realtime/token', async (c) => {
  const token = await broker.mintEphemeralToken();
  return c.json(token); // { clientSecret, expiresAt, model }
});
```

The master API key never leaves the server. The browser gets an ephemeral `clientSecret` valid for ~60s, used directly in the WebRTC Bearer header.

---

## API

### `useVoiceCapture(options, deps?)`

| Option | Type | Description |
|--------|------|-------------|
| `tokenProvider` | `() => Promise<{clientSecret, expiresAt, model}>` | Called on each `connect()` to mint an ephemeral token. |
| `onPartial?` | `(text: string) => void` | Called on each transcript delta. |
| `onFinal?` | `(t: FinalTranscript) => void` | Called when a speech segment completes. |

Returns `UseVoiceCaptureResult`:

| Property | Description |
|----------|-------------|
| `state` | `VoiceState` — `idle \| connecting \| live \| error` |
| `partial` | Current in-progress fragment. Replaces on each delta. |
| `finals` | Array of completed segment texts. Appends. |
| `transcript` | Convenience: `finals.join(' ') + ' ' + partial` |
| `connect()` | Start session: mint token, request mic, negotiate WebRTC. |
| `disconnect()` | Tear down peer and release mic. |
| `clearTranscript()` | Reset `finals` and `partial` (call on item navigation). |
| `setCorrelationId(id)` | Stamp outbound finals with this ID. Pass `null` to unset. |
| `forceFinalize()` | Flush current `partial` as a final segment (push-to-talk). |

### `FinalTranscript`

```typescript
{
  text: string;
  sessionId: string;    // UUID, fresh per connect() call
  correlationId: string | null;  // from setCorrelationId()
  t: number;            // Date.now() at time of finalization
}
```

### `makeTranscriptionBroker(opts?)`

Server-side factory. `opts.apiKey` defaults to `process.env.OPENAI_API_KEY`. Throws at construction if missing.

---

## Architecture notes

- No dependency on cockpit. Voice composes without cockpit on the page (worked example 3 in the design brief).
- `setCorrelationId` is the single cross-library coupling point. Cockpit publishes `focused-item`; the surface manifest wires it to `setCorrelationId`. Neither library imports the other.
- `tokenProvider` is the auth seam. The library never holds API keys. The server-side helper ships in `@surface-voice-triage/voice/server` but is optional — wire your own route.
- v0 engine: OpenAI Realtime API in `transcription` intent mode. Data channel receives `conversation.item.input_audio_transcription.delta` and `.completed` events. WebRTC audio is mic-only (no audio response from OpenAI).
