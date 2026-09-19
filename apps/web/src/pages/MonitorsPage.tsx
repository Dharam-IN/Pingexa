import { useCallback, useMemo, useState } from 'react';
import clsx from 'clsx';
import { Link, useNavigate } from 'react-router';
import type { MonitorDisplayState, MonitorListResponse, MonitorSummary } from '@pingexa/shared';
import { AddMonitorForm, type NewMonitor } from '../components/AddMonitorForm';
import { StateBadge } from '../components/StateBadge';
import {
  Alert,
  Button,
  Card,
  ConfirmDialog,
  Dialog,
  EmptyState,
  Field,
  Hint,
  PageHeader,
  SegmentedControl,
  SelectField,
  SkeletonRow,
} from '../components/ui';
import { ApiError, api } from '../lib/api';
import { usePolledResource } from '../lib/usePolledResource';
import {
  displayUrl,
  formatMs,
  formatNextCheck,
  formatRelative,
  formatUptime,
  hostnameOf,
  plural,
} from '../lib/format';
import { useAuth } from '../state/AuthContext';
import { useToast } from '../state/ToastContext';

const REFRESH_MS = 30_000;

export type MonitorFilter = 'all' | 'up' | 'down' | 'paused' | 'pending';
export type MonitorSort = 'attention' | 'name' | 'uptime' | 'response';

/**
 * Which display states each filter admits.
 *
 * `pending` covers both "no result yet" and "we stopped hearing", because from
 * the reader's side both mean the same thing: this monitor is not currently
 * telling us anything.
 */
const FILTER_STATES: Record<Exclude<MonitorFilter, 'all'>, readonly MonitorDisplayState[]> = {
  up: ['UP'],
  down: ['DOWN'],
  paused: ['PAUSED'],
  pending: ['PENDING', 'STALE'],
};

/** Problems first, then everything else. Mirrors the overview's ordering. */
const ATTENTION_RANK: Record<MonitorDisplayState, number> = {
  DOWN: 0,
  STALE: 1,
  PENDING: 2,
  UP: 3,
  PAUSED: 4,
};

export interface FilterArgs {
  monitors: readonly MonitorSummary[];
  query: string;
  filter: MonitorFilter;
  sort: MonitorSort;
}

/**
 * Search, filter and sort, as one pure function.
 *
 * Kept out of the component and exported so the behaviour the page advertises —
 * "problems first by default", "search by name or host" — is unit-tested rather
 * than asserted in a screenshot.
 */
export function selectMonitors({ monitors, query, filter, sort }: FilterArgs): MonitorSummary[] {
  const needle = query.trim().toLowerCase();

  const matched = monitors.filter((monitor) => {
    if (filter !== 'all' && !FILTER_STATES[filter].includes(monitor.displayState)) return false;
    if (needle === '') return true;
    // Host *and* full URL: someone searching "example.com/health" should find it,
    // and so should someone searching just the name.
    return (
      monitor.name.toLowerCase().includes(needle) ||
      hostnameOf(monitor.url).toLowerCase().includes(needle) ||
      monitor.url.toLowerCase().includes(needle)
    );
  });

  const sorted = [...matched];
  switch (sort) {
    case 'name':
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case 'uptime':
      // Nulls last: "no data" is not "worst uptime", and sorting it to the
      // bottom of a worst-first list would claim it was.
      sorted.sort((a, b) => {
        const left = a.uptime24h.uptimePercent;
        const right = b.uptime24h.uptimePercent;
        if (left === null && right === null) return a.name.localeCompare(b.name);
        if (left === null) return 1;
        if (right === null) return -1;
        return left - right;
      });
      break;
    case 'response':
      sorted.sort((a, b) => {
        const left = a.lastResponseTimeMs;
        const right = b.lastResponseTimeMs;
        if (left === null && right === null) return a.name.localeCompare(b.name);
        if (left === null) return 1;
        if (right === null) return -1;
        return right - left;
      });
      break;
    case 'attention':
    default:
      sorted.sort((a, b) => {
        const rank = ATTENTION_RANK[a.displayState] - ATTENTION_RANK[b.displayState];
        if (rank !== 0) return rank;
        // Within a state, the one failing hardest first.
        const streak = b.consecutiveFailures - a.consecutiveFailures;
        if (streak !== 0) return streak;
        return a.name.localeCompare(b.name);
      });
  }
  return sorted;
}

export function MonitorsPage() {
  const { user, meta } = useAuth();
  const { show } = useToast();
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<MonitorFilter>('all');
  const [sort, setSort] = useState<MonitorSort>('attention');
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<MonitorSummary | null>(null);

  const {
    data,
    error: loadError,
    loading,
    reload: load,
  } = usePolledResource<MonitorListResponse>(
    useCallback((signal) => api.get<MonitorListResponse>('/api/monitors', signal), []),
    { intervalMs: REFRESH_MS, fallbackMessage: 'Could not load your monitors.' },
  );

  const monitors = useMemo(() => data?.monitors ?? [], [data?.monitors]);
  const visible = useMemo(
    () => selectMonitors({ monitors, query, filter, sort }),
    [monitors, query, filter, sort],
  );

  const limit = data?.limit ?? meta?.monitorLimit ?? 3;
  const used = data?.used ?? 0;
  const atLimit = used >= limit;
  const canAdd = user?.emailVerified === true;
  const intervalMinutes = Math.round((meta?.intervalSeconds ?? 300) / 60);
  const threshold = meta?.failureThreshold ?? 3;

  const togglePause = useCallback(
    async (monitor: MonitorSummary) => {
      setBusyId(monitor.id);
      try {
        await api.patch(`/api/monitors/${monitor.id}`, { paused: !monitor.paused });
        show(
          'success',
          monitor.paused
            ? `${monitor.name} resumed. It goes back to pending until the next check completes.`
            : `${monitor.name} paused. No further checks or alerts.`,
        );
        await load();
      } catch (error) {
        show('error', error instanceof ApiError ? error.message : 'Could not update the monitor.');
      } finally {
        setBusyId(null);
      }
    },
    [load, show],
  );

  const confirmDelete = useCallback(async () => {
    if (!deleting) return;
    setBusyId(deleting.id);
    try {
      await api.delete(`/api/monitors/${deleting.id}`);
      show('success', `${deleting.name} deleted.`);
      setDeleting(null);
      await load();
    } catch (error) {
      show('error', error instanceof ApiError ? error.message : 'Could not delete the monitor.');
    } finally {
      setBusyId(null);
    }
  }, [deleting, load, show]);

  const addMonitor = useCallback(
    async (monitor: NewMonitor) => {
      await api.post('/api/monitors', monitor);
      setAdding(false);
      show('success', `${monitor.name} added. The first check runs within ${intervalMinutes} minutes.`);
      await load();
    },
    [intervalMinutes, load, show],
  );

  const counts = useMemo(() => {
    const byFilter = (value: MonitorFilter) =>
      value === 'all'
        ? monitors.length
        : monitors.filter((monitor) => FILTER_STATES[value].includes(monitor.displayState)).length;
    return {
      all: byFilter('all'),
      up: byFilter('up'),
      down: byFilter('down'),
      paused: byFilter('paused'),
      pending: byFilter('pending'),
    };
  }, [monitors]);

  return (
    <div>
      <PageHeader
        title="Monitors"
        description={`${plural(used, 'monitor')} of ${limit} in use. Each is checked every ${intervalMinutes} minutes.`}
        actions={
          canAdd && !atLimit ? <Button onClick={() => setAdding(true)}>Add monitor</Button> : null
        }
      />

      {loadError ? (
        <Alert
          tone="error"
          title="Could not load your monitors"
          className="mb-6"
          action={
            <Button variant="secondary" size="sm" onClick={() => void load()}>
              Try again
            </Button>
          }
        >
          {loadError}
        </Alert>
      ) : null}

      {atLimit ? (
        <Alert tone="info" className="mb-6">
          All {limit} monitor slots are in use. Pingexa ships with a fixed limit of {limit} monitors
          per account — delete one below to watch something else.
        </Alert>
      ) : null}

      {loading && !data ? (
        <Card className="overflow-hidden" aria-label="Loading your monitors">
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </Card>
      ) : monitors.length === 0 ? (
        <Card>
          <EmptyState
            title={canAdd ? 'No monitors yet' : 'Confirm your email to start monitoring'}
            description={
              canAdd
                ? `Add a public URL and Pingexa checks it every ${intervalMinutes} minutes, emailing you after ${threshold} consecutive failures.`
                : 'Monitoring stays switched off until you confirm your email address.'
            }
            action={canAdd ? <Button onClick={() => setAdding(true)}>Add your first monitor</Button> : null}
          />
        </Card>
      ) : (
        <>
          {/* -------------------------------------------------- controls -- */}
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <Field
              label="Search"
              className="min-w-[13rem] flex-1"
              type="search"
              value={query}
              placeholder="Name or host"
              onChange={(event) => setQuery(event.target.value)}
              leading={
                <svg viewBox="0 0 20 20" aria-hidden="true" className="size-4">
                  <circle cx="9" cy="9" r="5.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
                  <path d="m13 13 3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              }
            />
            <SelectField
              label="Sort by"
              className="w-44"
              value={sort}
              onChange={(event) => setSort(event.target.value as MonitorSort)}
            >
              <option value="attention">Problems first</option>
              <option value="name">Name</option>
              <option value="uptime">Lowest uptime</option>
              <option value="response">Slowest response</option>
            </SelectField>
          </div>

          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <SegmentedControl<MonitorFilter>
              legend="Filter monitors by state"
              size="sm"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: `All ${counts.all}` },
                { value: 'up', label: `Up ${counts.up}` },
                { value: 'down', label: `Down ${counts.down}` },
                { value: 'pending', label: `Pending ${counts.pending}`, hint: 'Waiting for a first check, or no longer reporting' },
                { value: 'paused', label: `Paused ${counts.paused}` },
              ]}
            />
            {/*
              The result count is a live region: filtering with the keyboard
              gives no other feedback that the list changed.
            */}
            <p className="text-sm text-muted" role="status" aria-live="polite">
              Showing {visible.length} of {plural(monitors.length, 'monitor')}
            </p>
          </div>

          {visible.length === 0 ? (
            <Card>
              <EmptyState
                icon={false}
                title="No monitors match"
                description={
                  query.trim() !== ''
                    ? `Nothing matches “${query.trim()}” in the ${filter === 'all' ? 'current list' : `“${filter}” filter`}.`
                    : 'No monitor is in this state right now.'
                }
                action={
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setQuery('');
                      setFilter('all');
                    }}
                  >
                    Clear search and filters
                  </Button>
                }
              />
            </Card>
          ) : (
            <Card className="overflow-hidden">
              {/*
                One list, not a table for wide screens plus a list for narrow
                ones. Rendering both leaves whichever is hidden in the DOM: it
                doubles the markup, and every query for a monitor's state finds
                the invisible copy first. A single grid that reflows is the same
                information with one source.
              */}
              <div
                aria-hidden="true"
                className="hidden grid-cols-[minmax(0,1fr)_7.5rem_6.5rem_5.5rem_9rem_auto] items-center gap-4 border-b border-[var(--border-subtle)] px-4 py-2.5 text-xs font-medium tracking-wide text-muted uppercase md:grid"
              >
                <span>Monitor</span>
                <span>State</span>
                <span className="text-right">Uptime 24h</span>
                <span className="text-right">Response</span>
                <span>Last check</span>
                <span className="sr-only">Actions</span>
              </div>

              <ul className="divide-y divide-[var(--border-subtle)]">
                {visible.map((monitor) => (
                  <li
                    key={monitor.id}
                    className={clsx(
                      // Two columns on a phone so the badge sits beside the name;
                      // six aligned columns from md up. One element per datum in
                      // both, so nothing is rendered twice and hidden once.
                      'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 px-4 py-4',
                      'md:grid-cols-[minmax(0,1fr)_7.5rem_6.5rem_5.5rem_9rem_auto] md:gap-y-0 md:py-3',
                      monitor.displayState === 'DOWN' && 'bg-[var(--status-down-surface)]',
                    )}
                  >
                    {/* Name and target */}
                    <div className="min-w-0">
                      <Link
                        to={`/app/monitors/${monitor.id}`}
                        className="block truncate text-sm font-semibold text-strong hover:underline"
                      >
                        {monitor.name}
                      </Link>
                      <span className="block truncate text-xs text-subtle" title={monitor.url}>
                        {displayUrl(monitor.url)}
                      </span>
                    </div>

                    {/* The one state badge for this row, beside the name on a
                        phone and in its own column from md up. */}
                    <div className="justify-self-end md:justify-self-start">
                      <StateBadge state={monitor.displayState} size="sm" />
                      {monitor.openIncidentId ? (
                        <span className="mt-1 hidden text-xs text-[var(--status-down-text)] md:block">
                          Open incident
                        </span>
                      ) : null}
                    </div>

                    {/* Figures: a labelled row on a phone, aligned columns above. */}
                    <dl className="col-span-2 grid grid-cols-3 gap-2 text-xs md:hidden">
                      <div>
                        <dt className="text-muted">Uptime 24h</dt>
                        <dd className="mt-0.5 text-sm font-semibold tabular-nums text-strong">
                          {formatUptime(monitor.uptime24h)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted">Response</dt>
                        <dd className="mt-0.5 text-sm font-semibold tabular-nums text-strong">
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

                    <span className="hidden text-right text-sm whitespace-nowrap tabular-nums text-strong md:block">
                      {formatUptime(monitor.uptime24h)}
                      {monitor.uptime24h.partialData && monitor.uptime24h.recordedChecks > 0 ? (
                        <span className="block text-xs text-[var(--status-warn-text)]">
                          {monitor.uptime24h.coveragePercent.toFixed(0)}% coverage
                        </span>
                      ) : null}
                    </span>

                    <span className="hidden text-right text-sm whitespace-nowrap tabular-nums text-strong md:block">
                      {formatMs(monitor.lastResponseTimeMs)}
                    </span>

                    <span className="hidden text-sm whitespace-nowrap text-muted md:block">
                      {formatRelative(monitor.lastCheckedAt)}
                      <span className="block text-xs text-subtle">{formatNextCheck(monitor)}</span>
                    </span>

                    <div className="col-span-2 md:col-span-1">
                      <RowActions
                        monitor={monitor}
                        busy={busyId === monitor.id}
                        onTogglePause={() => void togglePause(monitor)}
                        onDelete={() => setDeleting(monitor)}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Hint className="mt-3">
            Pausing stops checks and alerts immediately and closes any open incident without sending
            a recovery email. Deleting also removes the monitor&apos;s whole history.
          </Hint>
        </>
      )}

      <Dialog
        open={adding}
        onClose={() => setAdding(false)}
        title="Add a monitor"
        description={`Checked every ${intervalMinutes} minutes. Declared down after ${threshold} consecutive failures, with one email to ${user?.email ?? 'your confirmed address'}.`}
      >
        <AddMonitorForm
          onSubmit={addMonitor}
          onCancel={() => setAdding(false)}
          onCreated={(id) => navigate(`/app/monitors/${id}`)}
        />
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
        busy={busyId === deleting?.id}
        title={`Delete ${deleting?.name ?? 'this monitor'}?`}
        description={
          <>
            <p>
              This removes the monitor along with its entire check and incident history. It cannot
              be undone.
            </p>
            <p className="mt-2">It also frees one of your {limit} monitor slots.</p>
          </>
        }
        confirmLabel="Delete monitor"
        cancelLabel="Keep it"
      />
    </div>
  );
}

function RowActions({
  monitor,
  busy,
  onTogglePause,
  onDelete,
}: {
  monitor: MonitorSummary;
  busy: boolean;
  onTogglePause(): void;
  onDelete(): void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 md:flex-nowrap md:justify-end">
      <Link
        to={`/app/monitors/${monitor.id}`}
        className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-brand-600 hover:bg-[var(--status-info-surface)] dark:text-brand-300"
      >
        Details
      </Link>
      <Button variant="secondary" size="sm" loading={busy} onClick={onTogglePause}>
        {monitor.paused ? 'Resume' : 'Pause'}
      </Button>
      {/*
        The destructive action is separated from the others by a divider rather
        than sitting flush against "Pause": adjacent buttons of equal weight are
        how a delete gets clicked by accident.
      */}
      <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-[var(--border-subtle)]" />
      <Button variant="ghost" size="sm" onClick={onDelete} className="text-[var(--status-down-text)]">
        Delete
      </Button>
    </div>
  );
}
