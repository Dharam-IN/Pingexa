import { useCallback, useState } from 'react';
import { Link } from 'react-router';
import type {
  AlertListResponse,
  MonitorListResponse,
  StatusPageSettingsResponse,
} from '@pingexa/shared';
import { changePasswordSchema } from '@pingexa/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Field,
  Hint,
  PageHeader,
  SectionHeading,
  Skeleton,
  TableWrap,
  Td,
  Th,
  Toggle,
} from '../components/ui';
import { ThemeSelector } from '../components/ThemeSelector';
import { ApiError, api } from '../lib/api';
import { usePolledResource } from '../lib/usePolledResource';
import { formatDateTime, formatRelative, plural } from '../lib/format';
import { useAuth } from '../state/AuthContext';
import { useToast } from '../state/ToastContext';

/**
 * Settings.
 *
 * Grouped into five sections in the order people look for them: who you are,
 * how to get in, what is public, how the product behaves, and how it looks. A
 * table of contents rides alongside on wide screens so the page is navigable
 * without scrolling blind.
 *
 * Nothing here renders a secret. No session value, no token, no password hash,
 * no internal id, and no raw notification payload — the alert table shows a
 * status and an attempt count, which is what "did it arrive" needs.
 */

const SECTIONS = [
  { id: 'account', label: 'Account' },
  { id: 'password', label: 'Password' },
  { id: 'status-page', label: 'Public status page' },
  { id: 'alerts', label: 'Monitoring and alerts' },
  { id: 'appearance', label: 'Appearance' },
] as const;

export function SettingsPage() {
  const { user, meta } = useAuth();
  const { show } = useToast();
  const [busy, setBusy] = useState(false);
  const [confirmingRotate, setConfirmingRotate] = useState(false);

  interface SettingsData {
    statusPage: StatusPageSettingsResponse;
    monitors: MonitorListResponse;
    alerts: AlertListResponse;
  }

  const {
    data,
    error: loadError,
    reload: load,
    setData,
  } = usePolledResource<SettingsData>(
    useCallback(async (signal?: AbortSignal) => {
      const [statusPage, monitors, alerts] = await Promise.all([
        api.get<StatusPageSettingsResponse>('/api/status-page', signal),
        api.get<MonitorListResponse>('/api/monitors', signal),
        api.get<AlertListResponse>('/api/alerts?limit=10', signal),
      ]);
      return { statusPage, monitors, alerts };
    }, []),
    { fallbackMessage: 'Could not load your settings.' },
  );

  const update = useCallback(
    async (changes: { title?: string; published?: boolean }, message: string) => {
      setBusy(true);
      try {
        const response = await api.patch<StatusPageSettingsResponse>('/api/status-page', changes);
        // The write already returned the new state, so no re-read is needed.
        setData((current) => (current ? { ...current, statusPage: response } : current));
        show('success', message);
      } catch (error) {
        show('error', error instanceof ApiError ? error.message : 'Could not save the change.');
      } finally {
        setBusy(false);
      }
    },
    [show, setData],
  );

  const rotateSlug = useCallback(async () => {
    setBusy(true);
    try {
      const response = await api.post<StatusPageSettingsResponse>('/api/status-page/rotate-slug');
      setData((current) => (current ? { ...current, statusPage: response } : current));
      setConfirmingRotate(false);
      show('success', 'A new link was generated. The old one stopped working immediately.');
    } catch (error) {
      show('error', error instanceof ApiError ? error.message : 'Could not replace the link.');
    } finally {
      setBusy(false);
    }
  }, [setData, show]);

  if (loadError && !data) {
    return (
      <div>
        <PageHeader title="Settings" />
        <Alert
          tone="error"
          title="Could not load your settings"
          action={
            <Button variant="secondary" size="sm" onClick={() => void load()}>
              Try again
            </Button>
          }
        >
          {loadError}
        </Alert>
      </div>
    );
  }

  if (!data) return <SettingsSkeleton />;

  const { statusPage, monitors, alerts } = data;
  const page = statusPage.statusPage;
  const publishedCount = monitors.monitors.filter((monitor) => monitor.isPublic).length;
  const intervalMinutes = Math.round((meta?.intervalSeconds ?? 300) / 60);
  const threshold = meta?.failureThreshold ?? 3;

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Your account, your public status page, and how Pingexa behaves."
      />

      <div className="lg:flex lg:gap-8">
        {/* Section nav: a plain anchor list, so it works without JavaScript
            behaviour and reads as a navigation landmark. */}
        <nav aria-label="Settings sections" className="mb-6 hidden shrink-0 lg:block lg:w-48">
          <ul className="sticky top-8 space-y-0.5">
            {SECTIONS.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="block rounded-lg px-3 py-1.5 text-sm text-muted transition-colors hover:bg-[var(--surface-sunken)] hover:text-strong"
                >
                  {section.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 flex-1 space-y-6">
          {/* -------------------------------------------------- account -- */}
          <Card as="section" id="account" aria-labelledby="account-heading" className="p-5">
            <SectionHeading
              id="account-heading"
              title="Account"
              description="Alerts are always sent to this address, and only once it is confirmed."
            />
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted">Email address</dt>
                <dd className="font-medium break-all text-strong">{user?.email}</dd>
              </div>
              <div>
                <dt className="text-muted">Email confirmed</dt>
                <dd className="mt-0.5">
                  {user?.emailVerified ? (
                    <Badge tone="up" size="sm" dot>
                      Confirmed
                    </Badge>
                  ) : (
                    <Badge tone="warn" size="sm" dot>
                      Not confirmed
                    </Badge>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Member since</dt>
                <dd className="font-medium text-strong">{formatDateTime(user?.createdAt ?? null)}</dd>
              </div>
              <div>
                <dt className="text-muted">Monitors used</dt>
                <dd className="font-medium text-strong">
                  {monitors.used} of {monitors.limit}
                </dd>
              </div>
            </dl>
          </Card>

          {/* ------------------------------------------------- password -- */}
          <Card as="section" id="password" aria-labelledby="password-heading" className="p-5">
            <SectionHeading
              id="password-heading"
              title="Change password"
              description="Changing it signs out every other session and keeps this one."
            />
            <ChangePasswordForm minLength={meta?.minPasswordLength ?? 10} />
          </Card>

          {/* ---------------------------------------------- status page -- */}
          <Card as="section" id="status-page" aria-labelledby="status-page-heading" className="p-5">
            <SectionHeading
              id="status-page-heading"
              title="Public status page"
              description="One page per account, at a link only people you share it with can guess."
            />

            <div className="space-y-5">
              <Toggle
                label="Publish my status page"
                description={
                  page.published
                    ? 'The link below is live. Turning this off makes it stop working immediately.'
                    : 'While this is off, the link returns nothing at all.'
                }
                checked={page.published}
                disabled={busy}
                onChange={(next) =>
                  void update(
                    { published: next },
                    next ? 'Status page published.' : 'Status page unpublished.',
                  )
                }
              />

              <TitleForm
                initialTitle={page.title}
                busy={busy}
                onSave={(title) => update({ title }, 'Status page title saved.')}
              />

              <div>
                <p className="mb-1.5 text-sm font-medium text-strong">Your status page link</p>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-lg bg-[var(--surface-sunken)] px-3 py-2 font-mono text-xs text-strong">
                    {page.publicUrl}
                  </code>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(page.publicUrl);
                        show('success', 'Link copied.');
                      } catch {
                        show('error', 'Could not copy. Select the link and copy it manually.');
                      }
                    }}
                  >
                    Copy
                  </Button>
                  <a
                    href={`/status/${page.slug}`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg px-3 py-1.5 text-sm font-medium text-brand-600 hover:bg-[var(--status-info-surface)] dark:text-brand-300"
                  >
                    Open
                  </a>
                </div>
                <Hint className="mt-2">
                  The link is the only access control, so treat it as private. Replacing it breaks
                  every copy anyone already has.
                </Hint>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-3"
                  onClick={() => setConfirmingRotate(true)}
                >
                  Replace the link
                </Button>
              </div>

              <div>
                <p className="mb-2 text-sm font-medium text-strong">
                  Monitors on the page ({publishedCount} of {monitors.used})
                </p>
                {monitors.monitors.length === 0 ? (
                  <p className="text-sm text-muted">
                    You have no monitors yet, so there is nothing to publish.{' '}
                    <Link to="/app/monitors" className="underline underline-offset-2">
                      Add one first
                    </Link>
                    .
                  </p>
                ) : (
                  <ul className="divide-y divide-[var(--border-subtle)]">
                    {monitors.monitors.map((monitor) => (
                      <li key={monitor.id} className="py-3 first:pt-0 last:pb-0">
                        <Toggle
                          label={monitor.name}
                          description="Publishes the name, state and uptime only."
                          checked={monitor.isPublic}
                          disabled={busy}
                          onChange={async (next) => {
                            setBusy(true);
                            try {
                              await api.patch(`/api/monitors/${monitor.id}`, { isPublic: next });
                              await load();
                              show(
                                'success',
                                next
                                  ? `${monitor.name} added to your status page.`
                                  : `${monitor.name} removed from your status page.`,
                              );
                            } catch (error) {
                              show(
                                'error',
                                error instanceof ApiError
                                  ? error.message
                                  : 'Could not save the change.',
                              );
                            } finally {
                              setBusy(false);
                            }
                          }}
                        />
                      </li>
                    ))}
                  </ul>
                )}
                <Hint className="mt-3">
                  A published monitor never exposes its URL, your email address, HTTP status codes
                  or failure messages — only its name, current state, uptime and incident times.
                </Hint>
              </div>
            </div>
          </Card>

          {/* -------------------------------------------- monitoring/alerts -- */}
          <Card as="section" id="alerts" aria-labelledby="alerts-heading" className="p-5">
            <SectionHeading
              id="alerts-heading"
              title="Monitoring and alerts"
              description="How Pingexa checks your sites and when it emails you. These rules are fixed."
            />
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted">Check interval</dt>
                <dd className="font-medium text-strong">Every {intervalMinutes} minutes</dd>
              </div>
              <div>
                <dt className="text-muted">Declared down after</dt>
                <dd className="font-medium text-strong">
                  {threshold} consecutive failed checks
                </dd>
              </div>
              <div>
                <dt className="text-muted">Alerts go to</dt>
                <dd className="font-medium break-all text-strong">{user?.email}</dd>
              </div>
              <div>
                <dt className="text-muted">History kept</dt>
                <dd className="font-medium text-strong">
                  {plural(meta?.checkRetentionDays ?? 7, 'day')} of individual checks
                </dd>
              </div>
            </dl>

            <div className="mt-5 border-t border-[var(--border-subtle)] pt-5">
              <h3 className="text-sm font-semibold text-strong">Recent alert emails</h3>
              <Hint className="mt-0.5 mb-3">
                The last {alerts.limit} alerts across all your monitors. One down email and one
                recovery email per incident.
              </Hint>
              {alerts.alerts.length === 0 ? (
                <p className="py-4 text-sm text-muted">
                  No alerts sent yet. Pingexa only emails you when a monitor fails {threshold}{' '}
                  checks in a row, and again when it recovers.
                </p>
              ) : (
                <TableWrap label="Recent alert emails">
                  <table className="w-full min-w-[30rem] text-left">
                    <caption className="sr-only">Recent alert email delivery</caption>
                    <thead>
                      <tr className="border-b border-[var(--border-subtle)]">
                        <Th>Monitor</Th>
                        <Th>Type</Th>
                        <Th>Delivery</Th>
                        <Th>When</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border-subtle)]">
                      {alerts.alerts.map((alert) => (
                        <tr key={alert.id}>
                          <Td className="font-medium text-strong">
                            <Link
                              to={`/app/monitors/${alert.monitorId}`}
                              className="hover:underline"
                            >
                              {alert.monitorName}
                            </Link>
                          </Td>
                          <Td className="text-muted">
                            {alert.kind === 'DOWN' ? 'Down' : 'Recovery'}
                          </Td>
                          <Td>
                            <Badge
                              tone={
                                alert.status === 'SENT'
                                  ? 'up'
                                  : alert.status === 'FAILED'
                                    ? 'down'
                                    : 'warn'
                              }
                              size="sm"
                            >
                              {alert.status === 'SENT'
                                ? 'Accepted'
                                : alert.status === 'FAILED'
                                  ? 'Failed'
                                  : 'Queued'}
                            </Badge>
                          </Td>
                          <Td className="text-muted">
                            {formatRelative(alert.sentAt ?? alert.createdAt)}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              )}
              <Hint className="mt-3">
                &ldquo;Accepted&rdquo; means the mail provider took the message for delivery.
                Pingexa has no bounce tracking, so it is not proof the email reached your inbox.
              </Hint>
            </div>
          </Card>

          {/* ----------------------------------------------- appearance -- */}
          <Card as="section" id="appearance" aria-labelledby="appearance-heading" className="p-5">
            <SectionHeading
              id="appearance-heading"
              title="Appearance"
              description="Applies to this browser and is remembered the next time you visit."
            />
            <ThemeSelector />
            <Hint className="mt-3">
              &ldquo;System&rdquo; follows the light or dark setting of your operating system and
              changes with it.
            </Hint>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={confirmingRotate}
        onClose={() => setConfirmingRotate(false)}
        onConfirm={() => void rotateSlug()}
        busy={busy}
        title="Replace your status page link?"
        description={
          <>
            <p>
              A new link is generated immediately and the current one stops working for everyone who
              has it — bookmarks, emails and anywhere you have shared it.
            </p>
            <p className="mt-2">Use this if the link has been shared more widely than you meant.</p>
          </>
        }
        confirmLabel="Replace the link"
        cancelLabel="Keep the current link"
      />
    </div>
  );
}

function SettingsSkeleton() {
  return (
    <div role="status" aria-label="Loading settings">
      <PageHeader title="Settings" />
      <div className="space-y-6">
        {[0, 1, 2].map((index) => (
          <Card key={index} className="p-5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="mt-2 h-3 w-64" />
            <Skeleton className="mt-5 h-20 w-full" />
          </Card>
        ))}
      </div>
    </div>
  );
}

function TitleForm({
  initialTitle,
  busy,
  onSave,
}: {
  initialTitle: string;
  busy: boolean;
  onSave(title: string): Promise<void>;
}) {
  const [title, setTitle] = useState(initialTitle);
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={async (event) => {
        event.preventDefault();
        await onSave(title.trim());
      }}
    >
      <Field
        label="Page title"
        className="min-w-[14rem] flex-1"
        value={title}
        maxLength={60}
        hint="Shown as the heading of your public status page."
        onChange={(event) => setTitle(event.target.value)}
      />
      <Button
        type="submit"
        variant="secondary"
        loading={busy}
        disabled={title.trim() === initialTitle}
        className="mb-6"
      >
        Save title
      </Button>
    </form>
  );
}

function ChangePasswordForm({ minLength }: { minLength: number }) {
  const { show } = useToast();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={async (event) => {
        event.preventDefault();
        if (submitting) return;
        const parsed = changePasswordSchema.safeParse({ currentPassword, newPassword });
        if (!parsed.success) {
          const fields: Record<string, string> = {};
          for (const issue of parsed.error.issues) {
            const key = issue.path.join('.') || '_';
            if (!(key in fields)) fields[key] = issue.message;
          }
          setErrors(fields);
          return;
        }
        setErrors({});
        setSubmitting(true);
        try {
          await api.post('/api/auth/password', parsed.data);
          setCurrentPassword('');
          setNewPassword('');
          show('success', 'Password changed. Other sessions have been signed out.');
        } catch (error) {
          if (error instanceof ApiError) {
            setErrors(error.fields);
            if (Object.keys(error.fields).length === 0) show('error', error.message);
          } else {
            show('error', 'Could not change your password.');
          }
        } finally {
          setSubmitting(false);
        }
      }}
    >
      <Field
        label="Current password"
        type="password"
        autoComplete="current-password"
        value={currentPassword}
        onChange={(event) => setCurrentPassword(event.target.value)}
        error={errors['currentPassword']}
        required
      />
      <Field
        label="New password"
        type="password"
        autoComplete="new-password"
        value={newPassword}
        onChange={(event) => setNewPassword(event.target.value)}
        error={errors['newPassword']}
        hint={`At least ${minLength} characters, with a letter and a number.`}
        required
      />
      <Button type="submit" loading={submitting}>
        Change password
      </Button>
    </form>
  );
}
