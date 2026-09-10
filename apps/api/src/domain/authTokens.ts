import type { AuthTokenType } from '../generated/prisma/enums.js';
import { generateOpaqueToken, hashToken } from '../lib/crypto.js';
import { addMs, HOUR_MS } from '../lib/time.js';
import { prisma } from '../lib/prisma.js';
import type { TxClient } from '../lib/prisma.js';

export const TOKEN_TTL_MS: Record<AuthTokenType, number> = {
  EMAIL_VERIFICATION: 24 * HOUR_MS,
  PASSWORD_RESET: 1 * HOUR_MS,
};

/**
 * Issues a single-use token.
 *
 * Only the HMAC of the token is stored, so a database dump does not yield
 * working links. Any outstanding token of the same type is invalidated first:
 * requesting a new reset link must make the previous one dead, otherwise an
 * attacker who saw an old email keeps a valid path in.
 */
export async function issueAuthToken(
  userId: string,
  type: AuthTokenType,
  client: TxClient | typeof prisma = prisma,
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateOpaqueToken();
  const expiresAt = addMs(new Date(), TOKEN_TTL_MS[type]);

  await client.authToken.updateMany({
    where: { userId, type, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  await client.authToken.create({
    data: { userId, type, tokenHash: hashToken(token), expiresAt },
  });

  return { token, expiresAt };
}

export interface ConsumedToken {
  readonly userId: string;
}

/**
 * Consumes a token atomically. `updateMany` with `consumedAt: null` in the
 * WHERE clause means two simultaneous uses of the same link produce exactly one
 * winner: the second sees `count === 0`.
 */
export async function consumeAuthToken(
  rawToken: string,
  type: AuthTokenType,
): Promise<ConsumedToken | null> {
  const tokenHash = hashToken(rawToken);
  const record = await prisma.authToken.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, type: true, expiresAt: true, consumedAt: true },
  });

  if (!record) return null;
  if (record.type !== type) return null;
  if (record.consumedAt !== null) return null;
  if (record.expiresAt.getTime() <= Date.now()) return null;

  const claimed = await prisma.authToken.updateMany({
    where: { id: record.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (claimed.count !== 1) return null;

  return { userId: record.userId };
}

export async function purgeExpiredAuthTokens(now = new Date()): Promise<number> {
  const result = await prisma.authToken.deleteMany({
    where: { OR: [{ expiresAt: { lt: now } }, { consumedAt: { not: null } }] },
  });
  return result.count;
}
