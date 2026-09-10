/**
 * Environment for test runs, shared by the unit and integration projects.
 *
 * The integration database is a separate Postgres database (`pingexa_test`) in
 * the development container, created and migrated from the committed migrations
 * by `tests/globalSetup.ts`. The development database is never touched.
 *
 * Redis uses logical database 1 and its own queue prefix, so a test run cannot
 * disturb the development queues on database 0.
 */
const devUrl = process.env['DATABASE_URL'] ?? 'postgresql://pingexa:pingexa_dev_password@127.0.0.1:55433/pingexa_dev';

export const TEST_DATABASE_NAME = process.env['TEST_DATABASE_NAME'] ?? 'pingexa_test';

export function adminDatabaseUrl(): string {
  const url = new URL(devUrl);
  url.pathname = '/postgres';
  return url.toString();
}

export function testDatabaseUrl(): string {
  const url = new URL(devUrl);
  url.pathname = `/${TEST_DATABASE_NAME}`;
  return url.toString();
}

export const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: testDatabaseUrl(),
  DATABASE_POOL_MAX: '5',
  REDIS_URL: (process.env['TEST_REDIS_URL'] ?? 'redis://127.0.0.1:56379/1'),
  QUEUE_PREFIX: 'pingexa_test',
  SESSION_SECRET: 'test-session-secret-value-that-is-long-enough-0123456789',
  PUBLIC_APP_URL: 'http://localhost:5173',
  TRUSTED_ORIGINS: 'http://localhost:5173',
  COOKIE_SECURE: 'false',
  LOG_LEVEL: 'silent',
  LOG_PRETTY: 'false',
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: '58025',
  SMTP_SECURE: 'false',
  SMTP_REJECT_UNAUTHORIZED: 'false',
  MAIL_FROM_ADDRESS: 'alerts@pingexa.local',
  MAIL_FROM_NAME: 'Pingexa Test',
  MONITOR_INTERVAL_SECONDS: '300',
  MONITOR_TIMEOUT_MS: '3000',
  SCHEDULER_TICK_MS: '1000',
  CHECK_RETENTION_DAYS: '7',
  INCIDENT_RETENTION_DAYS: '90',
};
