// Throwaway config for browser-pane verification only — separate from
// vite.config.ts so it never touches Nadav's own https dev server on 5173.
// http + fixed port so the sandboxed browser pane (which refuses the
// self-signed https cert) can load it.
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    port: 5180,
    strictPort: true,
    https: false
  },
  build: {
    target: 'es2020'
  }
});
