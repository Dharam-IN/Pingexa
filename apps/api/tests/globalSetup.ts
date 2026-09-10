import { execFileSync } from 'node:child_process';
import { Client } from 'pg';
import { adminDatabaseUrl, TEST_DATABASE_NAME, testDatabaseUrl, TEST_ENV } from './env.js';

/**
 * Creates a disposable integration database and applies the committed
 * migrations to it.
 *
 * This is also the fresh-setup check: the schema under test is built only from
 * `prisma/migrations`, never from `prisma db push`, so a drift between the
 * schema file and the migrations fails the test run instead of hiding until
 * someone deploys.
 *
 * The development database is not dropped, recreated, or connected to for
 * anything other than reading its host/credentials.
 */
export default async function globalSetup(): Promise<void> {
  if (!/^[a-z0-9_]+$/.test(TEST_DATABASE_NAME)) {
    throw new Error(`Refusing to use an unsafe test database name: ${TEST_DATABASE_NAME}`);
  }

  const admin = new Client({ connectionString: adminDatabaseUrl() });
  await admin.connect();
  try {
    // Terminate leftover connections from a previous interrupted run so DROP
    // does not block.
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [TEST_DATABASE_NAME],
    );
    await admin.query(`DROP DATABASE IF EXISTS "${TEST_DATABASE_NAME}"`);
    await admin.query(`CREATE DATABASE "${TEST_DATABASE_NAME}"`);
  } finally {
    await admin.end();
  }

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, ...TEST_ENV, DATABASE_URL: testDatabaseUrl() },
    stdio: 'pipe',
  });
}
