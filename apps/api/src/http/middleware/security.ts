import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { safeEqual } from '../../lib/crypto.js';
import { CSRF_COOKIE, newCsrfToken, setCsrfCookie } from '../cookies.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const trustedOrigins = new Set(env.TRUSTED_ORIGINS);

/**
 * CORS, restricted to the configured origins.
 *
 * There is no wildcard path: the API answers cookie-bearing cross-origin
 * requests, and `Access-Control-Allow-Origin: *` is incompatible with
 * credentials anyway. An unlisted origin gets no CORS headers, so the browser
 * blocks the response.
 */
export const cors: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && trustedOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-CSRF-Token');
    res.setHeader('Access-Control-Max-Age', '600');
  }
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
};

/**
 * CSRF protection: double-submit cookie plus an origin allowlist.
 *
 * The session cookie is `SameSite=Lax`, which already stops cross-site form
 * posts in current browsers. These two checks are the defence that still works
 * when the SPA and the API are on different origins (where `Lax` does not apply
 * to the API's own same-site rules) and on clients with weaker cookie policies.
 *
 * A GET response always (re)issues the cookie, so a fresh browser session picks
 * up a token before it needs to send anything.
 */
export const csrfProtection: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  const cookieToken = req.cookies?.[CSRF_COOKIE] as string | undefined;

  if (SAFE_METHODS.has(req.method)) {
    if (!cookieToken) setCsrfCookie(res, newCsrfToken());
    next();
    return;
  }

  const origin = req.headers.origin;
  if (typeof origin === 'string' && !trustedOrigins.has(origin)) {
    next(
      new AppError(403, 'origin_not_allowed', 'This request came from an origin we do not trust.', {
        logContext: { origin },
      }),
    );
    return;
  }

  const headerToken = req.get('x-csrf-token');
  if (!cookieToken || !headerToken || !safeEqual(cookieToken, headerToken)) {
    next(
      new AppError(
        403,
        'csrf_failed',
        'Your session token was missing or stale. Reload the page and try again.',
      ),
    );
    return;
  }

  next();
};

/** Ensures the SPA always has a usable CSRF token after any response. */
export const issueCsrfCookie: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  if (!req.cookies?.[CSRF_COOKIE]) setCsrfCookie(res, newCsrfToken());
  next();
};
