import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { runHttpCheck } from '../monitoring/httpCheck.js';
import { processCheckResult } from '../monitoring/resultProcessor.js';
import { enqueueEmail, type CheckJobData } from '../queue/queues.js';
import { DEFAULT_MAX_LAG_INTERVALS } from '../monitoring/scheduler.js';
import type { UrlGuard } from '../monitoring/urlGuard.js';

export type CheckJobOutcome =
  | 'recorded'
  | 'duplicate'
  | 'monitor_missing'
  | 'monitor_paused'
  | 'email_unverified'
  | 'stale_slot';

export interface HandleCheckJobOptions {
  /** Injected by integration tests that point at a loopback fixture server. */
  readonly guard?: UrlGuard;
  readonly failureThreshold?: number;
  readonly maxLagIntervals?: number;
  readonly now?: () => Date;
}

/**
 * Executes one queued check.
 *
 * Order matters here. Every reason to *not* perform the check is evaluated
 * before the outbound request, so a monitor that was paused, deleted or edited
 * after the job was queued never causes traffic to the target and never records
 * a result:
 *
 *  1. Monitor gone -> nothing to do.
 *  2. Monitor paused -> paused monitors must not generate checks or alerts.
 *  3. Account no longer verified -> monitoring is gated on a verified email.
 *  4. Slot too old -> a job delivered long after its slot (a worker outage, a
 *     queue backlog) is dropped rather than recorded. Recording it would either
 *     invent a failure for a time we were not watching, or attribute a fresh
 *     result to a stale slot.
 *  5. Slot already recorded -> short-circuit before spending an HTTP request.
 *     This is an optimisation, not the correctness guarantee: the authoritative
 *     protection is the unique index checked inside `processCheckResult`.
 *
 * The URL is read from the database at this moment, so an edit that landed while
 * the job was queued is honoured.
 */
export async function handleCheckJob(
  data: CheckJobData,
  options: HandleCheckJobOptions = {},
): Promise<CheckJobOutcome> {
  const now = options.now ?? (() => new Date());
  const scheduledFor = new Date(data.scheduledFor);

  const monitor = await prisma.monitor.findUnique({
    where: { id: data.monitorId },
    select: {
      id: true,
      url: true,
      name: true,
      paused: true,
      intervalSeconds: true,
      user: { select: { emailVerifiedAt: true } },
    },
  });

  if (!monitor) return 'monitor_missing';
  if (monitor.paused) return 'monitor_paused';
  if (monitor.user.emailVerifiedAt === null) return 'email_unverified';

  const maxLagMs =
    (options.maxLagIntervals ?? DEFAULT_MAX_LAG_INTERVALS) * monitor.intervalSeconds * 1000;
  if (now().getTime() - scheduledFor.getTime() > maxLagMs) {
    logger.warn(
      { monitorId: monitor.id, scheduledFor: data.scheduledFor },
      'dropping check job for a stale slot',
    );
    return 'stale_slot';
  }

  const alreadyRecorded = await prisma.check.findUnique({
    where: { monitorId_scheduledFor: { monitorId: monitor.id, scheduledFor } },
    select: { id: true },
  });
  if (alreadyRecorded) return 'duplicate';

  const result = await runHttpCheck(monitor.url, {
    ...(options.guard ? { guard: options.guard } : {}),
    timeoutMs: env.MONITOR_TIMEOUT_MS,
    maxResponseBytes: env.MONITOR_MAX_RESPONSE_BYTES,
  });

  const processed = await processCheckResult({
    monitorId: monitor.id,
    scheduledFor,
    result,
    ...(options.failureThreshold === undefined
      ? {}
      : { failureThreshold: options.failureThreshold }),
  });

  logger.info(
    {
      monitorId: monitor.id,
      scheduledFor: data.scheduledFor,
      outcome: result.outcome,
      statusCode: result.statusCode ?? null,
      responseTimeMs: result.responseTimeMs ?? null,
      failureKind: result.outcome === 'DOWN' ? result.failureKind : undefined,
      status: processed.status,
      consecutiveFailures: processed.consecutiveFailures,
      incidentOpened: processed.incidentOpened,
      incidentResolved: processed.incidentResolved,
    },
    'check completed',
  );

  // Enqueue alerts only after the transaction has committed. Anything that
  // fails to enqueue stays PENDING and is retried by the reconciliation pass,
  // so a Redis hiccup loses no incident and no alert.
  for (const notification of processed.notifications) {
    try {
      await enqueueEmail({
        kind: 'alert',
        notificationId: notification.id,
        notificationKind: notification.kind,
      });
    } catch (error) {
      logger.error(
        {
          notificationId: notification.id,
          err: error instanceof Error ? error.message : String(error),
        },
        'failed to enqueue alert email; left PENDING for reconciliation',
      );
    }
  }

  return processed.status;
}
