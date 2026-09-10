import rateLimit, { ipKeyGenerator, type Options } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import type { Request, RequestHandler } from 'express';
import { env, isTest } from '../../config/env.js';
import { commandRedis } from '../../lib/redis.js';
import { logger } from '../../lib/logger.js';

/**
 * Rate limits are backed by Redis so they hold across API instances; a
 * per-process memory store would let a caller multiply their allowance by the
 * number of replicas.
 *
 * If Redis is unavailable the limiter falls back to allowing the request rather
 * than failing it: losing rate limiting temporarily is less bad than taking the
 * whole API down. That choice is logged.
 */
function store(prefix: string) {
  return new RedisStore({
    prefix: `${env.QUEUE_PREFIX}:rl:${prefix}:`,
    sendCommand: async (...args: string[]) =>
      commandRedis().call(args[0] as string, ...args.slice(1)) as Promise<never>,
  });
}

interface LimiterSpec {
  readonly name: string;
  readonly windowMs: number;
  readonly max: number;
  readonly keyGenerator?: (req: Request) => string;
  readonly message: string;
}

function build(spec: LimiterSpec): RequestHandler {
  const options: Partial<Options> = {
    windowMs: spec.windowMs,
    limit: spec.max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    store: store(spec.name),
    // `ipKeyGenerator` normalises IPv6 into a /64 so a single client cannot
    // rotate through its own address space to reset the counter.
    keyGenerator: spec.keyGenerator ?? ((req: Request) => ipKeyGenerator(req.ip ?? 'unknown')),
    handler: (req, res) => {
      logger.warn({ path: req.path, ip: req.ip, limiter: spec.name }, 'rate limit hit');
      res.status(429).json({ error: { code: 'rate_limited', message: spec.message } });
    },
    // A failing Redis must not fail requests.
    passOnStoreError: true,
  };
  return rateLimit(options);
}

/** No-op limiter used in tests, where deterministic behaviour matters more. */
const passthrough: RequestHandler = (_req, _res, next) => next();

/**
 * Authentication endpoints. Keyed by IP *and* by the submitted email, so an
 * attacker spreading a password-spray across many addresses is still limited per
 * address, and a victim's account is not locked out by someone else's IP.
 */
export const authLimiter: RequestHandler = isTest
  ? passthrough
  : build({
      name: 'auth',
      windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
      max: env.AUTH_RATE_LIMIT_MAX,
      keyGenerator: (req) => {
        const body = req.body as { email?: unknown } | undefined;
        const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
        return `${ipKeyGenerator(req.ip ?? 'unknown')}|${email}`;
      },
      message: 'Too many attempts. Wait a few minutes and try again.',
    });

/** Everything behind a session. Keyed by user id so one noisy tab is contained. */
export const apiLimiter: RequestHandler = isTest
  ? passthrough
  : build({
      name: 'api',
      windowMs: env.API_RATE_LIMIT_WINDOW_MS,
      max: env.API_RATE_LIMIT_MAX,
      keyGenerator: (req) => req.auth?.user.id ?? ipKeyGenerator(req.ip ?? 'unknown'),
      message: 'Too many requests. Slow down and try again.',
    });

/** Unauthenticated public status pages, keyed by IP. */
export const publicLimiter: RequestHandler = isTest
  ? passthrough
  : build({
      name: 'public',
      windowMs: env.PUBLIC_RATE_LIMIT_WINDOW_MS,
      max: env.PUBLIC_RATE_LIMIT_MAX,
      message: 'Too many requests. Try again shortly.',
    });

/** Monitor creation: a much tighter cap than the general API limit. */
export const monitorWriteLimiter: RequestHandler = isTest
  ? passthrough
  : build({
      name: 'monitor-write',
      windowMs: 60_000,
      max: 20,
      keyGenerator: (req) => req.auth?.user.id ?? ipKeyGenerator(req.ip ?? 'unknown'),
      message: 'Too many monitor changes. Wait a moment and try again.',
    });
