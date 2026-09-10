import { Router } from 'express';
import {
  changePasswordSchema,
  loginSchema,
  requestEmailSchema,
  resetPasswordSchema,
  signupSchema,
  verifyEmailSchema,
  type MeResponse,
} from '@pingexa/shared';
import {
  changePassword,
  login,
  requestPasswordReset,
  resendVerification,
  resetPassword,
  signup,
  verifyEmail,
} from '../../domain/auth.js';
import { createSession, revokeSession } from '../../domain/sessions.js';
import { serialiseUser } from '../../domain/serializers.js';
import { AppError, unauthorized } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import {
  clearSessionCookie,
  newCsrfToken,
  setCsrfCookie,
  setSessionCookie,
} from '../cookies.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { requireAuth } from '../middleware/session.js';
import { validateBody } from '../middleware/validate.js';

export const authRouter = Router();

/**
 * Signup answers the same way for a new address and for one that already has an
 * account, so it cannot be used to discover which emails are registered. The
 * owner of an existing address gets an "you already have an account" email.
 */
authRouter.post(
  '/signup',
  authLimiter,
  validateBody(signupSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as { email: string; password: string };
    await signup(email, password);
    res.status(202).json({
      status: 'verification_sent',
      message: 'Check your inbox for a confirmation link.',
    });
  }),
);

authRouter.post(
  '/login',
  authLimiter,
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as { email: string; password: string };
    const result = await login(email, password);
    if (!result) {
      // One message for both "no such account" and "wrong password".
      throw new AppError(401, 'invalid_credentials', 'That email and password do not match.');
    }

    const session = await createSession(result.userId, req.get('user-agent'));
    setSessionCookie(res, session.token, session.expiresAt);
    setCsrfCookie(res, newCsrfToken());

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: result.userId },
      select: { id: true, email: true, emailVerifiedAt: true, createdAt: true },
    });
    const body: MeResponse = { user: serialiseUser(user) };
    res.status(200).json(body);
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    if (req.auth) await revokeSession(req.auth.sessionId);
    clearSessionCookie(res);
    res.status(204).end();
  }),
);

authRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthorized();
    const body: MeResponse = { user: serialiseUser(req.auth.user) };
    res.status(200).json(body);
  }),
);

authRouter.post(
  '/verify-email',
  authLimiter,
  validateBody(verifyEmailSchema),
  asyncHandler(async (req, res) => {
    const { token } = req.body as { token: string };
    const result = await verifyEmail(token);
    res.status(200).json({
      status: result.alreadyVerified ? 'already_verified' : 'verified',
      monitorsActivated: result.monitorsActivated,
    });
  }),
);

authRouter.post(
  '/verify-email/resend',
  authLimiter,
  validateBody(requestEmailSchema),
  asyncHandler(async (req, res) => {
    const { email } = req.body as { email: string };
    await resendVerification(email);
    // Always the same answer, verified or not, existing or not.
    res.status(202).json({ status: 'verification_sent' });
  }),
);

authRouter.post(
  '/password-reset/request',
  authLimiter,
  validateBody(requestEmailSchema),
  asyncHandler(async (req, res) => {
    const { email } = req.body as { email: string };
    await requestPasswordReset(email);
    res.status(202).json({ status: 'reset_email_sent' });
  }),
);

authRouter.post(
  '/password-reset/confirm',
  authLimiter,
  validateBody(resetPasswordSchema),
  asyncHandler(async (req, res) => {
    const { token, password } = req.body as { token: string; password: string };
    await resetPassword(token, password);
    // Every session was revoked, including any this browser held.
    clearSessionCookie(res);
    res.status(200).json({ status: 'password_reset' });
  }),
);

authRouter.post(
  '/password',
  requireAuth,
  authLimiter,
  validateBody(changePasswordSchema),
  asyncHandler(async (req, res) => {
    const auth = req.auth;
    if (!auth) throw unauthorized();
    const { currentPassword, newPassword } = req.body as {
      currentPassword: string;
      newPassword: string;
    };
    await changePassword({
      userId: auth.user.id,
      currentPassword,
      newPassword,
      keepSessionId: auth.sessionId,
    });
    res.status(200).json({ status: 'password_changed' });
  }),
);
