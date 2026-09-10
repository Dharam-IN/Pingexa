import { useCallback, useState } from 'react';
import type { MonitorListResponse, MonitorSummary } from '@pingexa/shared';
import { AddMonitorForm, type NewMonitor } from '../components/AddMonitorForm';
import { MonitorCard } from '../components/MonitorCard';
import { Alert, Button, Card, EmptyState, LoadingBlock, SectionHeading } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { usePolledResource } from '../lib/usePolledResource';
import { useAuth } from '../state/AuthContext';
import { useToast } from '../state/ToastContext';

/** How often the dashboard re-reads the list, so a new check appears on its own. */
const REFRESH_MS = 30_000;

export function DashboardPage() {
  const { user, meta } = useAuth();
  const { show } = useToast();
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const {
    data,
    error: loadError,
    loading,
    reload: load,
  } = usePolledResource<MonitorListResponse>(
    useCallback((signal) => api.get<MonitorListResponse>('/api/monitors', signal), []),
    { intervalMs: REFRESH_MS, fallbackMessage: 'Could not load your monitors.' },
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

  const togglePause = useCallback(
    async (monitor: MonitorSummary) => {
      setBusyId(monitor.id);
      try {
        await api.patch(`/api/monitors/${monitor.id}`, { paused: !monitor.paused });
        show('success', monitor.paused ? `${monitor.name} resumed.` : `${monitor.name} paused.`);
        await load();
      } catch (error) {
        show('error', error instanceof ApiError ? error.message : 'Could not update the monitor.');
      } finally {
        setBusyId(null);
      }
    },
    [load, show],
  );

  if (loading && !data && !loadError) return <LoadingBlock label="Loading your monitors…" />;

  const monitors = data?.monitors ?? [];
  const limit = data?.limit ?? meta?.monitorLimit ?? 3;
  const atLimit = monitors.length >= limit;
  const canAdd = user?.emailVerified === true;

  return (
    <div className="space-y-6">
      <SectionHeading
        title="Your monitors"
        description={
          <>
            {monitors.length} of {limit} used. Each is checked every{' '}
            {(meta?.intervalSeconds ?? 300) / 60} minutes.
          </>
        }
        action={
          !adding && canAdd && !atLimit ? (
            <Button onClick={() => setAdding(true)}>Add monitor</Button>
          ) : null
        }
      />

      {loadError ? (
        <Alert tone="error" title="Could not load your monitors">
          <p>{loadError}</p>
          <Button variant="secondary" size="sm" className="mt-3" onClick={() => void load()}>
            Try again
          </Button>
        </Alert>
      ) : null}

      {adding ? (
        <Card className="p-5">
          <SectionHeading title="Add a monitor" />
          <AddMonitorForm onSubmit={addMonitor} onCancel={() => setAdding(false)} />
        </Card>
      ) : null}

      {atLimit && !adding ? (
        <Alert tone="info">
          You are using all {limit} monitors. Delete one to add another.
        </Alert>
      ) : null}

      {monitors.length === 0 && !adding ? (
        <Card>
          <EmptyState
            title="No monitors yet"
            description={
              canAdd
                ? 'Add the URL of a site you want watched. Pingexa checks it every five minutes and emails you if it stops responding.'
                : 'Confirm your email address first — monitoring stays switched off until you do.'
            }
            action={
              canAdd ? <Button onClick={() => setAdding(true)}>Add your first monitor</Button> : null
            }
          />
        </Card>
      ) : (
        <ul className="grid items-start gap-4 sm:grid-cols-2">
          {monitors.map((monitor) => (
            <MonitorCard
              key={monitor.id}
              monitor={monitor}
              onTogglePause={(target) => void togglePause(target)}
              busy={busyId === monitor.id}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
