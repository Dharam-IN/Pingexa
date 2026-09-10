import type { UptimeSummary, UptimeWindow } from '@pingexa/shared';
import { HOUR_MS, DAY_MS } from '../lib/time.js';
import { prisma } from '../lib/prisma.js';

export const WINDOW_MS: Record<UptimeWindow, number> = {
  '24h': 24 * HOUR_MS,
  '7d': 7 * DAY_MS,
};

/** Below this coverage the percentage is flagged so the UI can qualify it. */
export const PARTIAL_DATA_COVERAGE_THRESHOLD = 90;

export interface UptimeCounts {
  readonly upChecks: number;
  readonly downChecks: number;
}

export interface ComputeUptimeArgs {
  readonly window: UptimeWindow;
  readonly now: Date;
  readonly monitorCreatedAt: Date;
  readonly intervalSeconds: number;
  readonly counts: UptimeCounts;
}

/**
 * Turns raw check counts into the uptime figure the product displays.
 *
 * Two numbers, deliberately:
 *
 *  * `uptimePercent` — up / (up + down) over the checks that were actually
 *    recorded. A check that never happened contributes to neither side. This is
 *    the scope requirement that a monitoring gap must not be counted as uptime
 *    *or* as downtime.
 *  * `coveragePercent` — recorded / expected, where `expected` is how many
 *    checks the interval implies for the part of the window in which the monitor
 *    existed. It is what makes a gap visible instead of invisible.
 *
 * `coveragePercent` treats paused time as expected-but-missing, because Pingexa
 * does not keep a pause history. A monitor that was paused for most of the
 * window therefore reports low coverage, which is the honest answer: for that
 * time, its state is genuinely unknown.
 */
export function computeUptime(args: ComputeUptimeArgs): UptimeSummary {
  const windowMs = WINDOW_MS[args.window];
  const windowEnd = args.now;
  const windowStart = new Date(windowEnd.getTime() - windowMs);

  const observedFrom = new Date(
    Math.max(windowStart.getTime(), args.monitorCreatedAt.getTime()),
  );
  const observedMs = Math.max(0, windowEnd.getTime() - observedFrom.getTime());
  const intervalMs = args.intervalSeconds * 1000;
  const expectedChecks = intervalMs > 0 ? Math.floor(observedMs / intervalMs) : 0;

  const recordedChecks = args.counts.upChecks + args.counts.downChecks;
  const uptimePercent =
    recordedChecks === 0 ? null : round2((args.counts.upChecks / recordedChecks) * 100);
  const coveragePercent =
    expectedChecks === 0
      ? recordedChecks > 0
        ? 100
        : 0
      : round2(Math.min(100, (recordedChecks / expectedChecks) * 100));

  return {
    window: args.window,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    upChecks: args.counts.upChecks,
    downChecks: args.counts.downChecks,
    recordedChecks,
    expectedChecks,
    uptimePercent,
    coveragePercent,
    partialData: coveragePercent < PARTIAL_DATA_COVERAGE_THRESHOLD,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Counts recorded check outcomes per monitor in one query. */
export async function countChecksInWindow(
  monitorIds: readonly string[],
  since: Date,
): Promise<Map<string, UptimeCounts>> {
  const result = new Map<string, UptimeCounts>();
  if (monitorIds.length === 0) return result;

  const rows = await prisma.check.groupBy({
    by: ['monitorId', 'outcome'],
    where: { monitorId: { in: [...monitorIds] }, checkedAt: { gte: since } },
    _count: { _all: true },
  });

  for (const id of monitorIds) result.set(id, { upChecks: 0, downChecks: 0 });
  for (const row of rows) {
    const current = result.get(row.monitorId) ?? { upChecks: 0, downChecks: 0 };
    result.set(
      row.monitorId,
      row.outcome === 'UP'
        ? { ...current, upChecks: row._count._all }
        : { ...current, downChecks: row._count._all },
    );
  }
  return result;
}

export interface StaleArgs {
  readonly paused: boolean;
  readonly nextCheckAt: Date | null;
  readonly lastCheckedAt: Date | null;
  readonly createdAt: Date;
  readonly intervalSeconds: number;
  readonly now: Date;
  readonly staleMultiplier: number;
}

/**
 * True when scheduled checks have stopped arriving for a monitor that should be
 * getting them. This is how a worker outage surfaces as "we don't know" rather
 * than quietly freezing the last known state.
 *
 * A paused monitor is never stale (it is not supposed to be checked), and
 * neither is an unscheduled one (`nextCheckAt === null` — an unverified account).
 */
export function isMonitoringStale(args: StaleArgs): boolean {
  if (args.paused) return false;
  if (args.nextCheckAt === null) return false;
  const reference = args.lastCheckedAt ?? args.createdAt;
  const limitMs = args.staleMultiplier * args.intervalSeconds * 1000;
  return args.now.getTime() - reference.getTime() > limitMs;
}
