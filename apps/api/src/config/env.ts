import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

/**
 * Finds the environment file to load.
 *
 * `PINGEXA_ENV_FILE` wins, which is how the integration suite and the
 * fresh-setup verification point a process at an isolated database without
 * touching the developer's `.env`. Otherwise we walk up from the current working
 * directory so `npm run dev:api` works from the repo root or from `apps/api`.
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

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((value) => {
    if (typeof value === 'boolean') return value;
    const normalised = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalised)) return true;
    if (['0', 'false', 'no', 'off', ''].includes(normalised)) return false;
    throw new Error(`Expected a boolean, received "${value}"`);
  });

const intFromEnv = (min: number, max: number) =>
  z.coerce.number().int().min(min).max(max);

const originList = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0),
  )
  .refine((list) => list.length > 0, 'At least one trusted origin is required')
  .refine(
    (list) => list.every((origin) => /^https?:\/\/[^/]+$/.test(origin)),
    'Each trusted origin must be a scheme + host with no path, e.g. https://app.example.com',
  );

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: intFromEnv(1, 65535).default(4000),
  API_HOST: z.string().min(1).default('127.0.0.1'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
  LOG_PRETTY: booleanish.default(false),

  PUBLIC_APP_URL: z
    .string()
    .refine((value) => {
      try {
        const url = new URL(value);
        return (url.protocol === 'http:' || url.protocol === 'https:') && !value.endsWith('/');
      } catch {
        return false;
      }
    }, 'PUBLIC_APP_URL must be an absolute http(s) URL with no trailing slash'),
  TRUSTED_ORIGINS: originList,

  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: intFromEnv(1, 200).default(10),

  REDIS_URL: z.string().min(1),
  QUEUE_PREFIX: z
    .string()
    .regex(/^[A-Za-z0-9_:-]{1,40}$/, 'QUEUE_PREFIX must be short and alphanumeric')
    .default('pingexa'),

  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  SESSION_TTL_DAYS: intFromEnv(1, 365).default(30),
  COOKIE_SECURE: booleanish.default(false),
  COOKIE_SAMESITE: z.enum(['Lax', 'Strict', 'None']).default('Lax'),
  COOKIE_DOMAIN: z.string().min(1).optional(),

  TRUST_PROXY_HOPS: intFromEnv(0, 10).default(0),

  MONITOR_INTERVAL_SECONDS: intFromEnv(1, 86400).default(300),
  SCHEDULER_TICK_MS: intFromEnv(100, 600000).default(15000),
  MONITOR_TIMEOUT_MS: intFromEnv(500, 60000).default(10000),
  MONITOR_MAX_RESPONSE_BYTES: intFromEnv(1024, 10485760).default(65536),
  WORKER_CHECK_CONCURRENCY: intFromEnv(1, 100).default(5),
  WORKER_EMAIL_CONCURRENCY: intFromEnv(1, 50).default(2),
  MONITOR_USER_AGENT: z.string().min(1).default('Pingexa/1.0 (+uptime monitor)'),

  CHECK_RETENTION_DAYS: intFromEnv(1, 365).default(7),
  INCIDENT_RETENTION_DAYS: intFromEnv(1, 3650).default(90),
  RETENTION_INTERVAL_MS: intFromEnv(60000, 86400000).default(3600000),

  SMTP_HOST: z.string().min(1),
  SMTP_PORT: intFromEnv(1, 65535).default(1025),
  SMTP_SECURE: booleanish.default(false),
  SMTP_USER: z.string().default(''),
  SMTP_PASSWORD: z.string().default(''),
  SMTP_REJECT_UNAUTHORIZED: booleanish.default(true),
  MAIL_FROM_NAME: z.string().min(1).default('Pingexa'),
  MAIL_FROM_ADDRESS: z.email(),
  MAIL_MAX_ATTEMPTS: intFromEnv(1, 20).default(5),

  AUTH_RATE_LIMIT_WINDOW_MS: intFromEnv(1000, 86400000).default(900000),
  AUTH_RATE_LIMIT_MAX: intFromEnv(1, 100000).default(15),
  API_RATE_LIMIT_WINDOW_MS: intFromEnv(1000, 86400000).default(60000),
  API_RATE_LIMIT_MAX: intFromEnv(1, 1000000).default(300),
  PUBLIC_RATE_LIMIT_WINDOW_MS: intFromEnv(1000, 86400000).default(60000),
  PUBLIC_RATE_LIMIT_MAX: intFromEnv(1, 1000000).default(60),

  SEED_USER_EMAIL: z.email().default('demo@pingexa.local'),
  SEED_USER_PASSWORD: z.string().min(8).default('demo-password-123'),
});

export type Env = z.infer<typeof envSchema>;

function parseEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment configuration.\n${details}\n` +
        `Copy .env.example to .env and fill in the missing values.`,
    );
  }

  const env = parsed.data;

  // Cross-field rules that a per-field schema cannot express.
  const problems: string[] = [];
  if (env.NODE_ENV === 'production') {
    if (!env.COOKIE_SECURE) {
      problems.push('COOKIE_SECURE must be true when NODE_ENV=production');
    }
    if (!env.SMTP_REJECT_UNAUTHORIZED) {
      problems.push('SMTP_REJECT_UNAUTHORIZED must be true when NODE_ENV=production');
    }
    if (env.PUBLIC_APP_URL.startsWith('http://')) {
      problems.push('PUBLIC_APP_URL must use https when NODE_ENV=production');
    }
    if (env.MONITOR_INTERVAL_SECONDS !== 300) {
      problems.push('MONITOR_INTERVAL_SECONDS must stay at 300 when NODE_ENV=production');
    }
    if (env.SESSION_SECRET.startsWith('replace-me')) {
      problems.push('SESSION_SECRET is still the example value');
    }
  }
  if (env.COOKIE_SAMESITE === 'None' && !env.COOKIE_SECURE) {
    problems.push('COOKIE_SAMESITE=None requires COOKIE_SECURE=true');
  }
  if (problems.length > 0) {
    throw new Error(`Invalid environment configuration.\n${problems.map((p) => `  ${p}`).join('\n')}`);
  }

  return env;
}

export const env: Env = parseEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

/** Where the loaded configuration came from, for the startup log line. */
export const envFileUsed = envFile;
