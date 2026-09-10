import { FAILURE_THRESHOLD } from '@pingexa/shared';
import type { NotificationKind } from '@pingexa/shared';
import { isUniqueViolation, prisma } from '../lib/prisma.js';
import type { TxClient } from '../lib/prisma.js';
import type { HttpCheckResult } from './httpCheck.js';

/**
 * Applies one check result to the database and moves the incident state machine.
 *
 * Everything here happens in a single transaction that starts by taking a row
 * lock on the monitor, so two workers processing two slots of the same monitor
 * cannot interleave their reads and writes of the failure streak.
 *
 * Idempotency comes from the `(monitorId, scheduledFor)` unique index, not from
 * the queue: if this slot has already been recorded, the insert conflicts, the
 * whole transaction is rolled back, and the caller is told `duplicate`. That is
 * what stops a redelivered job from advancing the failure streak and inventing
 * downtime.
 */

export type ProcessResultStatus =
  | 'recorded'
  /** This scheduled slot was already recorded. Nothing was changed. */
  | 'duplicate'
  /** The monitor was deleted while the job was queued or running. */
  | 'monitor_missing'
  /** The monitor was paused while the job was queued or running. */
  | 'monitor_paused';

export interface PendingNotification {
  readonly id: string;
  readonly kind: NotificationKind;
}

export interface ProcessResult {
  readonly status: ProcessResultStatus;
  readonly monitorState?: 'PENDING' | 'UP' | 'DOWN';
  readonly consecutiveFailures?: number;
  readonly incidentOpened?: string;
  readonly incidentResolved?: string;
  /**
   * Notifications created by this transaction. The caller enqueues them *after*
   * the commit; anything that fails to enqueue stays PENDING in the database and
   * is picked up by the worker's notification reconciliation pass.
   */
  readonly notifications: readonly PendingNotification[];
}

class DuplicateSlotError extends Error {}
class MonitorGoneError extends Error {}
class MonitorPausedError extends Error {}

export interface ProcessCheckResultArgs {
  readonly monitorId: string;
  readonly scheduledFor: Date;
  readonly result: HttpCheckResult;
  /** Overridable so tests can exercise the threshold without three real checks. */
  readonly failureThreshold?: number;
}

export async function processCheckResult(
  args: ProcessCheckResultArgs,
): Promise<ProcessResult> {
  const threshold = args.failureThreshold ?? FAILURE_THRESHOLD;

  try {
    return await prisma.$transaction(async (tx) => applyResult(tx, args, threshold));
  } catch (error) {
    if (error instanceof DuplicateSlotError || isUniqueViolation(error)) {
      return { status: 'duplicate', notifications: [] };
    }
    if (error instanceof MonitorGoneError) {
      return { status: 'monitor_missing', notifications: [] };
    }
    if (error instanceof MonitorPausedError) {
      return { status: 'monitor_paused', notifications: [] };
    }
    throw error;
  }
}

async function applyResult(
  tx: TxClient,
  args: ProcessCheckResultArgs,
  threshold: number,
): Promise<ProcessResult> {
  // Serialise all state transitions for this monitor.
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "monitors" WHERE "id" = ${args.monitorId}::uuid FOR UPDATE
  `;
  if (locked.length === 0) throw new MonitorGoneError();

  const monitor = await tx.monitor.findUnique({ where: { id: args.monitorId } });
  if (!monitor) throw new MonitorGoneError();
  if (monitor.paused) throw new MonitorPausedError();

  const { result } = args;
  const checkedAt = result.finishedAt;

  // The idempotency gate. A conflict here rolls back everything below.
  const inserted = await tx.check.createMany({
    data: [
      {
        monitorId: monitor.id,
        scheduledFor: args.scheduledFor,
        startedAt: result.startedAt,
        checkedAt,
        outcome: result.outcome,
        statusCode: result.statusCode ?? null,
        responseTimeMs: result.responseTimeMs ?? null,
        failureKind: result.outcome === 'DOWN' ? result.failureKind : null,
        failureReason: result.outcome === 'DOWN' ? result.failureReason : null,
      },
    ],
    skipDuplicates: true,
  });
  if (inserted.count === 0) throw new DuplicateSlotError();

  const notifications: PendingNotification[] = [];

  if (result.outcome === 'UP') {
    let incidentResolved: string | undefined;

    // Close an open incident. `resolvedAt: null` in the WHERE clause means only
    // one transaction can ever be the one that closes it.
    const open = await tx.incident.findFirst({
      where: { monitorId: monitor.id, resolvedAt: null },
      select: { id: true },
    });
    if (open) {
      const closed = await tx.incident.updateMany({
        where: { id: open.id, resolvedAt: null },
        data: { resolvedAt: checkedAt, closeReason: 'RECOVERED' },
      });
      if (closed.count === 1) {
        incidentResolved = open.id;
        notifications.push(
          ...(await createNotification(tx, open.id, monitor.userId, 'RECOVERY')),
        );
      }
    }

    await tx.monitor.update({
      where: { id: monitor.id },
      data: {
        state: 'UP',
        consecutiveFailures: 0,
        failingSince: null,
        lastCheckedAt: checkedAt,
        lastResponseTimeMs: result.responseTimeMs,
        lastStatusCode: result.statusCode,
        lastFailureKind: null,
        lastFailureReason: null,
      },
    });

    return {
      status: 'recorded',
      monitorState: 'UP',
      consecutiveFailures: 0,
      ...(incidentResolved ? { incidentResolved } : {}),
      notifications,
    };
  }

  // ---- failure path ----
  const consecutiveFailures = monitor.consecutiveFailures + 1;
  const failingSince = monitor.failingSince ?? checkedAt;
  let incidentOpened: string | undefined;
  let nextState = monitor.state;

  const shouldDeclareDown = consecutiveFailures >= threshold && monitor.state !== 'DOWN';
  if (shouldDeclareDown) {
    // The partial unique index guarantees at most one open incident per monitor.
    const incident = await tx.incident.create({
      data: {
        monitorId: monitor.id,
        startedAt: failingSince,
        detectedAt: checkedAt,
        causeKind: result.failureKind,
        causeReason: result.failureReason,
      },
      select: { id: true },
    });
    incidentOpened = incident.id;
    nextState = 'DOWN';
    notifications.push(...(await createNotification(tx, incident.id, monitor.userId, 'DOWN')));
  }

  await tx.monitor.update({
    where: { id: monitor.id },
    data: {
      state: nextState,
      consecutiveFailures,
      failingSince,
      lastCheckedAt: checkedAt,
      lastResponseTimeMs: result.responseTimeMs,
      lastStatusCode: result.statusCode,
      lastFailureKind: result.failureKind,
      lastFailureReason: result.failureReason,
    },
  });

  return {
    status: 'recorded',
    monitorState: nextState,
    consecutiveFailures,
    ...(incidentOpened ? { incidentOpened } : {}),
    notifications,
  };
}

/**
 * Creates the one notification of this kind allowed for the incident.
 * `skipDuplicates` maps to `ON CONFLICT DO NOTHING`, so a retry of the enclosing
 * work can never produce a second alert for the same incident.
 */
async function createNotification(
  tx: TxClient,
  incidentId: string,
  userId: string,
  kind: NotificationKind,
): Promise<PendingNotification[]> {
  const created = await tx.notification.createMany({
    data: [{ incidentId, userId, kind, status: 'PENDING' }],
    skipDuplicates: true,
  });
  if (created.count === 0) return [];
  const row = await tx.notification.findUnique({
    where: { incidentId_kind: { incidentId, kind } },
    select: { id: true, kind: true },
  });
  return row ? [{ id: row.id, kind: row.kind }] : [];
}

/**
 * Closes an incident because the monitor stopped being monitored (paused) or was
 * pointed at a different URL. No alert is produced: nothing recovered.
 * Used by the monitors domain; kept here so all incident transitions live
 * in one file.
 */
export async function closeIncidentWithoutRecovery(
  monitorId: string,
  reason: 'MONITOR_PAUSED' | 'MONITOR_RECONFIGURED',
  at = new Date(),
): Promise<number> {
  const result = await prisma.incident.updateMany({
    where: { monitorId, resolvedAt: null },
    data: { resolvedAt: at, closeReason: reason },
  });
  return result.count;
}
