import type { Server } from 'node:http';
import { env, envFileUsed } from './config/env.js';
import { describeError, logger } from './lib/logger.js';
import { disconnectPrisma, pingDatabase } from './lib/prisma.js';
import { closeSharedRedis } from './lib/redis.js';
import { closeQueues } from './queue/queues.js';
import { createApp } from './http/app.js';

/**
 * API process entrypoint. Serves HTTP only: it enqueues email jobs but runs no
 * queue consumers and no scheduler. Start the worker separately with
 * `npm run start:worker` (or `npm run dev:worker`).
 */
async function main(): Promise<void> {
  const app = createApp();

  const databaseReachable = await pingDatabase();
  if (!databaseReachable) {
    // Start anyway so /health answers and an orchestrator sees a live process,
    // but say so loudly: /ready will report degraded until the database is back.
    logger.error('database is not reachable at startup; /api/ready will report degraded');
  }

  const server: Server = app.listen(env.API_PORT, env.API_HOST, () => {
    logger.info(
      {
        port: env.API_PORT,
        host: env.API_HOST,
        nodeEnv: env.NODE_ENV,
        envFile: envFileUsed ?? '(process environment only)',
        trustedOrigins: env.TRUSTED_ORIGINS,
      },
      'pingexa api listening',
    );
  });

  // Bound how long a stalled request can hold a socket.
  server.requestTimeout = 30_000;
  server.headersTimeout = 20_000;
  server.keepAliveTimeout = 30_000;

  installShutdownHandlers(server);
}

/**
 * Graceful shutdown: stop accepting connections, let in-flight requests finish,
 * then release the database, Redis and queue handles. A hard exit after 15 s
 * stops a stuck socket from blocking a deploy forever.
 */
function installShutdownHandlers(server: Server): void {
  let shuttingDown = false;

  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'api shutting down');

    const force = setTimeout(() => {
      logger.warn('forced exit after shutdown timeout');
      process.exit(1);
    }, 15_000);
    force.unref();

    server.close(async (error) => {
      if (error) logger.error({ err: describeError(error) }, 'error closing http server');
      try {
        await closeQueues();
        await closeSharedRedis();
        await disconnectPrisma();
      } catch (closeError) {
        logger.error({ err: describeError(closeError) }, 'error during shutdown');
      }
      clearTimeout(force);
      logger.info('api stopped');
      process.exit(error ? 1 : 0);
    });
    // Stop keep-alive sockets from holding the close open.
    server.closeIdleConnections();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: describeError(reason) }, 'unhandled promise rejection');
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: describeError(error) }, 'uncaught exception; exiting');
    process.exit(1);
  });
}

main().catch((error) => {
  logger.fatal({ err: describeError(error) }, 'api failed to start');
  process.exit(1);
});
