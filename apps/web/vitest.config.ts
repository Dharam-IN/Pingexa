import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Component and formatting tests. The API is never called here — everything that
 * needs a real API is covered by the integration suite in `apps/api` or by the
 * Playwright suite in `e2e/`.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test-setup.ts'],
    globals: false,
  },
});
