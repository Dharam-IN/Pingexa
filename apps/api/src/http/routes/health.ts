import { Router } from 'express';
import {
  CHECK_RETENTION_DAYS,
  DEFAULT_MONITOR_INTERVAL_SECONDS,
  FAILURE_THRESHOLD,
  MAX_MONITORS_PER_USER,
  MIN_PASSWORD_LENGTH,
  type HealthResponse,
  type ReadyResponse,
} from '@pingexa/shared';
import { pingDatabase } from '../../lib/prisma.js';
import { pingRedis } from '../../lib/redis.js';
import { asyncHandler } from '../middleware/errorHandler.js';

export const healthRouter = Router();

const startedAt = Date.now();
const VERSION = process.env['npm_package_version'] ?? '1.0.0';

/**
 * Liveness: is this process running and able to answer? Deliberately does not
 * touch Postgres or Redis, so a database blip does not make an orchestrator kill
 * a healthy API process.
 */
healthRouter.get('/health', (_req, res) => {
  const body: HealthResponse = {
    status: 'ok',
    service: 'pingexa-api',
    version: VERSION,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
  };
  res.status(200).json(body);
});

/**
 * Readiness: should traffic be routed here? This one does check dependencies,
 * and returns 503 when either is unavailable.
 */
healthRouter.get(
  '/ready',
  asyncHandler(async (_req, res) => {
    const [database, redis] = await Promise.all([pingDatabase(), pingRedis()]);
    const ready = database && redis;
    const body: ReadyResponse = {
      status: ready ? 'ready' : 'degraded',
      checks: { database, redis },
    };
    res.status(ready ? 200 : 503).json(body);
  }),
);

/**
 * Public, unauthenticated description of the product's fixed rules, so the web
 * app displays real limits instead of hardcoded copy that can drift.
 */
healthRouter.get('/meta', (_req, res) => {
  res.status(200).json({
    monitorLimit: MAX_MONITORS_PER_USER,
    intervalSeconds: DEFAULT_MONITOR_INTERVAL_SECONDS,
    failureThreshold: FAILURE_THRESHOLD,
    checkRetentionDays: CHECK_RETENTION_DAYS,
    minPasswordLength: MIN_PASSWORD_LENGTH,
  });
});
