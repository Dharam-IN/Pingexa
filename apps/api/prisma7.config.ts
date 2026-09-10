import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import dotenv from 'dotenv';
import { defineConfig } from 'prisma/config';

/**
 * The Prisma CLI runs this file in its own process, so it loads the repository
 * root `.env` itself. `PINGEXA_ENV_FILE` lets the integration/fresh-setup runs
 * point the CLI at an isolated database without touching the dev `.env`.
 */
function resolveEnvFile(): string | undefined {
  const explicit = process.env['PINGEXA_ENV_FILE'];
  if (explicit) return resolve(process.cwd(), explicit);
  let dir = process.cwd();
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = resolve(dir, '.env');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

const envFile = resolveEnvFile();
if (envFile) dotenv.config({ path: envFile, quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env['DATABASE_URL'],
  },
});
