import { Navigate, Route, Routes, useLocation } from 'react-router';
import type { ReactNode } from 'react';
import { AppShell } from './components/AppShell';
import { LoadingBlock } from './components/ui';
import { OverviewPage } from './pages/OverviewPage';
import { MonitorsPage } from './pages/MonitorsPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { MonitorDetailPage } from './pages/MonitorDetailPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PublicStatusPage } from './pages/PublicStatusPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { SettingsPage } from './pages/SettingsPage';
import { SignupPage } from './pages/SignupPage';
import { VerifyEmailPage } from './pages/VerifyEmailPage';
import { useAuth } from './state/AuthContext';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<PublicOnly><LandingPage /></PublicOnly>} />
      <Route path="/signup" element={<PublicOnly><SignupPage /></PublicOnly>} />
      <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />
      {/* Reachable while signed in or out: the link arrives by email. */}
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/status/:slug" element={<PublicStatusPage />} />

      <Route
        path="/app"
        element={
          <RequireAuth>
            <AppShell>
              <OverviewPage />
            </AppShell>
          </RequireAuth>
        }
      />
      <Route
        path="/app/monitors"
        element={
          <RequireAuth>
            <AppShell>
              <MonitorsPage />
            </AppShell>
          </RequireAuth>
        }
      />
      <Route
        path="/app/monitors/:id"
        element={
          <RequireAuth>
            <AppShell>
              <MonitorDetailPage />
            </AppShell>
          </RequireAuth>
        }
      />
      <Route
        path="/app/settings"
        element={
          <RequireAuth>
            <AppShell>
              <SettingsPage />
            </AppShell>
          </RequireAuth>
        }
      />

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

/**
 * Gate for signed-in pages. While the session is still being resolved it shows
 * a loading state rather than redirecting, otherwise a page reload would bounce
 * a signed-in user to the login screen before `/api/auth/me` answers.
 */
function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <LoadingBlock label="Checking your session…" />;
  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

/** Sends an already signed-in user straight to their dashboard. */
function PublicOnly({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  if (status === 'authenticated') return <Navigate to="/app" replace />;
  return <>{children}</>;
}
