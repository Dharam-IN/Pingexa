import { Suspense, lazy, useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { CheckRecord, MonitorDetailResponse, UptimeWindow } from '@pingexa/shared';
import { monitorNameSchema, monitorUrlSchema, FAILURE_KIND_LABELS } from '@pingexa/shared';
import { IncidentList } from '../components/IncidentList';

/**
 * Recharts is by far the biggest dependency in the app and only this page needs
 * it, so it is split out of the initial bundle.
 */
const ResponseTimeChart = lazy(async () => ({
  default: (await import('../components/ResponseTimeChart')).ResponseTimeChart,
}));
import { StateBadge } from '../components/StateBadge';
import { UptimeStat } from '../components/UptimeStat';
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Dialog,
  Field,
  Hint,
  Metric,
  PageHeader,
  SectionHeading,
  SegmentedControl,
  Skeleton,
  TableWrap,
  Td,
  Th,
  Toggle,
} from '../components/ui';
import { ApiError, api } from '../lib/api';
import { usePolledResource } from '../lib/usePolledResource';
import {
  coverageNote,
  explainState,
  failureProgress,
  formatDateTime,
  formatMs,
  formatNextCheck,
  formatRelative,
  normaliseMonitorUrl,
  plural,
} from '../lib/format';
import { useAuth } from '../state/AuthContext';
import { useToast } from '../state/ToastContext';

const REFRESH_MS = 30_000;

/** How many individual results the check table shows before it is truncated. */
const CHECK_TABLE_LIMIT = 25;

export function MonitorDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { show } = useToast();
  const { meta } = useAuth();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [range, setRange] = useState<UptimeWindow>('24h');

  const {
    data,
    error: loadError,
    reload: load,
  } = usePolledResource<MonitorDetailResponse>(
    useCallback(
      (signal?: AbortSignal) => api.get<MonitorDetailResponse>(`/api/monitors/${id}`, signal),
      [id],
    ),
    { intervalMs: REFRESH_MS, fallbackMessage: 'Could not load this monitor.' },
  );

  const patch = useCallback(
    async (changes: Record<string, unknown>, successMessage: string) => {
      setBusy(true);
      try {
        await api.patch(`/api/monitors/${id}`, changes);
        show('success', successMessage);
        await load();
        return true;
      } catch (error) {
        show('error', error instanceof ApiError ? error.message : 'Could not update the monitor.');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [id, load, show],
  );

  const threshold = meta?.failureThreshold ?? 3;
  const retentionDays = data?.checkHistoryRetentionDays ?? meta?.checkRetentionDays ?? 7;

  /*
   * The detail response already carries the full 7 days of checks, so switching
   * range is a filter rather than another request. One fetch, two ranges, and no
   * spinner between them.
   */
  const rangedChecks = useMemo<CheckRecord[]>(() => {
    if (!data) return [];
    if (range === '7d') return data.checks;
    /*
     * The cutoff comes from the server's own 24h window rather than from a
     * clock read during render. That keeps this pure, and it also keeps the
     * chart and the uptime figure beside it describing exactly the same window
     * — two different "24 hours" on one card is the kind of discrepancy nobody
     * can explain later.
     */
    const cutoff = new Date(data.uptime['24h'].windowStart).getTime();
    return data.checks.filter((check) => new Date(check.checkedAt).getTime() >= cutoff);
  }, [data, range]);

  const recentChecks = useMemo(
    () => [...rangedChecks].reverse().slice(0, CHECK_TABLE_LIMIT),
    [rangedChecks],
  );

  if (loadError && !data) {
    return (
      <div>
        <PageHeader
          title="Monitor unavailable"
          above={<BackLink />}
        />
        <Alert tone="error" title="Could not load this monitor">
          <p>{loadError}</p>
          <p className="mt-1">
            It may have been deleted, or the connection dropped. Your other monitors are unaffected.
          </p>
          <div className="mt-3 flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => void load()}>
              Try again
            </Button>
            <Link
              to="/app/monitors"
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-brand-600 dark:text-brand-300"
            >
              Back to monitors
            </Link>
          </div>
        </Alert>
      </div>
    );
  }

  if (!data) return <DetailSkeleton />;

  const { monitor, uptime, incidents, notifications } = data;
  const failedNotifications = notifications.filter((entry) => entry.status === 'FAILED');
  const progress = failureProgress(monitor, threshold);
  const activeUptime = uptime[range];

  return (
    <div>
      <PageHeader
        above={<BackLink />}
        title={monitor.name}
        description={
          <>
            <a
              href={monitor.url}
              target="_blank"
              rel="noreferrer noopener"
              className="break-all underline underline-offset-2 hover:text-strong"
            >
              {monitor.url}
            </a>
            <span className="mt-1 block">
              {explainState({ ...monitor, failureThreshold: threshold })}
            </span>
          </>
        }
        actions={
          <>
            <StateBadge state={monitor.displayState} />
            <Button
              variant="secondary"
              size="sm"
              loading={busy}
              onClick={() =>
                void patch(
                  { paused: !monitor.paused },
                  monitor.paused
                    ? 'Checks resumed. The monitor is pending until the next result arrives.'
                    : 'Checks paused. No further checks or alerts for this monitor.',
                )
              }
            >
              {monitor.paused ? 'Resume checks' : 'Pause checks'}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              Edit
            </Button>
          </>
        }
      />

      {loadError ? (
        <Alert tone="warning" className="mb-6">
          Could not refresh: {loadError} Showing the last data that loaded.
        </Alert>
      ) : null}

      <div className="space-y-6">
        {/* ------------------------------------------------ state notices -- */}
        {monitor.displayState === 'DOWN' && monitor.lastFailureReason ? (
          <Alert tone="error" title="This monitor is down">
            <p>{monitor.lastFailureReason}</p>
            <p className="mt-1">
              Confirmed after {threshold} consecutive failed checks
              {monitor.consecutiveFailures > threshold
                ? `; ${monitor.consecutiveFailures} have now failed in a row`
                : ''}
              . You were emailed once when this outage opened, and will be emailed once more when it
              recovers.
            </p>
          </Alert>
        ) : null}

        {progress ? (
          <Alert tone="warning" title="The most recent check failed">
            <p>{monitor.lastFailureReason}</p>
            <p className="mt-1">{progress}</p>
          </Alert>
        ) : null}

        {monitor.displayState === 'STALE' ? (
          <Alert tone="warning" title="Monitoring has gone quiet">
            The last completed check was {formatRelative(monitor.lastCheckedAt)}, more than three
            intervals ago. Until checks resume this monitor&apos;s real state is unknown — it is not
            being reported as up or down, and the gap is excluded from uptime rather than counted
            against it.
          </Alert>
        ) : null}

        {monitor.displayState === 'PAUSED' ? (
          <Alert tone="info" title="Checks are paused">
            No checks run and no alerts are sent while a monitor is paused. Any incident that was
            open when you paused it was closed without a recovery email, because nothing recovered.
          </Alert>
        ) : null}

        {monitor.displayState === 'PENDING' ? (
          <Alert tone="info" title="Waiting for the first check">
            This monitor has not completed a check yet. The first result normally arrives within one
            interval, and this page updates on its own when it does.
          </Alert>
        ) : null}

        {monitor.lastFailureKind === 'REDIRECT' ? (
          <Alert tone="warning" title="This URL responds with a redirect">
            Pingexa does not follow redirects, so a 3xx response counts as a failed check. Edit the
            monitor to point at the final URL — for example the <code className="font-mono">https://</code>{' '}
            address, or the page the redirect leads to.
          </Alert>
        ) : null}

        {failedNotifications.length > 0 ? (
          <Alert tone="error" title="An alert email could not be delivered">
            {plural(failedNotifications.length, 'alert')} for this monitor exhausted every delivery
            attempt. The incident history below is complete regardless — a failed email never loses a
            record.
          </Alert>
        ) : null}

        {/* ------------------------------------------------------ figures -- */}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Card className="p-4">
            <UptimeStat summary={uptime['24h']} label="Uptime · 24 hours" />
          </Card>
          <Card className="p-4">
            <UptimeStat summary={uptime['7d']} label="Uptime · 7 days" />
          </Card>
          <Card className="p-4">
            <Metric
              label="Last response"
              value={formatMs(monitor.lastResponseTimeMs)}
              note={
                monitor.lastStatusCode
                  ? `HTTP ${monitor.lastStatusCode} · time to first byte`
                  : 'no status recorded'
              }
            />
          </Card>
          <Card className="p-4">
            <Metric
              label="Last check"
              value={formatRelative(monitor.lastCheckedAt)}
              note={formatNextCheck(monitor)}
            />
            {monitor.consecutiveFailures > 0 ? (
              <p className="mt-2 text-xs font-medium text-[var(--status-warn-text)]">
                {plural(monitor.consecutiveFailures, 'failure')} in a row
              </p>
            ) : null}
          </Card>
        </div>

        {/* -------------------------------------------------------- chart -- */}
        <Card className="p-5">
          <SectionHeading
            title="Response time"
            description={`Individual check results. History is kept for ${plural(retentionDays, 'day')} and then removed automatically.`}
            action={
              <SegmentedControl<UptimeWindow>
                legend="Chart range"
                size="sm"
                value={range}
                onChange={setRange}
                options={[
                  { value: '24h', label: '24 hours' },
                  { value: '7d', label: '7 days' },
                ]}
              />
            }
          />
          <Suspense fallback={<Skeleton className="h-[260px] w-full" />}>
            <ResponseTimeChart checks={rangedChecks} />
          </Suspense>
          {coverageNote(activeUptime) ? (
            <Hint className="mt-2 text-[var(--status-warn-text)]">{coverageNote(activeUptime)}</Hint>
          ) : null}
        </Card>

        {/* ---------------------------------------------------- incidents -- */}
        <Card className="p-5">
          <SectionHeading
            title="Incidents"
            description={`An incident opens after ${threshold} consecutive failed checks and closes on the first success.`}
          />
          <IncidentList incidents={incidents} />
        </Card>

        {/* ------------------------------------------------ recent checks -- */}
        <Card className="p-5">
          <SectionHeading
            title="Recent checks"
            description={
              rangedChecks.length > CHECK_TABLE_LIMIT
                ? `The ${CHECK_TABLE_LIMIT} most recent of ${plural(rangedChecks.length, 'check')} in the selected range, newest first.`
                : 'Newest first.'
            }
          />
          {recentChecks.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">
              No checks recorded in this range yet.
            </p>
          ) : (
            <TableWrap label="Recent check results">
              <table className="w-full min-w-[34rem] text-left">
                <caption className="sr-only">
                  Individual check results with outcome, status and response time
                </caption>
                <thead>
                  <tr className="border-b border-[var(--border-subtle)]">
                    <Th>Checked at</Th>
                    <Th>Outcome</Th>
                    <Th>Result</Th>
                    <Th align="right">Response</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {recentChecks.map((check) => (
                    <tr key={check.id}>
                      <Td className="whitespace-nowrap text-muted">
                        {formatDateTime(check.checkedAt)}
                      </Td>
                      <Td>
                        <Badge tone={check.outcome === 'UP' ? 'up' : 'down'} size="sm" dot>
                          {check.outcome === 'UP' ? 'Up' : 'Down'}
                        </Badge>
                      </Td>
                      <Td className="text-muted">
                        {check.outcome === 'UP'
                          ? `HTTP ${check.statusCode ?? '—'}`
                          : /*
                               The failure *kind* is a fixed vocabulary and safe to
                               show; the reason is already sanitised server-side and
                               never contains a response body.
                             */
                            (check.failureReason ??
                            (check.failureKind ? FAILURE_KIND_LABELS[check.failureKind] : 'Failed'))}
                      </Td>
                      <Td align="right" className="tabular-nums text-strong">
                        {formatMs(check.responseTimeMs)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>

        {/* ----------------------------------------------------- alerting -- */}
        <Card className="p-5">
          <SectionHeading
            title="Alert emails"
            description="One email when an incident opens, one when it closes. Delivery state is recorded here."
          />
          {notifications.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted">
              No alerts sent for this monitor yet.
            </p>
          ) : (
            <TableWrap label="Alert email delivery history">
              <table className="w-full min-w-[28rem] text-left">
                <caption className="sr-only">Alert email delivery history</caption>
                <thead>
                  <tr className="border-b border-[var(--border-subtle)]">
                    <Th>Type</Th>
                    <Th>Delivery</Th>
                    <Th align="right">Attempts</Th>
                    <Th>Accepted at</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {notifications.map((entry) => (
                    <tr key={entry.id}>
                      <Td className="font-medium text-strong">
                        {entry.kind === 'DOWN' ? 'Down alert' : 'Recovery'}
                      </Td>
                      <Td>
                        <Badge
                          tone={
                            entry.status === 'SENT' ? 'up' : entry.status === 'FAILED' ? 'down' : 'warn'
                          }
                          size="sm"
                        >
                          {entry.status === 'SENT'
                            ? 'Accepted'
                            : entry.status === 'FAILED'
                              ? 'Failed'
                              : 'Queued'}
                        </Badge>
                      </Td>
                      <Td align="right" className="tabular-nums text-muted">
                        {entry.attempts}
                      </Td>
                      <Td className="text-muted">{formatDateTime(entry.sentAt)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
          {/*
            "Accepted", not "delivered". The mail provider returning 250 means it
            took the message, not that it reached an inbox — there is no bounce
            webhook behind this. See docs/DECISIONS.md D25.
          */}
          <Hint className="mt-3">
            &ldquo;Accepted&rdquo; means the mail provider took the message for delivery. Pingexa
            has no bounce tracking, so it is not proof the email reached your inbox.
          </Hint>
        </Card>

        {/* ------------------------------------------------- danger zone -- */}
        <Card className="border-[var(--status-down-border)] p-5">
          <SectionHeading
            title="Delete this monitor"
            description="Removes the monitor along with its entire check and incident history. This cannot be undone."
          />
          <Button variant="danger" size="sm" onClick={() => setConfirmingDelete(true)}>
            Delete {monitor.name}
          </Button>
        </Card>
      </div>

      <Dialog
        open={editing}
        onClose={() => setEditing(false)}
        title="Edit monitor"
        description="Changing the URL resets the failure streak and the current state, because the history describes a different target."
      >
        <EditForm
          initialName={monitor.name}
          initialUrl={monitor.url}
          initialPublic={monitor.isPublic}
          busy={busy}
          onCancel={() => setEditing(false)}
          onSave={async (changes) => {
            const ok = await patch(changes, 'Monitor updated.');
            if (ok) setEditing(false);
          }}
        />
      </Dialog>

      <ConfirmDialog
        open={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        busy={busy}
        title={`Delete ${monitor.name}?`}
        description={
          <>
            <p>
              This removes the monitor along with its entire check and incident history. It cannot
              be undone.
            </p>
            <p className="mt-2">It frees one of your monitor slots.</p>
          </>
        }
        confirmLabel="Delete monitor"
        cancelLabel="Keep it"
        onConfirm={async () => {
          setBusy(true);
          try {
            await api.delete(`/api/monitors/${monitor.id}`);
            show('success', `${monitor.name} deleted.`);
            navigate('/app/monitors');
          } catch (error) {
            show('error', error instanceof ApiError ? error.message : 'Could not delete the monitor.');
            setBusy(false);
            setConfirmingDelete(false);
          }
        }}
      />
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/app/monitors"
      className="inline-flex items-center gap-1 rounded text-sm text-brand-600 hover:underline dark:text-brand-300"
    >
      <svg viewBox="0 0 20 20" aria-hidden="true" className="size-4">
        <path d="M12 5l-5 5 5 5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      All monitors
    </Link>
  );
}

function DetailSkeleton() {
  return (
    <div role="status" aria-label="Loading monitor">
      <Skeleton className="h-4 w-28" />
      <Skeleton className="mt-3 h-8 w-64" />
      <Skeleton className="mt-2 h-4 w-80" />
      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <Card key={index} className="p-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-3 h-7 w-20" />
          </Card>
        ))}
      </div>
      <Card className="mt-6 p-5">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="mt-4 h-[260px] w-full" />
      </Card>
    </div>
  );
}

function EditForm({
  initialName,
  initialUrl,
  initialPublic,
  busy,
  onSave,
  onCancel,
}: {
  initialName: string;
  initialUrl: string;
  initialPublic: boolean;
  busy: boolean;
  onSave(changes: Record<string, unknown>): Promise<void>;
  onCancel(): void;
}) {
  const [name, setName] = useState(initialName);
  const [url, setUrl] = useState(initialUrl);
  const [isPublic, setIsPublic] = useState(initialPublic);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const dirty = name !== initialName || url !== initialUrl || isPublic !== initialPublic;

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;

        const candidate = normaliseMonitorUrl(url) ?? url.trim();
        const next: Record<string, string> = {};
        const nameResult = monitorNameSchema.safeParse(name);
        if (!nameResult.success) next['name'] = nameResult.error.issues[0]?.message ?? 'Invalid';
        const urlResult = monitorUrlSchema.safeParse(candidate);
        if (!urlResult.success) next['url'] = urlResult.error.issues[0]?.message ?? 'Invalid';
        if (Object.keys(next).length > 0) {
          setErrors(next);
          return;
        }
        setErrors({});

        // Send only what actually changed, so a no-op save is not an edit.
        const changes: Record<string, unknown> = {};
        if (nameResult.data !== initialName) changes['name'] = nameResult.data;
        if (urlResult.data !== initialUrl) changes['url'] = urlResult.data;
        if (isPublic !== initialPublic) changes['isPublic'] = isPublic;
        await onSave(changes);
      }}
    >
      <Field
        label="Name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        error={errors['name']}
        maxLength={60}
        required
      />
      <Field
        label="URL to monitor"
        type="url"
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        error={errors['url']}
        spellCheck={false}
        hint="Changing this resets the state to pending and closes any open incident without sending a recovery email."
        required
      />
      <Toggle
        label="Show on my status page"
        description="Only the name, state and uptime are published — never the URL."
        checked={isPublic}
        onChange={setIsPublic}
      />
      <div className="flex flex-wrap gap-2 pt-1">
        <Button type="submit" loading={busy} disabled={!dirty}>
          Save changes
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
