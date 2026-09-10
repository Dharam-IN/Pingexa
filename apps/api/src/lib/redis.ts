import { Redis, type RedisOptions } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from './logger.js';

/**
 * BullMQ requires `maxRetriesPerRequest: null` on the connections it owns,
 * otherwise a blocking `BRPOPLPUSH` will throw during a reconnect and kill the
 * worker. Connections used for ordinary commands (rate limiting, readiness) keep
 * the default retry behaviour so a failed command surfaces quickly.
 */
const baseOptions: RedisOptions = {
  enableReadyCheck: true,
  // Grow the delay so a Redis restart does not produce a reconnect storm.
  retryStrategy: (attempt) => Math.min(attempt * 200, 5_000),
};

export function createQueueConnection(): Redis {
  return new Redis(env.REDIS_URL, {
    ...baseOptions,
    maxRetriesPerRequest: null,
  });
}

export function createCommandConnection(): Redis {
  return new Redis(env.REDIS_URL, { ...baseOptions, maxRetriesPerRequest: 2 });
}

let sharedCommandConnection: Redis | undefined;

/** Lazily created connection for rate limiting and readiness probes. */
export function commandRedis(): Redis {
  if (!sharedCommandConnection) {
    sharedCommandConnection = createCommandConnection();
    sharedCommandConnection.on('error', (error: Error) => {
      logger.warn({ err: error.message }, 'redis command connection error');
    });
  }
  return sharedCommandConnection;
}

export async function pingRedis(): Promise<boolean> {
  try {
    const reply = await commandRedis().ping();
    return reply === 'PONG';
  } catch (error) {
    logger.warn(
      { err: error instanceof Error ? error.message : String(error) },
      'redis ping failed',
    );
    return false;
  }
}

export async function closeSharedRedis(): Promise<void> {
  if (sharedCommandConnection) {
    await sharedCommandConnection.quit().catch(() => sharedCommandConnection?.disconnect());
    sharedCommandConnection = undefined;
  }
}
