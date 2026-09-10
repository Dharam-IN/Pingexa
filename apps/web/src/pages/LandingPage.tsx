import { Link } from 'react-router';
import { useAuth } from '../state/AuthContext';
import { Card, Logo, Wordmark } from '../components/ui';

/**
 * Landing page.
 *
 * Deliberately contains no invented numbers, logos or testimonials: everything
 * on it is a factual statement about what V1 does, so nothing here can be
 * contradicted by the product.
 */
export function LandingPage() {
  const { status, meta } = useAuth();

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-5 sm:px-6">
        <Wordmark />
        <nav className="flex items-center gap-2 text-sm" aria-label="Account">
          {status === 'authenticated' ? (
            <Link
              to="/app"
              className="rounded-lg bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700"
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
                className="rounded-lg bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700"
              >
                Create account
              </Link>
            </>
          )}
        </nav>
      </header>

      <main>
        <section className="mx-auto max-w-3xl px-4 pt-10 pb-16 text-center sm:px-6 sm:pt-20">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 dark:border-brand-700 dark:bg-brand-900/40 dark:text-brand-100">
            <Logo size={16} live />
            Checks every {meta ? meta.intervalSeconds / 60 : 5} minutes
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-strong sm:text-5xl">
            Know your site is down
            <br />
            before your customers tell you.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base text-muted">
            Pingexa checks your websites from the outside every five minutes. When one stops
            responding, you get one email. When it comes back, you get one more. That is the whole
            product.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/signup"
              className="rounded-lg bg-brand-600 px-5 py-3 text-sm font-medium text-white hover:bg-brand-700"
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
            Up to {meta?.monitorLimit ?? 3} monitors per account. Email confirmation required before
            monitoring starts.
          </p>
        </section>

        <section
          aria-labelledby="how-it-works"
          className="mx-auto max-w-5xl px-4 pb-16 sm:px-6"
        >
          <h2 id="how-it-works" className="mb-6 text-center text-lg font-semibold text-strong">
            How it works
          </h2>
          <ol className="grid gap-4 sm:grid-cols-3">
            {[
              {
                step: '1',
                title: 'Add a URL',
                body: 'A public http:// or https:// address on a standard port. Pingexa never sends cookies, credentials or custom headers to it.',
              },
              {
                step: '2',
                title: 'We check it every 5 minutes',
                body: `A plain GET request with a ${10}-second budget. A 2xx response counts as up; anything else — including a redirect — counts as a failed check.`,
              },
              {
                step: '3',
                title: 'You hear from us only when it matters',
                body: `After ${meta?.failureThreshold ?? 3} consecutive failed checks Pingexa declares the monitor down and emails you once. One more email when it recovers.`,
              },
            ].map((item) => (
              <Card as="li" key={item.step} className="p-5">
                <span className="inline-flex size-7 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">
                  {item.step}
                </span>
                <h3 className="mt-3 text-sm font-semibold text-strong">{item.title}</h3>
                <p className="mt-1.5 text-sm text-muted">{item.body}</p>
              </Card>
            ))}
          </ol>
        </section>

        <section aria-labelledby="what-you-get" className="mx-auto max-w-5xl px-4 pb-20 sm:px-6">
          <h2 id="what-you-get" className="mb-6 text-center text-lg font-semibold text-strong">
            What you get
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {[
              {
                title: 'Honest uptime',
                body: `Uptime is calculated from checks that actually ran. If Pingexa misses a check, that gap is shown as reduced coverage — never counted as uptime, and never counted against you.`,
              },
              {
                title: 'Response time history',
                body: `${meta?.checkRetentionDays ?? 7} days of individual check results, with failures marked separately from slow responses.`,
              },
              {
                title: 'Incident timeline',
                body: 'Every outage records when it started, when it was confirmed, and when it recovered — with those three meanings spelled out.',
              },
              {
                title: 'An optional status page',
                body: 'Publish the monitors you choose on a page with an unguessable link. It shows names, states and uptime — never your URLs or your email.',
              },
            ].map((item) => (
              <Card key={item.title} className="p-5">
                <h3 className="text-sm font-semibold text-strong">{item.title}</h3>
                <p className="mt-1.5 text-sm text-muted">{item.body}</p>
              </Card>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-[var(--border-subtle)] px-4 py-6 sm:px-6">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 text-xs text-muted">
          <Wordmark size="sm" />
          <span>Website uptime monitoring for developers and small site owners.</span>
        </div>
      </footer>
    </div>
  );
}
