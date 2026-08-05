import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Vite config for the demo page only.
 * Run: pnpm demo (or npm run demo)
 * Opens at http://localhost:5173/
 */
export default defineConfig({
  plugins: [react()],
  root: 'demo',
  build: {
    outDir: '../dist-demo',
    emptyOutDir: true,
  },
});
