import { hashPassword, verifyPassword } from '../lib/crypto.js';
import { badRequest, conflict } from '../lib/errors.js';
import { isUniqueViolation, prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { enqueueEmail } from '../queue/queues.js';
import { consumeAuthToken, issueAuthToken } from './authTokens.js';
import { activateMonitorsForUser } from './monitors.js';
import { revokeAllSessionsForUser } from './sessions.js';

/**
 * Result of a signup attempt.
 *
 * `signup` answers identically whether the address was new or already had an
 * account, so the endpoint cannot be used to enumerate registered emails. The
 * real owner of an existing address is told what happened by email instead.
 */
export interface SignupResult {
  readonly created: boolean;
}

export async function signup(email: string, password: string): Promise<SignupResult> {
  const passwordHash = await hashPassword(password);

  try {
    const user = await prisma.user.create({
      data: { email, passwordHash },
      select: { id: true, email: true },
    });

    const { token } = await issueAuthToken(user.id, 'EMAIL_VERIFICATION');
    await enqueueEmail({ kind: 'verify-email', userId: user.id, token });
    logger.info({ userId: user.id }, 'account created');
    return { created: true };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // Address already registered. Same response shape, different email.
    await enqueueEmail({ kind: 'account-exists', email });
    logger.info({ event: 'signup_existing_email' }, 'signup attempted for existing address');
    return { created: false };
  }
}

export interface LoginResult {
  readonly userId: string;
  readonly emailVerified: boolean;
}

/**
 * Verifies credentials. A missing account still costs a password verification
 * against a dummy hash, so response time does not reveal whether the address
 * exists.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$FA3U7lNo4k5ROfCY1ir2Zg$GxwsVhGjrL5xCdbUbnpJff6cX/7VUWpygaaiex3qJsY';

export async function login(email: string, password: string): Promise<LoginResult | null> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, passwordHash: true, emailVerifiedAt: true },
  });

  if (!user) {
    await verifyPassword(DUMMY_HASH, password);
    return null;
  }

  const valid = await verifyPassword(user.passwordHash, password);
  if (!valid) return null;

  return { userId: user.id, emailVerified: user.emailVerifiedAt !== null };
}

export interface VerifyEmailResult {
  readonly userId: string;
  readonly alreadyVerified: boolean;
  readonly monitorsActivated: number;
}

export async function verifyEmail(token: string): Promise<VerifyEmailResult> {
  const consumed = await consumeAuthToken(token, 'EMAIL_VERIFICATION');
  if (!consumed) {
    throw badRequest(
      'invalid_token',
      'This confirmation link is invalid, already used, or expired. Request a new one.',
    );
  }

  const existing = await prisma.user.findUnique({
    where: { id: consumed.userId },
    select: { emailVerifiedAt: true },
  });
  if (existing?.emailVerifiedAt) {
    return { userId: consumed.userId, alreadyVerified: true, monitorsActivated: 0 };
  }

  await prisma.user.update({
    where: { id: consumed.userId },
    data: { emailVerifiedAt: new Date() },
  });
  const monitorsActivated = await activateMonitorsForUser(consumed.userId);
  logger.info({ userId: consumed.userId, monitorsActivated }, 'email verified');

  return { userId: consumed.userId, alreadyVerified: false, monitorsActivated };
}

/**
 * Sends a fresh verification email. Returns silently for unknown or
 * already-verified addresses so it cannot be used as an existence oracle.
 */
export async function resendVerification(email: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, emailVerifiedAt: true },
  });
  if (!user || user.emailVerifiedAt) return;

  const { token } = await issueAuthToken(user.id, 'EMAIL_VERIFICATION');
  await enqueueEmail({ kind: 'verify-email', userId: user.id, token });
}

/** Always resolves, whether or not the address exists. */
export async function requestPasswordReset(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) {
    logger.info({ event: 'password_reset_unknown_email' }, 'password reset for unknown address');
    return;
  }

  const { token } = await issueAuthToken(user.id, 'PASSWORD_RESET');
  await enqueueEmail({ kind: 'password-reset', userId: user.id, token });
}

/**
 * Completes a password reset. Every session is revoked: if the reset was needed
 * because someone else had access, leaving their session alive defeats the point.
 *
 * A successful reset also verifies the email address, because receiving the
 * reset link proves control of the mailbox.
 */
export async function resetPassword(token: string, newPassword: string): Promise<{ userId: string }> {
  const consumed = await consumeAuthToken(token, 'PASSWORD_RESET');
  if (!consumed) {
    throw badRequest(
      'invalid_token',
      'This reset link is invalid, already used, or expired. Request a new one.',
    );
  }

  const passwordHash = await hashPassword(newPassword);
  const user = await prisma.user.update({
    where: { id: consumed.userId },
    data: { passwordHash, emailVerifiedAt: { set: new Date() } },
    select: { id: true, emailVerifiedAt: true },
  });

  await revokeAllSessionsForUser(user.id);
  await activateMonitorsForUser(user.id);
  await enqueueEmail({ kind: 'password-changed', userId: user.id });
  logger.info({ userId: user.id }, 'password reset completed');

  return { userId: user.id };
}

/** Changes the password of a signed-in user, keeping their current session. */
export async function changePassword(args: {
  userId: string;
  currentPassword: string;
  newPassword: string;
  keepSessionId: string;
}): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: args.userId },
    select: { passwordHash: true },
  });
  if (!user) throw badRequest('invalid_credentials', 'Your current password is not correct.');

  const valid = await verifyPassword(user.passwordHash, args.currentPassword);
  if (!valid) {
    throw badRequest('invalid_credentials', 'Your current password is not correct.', {
      currentPassword: 'That is not your current password',
    });
  }
  if (args.currentPassword === args.newPassword) {
    throw conflict('password_unchanged', 'Choose a password different from the current one.');
  }

  const passwordHash = await hashPassword(args.newPassword);
  await prisma.user.update({ where: { id: args.userId }, data: { passwordHash } });
  await revokeAllSessionsForUser(args.userId, { exceptSessionId: args.keepSessionId });
  await enqueueEmail({ kind: 'password-changed', userId: args.userId });
  logger.info({ userId: args.userId }, 'password changed');
}
