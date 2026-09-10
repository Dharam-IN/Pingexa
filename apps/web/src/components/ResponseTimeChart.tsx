import { useMemo } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { CheckRecord } from '@pingexa/shared';
import { formatDateTime, formatTime } from '../lib/format';

/**
 * Response time over the check history.
 *
 * Failures have no response time, so they are drawn as marks on the baseline
 * rather than as gaps or zeroes — a zero would read as "instant", which is the
 * opposite of what happened. The chart is also summarised in text below it for
 * anyone not reading the picture.
 */
interface Point {
  t: number;
  ms: number | null;
  failed: boolean;
  checkedAt: string;
  statusCode: number | null;
  failureReason: string | null;
}

export function ResponseTimeChart({
  checks,
  height = 260,
}: {
  checks: readonly CheckRecord[];
  height?: number;
}) {
  const points = useMemo<Point[]>(
    () =>
      checks.map((check) => ({
        t: new Date(check.checkedAt).getTime(),
        ms: check.outcome === 'UP' ? check.responseTimeMs : null,
        failed: check.outcome === 'DOWN',
        checkedAt: check.checkedAt,
        statusCode: check.statusCode,
        failureReason: check.failureReason,
      })),
    [checks],
  );

  const successes = points.filter((point) => point.ms !== null);
  const failures = points.filter((point) => point.failed);

  const summary = useMemo(() => {
    if (successes.length === 0) {
      return failures.length > 0
        ? `${failures.length} failed checks and no successful responses in this window.`
        : 'No checks recorded in this window yet.';
    }
    const values = successes.map((point) => point.ms as number);
    const average = Math.round(values.reduce((total, value) => total + value, 0) / values.length);
    const slowest = Math.max(...values);
    const fastest = Math.min(...values);
    return `${successes.length} successful checks: average ${average} ms, fastest ${fastest} ms, slowest ${slowest} ms. ${failures.length} failed.`;
  }, [successes, failures]);

  if (points.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted">
        No checks recorded yet. The first result appears within five minutes of adding a monitor.
      </p>
    );
  }

  return (
    <figure className="m-0">
      <div style={{ height }} role="img" aria-label={summary}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
            <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(value: number) => formatTime(new Date(value).toISOString())}
              stroke="var(--text-muted)"
              fontSize={11}
              tickMargin={8}
              minTickGap={40}
            />
            <YAxis
              stroke="var(--text-muted)"
              fontSize={11}
              tickFormatter={(value: number) => `${value}`}
              width={48}
              label={{
                value: 'ms',
                position: 'insideTopLeft',
                fill: 'var(--text-muted)',
                fontSize: 11,
                offset: 8,
              }}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--surface-raised)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 8,
                fontSize: 12,
                color: 'var(--text-strong)',
              }}
              labelFormatter={(value) => formatDateTime(new Date(Number(value)).toISOString())}
              formatter={(value, _name, item) => {
                const point = item.payload as Point;
                if (point.failed) {
                  return [point.failureReason ?? 'Check failed', 'Failed'];
                }
                return [`${value} ms`, `HTTP ${point.statusCode ?? '—'}`];
              }}
            />
            <Line
              type="monotone"
              dataKey="ms"
              stroke="var(--color-brand-500)"
              strokeWidth={2}
              dot={false}
              // Do not bridge across a failure: the line breaks where we have no
              // measurement, and the failure mark below shows why.
              connectNulls={false}
              isAnimationActive={false}
              name="Response time"
            />
            {failures.map((point) => (
              <ReferenceDot
                key={point.t}
                x={point.t}
                y={0}
                r={4}
                fill="var(--color-down-500)"
                stroke="var(--surface-raised)"
                strokeWidth={1.5}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-2 text-xs text-muted">
        {summary}
        {failures.length > 0 ? ' Red marks on the baseline are failed checks, which have no response time.' : ''}
      </figcaption>
    </figure>
  );
}
