import { useCallback, useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { ApiError } from './api';

/**
 * Load something from the API, then re-read it on an interval.
 *
 * Every screen needs the same four things — data, a load error, a manual retry,
 * and a way to replace the data after a write — so they live here once instead
 * of being re-implemented per page.
 *
 * `fetcher` must be stable (wrap it in `useCallback`): it is a dependency of the
 * polling effect, so an inline arrow would tear down and restart the interval on
 * every render.
 */
export interface PolledResource<T> {
  data: T | null;
  error: string | null;
  /** True until the first load settles, either way. */
  loading: boolean;
  reload(): Promise<void>;
  /** Replaces the data locally, for when a write already returned the new state. */
  setData: Dispatch<SetStateAction<T | null>>;
}

export function usePolledResource<T>(
  fetcher: (signal?: AbortSignal) => Promise<T>,
  options: { intervalMs?: number; fallbackMessage?: string } = {},
): PolledResource<T> {
  const { intervalMs, fallbackMessage = 'Could not load this data.' } = options;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const run = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const result = await fetcher(signal);
        if (signal?.aborted) return;
        setData(result);
        setError(null);
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        if (signal?.aborted) return;
        setError(caught instanceof ApiError ? caught.message : fallbackMessage);
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [fetcher, fallbackMessage],
  );

  useEffect(() => {
    const controller = new AbortController();

    /*
     * `run` awaits a network request before it touches state, so this does not
     * set state synchronously during the effect. The lint rule cannot see past
     * the async boundary, which is why the suppression is here — one place, for
     * the whole app's fetch-on-mount behaviour, rather than once per page.
     */
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void run(controller.signal);

    const timer = intervalMs ? window.setInterval(() => void run(), intervalMs) : undefined;
    return () => {
      controller.abort();
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [run, intervalMs]);

  const reload = useCallback(() => run(), [run]);

  return { data, error, loading, reload, setData };
}
