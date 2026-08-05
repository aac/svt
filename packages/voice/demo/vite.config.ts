import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Demo vite config for packages/voice/demo.
 *
 * The token endpoint is the only server-side piece:
 *   POST /api/realtime/token → mints an ephemeral OpenAI transcription token.
 *
 * The OPENAI_API_KEY env var is read at server start via the plugin below.
 * The key never reaches the browser — it's only used server-side to call
 * OpenAI's session-create endpoint.
 *
 * Run from packages/voice/: OPENAI_API_KEY=sk-... pnpm demo
 * Run from packages/voice/demo/: OPENAI_API_KEY=sk-... pnpm dev
 */
export default defineConfig({
  plugins: [
    react(),
    // Inline token-mint plugin — wires the broker as a Vite dev-server middleware.
    // This is the simplest possible server-side setup for a standalone demo:
    // no Express, no Hono, no Node http — just a Vite plugin that adds one route.
    voiceTokenPlugin(),
  ],
});

function voiceTokenPlugin() {
  return {
    name: 'voice-token-plugin',
    configureServer(server: import('vite').ViteDevServer) {
      server.middlewares.use('/api/realtime/token', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Method Not Allowed');
          return;
        }

        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
          res.statusCode = 503;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              error: 'openai_unconfigured',
              message:
                'OPENAI_API_KEY is not set. Run: OPENAI_API_KEY=sk-... pnpm dev',
            }),
          );
          return;
        }

        try {
          // Dynamic import so vite doesn't bundle OpenAI into the client.
          const { makeTranscriptionBroker } = await import('../src/server.js');
          const broker = makeTranscriptionBroker({ apiKey });
          const token = await broker.mintEphemeralToken();
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(token));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error('[voice-demo] token mint failed:', message);
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'mint_failed', message }));
        }
      });
    },
  };
}
