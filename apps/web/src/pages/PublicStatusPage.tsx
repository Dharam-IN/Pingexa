import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import type { PublicStatusPageResponse } from '@pingexa/shared';
import { StateBadge } from '../components/StateBadge';
import { ThemeSelector } from '../components/ThemeSelector';
import { Alert, Card, LoadingBlock, Logo, Wordmark } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { formatDateTime, formatDuration, formatRelative, formatUptime } from '../lib/format';

const REFRESH_MS = 60_000;

const OVERALL_COPY: Record<PublicStatusPageResponse['overall'], { title: string; tone: 'success' | 'error' | 'warning' | 'info' }> = {
  OPERATIONAL: { title: 'All systems operational', tone: 'success' },
  DEGRADED: { title: 'Some systems are having problems', tone: 'warning' },
  DOWN: { title: 'Systems are down', tone: 'error' },
  UNKNOWN: { title: 'No current status available', tone: 'info' },
};

/**
 * The public status page.
 *
 * It runs with no session and shows only what the API's public projection
 * returns: names, states, uptime and incident times. There is nothing here that
 * could reveal a URL, an email address or an internal error, because the API
 * never sends those fields.
 */
export function PublicStatusPage() {
  const { slug = '' } = useParams();
  const [data, setData] = useState<PublicStatusPageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await api.get<PublicStatusPageResponse>(`/api/public/status/${slug}`);
        if (cancelled) return;
        setData(response);
        setError(null);
        setNotFound(false);
      } catch (caught) {
        if (cancelled) return;
        if (caught instanceof ApiError && caught.status === 404) {
          setNotFound(true);
          return;
        }
        setError(caught instanceof ApiError ? caught.message : 'Could not load this status page.');
      }
    };

    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [slug]);

  if (notFound) {
    return (
      <PublicFrame>
        <Card className="p-8 text-center">
          <Logo size={40} />
          <h1 className="mt-3 text-lg font-semibold text-strong">Status page not available</h1>
          <p className="mt-1.5 text-sm text-muted">
            This link is not active. It may have been unpublished or replaced by its owner.
          </p>
        </Card>
      </PublicFrame>
    );
  }

  if (error) {
    return (
      <PublicFrame>
        <Alert tone="error" title="Could not load this status page">
          {error}
        </Alert>
      </PublicFrame>
    );
  }

  if (!data) {
    return (
      <PublicFrame>
        <LoadingBlock label="Loading status…" />
      </PublicFrame>
    );
  }

  const overall = OVERALL_COPY[data.overall];

  return (
    <PublicFrame title={data.title}>
      <div className="space-y-6">
        <Alert tone={overall.tone} title={overall.title}>
          Checked every {data.intervalSeconds / 60} minutes. Updated{' '}
          {formatRelative(data.generatedAt)}.
        </Alert>

        {data.monitors.length === 0 ? (
          <Card className="p-8 text-center">
            <p className="text-sm text-muted">
              Nothing is published on this page yet.
            </p>
          </Card>
        ) : (
          <ul className="space-y-4">
            {data.monitors.map((monitor) => (
              <Card as="li" key={monitor.id} className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold text-strong">{monitor.name}</h2>
                  <StateBadge state={monitor.displayState} />
                </div>

                <dl className="mt-4 grid grid-cols-2 gap-4 text-xs sm:grid-cols-3">
                  <div>
                    <dt className="text-muted">Uptime · 24 hours</dt>
                    <dd className="mt-0.5 text-base font-semibold text-strong">
                      {formatUptime(monitor.uptime24h)}
                    </dd>
                    {monitor.uptime24h.partialData ? (
                      <dd className="text-xs text-warn-700 dark:text-warn-500">
                        {monitor.uptime24h.coveragePercent.toFixed(0)}% coverage
                      </dd>
                    ) : null}
                  </div>
                  <div>
                    <dt className="text-muted">Uptime · 7 days</dt>
                    <dd className="mt-0.5 text-base font-semibold text-strong">
                      {formatUptime(monitor.uptime7d)}
                    </dd>
                    {monitor.uptime7d.partialData ? (
                      <dd className="text-xs text-warn-700 dark:text-warn-500">
                        {monitor.uptime7d.coveragePercent.toFixed(0)}% coverage
                      </dd>
                    ) : null}
                  </div>
                  <div>
                    <dt className="text-muted">Last checked</dt>
                    <dd className="mt-0.5 text-base font-semibold text-strong">
                      {formatRelative(monitor.lastCheckedAt)}
                    </dd>
                  </div>
                </dl>

                {monitor.recentIncidents.length > 0 ? (
                  <div className="mt-4 border-t border-[var(--border-subtle)] pt-3">
                    <p className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">
                      Recent incidents
                    </p>
                    <ul className="space-y-1.5 text-xs text-muted">
                      {monitor.recentIncidents.map((incident) => (
                        <li key={incident.id} className="flex flex-wrap justify-between gap-2">
                          <span>
                            {formatDateTime(incident.startedAt)}
                            {incident.ongoing ? ' — ongoing' : ` — ${formatDateTime(incident.resolvedAt)}`}
                          </span>
                          <span className="font-medium text-strong">
                            {formatDuration(incident.durationSeconds)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="mt-4 border-t border-[var(--border-subtle)] pt-3 text-xs text-muted">
                    No incidents in the last 7 days.
                  </p>
                )}
              </Card>
            ))}
          </ul>
        )}

        <p className="text-center text-xs text-muted">
          Uptime is measured from checks that actually ran. A gap in coverage is shown as such,
          rather than counted as uptime or as downtime.
        </p>
      </div>
    </PublicFrame>
  );
}

function PublicFrame({ title, children }: { title?: string; children: React.ReactNode }) {
  useEffect(() => {
    if (title) document.title = `${title} — status`;
    return () => {
      document.title = 'Pingexa';
    };
  }, [title]);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-[var(--border-subtle)] px-4 py-5 sm:px-6">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <h1 className="truncate text-lg font-semibold tracking-tight text-strong">
            {title ?? 'Status'}
          </h1>
          <div className="flex shrink-0 items-center gap-3">
            <ThemeSelector compact />
            <a href="/" aria-label="Pingexa">
              <Wordmark size="sm" />
            </a>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:px-6 sm:py-8">{children}</main>
      <footer className="border-t border-[var(--border-subtle)] px-4 py-5 text-center text-xs text-muted sm:px-6">
        Status page powered by Pingexa
      </footer>
    </div>
  );
}
