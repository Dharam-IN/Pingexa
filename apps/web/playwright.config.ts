import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end browser tests.
 *
 * These run against the real stack: the Vite dev server, the Express API, the
 * worker, Postgres, Redis and Mailpit. Nothing is stubbed — verification emails
 * are read out of Mailpit's API exactly as a person would read their inbox.
 *
 * Start the stack first (see docs/HANDOVER.md):
 *   docker compose -f docker-compose.dev.yml up -d
 *   npm run dev:api & npm run dev:worker & npm run dev:web
 */
const BASE_URL = process.env['E2E_BASE_URL'] ?? 'http://127.0.0.1:5173';

export default defineConfig({
  testDir: './e2e',
  // Each spec creates its own account, but they share one database, so keep the
  // run serial to make failures easy to read.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    // The responsive layout is a requirement, so it is tested, not eyeballed.
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
});
