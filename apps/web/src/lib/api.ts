import type { ApiErrorBody } from '@pingexa/shared';

/**
 * The single place the browser talks to the API.
 *
 * Two things every call needs and no caller should have to remember:
 *  * `credentials: 'include'`, because the session lives in an httpOnly cookie;
 *  * the `X-CSRF-Token` header on writes, echoing the readable `pingexa_csrf`
 *    cookie the API sets. That is the double-submit half of the CSRF defence.
 */

const API_BASE = import.meta.env['VITE_API_BASE_URL'] ?? '';
const CSRF_COOKIE = 'pingexa_csrf';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;

  constructor(status: number, body: ApiErrorBody | undefined, fallback: string) {
    super(body?.error.message ?? fallback);
    this.name = 'ApiError';
    this.status = status;
    this.code = body?.error.code ?? 'unknown_error';
    this.fields = body?.error.fields ?? {};
  }

  /** True for the one error the UI handles by sending the user to sign in. */
  get isUnauthenticated(): boolean {
    return this.status === 401;
  }
}

function readCookie(name: string): string | undefined {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };

  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') {
    const token = readCookie(CSRF_COOKIE);
    if (token) headers['X-CSRF-Token'] = token;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      credentials: 'include',
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    // A network-level failure is not an API error; say so plainly.
    throw new ApiError(0, undefined, 'Could not reach Pingexa. Check your connection.');
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const parsed: unknown = text ? safeJson(text) : undefined;

  if (!response.ok) {
    throw new ApiError(
      response.status,
      isApiErrorBody(parsed) ? parsed : undefined,
      'Something went wrong. Please try again.',
    );
  }
  return parsed as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as ApiErrorBody).error?.message === 'string'
  );
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) =>
    request<T>(path, signal ? { signal } : {}),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

/**
 * Priming call.
 *
 * The CSRF cookie is issued by any GET, so the app makes one before it needs to
 * write anything. `/api/meta` also returns the product's fixed rules, so the UI
 * shows the real monitor limit and interval rather than duplicating them.
 */
export interface ProductMeta {
  monitorLimit: number;
  intervalSeconds: number;
  failureThreshold: number;
  checkRetentionDays: number;
  minPasswordLength: number;
}

export const fetchMeta = () => api.get<ProductMeta>('/api/meta');
