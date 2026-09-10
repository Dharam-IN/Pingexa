import { Link } from 'react-router';
import type { MonitorSummary } from '@pingexa/shared';
import { formatMs, formatRelative, formatUptime, hostnameOf } from '../lib/format';
import { StateBadge } from './StateBadge';
import { Button, Card } from './ui';

/**
 * One monitor on the dashboard.
 *
 * Everything shown here comes from the API. There is no placeholder metric: a
 * monitor with no checks yet says so instead of showing a zero.
 */
export function MonitorCard({
  monitor,
  onTogglePause,
  busy,
}: {
  monitor: MonitorSummary;
  onTogglePause(monitor: MonitorSummary): void;
  busy: boolean;
}) {
  return (
    <Card as="li" className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-strong">
            <Link to={`/app/monitors/${monitor.id}`} className="hover:underline">
              {monitor.name}
            </Link>
          </h3>
          <p className="mt-0.5 truncate text-xs text-muted" title={monitor.url}>
            {hostnameOf(monitor.url)}
          </p>
        </div>
        <StateBadge state={monitor.displayState} />
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-3 text-xs">
        <div>
          <dt className="text-muted">Uptime 24h</dt>
          <dd className="mt-0.5 text-sm font-semibold text-strong">
            {formatUptime(monitor.uptime24h)}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Response</dt>
          <dd className="mt-0.5 text-sm font-semibold text-strong">
            {formatMs(monitor.lastResponseTimeMs)}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Last check</dt>
          <dd className="mt-0.5 text-sm font-semibold text-strong">
            {formatRelative(monitor.lastCheckedAt)}
          </dd>
        </div>
      </dl>

      {monitor.uptime24h.partialData && monitor.uptime24h.recordedChecks > 0 ? (
        <p className="mt-3 text-xs text-warn-700 dark:text-warn-500">
          Only {monitor.uptime24h.coveragePercent.toFixed(0)}% of the last 24 hours was checked.
        </p>
      ) : null}

      {monitor.displayState === 'DOWN' && monitor.lastFailureReason ? (
        <p className="mt-3 rounded-md bg-down-50 px-3 py-2 text-xs text-down-700 dark:bg-down-700/25 dark:text-down-50">
          {monitor.lastFailureReason}
        </p>
      ) : null}

      {/*
        A monitor can have a failing last check without being down yet: the
        threshold is three consecutive failures. Saying nothing here would make
        the card look healthy while the site is already erroring.
      */}
      {monitor.displayState !== 'DOWN' && monitor.lastFailureReason ? (
        <p className="mt-3 rounded-md bg-warn-50 px-3 py-2 text-xs text-warn-700 dark:bg-warn-700/25 dark:text-warn-50">
          Last check failed: {monitor.lastFailureReason} ({monitor.consecutiveFailures} in a row; 3
          are needed before an alert.)
        </p>
      ) : null}

      {monitor.displayState === 'STALE' ? (
        <p className="mt-3 rounded-md bg-warn-50 px-3 py-2 text-xs text-warn-700 dark:bg-warn-700/25 dark:text-warn-50">
          Scheduled checks have stopped arriving, so the current state is unknown. Last known state
          was {monitor.state.toLowerCase()}.
        </p>
      ) : null}

      <div className="mt-4 flex items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => onTogglePause(monitor)} loading={busy}>
          {monitor.paused ? 'Resume' : 'Pause'}
        </Button>
        <Link
          to={`/app/monitors/${monitor.id}`}
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-900/40"
        >
          Details
        </Link>
        {monitor.isPublic ? (
          <span className="ml-auto rounded-full bg-[var(--surface-sunken)] px-2 py-0.5 text-xs text-muted">
            On status page
          </span>
        ) : null}
      </div>
    </Card>
  );
}
