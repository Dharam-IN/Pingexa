import type { IncidentRecord } from '@pingexa/shared';
import { formatDateTime, formatDuration } from '../lib/format';
import { StateBadge } from './StateBadge';

const CLOSE_REASON_NOTE: Record<string, string> = {
  RECOVERED: 'Recovered — a scheduled check succeeded again.',
  MONITOR_RECONFIGURED: 'Closed because the monitored URL was changed, not because it recovered.',
  MONITOR_PAUSED: 'Closed because the monitor was paused, not because it recovered.',
};

/**
 * Incident history with explicit timestamp semantics.
 *
 * The three timestamps mean different things and users get them wrong if the UI
 * does not say which is which:
 *   started   — the first failed check of the streak (when the outage began);
 *   confirmed — the third consecutive failure (when the alert went out);
 *   resolved  — the first successful check afterwards.
 */
export function IncidentList({ incidents }: { incidents: readonly IncidentRecord[] }) {
  if (incidents.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted">
        No incidents recorded. An incident opens after three consecutive failed checks.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-[var(--border-subtle)]">
      {incidents.map((incident) => (
        <li key={incident.id} className="py-3.5 first:pt-0 last:pb-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <StateBadge state={incident.ongoing ? 'DOWN' : 'UP'} size="sm" />
              <span className="text-sm font-medium text-strong">
                {incident.ongoing ? 'Ongoing outage' : `Down for ${formatDuration(incident.durationSeconds)}`}
              </span>
            </span>
            <span className="text-xs text-muted">
              {incident.ongoing
                ? `Ongoing for ${formatDuration(incident.durationSeconds)}`
                : formatDateTime(incident.resolvedAt)}
            </span>
          </div>

          <dl className="mt-2 grid gap-x-6 gap-y-1 text-xs text-muted sm:grid-cols-3">
            <div>
              <dt className="font-medium">Started (first failed check)</dt>
              <dd>{formatDateTime(incident.startedAt)}</dd>
            </div>
            <div>
              <dt className="font-medium">Confirmed (3rd failure, alert sent)</dt>
              <dd>{formatDateTime(incident.detectedAt)}</dd>
            </div>
            <div>
              <dt className="font-medium">Resolved (first success)</dt>
              <dd>{incident.resolvedAt ? formatDateTime(incident.resolvedAt) : 'not yet'}</dd>
            </div>
          </dl>

          {incident.causeReason ? (
            <p className="mt-2 text-xs text-muted">
              <span className="font-medium">Cause:</span> {incident.causeReason}
            </p>
          ) : null}
          {incident.closeReason && incident.closeReason !== 'RECOVERED' ? (
            <p className="mt-1 text-xs font-medium text-warn-700 dark:text-warn-500">
              {CLOSE_REASON_NOTE[incident.closeReason]}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
