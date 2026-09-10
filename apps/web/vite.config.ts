import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * The dev server proxies `/api` to the Express API so the browser sees one
 * origin in development. That keeps cookies first-party locally without needing
 * CORS, while the API still enforces CORS and the CSRF origin allowlist for the
 * deployed case where the two are served from different origins.
 */
const API_TARGET = process.env['VITE_API_PROXY_TARGET'] ?? 'http://127.0.0.1:4000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env['VITE_PORT'] ?? 5173),
    strictPort: true,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: false },
    },
  },
  preview: {
    port: Number(process.env['VITE_PREVIEW_PORT'] ?? 5174),
    strictPort: true,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
