import { defineConfig } from 'vitest/config';
import { TEST_ENV } from './tests/env.js';

/**
 * Two projects:
 *  * `unit` — pure logic (SSRF address policy, URL guard, uptime maths, email
 *    templates). No Postgres, no Redis, no network.
 *  * `integration` — real Postgres and real Redis against a disposable
 *    `pingexa_test` database created by `tests/globalSetup.ts`.
 */
export default defineConfig({
  test: {
    env: TEST_ENV,
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
          env: TEST_ENV,
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          env: TEST_ENV,
          globalSetup: ['./tests/globalSetup.ts'],
          // Integration tests share one database and truncate between cases,
          // so they must not run in parallel with each other.
          fileParallelism: false,
          hookTimeout: 60_000,
          testTimeout: 60_000,
        },
      },
    ],
  },
});
