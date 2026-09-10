import type { CookieOptions, Response } from 'express';
import { env } from '../config/env.js';
import { generateOpaqueToken } from '../lib/crypto.js';

export const SESSION_COOKIE = 'pingexa_session';
/** Readable by the SPA on purpose: it is the value echoed in `X-CSRF-Token`. */
export const CSRF_COOKIE = 'pingexa_csrf';

function baseOptions(): CookieOptions {
  return {
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAMESITE.toLowerCase() as 'lax' | 'strict' | 'none',
    path: '/',
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  };
}

export function setSessionCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(SESSION_COOKIE, token, {
    ...baseOptions(),
    httpOnly: true,
    expires: expiresAt,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { ...baseOptions(), httpOnly: true });
}

export function setCsrfCookie(res: Response, token: string): void {
  res.cookie(CSRF_COOKIE, token, {
    ...baseOptions(),
    // Must be readable by the SPA so it can echo the value back in a header.
    httpOnly: false,
  });
}

export function newCsrfToken(): string {
  return generateOpaqueToken();
}
