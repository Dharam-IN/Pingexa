import { NavLink, Link } from 'react-router';
import type { ReactNode } from 'react';
import clsx from 'clsx';
import { useAuth } from '../state/AuthContext';
import { useToast } from '../state/ToastContext';
import { ThemeSelector } from './ThemeSelector';
import { Alert, Button, Wordmark } from './ui';
import { api, ApiError } from '../lib/api';

/**
 * The signed-in frame: header, navigation, the unverified-email banner, and the
 * toast region. The banner lives here rather than on individual pages because
 * an unverified account has no working monitoring anywhere in the app.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const { toasts, dismiss, show } = useToast();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 border-b border-[var(--border-subtle)] bg-[var(--surface-raised)]/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          <Link to="/app" className="rounded-md" aria-label="Pingexa dashboard">
            <Wordmark size="sm" />
          </Link>

          <nav aria-label="Main" className="ml-2 flex items-center gap-1">
            <ShellLink to="/app">Monitors</ShellLink>
            <ShellLink to="/app/settings">Settings</ShellLink>
          </nav>

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <span className="hidden text-xs text-muted md:inline" title={user?.email}>
              {user?.email}
            </span>
            {/* Compact (icon-only) so the header still fits on a phone. */}
            <ThemeSelector compact />
            <Button variant="secondary" size="sm" onClick={() => void logout()}>
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        {user && !user.emailVerified ? <UnverifiedBanner email={user.email} onDone={show} /> : null}
        {children}
      </main>

      <footer className="border-t border-[var(--border-subtle)] px-4 py-5 sm:px-6">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 text-xs text-muted">
          <span>Pingexa — checks every 5 minutes, alerts by email.</span>
          <span>Up to 3 monitors per account.</span>
        </div>
      </footer>

      {/* Toasts: one live region for the whole app. */}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex flex-col items-center gap-2 px-4 pb-4"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={clsx(
              'pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg',
              toast.tone === 'success' &&
                'border-up-500/40 bg-up-50 text-up-700 dark:border-up-600 dark:bg-up-700/90 dark:text-up-50',
              toast.tone === 'error' &&
                'border-down-500/40 bg-down-50 text-down-700 dark:border-down-600 dark:bg-down-700/90 dark:text-down-50',
              toast.tone === 'info' &&
                'surface text-strong',
            )}
          >
            <span className="flex-1">{toast.message}</span>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              className="text-xs font-medium underline underline-offset-2"
            >
              Dismiss
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ShellLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <NavLink
      to={to}
      end={to === '/app'}
      className={({ isActive }) =>
        clsx(
          'rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors',
          isActive ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-100' : 'text-muted hover:text-strong',
        )
      }
    >
      {children}
    </NavLink>
  );
}

function UnverifiedBanner({
  email,
  onDone,
}: {
  email: string;
  onDone(tone: 'success' | 'error', message: string): void;
}) {
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
        onClick={async () => {
          try {
            await api.post('/api/auth/verify-email/resend', { email });
            onDone('success', 'Confirmation email sent. Check your inbox.');
          } catch (error) {
            onDone(
              'error',
              error instanceof ApiError ? error.message : 'Could not send the email.',
            );
          }
        }}
      >
        Send it again
      </Button>
    </Alert>
  );
}
