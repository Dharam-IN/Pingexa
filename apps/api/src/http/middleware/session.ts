import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { forbidden, unauthorized } from '../../lib/errors.js';
import { resolveSession } from '../../domain/sessions.js';
import { SESSION_COOKIE } from '../cookies.js';

/** Populates `req.auth` when a valid session cookie is present. Never rejects. */
export const attachSession: RequestHandler = (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
  if (!token) {
    next();
    return;
  }
  resolveSession(token)
    .then((context) => {
      if (context) req.auth = context;
      next();
    })
    .catch(next);
};

/** Requires any signed-in user. */
export const requireAuth: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  if (!req.auth) {
    next(unauthorized());
    return;
  }
  next();
};

/**
 * Requires a signed-in user whose email is verified.
 *
 * Guards every endpoint that creates monitoring work or would cause outbound
 * mail, which is the scope rule "require verified email before enabling
 * monitoring and alerts".
 */
export const requireVerifiedEmail: RequestHandler = (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  if (!req.auth) {
    next(unauthorized());
    return;
  }
  if (req.auth.user.emailVerifiedAt === null) {
    next(
      forbidden('Confirm your email address before setting up monitoring.'),
    );
    return;
  }
  next();
};
