import type {
  ActivitySummary,
  CheckBucket,
  MonitorTimeline,
  UptimeWindow,
} from '@pingexa/shared';
import type { Check } from '../generated/prisma/client.js';
import { WINDOW_MS } from './uptime.js';

/**
 * Aggregation for the signed-in overview.
 *
 * Both functions here take rows and return display shapes. They are pure and
 * synchronous on purpose: the arithmetic in them is the part that can be wrong
 * in a way nobody notices, so it is unit-tested directly rather than only
 * through an endpoint.
 *
 * The rule both of them obey is the one in `docs/PROJECT_PLAN.md`: a check that
 * never ran is not uptime and not downtime. It is absence, and absence is
 * reported as such — `recordedChecks: 0` and a `null` response time, never a
 * zero that would draw as "instant" or read as "fine".
 */

/** How many buckets each window is divided into for display. */
const BUCKET_COUNT: Record<UptimeWindow, number> = {
  // 24h / 48 = 30 minutes per bucket: fine enough to see a short outage, coarse
  // enough that the strip stays readable on a phone.
  '24h': 48,
  // 7d / 56 = 3 hours per bucket.
  '7d': 56,
};

export interface BucketChecksArgs {
  readonly monitorId: string;
  readonly window: UptimeWindow;
  readonly now: Date;
  readonly checks: readonly Pick<Check, 'checkedAt' | 'outcome' | 'responseTimeMs'>[];
}

/**
 * Divides a window into fixed buckets and counts what landed in each.
 *
 * Fixed buckets rather than one point per check: the number of points a monitor
 * produces depends on how long it has existed and on whether the worker kept
 * up, so a per-check series makes two monitors incomparable and makes a gap
 * look like a shorter window. A fixed grid makes a gap visibly a gap.
 */
export function bucketChecks(args: BucketChecksArgs): MonitorTimeline {
  const windowMs = WINDOW_MS[args.window];
  const count = BUCKET_COUNT[args.window];
  const bucketMs = Math.floor(windowMs / count);
  const end = args.now.getTime();
  const start = end - windowMs;

  const upCounts = new Array<number>(count).fill(0);
  const downCounts = new Array<number>(count).fill(0);
  const responseTotals = new Array<number>(count).fill(0);
  const responseCounts = new Array<number>(count).fill(0);

  for (const check of args.checks) {
    const at = check.checkedAt.getTime();
    if (at < start || at > end) continue;
    // `Math.min` keeps a check landing exactly on `end` inside the last bucket
    // rather than one past the array.
    const index = Math.min(count - 1, Math.floor((at - start) / bucketMs));
    if (check.outcome === 'UP') {
      upCounts[index] = (upCounts[index] ?? 0) + 1;
      if (check.responseTimeMs !== null) {
        responseTotals[index] = (responseTotals[index] ?? 0) + check.responseTimeMs;
        responseCounts[index] = (responseCounts[index] ?? 0) + 1;
      }
    } else {
      downCounts[index] = (downCounts[index] ?? 0) + 1;
    }
  }

  const buckets: CheckBucket[] = [];
  for (let index = 0; index < count; index += 1) {
    const up = upCounts[index] ?? 0;
    const down = downCounts[index] ?? 0;
    const samples = responseCounts[index] ?? 0;
    buckets.push({
      startedAt: new Date(start + index * bucketMs).toISOString(),
      endedAt: new Date(start + (index + 1) * bucketMs).toISOString(),
      upChecks: up,
      downChecks: down,
      recordedChecks: up + down,
      // A bucket with no *successful* check has no response time to report.
      // Zero would be a lie; null is the absence this is.
      avgResponseTimeMs: samples === 0 ? null : Math.round((responseTotals[index] ?? 0) / samples),
    });
  }

  return {
    monitorId: args.monitorId,
    window: args.window,
    bucketSeconds: Math.round(bucketMs / 1000),
    buckets,
  };
}

export interface SummariseActivityArgs {
  readonly window: UptimeWindow;
  readonly now: Date;
  /** Every recorded check in the window, across all of the account's monitors. */
  readonly checks: readonly Pick<Check, 'monitorId' | 'outcome' | 'responseTimeMs'>[];
  /** How many incidents *began* inside the window. */
  readonly incidentsStarted: number;
}

/**
 * Rolls the account's recent checks into the handful of figures the overview
 * shows.
 *
 * Deliberately no aggregate uptime percentage. Uptime is only meaningful next
 * to its coverage (`docs/DECISIONS.md` D12), and a mean of three monitors'
 * percentages — weighted by nothing in particular — would be a number that
 * looks authoritative and answers no question. The per-monitor figures stay
 * per-monitor.
 */
export function summariseActivity(args: SummariseActivityArgs): ActivitySummary {
  const windowMs = WINDOW_MS[args.window];
  const end = args.now;
  const start = new Date(end.getTime() - windowMs);

  let upChecks = 0;
  let downChecks = 0;
  const responseTimes: number[] = [];
  const monitorsSeen = new Set<string>();

  for (const check of args.checks) {
    monitorsSeen.add(check.monitorId);
    if (check.outcome === 'UP') {
      upChecks += 1;
      if (check.responseTimeMs !== null) responseTimes.push(check.responseTimeMs);
    } else {
      downChecks += 1;
    }
  }

  return {
    windowStart: start.toISOString(),
    windowEnd: end.toISOString(),
    recordedChecks: upChecks + downChecks,
    upChecks,
    downChecks,
    incidentsStarted: args.incidentsStarted,
    medianResponseTimeMs: median(responseTimes),
    monitorsWithData: monitorsSeen.size,
  };
}

/**
 * The median, not the mean.
 *
 * A single 10-second timeout drags a mean far enough to make a healthy monitor
 * look slow, which is exactly the kind of number that erodes trust in the rest
 * of the page. The median says what a typical check cost.
 */
function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return Math.round(sorted[middle] as number);
  return Math.round(((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2);
}
