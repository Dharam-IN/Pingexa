import { Suspense, lazy, useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { MonitorDetailResponse } from '@pingexa/shared';
import { monitorNameSchema, monitorUrlSchema } from '@pingexa/shared';
import { IncidentList } from '../components/IncidentList';

/**
 * Recharts is by far the biggest dependency in the app and only the monitor
 * detail page needs it, so it is split out of the initial bundle.
 */
const ResponseTimeChart = lazy(async () => ({
  default: (await import('../components/ResponseTimeChart')).ResponseTimeChart,
}));
import { StateBadge } from '../components/StateBadge';
import { UptimeStat } from '../components/UptimeStat';
import {
  Alert,
  Button,
  Card,
  Field,
  LoadingBlock,
  SectionHeading,
  Toggle,
} from '../components/ui';
import { ApiError, api } from '../lib/api';
import { usePolledResource } from '../lib/usePolledResource';
import { formatDateTime, formatMs, formatRelative, STATE_HELP } from '../lib/format';
import { useToast } from '../state/ToastContext';

const REFRESH_MS = 30_000;

export function MonitorDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { show } = useToast();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

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

  if (loadError) {
    return (
      <Alert tone="error" title="Could not load this monitor">
        <p>{loadError}</p>
        <Link to="/app" className="mt-3 inline-block text-sm underline">
          Back to your monitors
        </Link>
      </Alert>
    );
  }

  if (!data) return <LoadingBlock label="Loading monitor…" />;

  const { monitor, uptime, checks, incidents, notifications } = data;
  const failedNotifications = notifications.filter((entry) => entry.status === 'FAILED');

  return (
    <div className="space-y-6">
      <div>
        <Link to="/app" className="text-sm text-brand-600 underline">
          ← All monitors
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold tracking-tight text-strong">{monitor.name}</h1>
            <StateBadge state={monitor.displayState} />
          </div>
          <a
            href={monitor.url}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-1 inline-block max-w-full truncate text-sm text-muted underline underline-offset-2"
          >
            {monitor.url}
          </a>
          <p className="mt-1 text-xs text-muted">{STATE_HELP[monitor.displayState]}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            loading={busy}
            onClick={() =>
              void patch(
                { paused: !monitor.paused },
                monitor.paused ? 'Monitor resumed.' : 'Monitor paused.',
              )
            }
          >
            {monitor.paused ? 'Resume checks' : 'Pause checks'}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setEditing((value) => !value)}>
            {editing ? 'Close editor' : 'Edit'}
          </Button>
          <Button variant="danger" size="sm" onClick={() => setConfirmingDelete(true)}>
            Delete
          </Button>
        </div>
      </div>

      {monitor.displayState === 'STALE' ? (
        <Alert tone="warning" title="Monitoring has gone quiet">
          The last completed check was {formatRelative(monitor.lastCheckedAt)}, which is more than
          three intervals ago. Until checks resume, this monitor&apos;s real state is unknown — it is
          not being reported as up or down. The last known state was {monitor.state.toLowerCase()}.
        </Alert>
      ) : null}

      {monitor.lastFailureReason && monitor.displayState !== 'DOWN' ? (
        <Alert tone="warning" title="The most recent check failed">
          <p>{monitor.lastFailureReason}</p>
          <p className="mt-1">
            {monitor.consecutiveFailures === 1
              ? 'That is 1 consecutive failure. Pingexa declares a monitor down — and emails you — after 3.'
              : `That is ${monitor.consecutiveFailures} consecutive failures. Pingexa declares a monitor down — and emails you — after 3.`}
          </p>
        </Alert>
      ) : null}

      {monitor.displayState === 'DOWN' && monitor.lastFailureReason ? (
        <Alert tone="error" title="This monitor is down">
          <p>{monitor.lastFailureReason}</p>
          <p className="mt-1">
            Confirmed after 3 consecutive failed checks
            {monitor.consecutiveFailures > 3
              ? `; ${monitor.consecutiveFailures} have now failed in a row`
              : ''}
            . You have been emailed once about this outage, and will be emailed once more when it
            recovers.
          </p>
        </Alert>
      ) : null}

      {monitor.lastFailureKind === 'REDIRECT' ? (
        <Alert tone="warning" title="This URL responds with a redirect">
          Pingexa does not follow redirects, so a 3xx response counts as a failed check. Edit the
          monitor to point at the final URL — for example the https:// address, or the page the
          redirect leads to.
        </Alert>
      ) : null}

      {failedNotifications.length > 0 ? (
        <Alert tone="error" title="An alert email could not be delivered">
          {failedNotifications.length} alert
          {failedNotifications.length === 1 ? '' : 's'} for this monitor exhausted every delivery
          attempt. The incident history below is complete regardless — a failed email never loses a
          record.
        </Alert>
      ) : null}

      {confirmingDelete ? (
        <Alert tone="error" title={`Delete “${monitor.name}”?`}>
          <p>
            This removes the monitor and its whole check and incident history. It cannot be undone,
            and it frees one of your monitor slots.
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              variant="danger"
              size="sm"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api.delete(`/api/monitors/${monitor.id}`);
                  show('success', `${monitor.name} deleted.`);
                  navigate('/app');
                } catch (error) {
                  show(
                    'error',
                    error instanceof ApiError ? error.message : 'Could not delete the monitor.',
                  );
                  setBusy(false);
                }
              }}
            >
              Yes, delete it
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(false)}>
              Keep it
            </Button>
          </div>
        </Alert>
      ) : null}

      {editing ? (
        <Card className="p-5">
          <SectionHeading
            title="Edit monitor"
            description="Changing the URL resets the failure streak and the current state, because the history describes a different target."
          />
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
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <UptimeStat summary={uptime['24h']} label="Uptime · 24 hours" />
        </Card>
        <Card className="p-4">
          <UptimeStat summary={uptime['7d']} label="Uptime · 7 days" />
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium tracking-wide text-muted uppercase">Last response</p>
          <p className="text-2xl font-semibold text-strong">{formatMs(monitor.lastResponseTimeMs)}</p>
          <p className="mt-0.5 text-xs text-muted">
            {monitor.lastStatusCode ? `HTTP ${monitor.lastStatusCode}` : 'no status recorded'}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium tracking-wide text-muted uppercase">Last check</p>
          <p className="text-2xl font-semibold text-strong">
            {formatRelative(monitor.lastCheckedAt)}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {monitor.paused
              ? 'paused — no checks scheduled'
              : monitor.nextCheckAt
                ? `next ${formatRelative(monitor.nextCheckAt)}`
                : 'not scheduled'}
          </p>
        </Card>
      </div>

      <Card className="p-5">
        <SectionHeading
          title="Response time"
          description={`Individual check results from the last ${data.checkHistoryRetentionDays} days. Older results are removed automatically.`}
        />
        <Suspense fallback={<LoadingBlock label="Loading chart…" />}>
          <ResponseTimeChart checks={checks} />
        </Suspense>
      </Card>

      <Card className="p-5">
        <SectionHeading
          title="Incidents"
          description="An incident opens after three consecutive failed checks and closes on the first success."
        />
        <IncidentList incidents={incidents} />
      </Card>

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
          <div className="overflow-x-auto">
            <table className="w-full min-w-[28rem] text-left text-sm">
              <caption className="sr-only">Alert email delivery history</caption>
              <thead>
                <tr className="text-xs text-muted uppercase">
                  <th scope="col" className="pb-2 font-medium">Type</th>
                  <th scope="col" className="pb-2 font-medium">Delivery</th>
                  <th scope="col" className="pb-2 font-medium">Attempts</th>
                  <th scope="col" className="pb-2 font-medium">Sent</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {notifications.map((entry) => (
                  <tr key={entry.id}>
                    <td className="py-2 font-medium text-strong">
                      {entry.kind === 'DOWN' ? 'Down alert' : 'Recovery'}
                    </td>
                    <td className="py-2 text-muted">
                      {entry.status === 'SENT'
                        ? 'Sent'
                        : entry.status === 'FAILED'
                          ? 'Failed'
                          : 'Queued'}
                    </td>
                    <td className="py-2 text-muted">{entry.attempts}</td>
                    <td className="py-2 text-muted">{formatDateTime(entry.sentAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
        const next: Record<string, string> = {};
        const nameResult = monitorNameSchema.safeParse(name);
        if (!nameResult.success) next['name'] = nameResult.error.issues[0]?.message ?? 'Invalid';
        const urlResult = monitorUrlSchema.safeParse(url);
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
        hint="Changing this resets the state to pending and closes any open incident without sending a recovery email."
        required
      />
      <Toggle
        label="Show on my status page"
        description="Only the name, state and uptime are published — never the URL."
        checked={isPublic}
        onChange={setIsPublic}
      />
      <div className="flex gap-2">
        <Button type="submit" loading={busy} disabled={!dirty}>
          Save changes
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
