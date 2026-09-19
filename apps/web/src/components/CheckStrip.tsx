import clsx from 'clsx';
import { useMemo } from 'react';
import type { CheckBucket, MonitorTimeline } from '@pingexa/shared';
import { formatDateTime } from '../lib/format';

/**
 * The 24-hour check strip.
 *
 * One narrow bar per time bucket, oldest on the left. It answers the question a
 * list of numbers cannot — "when was it broken, and for how long" — at a glance
 * and in the width of a table cell.
 *
 * Three states per bucket, and the third is the point:
 *
 *   * every check succeeded            → the up colour
 *   * at least one check failed        → the down colour
 *   * **no check ran**                 → the gap colour
 *
 * A gap is drawn differently from a success and differently from a failure,
 * because it is neither. Filling gaps with green is how an uptime product
 * quietly turns its own outage into someone else's perfect record, and this
 * codebase's rule is that a missing check is never counted as up or as down.
 *
 * The strip is `aria-hidden` and carries a text summary beside it: 48 tiny
 * rectangles are meaningless to a screen reader, and the sentence says the same
 * thing better.
 */

function bucketTone(bucket: CheckBucket): 'up' | 'down' | 'gap' {
  if (bucket.recordedChecks === 0) return 'gap';
  return bucket.downChecks > 0 ? 'down' : 'up';
}

const TONE_STYLE: Record<'up' | 'down' | 'gap', string> = {
  up: 'bg-[var(--status-up-border)]',
  down: 'bg-[var(--chart-fail)]',
  gap: 'bg-[var(--chart-gap)]',
};

export interface CheckStripSummary {
  upBuckets: number;
  downBuckets: number;
  gapBuckets: number;
  sentence: string;
}

export function summariseTimeline(timeline: MonitorTimeline | undefined): CheckStripSummary {
  const buckets = timeline?.buckets ?? [];
  let upBuckets = 0;
  let downBuckets = 0;
  let gapBuckets = 0;
  for (const bucket of buckets) {
    const tone = bucketTone(bucket);
    if (tone === 'up') upBuckets += 1;
    else if (tone === 'down') downBuckets += 1;
    else gapBuckets += 1;
  }

  const hours = Math.round(((timeline?.bucketSeconds ?? 0) * buckets.length) / 3600);
  if (buckets.length === 0 || upBuckets + downBuckets === 0) {
    return { upBuckets, downBuckets, gapBuckets, sentence: 'No checks recorded in the last 24 hours.' };
  }

  const parts = [`${upBuckets + downBuckets} of ${buckets.length} intervals in the last ${hours} hours recorded a check`];
  parts.push(downBuckets === 0 ? 'none of them failed' : `${downBuckets} contained a failure`);
  if (gapBuckets > 0) {
    parts.push(`${gapBuckets} recorded nothing at all and count as neither up nor down`);
  }
  return { upBuckets, downBuckets, gapBuckets, sentence: `${parts.join(', ')}.` };
}

export function CheckStrip({
  timeline,
  className,
  height = 'md',
}: {
  timeline: MonitorTimeline | undefined;
  className?: string;
  height?: 'sm' | 'md';
}) {
  const summary = useMemo(() => summariseTimeline(timeline), [timeline]);
  const buckets = timeline?.buckets ?? [];

  if (buckets.length === 0) {
    return (
      <p className={clsx('text-xs text-subtle', className)}>No check history yet.</p>
    );
  }

  return (
    <div className={className}>
      <div
        className={clsx('flex w-full items-stretch gap-px', height === 'sm' ? 'h-5' : 'h-8')}
        role="img"
        aria-label={summary.sentence}
      >
        {buckets.map((bucket) => {
          const tone = bucketTone(bucket);
          return (
            <span
              key={bucket.startedAt}
              // The native tooltip is a progressive extra; the accessible name
              // above already carries the meaning.
              title={`${formatDateTime(bucket.startedAt)} — ${
                tone === 'gap'
                  ? 'no check recorded'
                  : `${bucket.upChecks} up, ${bucket.downChecks} down${
                      bucket.avgResponseTimeMs === null ? '' : `, avg ${bucket.avgResponseTimeMs} ms`
                    }`
              }`}
              className={clsx('min-w-0 flex-1 rounded-[1px]', TONE_STYLE[tone])}
            />
          );
        })}
      </div>
    </div>
  );
}

/** The legend, rendered once per page rather than under every strip. */
export function CheckStripLegend({ className }: { className?: string }) {
  return (
    <ul className={clsx('flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted', className)}>
      {(
        [
          ['up', 'All checks passed'],
          ['down', 'A check failed'],
          ['gap', 'No check recorded'],
        ] as const
      ).map(([tone, label]) => (
        <li key={tone} className="flex items-center gap-1.5">
          <span className={clsx('h-3 w-1.5 rounded-[1px]', TONE_STYLE[tone])} aria-hidden="true" />
          {label}
        </li>
      ))}
    </ul>
  );
}
