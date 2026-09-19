import type { UptimeSummary } from '@pingexa/shared';
import { coverageNote, formatUptime, plural } from '../lib/format';
import { Metric } from './ui';

/**
 * Uptime with its coverage.
 *
 * The percentage alone is misleading when checks are missing, so the coverage
 * line is part of the component rather than something a caller might forget to
 * add. The wording of that line lives in `coverageNote` so every place in the
 * app that qualifies an uptime figure says the same thing.
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
      : `${summary.upChecks} of ${plural(summary.recordedChecks, 'recorded check')} succeeded.`;

  const note = coverageNote(summary);

  if (compact) {
    return (
      <div>
        <p className="text-xs font-medium tracking-wide text-muted uppercase">{label}</p>
        <p className="text-lg font-semibold tabular-nums text-strong">{formatUptime(summary)}</p>
        <p className="mt-0.5 text-xs text-muted">{meaning}</p>
        {note ? (
          <p className="mt-1 text-xs font-medium text-[var(--status-warn-text)]">{note}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div>
      <Metric label={label} value={formatUptime(summary)} note={meaning} />
      {note ? (
        <p className="mt-1 text-xs font-medium text-[var(--status-warn-text)]">{note}</p>
      ) : null}
    </div>
  );
}
