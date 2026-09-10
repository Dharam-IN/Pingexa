import { prisma } from '../../src/lib/prisma.js';

/**
 * Empties every table between test cases.
 *
 * `TRUNCATE ... CASCADE` in one statement is both faster than per-table deletes
 * and immune to foreign-key ordering. `RESTART IDENTITY` keeps sequences
 * predictable.
 */
export async function resetDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "notifications",
      "incidents",
      "checks",
      "monitors",
      "status_pages",
      "auth_tokens",
      "sessions",
      "users"
    RESTART IDENTITY CASCADE
  `);
}

export async function closeDatabase(): Promise<void> {
  await prisma.$disconnect();
}
