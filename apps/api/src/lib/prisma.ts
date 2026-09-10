import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { env } from '../config/env.js';
import { logger } from './logger.js';

/**
 * Prisma 7 talks to Postgres through a driver adapter, so the connection pool is
 * `pg`'s. Each process (API, worker, a test run) creates exactly one client and
 * therefore one pool; `DATABASE_POOL_MAX` is per process, not per deployment.
 */
const adapter = new PrismaPg({
  connectionString: env.DATABASE_URL,
  max: env.DATABASE_POOL_MAX,
  // Fail fast instead of hanging a request when the database is unreachable.
  connectionTimeoutMillis: 10_000,
});

export const prisma = new PrismaClient({ adapter });

export type Prisma = typeof prisma;

/** A transaction client: the subset of `prisma` available inside `$transaction`. */
export type TxClient = Parameters<Parameters<Prisma['$transaction']>[0]>[0];

/** Postgres unique-violation SQLSTATE, surfaced by Prisma as P2002. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

/** Postgres CHECK/constraint violation, surfaced by Prisma as P2010/P2004/23514. */
export function isCheckViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  if (code === 'P2004') return true;
  const meta = (error as { meta?: { code?: unknown } }).meta;
  return meta?.code === '23514';
}

export async function pingDatabase(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    logger.warn({ err: error instanceof Error ? error.message : String(error) }, 'database ping failed');
    return false;
  }
}

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
