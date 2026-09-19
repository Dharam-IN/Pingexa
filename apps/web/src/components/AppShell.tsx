import { Link, NavLink } from 'react-router';
import type { ReactNode } from 'react';
import { useState } from 'react';
import clsx from 'clsx';
import { useAuth } from '../state/AuthContext';
import { useToast } from '../state/ToastContext';
import { ThemeSelector } from './ThemeSelector';
import { Alert, Button, IconButton, Wordmark } from './ui';
import { api, ApiError } from '../lib/api';

/**
 * The signed-in frame.
 *
 * A sidebar on desktop rather than a top bar, for two reasons that come out of
 * the route structure rather than from taste: the app has exactly three
 * destinations and will not grow more (teams, billing and regions are all out
 * of scope), so a persistent rail costs one column and never needs an overflow
 * menu; and the content is wide, dense and read top-to-bottom, so horizontal
 * space is cheaper here than vertical. Below `lg` the rail becomes a drawer,
 * because 240px of chrome on a 390px phone is most of the screen.
 *
 * The unverified-email banner lives here rather than on individual pages
 * because an unverified account has no working monitoring anywhere in the app.
 */

const NAV = [
  {
    to: '/app',
    label: 'Overview',
    end: true,
    icon: (
      <svg viewBox="0 0 20 20" aria-hidden="true" className="size-4.5">
        <path
          d="M3 10.5 10 4l7 6.5M5 9.5V16h10V9.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    to: '/app/monitors',
    label: 'Monitors',
    end: false,
    icon: (
      <svg viewBox="0 0 20 20" aria-hidden="true" className="size-4.5">
        <path
          d="M2.5 10h3l2-4.5 3 9 2-4.5h5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    to: '/app/settings',
    label: 'Settings',
    end: false,
    icon: (
      <svg viewBox="0 0 20 20" aria-hidden="true" className="size-4.5">
        <circle cx="10" cy="10" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path
          d="M10 2.6v1.9M10 15.5v1.9M17.4 10h-1.9M4.5 10H2.6M15.2 4.8l-1.3 1.3M6.1 13.9l-1.3 1.3M15.2 15.2l-1.3-1.3M6.1 6.1 4.8 4.8"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const { toasts, dismiss, show } = useToast();
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="min-h-dvh lg:flex">
      {/* ---------------------------------------------------- desktop rail -- */}
      <Sidebar
        className="hidden w-60 shrink-0 border-r border-[var(--border-subtle)] bg-[var(--surface-raised)] lg:flex"
        onSignOut={() => void logout()}
        email={user?.email}
      />

      {/* --------------------------------------------------- mobile drawer -- */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-[var(--scrim)]"
          />
          <Sidebar
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] border-r border-[var(--border-subtle)] bg-[var(--surface-overlay)] shadow-overlay"
            onSignOut={() => void logout()}
            email={user?.email}
            onClose={() => setDrawerOpen(false)}
            onNavigate={() => setDrawerOpen(false)}
          />
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* --------------------------------------------------- mobile bar -- */}
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--surface-raised)]/95 px-4 py-2.5 backdrop-blur lg:hidden">
          <IconButton
            label="Open navigation"
            variant="ghost"
            onClick={() => setDrawerOpen(true)}
            aria-expanded={drawerOpen}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true" className="size-5">
              <path d="M3 5.5h14M3 10h14M3 14.5h14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          </IconButton>
          <Link to="/app" className="rounded-md" aria-label="Pingexa overview">
            <Wordmark size="sm" />
          </Link>
          <div className="ml-auto">
            <ThemeSelector compact />
          </div>
        </header>

        <main id="main" className="w-full flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="mx-auto w-full max-w-6xl">
            {user && !user.emailVerified ? (
              <UnverifiedBanner email={user.email} onDone={show} />
            ) : null}
            {children}
          </div>
        </main>
      </div>

      {/* Toasts: one live region for the whole app. */}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 px-4 pb-4"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={clsx(
              'pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-overlay',
              toast.tone === 'success' && 'status-up',
              toast.tone === 'error' && 'status-down',
              toast.tone === 'info' && 'border-[var(--border-subtle)] bg-[var(--surface-overlay)] text-strong',
            )}
          >
            <span className="flex-1">{toast.message}</span>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              className="rounded text-xs font-medium underline underline-offset-2"
            >
              Dismiss
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function Sidebar({
  className,
  email,
  onSignOut,
  onClose,
  onNavigate,
}: {
  className?: string;
  email: string | undefined;
  onSignOut(): void;
  onClose?: () => void;
  /**
   * Called when a destination is chosen. The drawer closes from here rather
   * than from an effect watching the location: reacting to the route *after*
   * it changed means the new page renders once behind the open drawer.
   */
  onNavigate?: () => void;
}) {
  return (
    <div className={clsx('flex-col', className)}>
      <div className="flex items-center gap-2 px-4 py-4">
        <Link to="/app" className="rounded-md" aria-label="Pingexa overview">
          <Wordmark size="sm" />
        </Link>
        {onClose ? (
          <IconButton label="Close navigation" variant="ghost" className="ml-auto" onClick={onClose}>
            <svg viewBox="0 0 20 20" aria-hidden="true" className="size-5">
              <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          </IconButton>
        ) : null}
      </div>

      <nav aria-label="Main" className="flex-1 px-3">
        <ul className="space-y-0.5">
          {NAV.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                onClick={onNavigate}
                className={({ isActive }) =>
                  clsx(
                    'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? // The active route carries a fill *and* a left marker, so
                        // it is identifiable without relying on the tint alone.
                        'bg-[var(--status-info-surface)] text-[var(--status-info-text)]'
                      : 'text-muted hover:bg-[var(--surface-sunken)] hover:text-strong',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      aria-hidden="true"
                      className={clsx(
                        '-ml-1 h-5 w-0.5 rounded-full transition-colors',
                        isActive ? 'bg-brand-600 dark:bg-brand-400' : 'bg-transparent',
                      )}
                    />
                    {item.icon}
                    {item.label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {/*
        Identity, theme and sign-out are all rendered, not tucked behind a
        disclosure. Two of them are load-bearing: `docs/DECISIONS.md` D21 and the
        CLAUDE.md theming rules require every shell to render the theme selector,
        and hiding sign-out behind a menu makes the one control people look for
        under stress the one they have to hunt for.
      */}
      <div className="space-y-3 border-t border-[var(--border-subtle)] p-3">
        <div className="flex items-center gap-2.5 px-1">
          <span
            aria-hidden="true"
            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-on-brand"
          >
            {(email ?? '?').slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium text-strong" title={email}>
              {email ?? 'Signed in'}
            </span>
            <span className="block text-xs text-subtle">Alerts go here</span>
          </span>
        </div>

        <ThemeSelector compact className="w-full justify-center" />

        <Button variant="secondary" size="sm" className="w-full" onClick={onSignOut}>
          Sign out
        </Button>
      </div>
    </div>
  );
}

function UnverifiedBanner({
  email,
  onDone,
}: {
  email: string;
  onDone(tone: 'success' | 'error', message: string): void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Alert tone="warning" title="Confirm your email address" className="mb-6">
      <p>
        Monitoring and alerts stay switched off until you confirm <strong>{email}</strong>. Check
        your inbox for the link we sent.
      </p>
      <Button
        variant="secondary"
        size="sm"
        className="mt-3"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api.post('/api/auth/verify-email/resend', { email });
            onDone('success', 'Confirmation email sent. Check your inbox.');
          } catch (error) {
            onDone('error', error instanceof ApiError ? error.message : 'Could not send the email.');
          } finally {
            setBusy(false);
          }
        }}
      >
        Send it again
      </Button>
    </Alert>
  );
}
