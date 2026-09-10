import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { checkJobId, type Queues } from '../queue/queues.js';

/**
 * The scheduler. Postgres holds the schedule; Redis only carries jobs.
 *
 * `claimDueMonitors` runs one statement that selects due monitors with
 * `FOR UPDATE SKIP LOCKED`, advances their `nextCheckAt`, and returns the slot
 * it just claimed. Because the select and the update are one statement, two
 * ticks (or two worker processes) can never claim the same slot, and a crash
 * anywhere after the claim simply means one missed check — the next tick carries
 * on from the value already stored in the database.
 *
 * A monitor that has fallen far behind (worker down for a while) is *not*
 * replayed slot by slot. It is re-based onto the current moment, so a restart
 * produces one fresh check per monitor rather than a backlog of stale ones. A
 * backlog would either hammer the monitored sites or, worse, look like a burst
 * of failures.
 */

export interface ClaimedSlot {
  readonly monitorId: string;
  readonly scheduledFor: Date;
  /** True when the monitor was so far behind that its slot was re-based to now. */
  readonly rebased: boolean;
}

export interface ClaimOptions {
  readonly now?: Date;
  /** Maximum monitors claimed per tick. Bounds a tick's work. */
  readonly batchSize?: number;
  /**
   * How many intervals behind a due time may be before the slot is re-based to
   * the present instead of replayed.
   */
  readonly maxLagIntervals?: number;
}

export const DEFAULT_BATCH_SIZE = 200;
export const DEFAULT_MAX_LAG_INTERVALS = 3;

interface ClaimRow {
  id: string;
  scheduled_for: Date;
  rebased: boolean;
}

export async function claimDueMonitors(options: ClaimOptions = {}): Promise<ClaimedSlot[]> {
  const now = options.now ?? new Date();
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxLagIntervals = options.maxLagIntervals ?? DEFAULT_MAX_LAG_INTERVALS;

  const rows = await prisma.$queryRaw<ClaimRow[]>`
    WITH due AS (
      SELECT m."id",
             m."nextCheckAt"     AS due_at,
             m."intervalSeconds" AS interval_seconds
      FROM "monitors" m
      JOIN "users" u ON u."id" = m."userId"
      WHERE m."paused" = false
        AND m."nextCheckAt" IS NOT NULL
        AND m."nextCheckAt" <= ${now}
        -- Monitoring and alerts stay off until the account email is verified.
        AND u."emailVerifiedAt" IS NOT NULL
      ORDER BY m."nextCheckAt" ASC
      LIMIT ${batchSize}
      FOR UPDATE OF m SKIP LOCKED
    ),
    claimed AS (
      UPDATE "monitors" m
      SET "nextCheckAt" = CASE
            WHEN due.due_at < ${now}::timestamptz
                 - (due.interval_seconds * ${maxLagIntervals} * INTERVAL '1 second')
              THEN ${now}::timestamptz + (due.interval_seconds * INTERVAL '1 second')
            ELSE GREATEST(
              due.due_at + (due.interval_seconds * INTERVAL '1 second'),
              ${now}::timestamptz
            )
          END
      FROM due
      WHERE m."id" = due."id"
      RETURNING m."id",
                CASE
                  WHEN due.due_at < ${now}::timestamptz
                       - (due.interval_seconds * ${maxLagIntervals} * INTERVAL '1 second')
                    THEN ${now}::timestamptz
                  ELSE due.due_at
                END AS scheduled_for,
                (due.due_at < ${now}::timestamptz
                  - (due.interval_seconds * ${maxLagIntervals} * INTERVAL '1 second')) AS rebased
    )
    SELECT "id", scheduled_for, rebased FROM claimed
  `;

  return rows.map((row) => ({
    monitorId: row.id,
    scheduledFor: new Date(row.scheduled_for),
    rebased: row.rebased,
  }));
}

/**
 * Puts back on the schedule any monitor that should be running but is not.
 *
 * Run at worker startup and periodically. It repairs the two ways a monitor can
 * end up unscheduled through no fault of its own: a crash between verifying an
 * email and activating the monitors, and a Redis flush that dropped queued jobs
 * (the stored `nextCheckAt` had already advanced, so the next tick picks it up —
 * this pass only covers rows where it is NULL).
 */
export async function reconcileSchedules(now = new Date()): Promise<number> {
  const result = await prisma.$executeRaw`
    UPDATE "monitors" m
    SET "nextCheckAt" = ${now}
    FROM "users" u
    WHERE u."id" = m."userId"
      AND m."paused" = false
      AND m."nextCheckAt" IS NULL
      AND u."emailVerifiedAt" IS NOT NULL
  `;
  return result;
}

export interface DispatchSummary {
  readonly claimed: number;
  readonly enqueued: number;
  readonly rebased: number;
}

/** Claims due monitors and enqueues one check job per claimed slot. */
export async function dispatchDueChecks(
  queues: Queues,
  options: ClaimOptions = {},
): Promise<DispatchSummary> {
  const claimed = await claimDueMonitors(options);
  if (claimed.length === 0) return { claimed: 0, enqueued: 0, rebased: 0 };

  let enqueued = 0;
  for (const slot of claimed) {
    const scheduledForIso = slot.scheduledFor.toISOString();
    try {
      await queues.checks.add(
        'check',
        { monitorId: slot.monitorId, scheduledFor: scheduledForIso },
        // A deterministic job id means a second tick in the same slot is a no-op.
        { jobId: checkJobId(slot.monitorId, scheduledForIso) },
      );
      enqueued += 1;
    } catch (error) {
      // The claim already advanced nextCheckAt, so this slot is simply skipped.
      // The monitor stays scheduled and the gap shows up as reduced coverage
      // rather than as downtime.
      logger.error(
        {
          monitorId: slot.monitorId,
          scheduledFor: scheduledForIso,
          err: error instanceof Error ? error.message : String(error),
        },
        'failed to enqueue check job',
      );
    }
  }

  return {
    claimed: claimed.length,
    enqueued,
    rebased: claimed.filter((slot) => slot.rebased).length,
  };
}
