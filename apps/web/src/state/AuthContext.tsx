import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { MeResponse, SessionUser } from '@pingexa/shared';
import { ApiError, api, fetchMeta, type ProductMeta } from '../lib/api';

/**
 * Session state for the whole app.
 *
 * `status` distinguishes "we have not asked yet" from "asked, nobody is signed
 * in", which is what stops the app flashing the landing page on reload for a
 * signed-in user.
 */
type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

interface AuthContextValue {
  status: AuthStatus;
  user: SessionUser | null;
  meta: ProductMeta | null;
  login(email: string, password: string): Promise<SessionUser>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const FALLBACK_META: ProductMeta = {
  monitorLimit: 3,
  intervalSeconds: 300,
  failureThreshold: 3,
  checkRetentionDays: 7,
  minPasswordLength: 10,
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<SessionUser | null>(null);
  const [meta, setMeta] = useState<ProductMeta | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await api.get<MeResponse>('/api/auth/me');
      setUser(response.user);
      setStatus('authenticated');
    } catch (error) {
      if (error instanceof ApiError && error.isUnauthenticated) {
        setUser(null);
        setStatus('anonymous');
        return;
      }
      // A network problem is not the same as being signed out; do not throw the
      // user back to the landing page for it.
      setStatus((current) => (current === 'loading' ? 'anonymous' : current));
    }
  }, []);

  useEffect(() => {
    // `/api/meta` doubles as the call that primes the CSRF cookie.
    void fetchMeta()
      .then(setMeta)
      .catch(() => setMeta(FALLBACK_META));

    /*
     * `refresh` awaits `/api/auth/me` before it touches state, so no state is
     * set synchronously here. The lint rule cannot see past the async boundary.
     * The rest of the app's fetch-on-mount goes through `usePolledResource`,
     * which carries the same note; this provider predates any data so it calls
     * directly.
     */
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const response = await api.post<MeResponse>('/api/auth/login', { email, password });
    setUser(response.user);
    setStatus('authenticated');
    return response.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } finally {
      setUser(null);
      setStatus('anonymous');
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, meta: meta ?? FALLBACK_META, login, logout, refresh }),
    [status, user, meta, login, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
