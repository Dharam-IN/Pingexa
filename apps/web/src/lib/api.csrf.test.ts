import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';

/**
 * Regression cover for the defect found by a real emailed link: a browser whose
 * first-ever request to Pingexa is a write (opening a confirmation or reset
 * link on a device that has never loaded the app) had no `pingexa_csrf` cookie,
 * sent no `X-CSRF-Token` header, and was rejected with `csrf_failed`.
 */
function clearCookies(): void {
  for (const pair of document.cookie.split(';')) {
    const name = pair.split('=')[0]?.trim();
    if (name) document.cookie = `${name}=; Max-Age=0; path=/`;
  }
}

const ok = (body: unknown = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

afterEach(() => {
  clearCookies();
  vi.unstubAllGlobals();
});

describe('api client CSRF bootstrap', () => {
  it('fetches a token with a safe GET when the cookie is missing, then sends the header', async () => {
    clearCookies();
    const calls: Array<{ url: string; method: string; csrf: string | null }> = [];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const headers = new Headers(init?.headers);
      calls.push({ url, method, csrf: headers.get('X-CSRF-Token') });

      if (method === 'GET') {
        // What the API does on any safe-method response.
        document.cookie = 'pingexa_csrf=issued-by-server; path=/';
        return ok({ ok: true });
      }
      return ok({ status: 'verified' });
    });
    vi.stubGlobal('fetch', fetchMock);

    await api.post('/api/auth/verify-email', { token: 'abc' });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ url: '/api/meta', method: 'GET' });
    expect(calls[1]?.method).toBe('POST');
    expect(calls[1]?.csrf).toBe('issued-by-server');
  });

  it('does not make the extra GET when a cookie is already present', async () => {
    clearCookies();
    document.cookie = 'pingexa_csrf=already-here; path=/';
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      ok({ status: 'verified' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await api.post('/api/auth/verify-email', { token: 'abc' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get('X-CSRF-Token')).toBe('already-here');
  });

  it('still issues the write when the bootstrap GET fails, so the real error surfaces', async () => {
    clearCookies();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'GET') throw new TypeError('offline');
      return ok({ status: 'verified' });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.post('/api/auth/verify-email', { token: 'abc' })).resolves.toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
