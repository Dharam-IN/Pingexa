import { useCallback, useState } from 'react';
import type {
  MonitorListResponse,
  StatusPageSettingsResponse,
} from '@pingexa/shared';
import { changePasswordSchema } from '@pingexa/shared';
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
import { formatDateTime } from '../lib/format';
import { useAuth } from '../state/AuthContext';
import { useToast } from '../state/ToastContext';

export function SettingsPage() {
  const { user, meta } = useAuth();
  const { show } = useToast();
  const [busy, setBusy] = useState(false);

  interface SettingsData {
    statusPage: StatusPageSettingsResponse;
    monitors: MonitorListResponse;
  }

  const {
    data,
    error: loadError,
    reload: load,
    setData,
  } = usePolledResource<SettingsData>(
    useCallback(async (signal?: AbortSignal) => {
      const [statusPage, monitors] = await Promise.all([
        api.get<StatusPageSettingsResponse>('/api/status-page', signal),
        api.get<MonitorListResponse>('/api/monitors', signal),
      ]);
      return { statusPage, monitors };
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

  if (loadError) {
    return (
      <Alert tone="error" title="Could not load your settings">
        <p>{loadError}</p>
        <Button variant="secondary" size="sm" className="mt-3" onClick={() => void load()}>
          Try again
        </Button>
      </Alert>
    );
  }

  if (!data) return <LoadingBlock label="Loading settings…" />;

  const { statusPage, monitors } = data;
  const page = statusPage.statusPage;
  const publishedCount = monitors.monitors.filter((monitor) => monitor.isPublic).length;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold tracking-tight text-strong">Settings</h1>

      <Card className="p-5">
        <SectionHeading
          title="Account"
          description="Alerts are always sent to this address, and only once it is confirmed."
        />
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted">Email address</dt>
            <dd className="font-medium text-strong">{user?.email}</dd>
          </div>
          <div>
            <dt className="text-muted">Email confirmed</dt>
            <dd className="font-medium text-strong">{user?.emailVerified ? 'Yes' : 'Not yet'}</dd>
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

      <Card className="p-5">
        <SectionHeading
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
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-900/40"
              >
                Open
              </a>
            </div>
            <p className="mt-2 text-xs text-muted">
              The link is the only access control, so treat it as private. Replacing it below breaks
              every copy anyone already has.
            </p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-3"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const response = await api.post<StatusPageSettingsResponse>(
                    '/api/status-page/rotate-slug',
                  );
                  setData((current) => (current ? { ...current, statusPage: response } : current));
                  show('success', 'A new link was generated. The old one no longer works.');
                } catch (error) {
                  show(
                    'error',
                    error instanceof ApiError ? error.message : 'Could not replace the link.',
                  );
                } finally {
                  setBusy(false);
                }
              }}
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
                You have no monitors yet, so there is nothing to publish.
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
                            error instanceof ApiError ? error.message : 'Could not save the change.',
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
            <p className="mt-3 text-xs text-muted">
              A published monitor never exposes its URL, your email address, HTTP status codes or
              failure messages — only its name, current state, uptime and incident times.
            </p>
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <SectionHeading
          title="Change password"
          description="Changing it signs out every other session, but keeps this one."
        />
        <ChangePasswordForm minLength={meta?.minPasswordLength ?? 10} />
      </Card>
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
        onChange={(event) => setTitle(event.target.value)}
      />
      <Button type="submit" variant="secondary" loading={busy} disabled={title.trim() === initialTitle}>
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
