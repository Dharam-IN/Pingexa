import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import type { ReactNode } from 'react';

/**
 * Theme preference, shared by the whole app.
 *
 * Three states the user can choose from, two the CSS ever sees:
 *   preference: 'light' | 'dark' | 'system'   — what the user picked
 *   resolved:   'light' | 'dark'              — what is actually shown
 *
 * `system` is resolved here rather than in CSS. The bootstrap script in
 * index.html has already written both attributes onto `<html>` before this
 * module loads, so mounting must not change what is on screen — this provider
 * reads the existing attributes as its initial state instead of recomputing
 * from scratch, which is what keeps the first render flash-free.
 */
export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

/** Shared with the bootstrap script in index.html. Changing one means changing both. */
export const THEME_STORAGE_KEY = 'pingexa.theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';

interface ThemeContextValue {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference(next: ThemePreference): void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function systemTheme(): ResolvedTheme {
  return typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(DARK_QUERY).matches
    ? 'dark'
    : 'light';
}

/** Pure: what a preference plus the current OS setting means on screen. */
export function resolveTheme(
  preference: ThemePreference,
  system: ResolvedTheme,
): ResolvedTheme {
  return preference === 'system' ? system : preference;
}

function readStoredPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    // Storage can be unavailable (private mode, blocked cookies). Not fatal:
    // the theme still works for this page view, it just will not be remembered.
  }
  return 'system';
}

function readBootstrappedPreference(): ThemePreference {
  if (typeof document === 'undefined') return 'system';
  const attribute = document.documentElement.getAttribute('data-theme-preference');
  if (attribute === 'light' || attribute === 'dark' || attribute === 'system') return attribute;
  return readStoredPreference();
}

/**
 * `useSyncExternalStore` plumbing for `prefers-color-scheme`.
 *
 * This is the correct API for reading a browser API that changes outside React,
 * and it is what removes the last race: the snapshot is read *during render*, so
 * an OS change that happens before the listener is attached — a remount, or
 * React's development double-invoke of effects — is still seen. An effect-based
 * subscription has a window where no listener exists and the change is simply
 * lost.
 */
function subscribeToSystemTheme(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => undefined;
  }
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/** Server/prerender fallback. Pingexa is client-rendered, so it is never used. */
function systemThemeFallback(): ResolvedTheme {
  return 'light';
}

function applyToDocument(preference: ThemePreference, resolved: ResolvedTheme): void {
  const root = document.documentElement;
  root.setAttribute('data-theme', resolved);
  root.setAttribute('data-theme-preference', preference);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readBootstrappedPreference);
  /*
   * The OS setting is subscribed to, not stored; what is *shown* is derived
   * from it and the preference. Nothing here caches a resolved theme, so there
   * is no value that can go stale.
   */
  const system = useSyncExternalStore(subscribeToSystemTheme, systemTheme, systemThemeFallback);
  const resolved = resolveTheme(preference, system);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    // Applied eagerly so the change is on screen in the same frame; the effect
    // below is the safety net, not the mechanism.
    applyToDocument(next, resolveTheme(next, systemTheme()));
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // See readStoredPreference: remembering is best-effort, applying is not.
    }
  }, []);

  /*
   * Keep the document in step with state. This is a DOM side effect and not a
   * state update, which is exactly what an effect is for; it also self-heals the
   * case where no bootstrap script ran and the attributes were never written.
   */
  useEffect(() => {
    applyToDocument(preference, resolved);
  }, [preference, resolved]);

  const value = useMemo(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside ThemeProvider');
  return context;
}
