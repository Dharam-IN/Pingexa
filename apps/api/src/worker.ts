import { Worker, type Job } from 'bullmq';
import { env, envFileUsed } from './config/env.js';
import { describeError, logger } from './lib/logger.js';
import { disconnectPrisma, pingDatabase } from './lib/prisma.js';
import { createQueueConnection, closeSharedRedis } from './lib/redis.js';
import { closeMailTransport } from './mail/transport.js';
import { runRetention } from './monitoring/retention.js';
import { dispatchDueChecks, reconcileSchedules } from './monitoring/scheduler.js';
import {
  QUEUE_CHECKS,
  QUEUE_EMAIL,
  closeQueues,
  queues,
  alertJobId,
  type CheckJobData,
  type EmailJobData,
} from './queue/queues.js';
import { handleCheckJob } from './worker/checkJob.js';
import { handleEmailJob, reconcilePendingAlerts } from './worker/emailJob.js';

/**
 * Worker process entrypoint. Runs four things, all independent of the API:
 *
 *  * the scheduler tick, which claims due monitors from Postgres and enqueues
 *    check jobs;
 *  * the check queue consumer, which performs the outbound requests;
 *  * the email queue consumer, which delivers verification, reset and alert mail;
 *  * periodic maintenance: retention cleanup, schedule reconciliation and
 *    pending-alert reconciliation.
 *
 * The scheduler is a plain interval rather than a BullMQ repeatable job on
 * purpose: it must keep working after a Redis flush, and the schedule it reads
 * lives in Postgres. See docs/DECISIONS.md D4.
 */

const ALERT_RECONCILE_EVERY_TICKS = 4;

async function main(): Promise<void> {
  const databaseReachable = await pingDatabase();
  if (!databaseReachable) {
    logger.fatal('worker cannot start without a reachable database');
    process.exit(1);
  }

  const queueHandles = queues();
  const checkConnection = createQueueConnection();
  const emailConnection = createQueueConnection();
  for (const connection of [checkConnection, emailConnection]) {
    connection.on('error', (error: Error) => {
      logger.warn({ err: error.message }, 'worker redis connection error');
    });
  }

  const repaired = await reconcileSchedules();
  if (repaired > 0) logger.info({ repaired }, 'reconciled monitor schedules at startup');

  const checkWorker = new Worker<CheckJobData>(
    QUEUE_CHECKS,
    async (job: Job<CheckJobData>) => handleCheckJob(job.data),
    {
      connection: checkConnection,
      prefix: env.QUEUE_PREFIX,
      concurrency: env.WORKER_CHECK_CONCURRENCY,
      // A check that outlives this has already blown its own time budget.
      lockDuration: env.MONITOR_TIMEOUT_MS * 3,
    },
  );

  const emailWorker = new Worker<EmailJobData>(
    QUEUE_EMAIL,
    async (job: Job<EmailJobData>) =>
      handleEmailJob(job.data, {
        attempt: job.attemptsMade + 1,
        maxAttempts: job.opts.attempts ?? env.MAIL_MAX_ATTEMPTS,
      }),
    {
      connection: emailConnection,
      prefix: env.QUEUE_PREFIX,
      concurrency: env.WORKER_EMAIL_CONCURRENCY,
      lockDuration: 60_000,
    },
  );

  for (const [name, worker] of [
    ['checks', checkWorker],
    ['email', emailWorker],
  ] as const) {
    worker.on('failed', (job, error) => {
      logger.error(
        { queue: name, jobId: job?.id, attemptsMade: job?.attemptsMade, err: describeError(error) },
        'job failed',
      );
    });
    worker.on('error', (error) => {
      logger.error({ queue: name, err: describeError(error) }, 'worker error');
    });
  }

  let tick = 0;
  let ticking = false;
  const schedulerTimer = setInterval(() => {
    // Never let two ticks overlap: a slow tick must not stack up work.
    if (ticking) return;
    ticking = true;
    tick += 1;
    const currentTick = tick;
    void (async () => {
      try {
        const summary = await dispatchDueChecks(queueHandles);
        if (summary.claimed > 0) {
          logger.info({ ...summary }, 'dispatched due checks');
        }
        if (currentTick % ALERT_RECONCILE_EVERY_TICKS === 0) {
          await reconcilePendingAlerts(async (notificationId, kind) => {
            await queueHandles.email.add(
              'alert',
              { kind: 'alert', notificationId, notificationKind: kind },
              { jobId: alertJobId(notificationId) },
            );
          });
          await reconcileSchedules();
        }
      } catch (error) {
        logger.error({ err: describeError(error) }, 'scheduler tick failed');
      } finally {
        ticking = false;
      }
    })();
  }, env.SCHEDULER_TICK_MS);

  const retentionTimer = setInterval(() => {
    void runRetention()
      .then((summary) => logger.info({ ...summary }, 'retention cleanup complete'))
      .catch((error) => logger.error({ err: describeError(error) }, 'retention cleanup failed'));
  }, env.RETENTION_INTERVAL_MS);

  // Run one cleanup shortly after boot so a long-lived gap is closed promptly.
  const initialRetention = setTimeout(() => {
    void runRetention()
      .then((summary) => logger.info({ ...summary }, 'initial retention cleanup complete'))
      .catch((error) => logger.error({ err: describeError(error) }, 'retention cleanup failed'));
  }, 10_000);

  logger.info(
    {
      nodeEnv: env.NODE_ENV,
      envFile: envFileUsed ?? '(process environment only)',
      schedulerTickMs: env.SCHEDULER_TICK_MS,
      monitorIntervalSeconds: env.MONITOR_INTERVAL_SECONDS,
      checkConcurrency: env.WORKER_CHECK_CONCURRENCY,
      emailConcurrency: env.WORKER_EMAIL_CONCURRENCY,
    },
    'pingexa worker started',
  );

  installShutdownHandlers(async () => {
    clearInterval(schedulerTimer);
    clearInterval(retentionTimer);
    clearTimeout(initialRetention);
    // `close()` waits for in-flight jobs, so a check in progress finishes and
    // records its result instead of being abandoned and retried.
    await Promise.allSettled([checkWorker.close(), emailWorker.close()]);
    await closeQueues();
    await Promise.allSettled([checkConnection.quit(), emailConnection.quit()]);
    await closeMailTransport();
    await closeSharedRedis();
    await disconnectPrisma();
  });
}

function installShutdownHandlers(cleanup: () => Promise<void>): void {
  let shuttingDown = false;

  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'worker shutting down');

    const force = setTimeout(() => {
      logger.warn('forced exit after shutdown timeout');
      process.exit(1);
    }, 30_000);
    force.unref();

    void cleanup()
      .then(() => {
        clearTimeout(force);
        logger.info('worker stopped');
        process.exit(0);
      })
      .catch((error) => {
        logger.error({ err: describeError(error) }, 'error during worker shutdown');
        process.exit(1);
      });
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
  logger.fatal({ err: describeError(error) }, 'worker failed to start');
  process.exit(1);
});
