import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { MonitorSummary, OverviewResponse } from '@pingexa/shared';
import { AddMonitorForm, type NewMonitor } from '../components/AddMonitorForm';
import { CheckStrip, CheckStripLegend } from '../components/CheckStrip';
import { StateBadge } from '../components/StateBadge';
import {
  Alert,
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Hint,
  Metric,
  MetricCard,
  PageHeader,
  SectionHeading,
  SkeletonMetric,
  SkeletonRow,
} from '../components/ui';
import { api } from '../lib/api';
import { usePolledResource } from '../lib/usePolledResource';
import {
  coverageNote,
  displayUrl,
  failureProgress,
  formatDuration,
  formatMs,
  formatNextCheck,
  formatRelative,
  formatUptime,
  plural,
} from '../lib/format';
import { useAuth } from '../state/AuthContext';
import { useToast } from '../state/ToastContext';

/** How often the overview re-reads, so a new check appears without a reload. */
const REFRESH_MS = 30_000;

/**
 * The operational overview.
 *
 * The ordering rule for this page is that the most urgent thing is the first
 * thing, and the layout follows from it rather than from a grid that happened
 * to look balanced: an open incident gets a full-width block above everything,
 * a monitor that is failing but not yet down gets a warning band, and a healthy
 * account gets a quiet summary it can skim in a second and leave.
 *
 * Every figure comes from `/api/overview`, which counts rows. Nothing on this
 * page is computed from an assumption about a check that did not run.
 */
export function OverviewPage() {
  const { user, meta } = useAuth();
  const { show } = useToast();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);

  const {
    data,
    error: loadError,
    loading,
    reload: load,
  } = usePolledResource<OverviewResponse>(
    useCallback((signal) => api.get<OverviewResponse>('/api/overview', signal), []),
    { intervalMs: REFRESH_MS, fallbackMessage: 'Could not load your overview.' },
  );

  const addMonitor = useCallback(
    async (monitor: NewMonitor) => {
      await api.post('/api/monitors', monitor);
      setAdding(false);
      show('success', `${monitor.name} added. The first check runs within five minutes.`);
      await load();
    },
    [load, show],
  );

  const grouped = useMemo(() => groupMonitors(data?.monitors ?? []), [data?.monitors]);

  const limit = data?.limit ?? meta?.monitorLimit ?? 3;
  const used = data?.used ?? 0;
  const atLimit = used >= limit;
  const canAdd = user?.emailVerified === true;
  const threshold = meta?.failureThreshold ?? 3;
  const intervalMinutes = Math.round((meta?.intervalSeconds ?? 300) / 60);

  if (loading && !data && !loadError) return <OverviewSkeleton />;

  return (
    <div>
      <PageHeader
        title="Overview"
        description={
          data
            ? `${plural(used, 'monitor')} of ${limit} in use, each checked every ${intervalMinutes} minutes.`
            : undefined
        }
        actions={
          canAdd && !atLimit ? (
            <Button onClick={() => setAdding(true)}>Add monitor</Button>
          ) : null
        }
      />

      {loadError ? (
        <Alert
          tone="error"
          title="Could not load your overview"
          className="mb-6"
          action={
            <Button variant="secondary" size="sm" onClick={() => void load()}>
              Try again
            </Button>
          }
        >
          <p>{loadError}</p>
          {data ? <p className="mt-1">Showing the last data that loaded successfully.</p> : null}
        </Alert>
      ) : null}

      {data ? (
        <div className="space-y-6">
          {/* ------------------------------------------------ urgent first -- */}
          <AttentionBanner data={data} threshold={threshold} />

          {/* ------------------------------------------------------ health -- */}
          <section aria-labelledby="health">
            <h2 id="health" className="sr-only">
              Account health
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                label="Operational"
                value={`${grouped.up.length}`}
                note={
                  grouped.up.length === used && used > 0
                    ? 'Every monitor passed its last check'
                    : `of ${plural(used, 'monitor')}`
                }
                tone="up"
                emphasis={grouped.up.length > 0 && grouped.down.length === 0}
              />
              <MetricCard
                label="Needs attention"
                value={`${grouped.down.length}`}
                note={
                  grouped.down.length === 0
                    ? 'No monitor is currently down'
                    : plural(data.openIncidents.length, 'open incident')
                }
                tone="down"
                emphasis={grouped.down.length > 0}
              />
              <MetricCard
                label="Paused or unknown"
                value={`${grouped.inactive.length}`}
                note={
                  grouped.inactive.length === 0
                    ? 'All monitors are being checked'
                    : describeInactive(grouped)
                }
                tone="warn"
                emphasis={grouped.inactive.length > 0 && grouped.down.length === 0}
              />
              <MetricCard
                label="Typical response"
                value={formatMs(data.last24h.medianResponseTimeMs)}
                note={
                  data.last24h.medianResponseTimeMs === null
                    ? 'No successful checks in the last 24 hours'
                    : `median of ${plural(data.last24h.upChecks, 'successful check')}, 24h`
                }
              />
            </div>
          </section>

          {/* ----------------------------------------------- 24h activity -- */}
          <Card className="p-5">
            <SectionHeading
              title="Last 24 hours"
              description="Counted from checks that actually ran. A check that never ran is not counted as either outcome."
            />
            <div className="grid gap-5 sm:grid-cols-3">
              <Metric
                label="Checks recorded"
                value={data.last24h.recordedChecks.toLocaleString()}
                note={
                  data.last24h.monitorsWithData === 0
                    ? 'No monitor recorded a check'
                    : `across ${plural(data.last24h.monitorsWithData, 'monitor')}`
                }
              />
              <Metric
                label="Failed checks"
                value={data.last24h.downChecks.toLocaleString()}
                note={
                  data.last24h.recordedChecks === 0
                    ? 'nothing recorded yet'
                    : `${((data.last24h.downChecks / data.last24h.recordedChecks) * 100).toFixed(1)}% of recorded checks`
                }
                tone="down"
                emphasis={data.last24h.downChecks > 0}
              />
              <Metric
                label="Incidents opened"
                value={data.last24h.incidentsStarted.toLocaleString()}
                note={`an incident opens after ${threshold} consecutive failures`}
              />
            </div>
          </Card>

          {/* ------------------------------------------------- monitor list -- */}
          <section aria-labelledby="monitors">
            <SectionHeading
              id="monitors"
              title="Monitors"
              description={
                used > 0
                  ? 'Problems first. The strip shows the last 24 hours of checks.'
                  : undefined
              }
              action={
                used > 0 ? (
                  <Link
                    to="/app/monitors"
                    className="rounded-lg px-3 py-1.5 text-sm font-medium text-brand-600 hover:bg-[var(--status-info-surface)] dark:text-brand-300"
                  >
                    Manage monitors
                  </Link>
                ) : null
              }
            />

            {used === 0 ? (
              <Card>
                <FirstRunEmptyState
                  canAdd={canAdd}
                  onAdd={() => setAdding(true)}
                  intervalMinutes={intervalMinutes}
                  threshold={threshold}
                  email={user?.email ?? ''}
                />
              </Card>
            ) : (
              <>
                <Card className="overflow-hidden">
                  <ul className="divide-y divide-[var(--border-subtle)]">
                    {grouped.ordered.map((monitor) => (
                      <OverviewMonitorRow
                        key={monitor.id}
                        monitor={monitor}
                        timeline={data.timelines.find((entry) => entry.monitorId === monitor.id)}
                        threshold={threshold}
                      />
                    ))}
                  </ul>
                </Card>
                <CheckStripLegend className="mt-3" />
              </>
            )}

            {atLimit && used > 0 ? (
              <Alert tone="info" className="mt-4">
                You are using all {limit} monitors, which is the limit on the free plan Pingexa
                ships today. To watch something else, delete a monitor you no longer need from{' '}
                <Link to="/app/monitors" className="underline underline-offset-2">
                  Monitors
                </Link>
                .
              </Alert>
            ) : null}
          </section>

          {/* ---------------------------------------------- recent activity -- */}
          {data.recentIncidents.length > 0 ? (
            <Card className="p-5">
              <SectionHeading
                title="Recent incidents"
                description="Outages that began in the last 7 days, newest first."
              />
              <ul className="divide-y divide-[var(--border-subtle)]">
                {data.recentIncidents.map((incident) => (
                  <li key={incident.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 first:pt-0 last:pb-0">
                    <Badge tone={incident.ongoing ? 'down' : 'up'} size="sm" dot>
                      {incident.ongoing ? 'Ongoing' : 'Resolved'}
                    </Badge>
                    <Link
                      to={`/app/monitors/${incident.monitorId}`}
                      className="text-sm font-medium text-strong hover:underline"
                    >
                      {incident.monitorName}
                    </Link>
                    <span className="text-xs text-muted">
                      started {formatRelative(incident.startedAt)}
                      {incident.ongoing
                        ? ` · ongoing for ${formatDuration(incident.durationSeconds)}`
                        : ` · lasted ${formatDuration(incident.durationSeconds)}`}
                    </span>
                    {incident.causeReason ? (
                      <span className="w-full text-xs text-subtle sm:w-auto sm:ml-auto">
                        {incident.causeReason}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : used > 0 ? (
            <Card className="p-5">
              <SectionHeading title="Recent incidents" />
              <p className="py-2 text-sm text-muted">
                No incidents in the last 7 days. An incident opens after {threshold} consecutive
                failed checks and closes on the first success.
              </p>
            </Card>
          ) : null}
        </div>
      ) : null}

      <Dialog
        open={adding}
        onClose={() => setAdding(false)}
        title="Add a monitor"
        description={`Pingexa will check this URL every ${intervalMinutes} minutes and email ${
          user?.email ?? 'your confirmed address'
        } if it fails ${threshold} checks in a row.`}
      >
        <AddMonitorForm
          onSubmit={addMonitor}
          onCancel={() => setAdding(false)}
          onCreated={(id) => navigate(`/app/monitors/${id}`)}
        />
      </Dialog>
    </div>
  );
}

/* ----------------------------------------------------------------- parts -- */

interface Grouped {
  down: MonitorSummary[];
  failing: MonitorSummary[];
  inactive: MonitorSummary[];
  up: MonitorSummary[];
  ordered: MonitorSummary[];
}

/**
 * Sorts monitors so the ones that need a human are at the top.
 *
 * Exported for the unit test: "problems first" is a claim the page makes, and a
 * claim about ordering is exactly the kind that rots silently.
 */
export function groupMonitors(monitors: readonly MonitorSummary[]): Grouped {
  const down = monitors.filter((monitor) => monitor.displayState === 'DOWN');
  const inactive = monitors.filter(
    (monitor) => monitor.displayState === 'PAUSED' || monitor.displayState === 'STALE',
  );
  const up = monitors.filter(
    (monitor) => monitor.displayState === 'UP' || monitor.displayState === 'PENDING',
  );
  // A monitor that is up but mid-streak still deserves to be read before the
  // healthy ones, without being counted as down.
  const failing = up.filter((monitor) => monitor.consecutiveFailures > 0);
  const healthy = up.filter((monitor) => monitor.consecutiveFailures === 0);

  return { down, failing, inactive, up, ordered: [...down, ...failing, ...inactive, ...healthy] };
}

function describeInactive(grouped: Grouped): string {
  const paused = grouped.inactive.filter((monitor) => monitor.displayState === 'PAUSED').length;
  const stale = grouped.inactive.length - paused;
  const parts: string[] = [];
  if (paused > 0) parts.push(`${paused} paused`);
  if (stale > 0) parts.push(`${stale} not reporting`);
  return parts.join(', ');
}

/** The full-width band above everything, shown only when something is wrong. */
function AttentionBanner({ data, threshold }: { data: OverviewResponse; threshold: number }) {
  const down = data.monitors.filter((monitor) => monitor.displayState === 'DOWN');
  const stale = data.monitors.filter((monitor) => monitor.displayState === 'STALE');
  const failing = data.monitors.filter(
    (monitor) => monitor.displayState !== 'DOWN' && monitor.consecutiveFailures > 0,
  );

  if (down.length > 0) {
    const single = down.length === 1 ? down[0] : undefined;
    const singleIncident = single
      ? data.openIncidents.find((entry) => entry.monitorId === single.id)
      : undefined;

    return (
      <Alert
        tone="error"
        title={single ? `${single.name} is down` : `${plural(down.length, 'monitor')} are down`}
        className="mb-6"
      >
        {/*
          With one monitor down the heading already names it, so repeating the
          name in a one-item list below is noise. Say the new things instead.
        */}
        {single ? (
          <p>
            {single.lastFailureReason ? `${single.lastFailureReason}. ` : ''}
            {singleIncident
              ? `Down for ${formatDuration(singleIncident.durationSeconds)}. `
              : ''}
            <Link
              to={`/app/monitors/${single.id}`}
              className="font-medium underline underline-offset-2"
            >
              Open the monitor
            </Link>
            .
          </p>
        ) : (
          <ul className="mt-1 space-y-1.5">
            {down.map((monitor) => {
              const incident = data.openIncidents.find((entry) => entry.monitorId === monitor.id);
              return (
                <li key={monitor.id} className="flex flex-wrap items-baseline gap-x-2">
                  <Link
                    to={`/app/monitors/${monitor.id}`}
                    className="font-medium underline underline-offset-2"
                  >
                    {monitor.name}
                  </Link>
                  {monitor.lastFailureReason ? <span>— {monitor.lastFailureReason}</span> : null}
                  {incident ? (
                    <span className="text-xs">
                      down for {formatDuration(incident.durationSeconds)}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-2 text-xs">
          Confirmed after {threshold} consecutive failed checks. You were emailed once when{' '}
          {down.length === 1 ? 'this outage' : 'each outage'} opened, and will be emailed again on
          recovery.
        </p>
      </Alert>
    );
  }

  if (stale.length > 0) {
    return (
      <Alert tone="warning" title="Monitoring has gone quiet" className="mb-6">
        {plural(stale.length, 'monitor')} {stale.length === 1 ? 'has' : 'have'} not recorded a check
        for more than three intervals, so {stale.length === 1 ? 'its' : 'their'} real state is
        unknown — not up, and not down.{' '}
        {stale.map((monitor, index) => (
          <span key={monitor.id}>
            {index > 0 ? ', ' : ''}
            <Link to={`/app/monitors/${monitor.id}`} className="underline underline-offset-2">
              {monitor.name}
            </Link>
          </span>
        ))}
      </Alert>
    );
  }

  if (failing.length > 0) {
    return (
      <Alert tone="warning" title="A check has failed recently" className="mb-6">
        {failing.map((monitor) => (
          <p key={monitor.id}>
            <Link to={`/app/monitors/${monitor.id}`} className="font-medium underline underline-offset-2">
              {monitor.name}
            </Link>{' '}
            — {failureProgress(monitor, threshold)}
          </p>
        ))}
      </Alert>
    );
  }

  return null;
}

function OverviewMonitorRow({
  monitor,
  timeline,
  threshold,
}: {
  monitor: MonitorSummary;
  timeline: OverviewResponse['timelines'][number] | undefined;
  threshold: number;
}) {
  const progress = failureProgress(monitor, threshold);
  const coverage = coverageNote(monitor.uptime24h);

  return (
    <li
      className={clsxRow(monitor.displayState === 'DOWN')}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={`/app/monitors/${monitor.id}`}
              className="truncate text-sm font-semibold text-strong hover:underline"
            >
              {monitor.name}
            </Link>
            <StateBadge state={monitor.displayState} size="sm" />
            {monitor.isPublic ? (
              <Badge tone="neutral" size="sm" title="Published on your status page">
                Public
              </Badge>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-xs text-subtle" title={monitor.url}>
            {displayUrl(monitor.url)}
          </p>
        </div>

        <dl className="flex shrink-0 items-start gap-5 text-xs sm:gap-8">
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
          <div className="hidden sm:block">
            <dt className="text-muted">Last check</dt>
            <dd className="mt-0.5 text-sm font-semibold text-strong">
              {formatRelative(monitor.lastCheckedAt)}
            </dd>
          </div>
        </dl>
      </div>

      <CheckStrip timeline={timeline} className="mt-3" height="sm" />

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <Hint className="text-subtle">{formatNextCheck(monitor)}</Hint>
        {coverage ? <Hint className="text-[var(--status-warn-text)]">{coverage}</Hint> : null}
      </div>

      {monitor.displayState === 'DOWN' && monitor.lastFailureReason ? (
        <p className="status-down mt-2 rounded-md border px-3 py-2 text-xs">
          {monitor.lastFailureReason}
        </p>
      ) : null}
      {progress ? (
        <p className="status-warn mt-2 rounded-md border px-3 py-2 text-xs">{progress}</p>
      ) : null}
    </li>
  );
}

/** A down row gets a tinted background so it is findable without reading. */
function clsxRow(isDown: boolean): string {
  return isDown
    ? 'px-4 py-4 bg-[var(--status-down-surface)] border-l-2 border-l-[var(--chart-fail)]'
    : 'px-4 py-4';
}

/**
 * The first thing a new, verified account sees.
 *
 * It states the four facts that make the product predictable — what a URL has
 * to be, how often it is checked, when an alert fires, and where it goes —
 * because every one of them is a question a first-time user otherwise has to
 * discover by waiting.
 */
function FirstRunEmptyState({
  canAdd,
  onAdd,
  intervalMinutes,
  threshold,
  email,
}: {
  canAdd: boolean;
  onAdd(): void;
  intervalMinutes: number;
  threshold: number;
  email: string;
}) {
  return (
    <EmptyState
      title={canAdd ? 'Add your first monitor' : 'Confirm your email to start monitoring'}
      description={
        canAdd ? (
          <>
            <p>Point Pingexa at a public URL and it takes care of the rest.</p>
            <ul className="mx-auto mt-4 max-w-sm space-y-2 text-left">
              {[
                'A public http:// or https:// address on its standard port (80 or 443).',
                `Checked every ${intervalMinutes} minutes, from the outside, with a plain GET.`,
                `Declared down after ${threshold} consecutive failed checks — not on the first blip.`,
                email ? `One email to ${email} when that happens, and one when it recovers.` : 'One email when that happens, and one when it recovers.',
              ].map((line) => (
                <li key={line} className="flex gap-2">
                  <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand-500" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          'Monitoring and alerts stay switched off until you confirm your email address. Use the banner above to send the link again.'
        )
      }
      action={canAdd ? <Button onClick={onAdd}>Add your first monitor</Button> : null}
    />
  );
}

function OverviewSkeleton() {
  return (
    <div role="status" aria-label="Loading your overview">
      <PageHeader title="Overview" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SkeletonMetric />
        <SkeletonMetric />
        <SkeletonMetric />
        <SkeletonMetric />
      </div>
      <Card className="mt-6 overflow-hidden">
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
      </Card>
    </div>
  );
}
