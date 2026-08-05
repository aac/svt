import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import type { ViteDevServer } from 'vite';

/**
 * Composition demo Vite config.
 *
 * The dev server plays the role of the surface server for this composition page.
 * It implements the surface wire (POST /submit → append + SUBMIT stdout line) plus
 * the per-item-grouping drain extension (GET /drain?groupBy=item), reuses the
 * voice library's broker for the token-mint route (POST /api/realtime/token), and
 * journals voice usage/cost rows (POST /usage).
 *
 * Run:  OPENAI_API_KEY=sk-... pnpm demo   (voice needs the key; cockpit works without)
 */
export default defineConfig({
  plugins: [react(), surfaceServerPlugin()],
});

function surfaceServerPlugin() {
  return {
    name: 'surface-composition-server',
    async configureServer(server: ViteDevServer) {
      // Lazy-load the store via the dev server's module runner so TS is handled.
      const { SurfaceStore } = (await server.ssrLoadModule('/src/server/surface-store.ts')) as typeof import(
        './src/server/surface-store.js'
      );
      const store = new SurfaceStore();

      // LOCAL DEV DURABILITY: the store is in-memory only, so a dev-server death
      // loses the session. Journal every accepted submission to disk as it lands —
      // recovery is reading the JSONL back; no human "save" step exists or is needed.
      const journalPath =
        process.env.SUBMIT_JOURNAL ?? resolve(process.cwd(), '.data/submit-journal.jsonl');
      mkdirSync(dirname(journalPath), { recursive: true });
      // eslint-disable-next-line no-console
      console.log(`[journal] appending submissions to ${journalPath}`);

      // ── POST /submit ──────────────────────────────────────────────────────
      server.middlewares.use('/submit', (req, res, next) => {
        if (req.method !== 'POST') return next();
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          let parsed: { id?: string; payload?: unknown };
          try {
            parsed = JSON.parse(body || '{}');
          } catch {
            res.statusCode = 400;
            res.end('bad json');
            return;
          }
          if (!parsed.id) {
            res.statusCode = 400;
            res.end('missing id');
            return;
          }
          const payload = parsed.payload ?? null;
          const entry = store.append(parsed.id, payload);
          try {
            appendFileSync(journalPath, JSON.stringify(entry) + '\n');
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error('[journal] WRITE FAILED — session is memory-only until fixed:', err);
          }
          // Canonical surface wire stdout line for autonomous draining.
          // eslint-disable-next-line no-console
          console.log(`SUBMIT ${parsed.id} ${JSON.stringify(payload)}`);
          res.statusCode = 200;
          res.end();
        });
      });

      // ── POST /usage (voice cost/usage journal) ───────────────
      // Mirrors the submission journal above: append-only JSONL, one row per
      // usage-bearing event, written as it lands rather than at session end.
      // Each row carries running cumulative totals, so the last row for a
      // sessionId IS that session's total and `jq` across the file answers
      // "what have we spent" across sessions. No dashboard, by design.
      const { buildUsageRow, parseUsageTotals, resolveUsageRates, usageRowToJsonl, DEFAULT_USAGE_JOURNAL_RELATIVE_PATH } =
        (await server.ssrLoadModule('/src/server/usage-journal.ts')) as typeof import(
          './src/server/usage-journal.js'
        );
      const usageJournalPath =
        process.env.VOICE_USAGE_JOURNAL ??
        resolve(process.cwd(), DEFAULT_USAGE_JOURNAL_RELATIVE_PATH);
      mkdirSync(dirname(usageJournalPath), { recursive: true });
      const usageRates = resolveUsageRates(process.env);
      // eslint-disable-next-line no-console
      console.log(
        `[usage] appending voice usage to ${usageJournalPath} ` +
          `(rate $${usageRates.usdPerAudioMinute}/audio-min, ` +
          `$${usageRates.usdPer1MInputTokens}/1M in, $${usageRates.usdPer1MOutputTokens}/1M out)`,
      );

      server.middlewares.use('/usage', (req, res, next) => {
        if (req.method !== 'POST') return next();
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(body || 'null');
          } catch {
            res.statusCode = 400;
            res.end('bad json');
            return;
          }
          // Totals crossed a process boundary, so validate rather than trust.
          const totals = parseUsageTotals(parsed);
          if (!totals) {
            res.statusCode = 400;
            res.end('unusable usage totals (sessionId required)');
            return;
          }
          try {
            appendFileSync(usageJournalPath, usageRowToJsonl(buildUsageRow(totals, usageRates)));
          } catch (err) {
            // Loud, but non-fatal: losing a usage row must never affect capture.
            // eslint-disable-next-line no-console
            console.error('[usage] WRITE FAILED — this session is unmeasured:', err);
            res.statusCode = 500;
            res.end('journal write failed');
            return;
          }
          res.statusCode = 204;
          res.end();
        });
      });

      // ── GET /drain[?groupBy=item] ─────────────────────────────────────────
      server.middlewares.use('/drain', (req, res, next) => {
        if (req.method !== 'GET') return next();
        const url = new URL(req.url ?? '/', 'http://localhost');
        const grouped = url.searchParams.get('groupBy') === 'item';
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(grouped ? store.drainByItem() : { submissions: store.drainFlat() }));
      });

      // ── POST /api/realtime/token (voice broker) ───────────────────────────
      server.middlewares.use('/api/realtime/token', async (req, res, next) => {
        if (req.method !== 'POST') return next();
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
          res.statusCode = 503;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              error: 'openai_unconfigured',
              message: 'OPENAI_API_KEY is not set. Cockpit nav works without it; voice needs it.',
            }),
          );
          return;
        }
        try {
          const { makeTranscriptionBroker } = (await server.ssrLoadModule(
            '@surface-voice-triage/voice/server',
          )) as typeof import('@surface-voice-triage/voice/server');
          // NOTE (closed experiment): tried pointing transcription at
          // the steerable reasoning model gpt-realtime-2 to attribute gapless
          // run-ons by content / honor an <item:NAME> marker. OpenAI rejects it —
          // transcription sessions only accept whisper-1, gpt-realtime-whisper,
          // gpt-4o-transcribe, and the gpt-4o-mini-transcribe family. A reasoning
          // STT would need a full conversational session (voice agent), out of
          // scope for v0. So: default model (gpt-4o-transcribe), no prompt — the
          // far_field + VAD tuning is the working config. The library now accepts
          // model/prompt for consumers who want them; this dogfood uses neither.
          const broker = makeTranscriptionBroker({ apiKey });
          const token = await broker.mintEphemeralToken();
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(token));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'mint_failed', message }));
        }
      });
    },
  };
}
