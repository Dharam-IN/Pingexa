import { useCallback, useEffect } from 'react';
import { useParams } from 'react-router';
import type { PublicStatusPageResponse } from '@pingexa/shared';
import { StateBadge } from '../components/StateBadge';
import { ThemeSelector } from '../components/ThemeSelector';
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  Hint,
  LoadingBlock,
  Logo,
  Wordmark,
} from '../components/ui';
import { api } from '../lib/api';
import { usePolledResource } from '../lib/usePolledResource';
import { useNow } from '../lib/useNow';
import {
  coverageNote,
  formatDateTime,
  formatDuration,
  formatRelative,
  formatUptime,
  plural,
} from '../lib/format';

const REFRESH_MS = 60_000;

/**
 * How long after `generatedAt` the page stops claiming to be current.
 *
 * Two check intervals. A status page whose data is older than that is still
 * worth showing — it is the last thing we knew — but saying "updated 40 minutes
 * ago" in small grey text is not enough: a reader glancing at a green banner
 * will take it as now. So past this point the page says so in the banner.
 */
const STALE_AFTER_MS = 10 * 60 * 1000;

const OVERALL_COPY: Record<
  PublicStatusPageResponse['overall'],
  { title: string; tone: 'success' | 'error' | 'warning' | 'info'; body: string }
> = {
  OPERATIONAL: {
    title: 'All systems operational',
    tone: 'success',
    body: 'Every published service passed its most recent check.',
  },
  DEGRADED: {
    title: 'Some systems are having problems',
    tone: 'warning',
    body: 'At least one published service is not responding normally.',
  },
  DOWN: {
    title: 'All systems are down',
    tone: 'error',
    body: 'Every published service is failing its checks.',
  },
  UNKNOWN: {
    title: 'No current status available',
    tone: 'info',
    body: 'Nothing is published on this page, or no checks have completed yet.',
  },
};

/**
 * The public status page.
 *
 * It runs with no session and shows only what the API's public projection
 * returns: names, states, uptime and incident times. There is nothing here that
 * could reveal a URL, an email address, an HTTP status code or an internal
 * error, because the API never sends those fields — the privacy boundary is
 * `serialisePublicMonitor`, not this component.
 */
export function PublicStatusPage() {
  const { slug = '' } = useParams();
  // Ticks, so "updated 3m ago" and the staleness banner stay true between polls.
  const now = useNow();

  const { data, error, errorCode, loading } = usePolledResource<PublicStatusPageResponse>(
    useCallback(
      (signal?: AbortSignal) =>
        api.get<PublicStatusPageResponse>(`/api/public/status/${slug}`, signal),
      [slug],
    ),
    { intervalMs: REFRESH_MS, fallbackMessage: 'Could not load this status page.' },
  );

  // A 404 is the deliberate answer for an unknown slug, an unpublished page and
  // a malformed slug alike, so the three are indistinguishable from outside.
  // Branch on the stable code, never on the human-readable message.
  const notFound = data === null && errorCode === 'not_found';

  if (loading && !data && error === null) {
    return (
      <PublicFrame>
        <LoadingBlock label="Loading status…" />
      </PublicFrame>
    );
  }

  if (!data) {
    return (
      <PublicFrame>
        <Card className="p-8 text-center">
          <div className="flex justify-center">
            <Logo size={40} />
          </div>
          <h1 className="mt-3 text-lg font-semibold text-strong">
            {notFound ? 'Status page not available' : 'Could not load this status page'}
          </h1>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted">
            {notFound
              ? 'This link is not active. It may have been unpublished, or replaced by its owner with a new link.'
              : 'Something went wrong fetching the current status. The page will keep trying.'}
          </p>
        </Card>
      </PublicFrame>
    );
  }

  const overall = OVERALL_COPY[data.overall];
  const generatedAgeMs = now - new Date(data.generatedAt).getTime();
  const isStale = Number.isFinite(generatedAgeMs) && generatedAgeMs > STALE_AFTER_MS;
  const intervalMinutes = Math.round(data.intervalSeconds / 60);

  // A monitor the owner paused is not an outage — it is a service whose state is
  // deliberately not being tracked. Calling that "degraded" would be wrong.
  const paused = data.monitors.filter((monitor) => monitor.displayState === 'PAUSED');
  const unknown = data.monitors.filter(
    (monitor) => monitor.displayState === 'STALE' || monitor.displayState === 'PENDING',
  );

  return (
    <PublicFrame title={data.title}>
      <div className="space-y-6">
        <Alert tone={isStale ? 'warning' : overall.tone} title={isStale ? 'Status may be out of date' : overall.title}>
          {isStale ? (
            <p>
              This page was last updated {formatRelative(data.generatedAt)}, which is more than two
              check intervals ago. The states below are the last ones recorded, not necessarily the
              current ones.
            </p>
          ) : (
            <p>{overall.body}</p>
          )}
          <p className="mt-1 text-xs">
            Checked every {intervalMinutes} minutes · updated {formatRelative(data.generatedAt)}
          </p>
        </Alert>

        {paused.length > 0 || unknown.length > 0 ? (
          <Hint>
            {paused.length > 0
              ? `${plural(paused.length, 'service')} ${paused.length === 1 ? 'is' : 'are'} paused and not currently being checked. `
              : ''}
            {unknown.length > 0
              ? `${plural(unknown.length, 'service')} ${unknown.length === 1 ? 'has' : 'have'} no current result, so ${unknown.length === 1 ? 'its' : 'their'} state is unknown.`
              : ''}
          </Hint>
        ) : null}

        {data.monitors.length === 0 ? (
          <Card>
            <EmptyState
              title="Nothing published yet"
              description="The owner of this page has not published any services on it. When they do, their current state and uptime appear here."
            />
          </Card>
        ) : (
          <ul className="space-y-4">
            {data.monitors.map((monitor) => {
              const coverage24h = coverageNote(monitor.uptime24h);
              const ongoing = monitor.recentIncidents.filter((incident) => incident.ongoing);
              return (
                <Card as="li" key={monitor.id} className="p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-sm font-semibold text-strong">{monitor.name}</h2>
                    <StateBadge state={monitor.displayState} />
                  </div>

                  {ongoing.length > 0 ? (
                    <p className="status-down mt-3 rounded-md border px-3 py-2 text-xs">
                      Ongoing since {formatDateTime(ongoing[0]?.startedAt ?? null)} —{' '}
                      {formatDuration(ongoing[0]?.durationSeconds ?? 0)} so far.
                    </p>
                  ) : null}

                  <dl className="mt-4 grid grid-cols-2 gap-4 text-xs sm:grid-cols-3">
                    <div>
                      <dt className="text-muted">Uptime · 24 hours</dt>
                      <dd className="mt-0.5 text-base font-semibold tabular-nums text-strong">
                        {formatUptime(monitor.uptime24h)}
                      </dd>
                      {monitor.uptime24h.partialData ? (
                        <dd className="text-xs text-[var(--status-warn-text)]">
                          {monitor.uptime24h.coveragePercent.toFixed(0)}% coverage
                        </dd>
                      ) : null}
                    </div>
                    <div>
                      <dt className="text-muted">Uptime · 7 days</dt>
                      <dd className="mt-0.5 text-base font-semibold tabular-nums text-strong">
                        {formatUptime(monitor.uptime7d)}
                      </dd>
                      {monitor.uptime7d.partialData ? (
                        <dd className="text-xs text-[var(--status-warn-text)]">
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

                  {coverage24h ? (
                    <p className="mt-2 text-xs text-[var(--status-warn-text)]">{coverage24h}</p>
                  ) : null}

                  <div className="mt-4 border-t border-[var(--border-subtle)] pt-3">
                    <p className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">
                      Incidents · last 7 days
                    </p>
                    {monitor.recentIncidents.length === 0 ? (
                      <p className="text-xs text-muted">No incidents in the last 7 days.</p>
                    ) : (
                      <ul className="space-y-1.5 text-xs text-muted">
                        {monitor.recentIncidents.map((incident) => (
                          <li key={incident.id} className="flex flex-wrap justify-between gap-2">
                            <span className="flex items-center gap-2">
                              <Badge tone={incident.ongoing ? 'down' : 'neutral'} size="sm">
                                {incident.ongoing ? 'Ongoing' : 'Resolved'}
                              </Badge>
                              {formatDateTime(incident.startedAt)}
                              {incident.ongoing
                                ? ''
                                : ` — ${formatDateTime(incident.resolvedAt)}`}
                            </span>
                            <span className="font-medium tabular-nums text-strong">
                              {formatDuration(incident.durationSeconds)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </Card>
              );
            })}
          </ul>
        )}

        <p className="text-center text-xs text-muted">
          Uptime is measured from checks that actually ran. A gap in coverage is reported as a gap,
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

  /*
   * `noindex` while a status page is open.
   *
   * The slug is the only access control on this page — that is the whole
   * reason it is 32 hex characters of CSPRNG output, and the reason the API
   * answers it `no-store` so that revocation is immediate (D18). A search
   * engine that indexed one would undo both: the link would outlive its
   * revocation in someone else's cache, and a page the owner shared with a
   * handful of people would become publicly discoverable.
   *
   * Removed on unmount so it never leaks onto the marketing pages, which do
   * want to be indexed.
   */
  useEffect(() => {
    const tag = document.createElement('meta');
    tag.name = 'robots';
    tag.content = 'noindex, nofollow';
    document.head.appendChild(tag);
    return () => {
      tag.remove();
    };
  }, []);

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
        Status page powered by{' '}
        <a href="/" className="underline underline-offset-2 hover:text-strong">
          Pingexa
        </a>
      </footer>
    </div>
  );
}
