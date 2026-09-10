import type { UptimeSummary } from '@pingexa/shared';
import { formatUptime } from '../lib/format';

/**
 * Uptime with its coverage.
 *
 * The percentage alone is misleading when checks are missing, so the coverage
 * line is part of the component rather than something a caller might forget.
 */
export function UptimeStat({
  summary,
  label,
  compact = false,
}: {
  summary: UptimeSummary;
  label: string;
  compact?: boolean;
}) {
  const meaning =
    summary.recordedChecks === 0
      ? 'No checks recorded in this window yet.'
      : `${summary.upChecks} of ${summary.recordedChecks} recorded checks succeeded.`;

  return (
    <div>
      <p className="text-xs font-medium tracking-wide text-muted uppercase">{label}</p>
      <p className={compact ? 'text-lg font-semibold text-strong' : 'text-2xl font-semibold text-strong'}>
        {formatUptime(summary)}
      </p>
      <p className="mt-0.5 text-xs text-muted">{meaning}</p>
      {summary.partialData ? (
        <p className="mt-1 text-xs font-medium text-warn-700 dark:text-warn-500">
          {summary.coveragePercent.toFixed(0)}% coverage — {summary.expectedChecks - summary.recordedChecks}{' '}
          expected {summary.expectedChecks - summary.recordedChecks === 1 ? 'check' : 'checks'} are
          missing, and are counted as neither up nor down.
        </p>
      ) : null}
    </div>
  );
}
