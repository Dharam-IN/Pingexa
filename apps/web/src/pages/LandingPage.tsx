import { useEffect } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../state/AuthContext';
import { ThemeSelector } from '../components/ThemeSelector';
import { Badge, Card, Logo, Wordmark } from '../components/ui';

/**
 * Landing page.
 *
 * Every claim on this page is a factual statement about what V1 does, so
 * nothing here can be contradicted by the product. There are no testimonials,
 * no customer counts, no logo wall and no uptime promise, because Pingexa
 * cannot substantiate any of them.
 *
 * The preview panel is the one piece of non-live content. It is built from the
 * `SAMPLE` constant below, labelled "Example" in the markup, and uses obviously
 * illustrative names — it must never be mistaken for the reader's own data, and
 * a signed-in visitor is redirected to their real overview before this renders.
 */

/** Presentation data for the preview. Static, and clearly marked as an example. */
const SAMPLE = {
  monitors: [
    { name: 'Marketing site', host: 'example.com', state: 'Up', tone: 'up', uptime: '100.00%', ms: '112 ms' },
    { name: 'Checkout API', host: 'api.example.com/health', state: 'Up', tone: 'up', uptime: '99.65%', ms: '287 ms' },
    { name: 'Docs', host: 'docs.example.com', state: 'Down', tone: 'down', uptime: '98.21%', ms: '—' },
  ],
  // 48 half-hour buckets, the same shape the real strip draws.
  strip: [
    ...Array<0>(31).fill(0),
    ...Array<1>(4).fill(1),
    ...Array<0>(9).fill(0),
    ...Array<2>(2).fill(2),
    ...Array<0>(2).fill(0),
  ],
} as const;

const STRIP_TONE = ['bg-[var(--status-up-border)]', 'bg-[var(--chart-fail)]', 'bg-[var(--chart-gap)]'];

export function LandingPage() {
  const { status, meta } = useAuth();
  const intervalMinutes = Math.round((meta?.intervalSeconds ?? 300) / 60);
  const threshold = meta?.failureThreshold ?? 3;
  const retention = meta?.checkRetentionDays ?? 7;
  const limit = meta?.monitorLimit ?? 3;

  useEffect(() => {
    document.title = 'Pingexa — uptime monitoring that emails you when your site goes down';
    const description = document.querySelector('meta[name="description"]');
    description?.setAttribute(
      'content',
      `Pingexa checks your websites every ${intervalMinutes} minutes from the outside, opens an incident after ${threshold} consecutive failures, and emails you once when a site goes down and once when it recovers. Free for up to ${limit} monitors.`,
    );
  }, [intervalMinutes, threshold, limit]);

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-5 sm:px-6">
        <Wordmark />
        <nav className="flex items-center gap-2 text-sm" aria-label="Account">
          <ThemeSelector compact className="mr-1" />
          {status === 'authenticated' ? (
            <Link
              to="/app"
              className="rounded-lg bg-brand-600 px-4 py-2 font-medium text-on-brand hover:bg-brand-700"
            >
              Open dashboard
            </Link>
          ) : (
            <>
              <Link to="/login" className="rounded-lg px-3 py-2 font-medium text-muted hover:text-strong">
                Sign in
              </Link>
              <Link
                to="/signup"
                className="rounded-lg bg-brand-600 px-4 py-2 font-medium text-on-brand hover:bg-brand-700"
              >
                Create account
              </Link>
            </>
          )}
        </nav>
      </header>

      <main>
        {/* ------------------------------------------------------- hero -- */}
        <section className="mx-auto max-w-6xl px-4 pt-8 pb-14 sm:px-6 sm:pt-14">
          <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
            <div>
              <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-[var(--status-info-border)] bg-[var(--status-info-surface)] px-3 py-1 text-xs font-medium text-[var(--status-info-text)]">
                <Logo size={16} live />
                Checks every {intervalMinutes} minutes
              </p>
              <h1 className="text-3xl font-semibold tracking-tight text-strong sm:text-4xl lg:text-5xl">
                Know your site is down before your customers tell you.
              </h1>
              <p className="mt-5 max-w-xl text-base text-muted">
                Pingexa checks your websites from the outside, every {intervalMinutes} minutes. When
                one stops responding it opens an incident and emails you once. When it comes back,
                you get one more email. That is the whole product.
              </p>

              <div className="mt-7 flex flex-wrap items-center gap-3">
                <Link
                  to="/signup"
                  className="rounded-lg bg-brand-600 px-5 py-3 text-sm font-medium text-on-brand hover:bg-brand-700"
                >
                  Create a free account
                </Link>
                <Link
                  to="/login"
                  className="surface rounded-lg px-5 py-3 text-sm font-medium text-strong hover:bg-[var(--surface-sunken)]"
                >
                  Sign in
                </Link>
              </div>
              <p className="mt-4 text-xs text-muted">
                Free for up to {limit} monitors — the limit Pingexa ships with today. No card, no
                trial timer. Email confirmation is required before monitoring starts.
              </p>

              <p className="mt-8 text-sm text-muted">
                Built for developers, freelancers, agencies and anyone who owns a handful of sites
                and wants to hear about an outage from a machine rather than a customer.
              </p>
            </div>

            <ProductPreview
              intervalMinutes={intervalMinutes}
              threshold={threshold}
            />
          </div>
        </section>

        {/* ------------------------------------------------ how it works -- */}
        <section aria-labelledby="how-it-works" className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
          <h2 id="how-it-works" className="mb-2 text-lg font-semibold text-strong">
            How it works
          </h2>
          <p className="mb-6 max-w-2xl text-sm text-muted">
            Three steps, and then it stays out of your way.
          </p>
          <ol className="grid gap-4 sm:grid-cols-3">
            {[
              {
                step: '1',
                title: 'Add a URL',
                body: `A public http:// or https:// address on its standard port. Pingexa sends a plain GET with no cookies, no credentials and no custom headers.`,
              },
              {
                step: '2',
                title: `We check it every ${intervalMinutes} minutes`,
                body: `From outside your network, with a 10-second budget. A 2xx response counts as up; anything else — including a redirect — counts as a failed check.`,
              },
              {
                step: '3',
                title: 'You hear from us only when it matters',
                body: `After ${threshold} consecutive failed checks Pingexa opens an incident and emails you once. One more email when it recovers. Nothing in between.`,
              },
            ].map((item) => (
              <Card as="li" key={item.step} className="p-5">
                <span className="inline-flex size-7 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-on-brand">
                  {item.step}
                </span>
                <h3 className="mt-3 text-sm font-semibold text-strong">{item.title}</h3>
                <p className="mt-1.5 text-sm text-muted">{item.body}</p>
              </Card>
            ))}
          </ol>
        </section>

        {/* ------------------------------------------- the three-fail rule -- */}
        <section aria-labelledby="quiet" className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
          <Card className="overflow-hidden">
            <div className="grid gap-6 p-6 sm:p-8 lg:grid-cols-2 lg:items-center">
              <div>
                <h2 id="quiet" className="text-lg font-semibold text-strong">
                  Quiet by design
                </h2>
                <p className="mt-2 text-sm text-muted">
                  One slow response or one dropped connection is not an outage, and a monitor that
                  emails you about every blip gets muted — at which point it is worse than useless.
                </p>
                <p className="mt-3 text-sm text-muted">
                  Pingexa only declares a monitor down after <strong className="text-strong">{threshold} consecutive
                  scheduled checks</strong> have failed. The streak counts distinct scheduled checks,
                  so an internal retry can never push your site to &ldquo;down&rdquo;.
                </p>
              </div>

              {/* A diagram of the rule, drawn from the same tokens as the app. */}
              <ol className="space-y-2" aria-label={`Example: ${threshold} consecutive failures are needed before an alert`}>
                {[
                  { label: 'Check 1', outcome: 'Failed', tone: 'warn', note: 'noted, no alert' },
                  { label: 'Check 2', outcome: 'Failed', tone: 'warn', note: 'noted, no alert' },
                  { label: `Check ${threshold}`, outcome: 'Failed', tone: 'down', note: 'incident opens · one email' },
                  { label: `Check ${threshold + 1}`, outcome: 'Passed', tone: 'up', note: 'incident closes · one email' },
                ].map((row) => (
                  <li
                    key={row.label}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2"
                  >
                    <span className="w-16 text-xs font-medium text-muted">{row.label}</span>
                    <Badge tone={row.tone as 'up' | 'down' | 'warn'} size="sm" dot>
                      {row.outcome}
                    </Badge>
                    <span className="text-xs text-muted">{row.note}</span>
                  </li>
                ))}
              </ol>
            </div>
          </Card>
        </section>

        {/* ------------------------------------------------- what you get -- */}
        <section aria-labelledby="what-you-get" className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
          <h2 id="what-you-get" className="mb-6 text-lg font-semibold text-strong">
            What you get
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                title: 'Honest uptime',
                body: 'Uptime is calculated only from checks that actually ran. If Pingexa misses a check, that gap is reported as reduced coverage — never counted as uptime, and never counted against you.',
              },
              {
                title: `${retention} days of response times`,
                body: `Every individual check result, with failures marked separately from slow responses, so a gradual slowdown is visible before it becomes an outage.`,
              },
              {
                title: 'Incident timeline',
                body: 'Each outage records when it started, when it was confirmed, and when it recovered — with those three meanings spelled out rather than collapsed into one timestamp.',
              },
              {
                title: 'Email alerts, twice',
                body: 'One email when an incident opens and one when it closes, to your confirmed account address. No digests, no noise, no third-party inbox.',
              },
              {
                title: 'A shareable status page',
                body: 'Publish the monitors you choose at an unguessable link. It shows names, states, uptime and incident times — never your URLs, your email or any error detail.',
              },
              {
                title: 'Careful about what it fetches',
                body: 'Only public http:// and https:// addresses on standard ports. Every hostname is resolved and checked against public address ranges before the request, and the connection is pinned to that address, so a monitor cannot be pointed at a private network.',
              },
            ].map((item) => (
              <Card key={item.title} className="p-5">
                <h3 className="text-sm font-semibold text-strong">{item.title}</h3>
                <p className="mt-1.5 text-sm text-muted">{item.body}</p>
              </Card>
            ))}
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              to="/signup"
              className="rounded-lg bg-brand-600 px-5 py-3 text-sm font-medium text-on-brand hover:bg-brand-700"
            >
              Start monitoring — free for {limit} sites
            </Link>
            <span className="text-xs text-muted">
              Takes a minute. You need an email address you can confirm.
            </span>
          </div>
        </section>
      </main>

      <footer className="border-t border-[var(--border-subtle)] px-4 py-6 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 text-xs text-muted">
          <Wordmark size="sm" />
          <span>Website uptime monitoring for developers and small site owners.</span>
        </div>
      </footer>
    </div>
  );
}

/**
 * A static picture of the signed-in overview.
 *
 * Marked as an example in the visible copy *and* in the accessible name, so it
 * cannot be read as live data by someone who arrives at the bottom of it.
 */
function ProductPreview({
  intervalMinutes,
  threshold,
}: {
  intervalMinutes: number;
  threshold: number;
}) {
  return (
    <figure className="m-0">
      <Card className="overflow-hidden shadow-raised">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-4 py-2.5">
          <span className="flex items-center gap-2 text-xs font-medium text-muted">
            <Logo size={16} />
            Overview
          </span>
          <Badge tone="neutral" size="sm">
            Example
          </Badge>
        </div>

        <div className="p-4">
          <div className="status-down mb-4 rounded-lg border px-3 py-2 text-xs">
            <strong className="font-semibold">Docs is down</strong> — Responded with HTTP 503.
            Confirmed after {threshold} consecutive failed checks.
          </div>

          <ul className="space-y-3">
            {SAMPLE.monitors.map((monitor) => (
              <li key={monitor.name} className="rounded-lg border border-[var(--border-subtle)] p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-strong">{monitor.name}</p>
                    <p className="truncate text-xs text-subtle">{monitor.host}</p>
                  </div>
                  <Badge tone={monitor.tone} size="sm" dot>
                    {monitor.state}
                  </Badge>
                </div>
                <dl className="mt-2 flex gap-6 text-xs">
                  <div>
                    <dt className="text-muted">Uptime 24h</dt>
                    <dd className="font-semibold tabular-nums text-strong">{monitor.uptime}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Response</dt>
                    <dd className="font-semibold tabular-nums text-strong">{monitor.ms}</dd>
                  </div>
                </dl>
                {monitor.state === 'Down' ? (
                  <div className="mt-2 flex h-4 w-full items-stretch gap-px" aria-hidden="true">
                    {SAMPLE.strip.map((tone, index) => (
                      <span
                        key={index}
                        className={`min-w-0 flex-1 rounded-[1px] ${STRIP_TONE[tone]}`}
                      />
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      </Card>
      <figcaption className="mt-2 text-center text-xs text-subtle">
        An example dashboard with sample data — not live. Checks run every {intervalMinutes}{' '}
        minutes.
      </figcaption>
    </figure>
  );
}
