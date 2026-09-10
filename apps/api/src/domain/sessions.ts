import { env } from '../config/env.js';
import { generateOpaqueToken, hashToken, userAgentTag } from '../lib/crypto.js';
import { addDays, DAY_MS, MINUTE_MS } from '../lib/time.js';
import { prisma } from '../lib/prisma.js';

export interface AuthenticatedUser {
  readonly id: string;
  readonly email: string;
  readonly emailVerifiedAt: Date | null;
  readonly createdAt: Date;
}

export interface SessionContext {
  readonly sessionId: string;
  readonly user: AuthenticatedUser;
}

/** Only refresh `lastSeenAt` occasionally; every request would be a write per request. */
const LAST_SEEN_REFRESH_MS = 5 * MINUTE_MS;

export async function createSession(
  userId: string,
  userAgent: string | undefined,
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateOpaqueToken();
  const expiresAt = addDays(new Date(), env.SESSION_TTL_DAYS);
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      userAgentTag: userAgentTag(userAgent),
    },
  });
  return { token, expiresAt };
}

/**
 * Resolves a session cookie to a user, or null. A revoked or expired row is
 * treated exactly like a missing one.
 */
export async function resolveSession(token: string): Promise<SessionContext | null> {
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      expiresAt: true,
      revokedAt: true,
      lastSeenAt: true,
      user: { select: { id: true, email: true, emailVerifiedAt: true, createdAt: true } },
    },
  });

  if (!session || session.revokedAt !== null) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;

  if (Date.now() - session.lastSeenAt.getTime() > LAST_SEEN_REFRESH_MS) {
    await prisma.session
      .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
      .catch(() => undefined);
  }

  return { sessionId: session.id, user: session.user };
}

export async function revokeSession(sessionId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Used after a password change or reset: every other session is invalidated. */
export async function revokeAllSessionsForUser(
  userId: string,
  options: { exceptSessionId?: string } = {},
): Promise<number> {
  const result = await prisma.session.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(options.exceptSessionId ? { id: { not: options.exceptSessionId } } : {}),
    },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

/**
 * Removes rows that can no longer authenticate anything. Run by the worker's
 * retention pass; sessions are not user-visible history.
 */
export async function purgeDeadSessions(now = new Date()): Promise<number> {
  const result = await prisma.session.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: now } },
        { revokedAt: { lt: new Date(now.getTime() - 7 * DAY_MS) } },
      ],
    },
  });
  return result.count;
}
