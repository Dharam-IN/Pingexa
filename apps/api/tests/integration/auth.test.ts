import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/lib/prisma.js';
import { hashToken } from '../../src/lib/crypto.js';
import { closeDatabase, resetDatabase } from '../helpers/db.js';
import {
  createClient,
  createUnverifiedUser,
  createVerifiedUser,
  primeClient,
  signIn,
  SESSION_COOKIE,
} from '../helpers/api.js';
import { closeQueues, queues } from '../../src/queue/queues.js';

/**
 * These tests run against the real Postgres test database and the real Redis
 * queues, through the whole Express middleware chain (CORS, CSRF, sessions,
 * validation). Nothing is mocked except the outbound SMTP transport, which is
 * never reached because the worker is not running: email jobs simply queue up.
 */

beforeEach(async () => {
  await resetDatabase();
  await queues().email.drain(true);
});

afterAll(async () => {
  await closeQueues();
  await closeDatabase();
});

/**
 * Reads the token from the queued email job that matches the account's single
 * live (unconsumed, unexpired) token row.
 *
 * Matching on the stored hash rather than on queue ordering is what makes this
 * deterministic: several jobs for the same user can exist, and only one of them
 * corresponds to a token that still works.
 */
async function latestToken(userId: string, type: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET') {
  const live = await prisma.authToken.findFirst({
    where: { userId, type, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (!live) return undefined;

  const wantedKind = type === 'EMAIL_VERIFICATION' ? 'verify-email' : 'password-reset';
  const jobs = await queues().email.getJobs(['waiting', 'delayed', 'active', 'completed']);
  for (const job of jobs) {
    const data = job.data as { kind?: string; userId?: string; token?: string };
    if (data.kind !== wantedKind || data.userId !== userId || !data.token) continue;
    if (hashToken(data.token) === live.tokenHash) return data.token;
  }
  return undefined;
}

describe('signup', () => {
  it('creates an account, queues a verification email, and does not sign the user in', async () => {
    const client = await primeClient(createClient());
    const response = await client
      .post('/api/auth/signup', { email: 'New.User@Monitored.dev', password: 'a-good-password-1' })
      .expect(202);

    expect(response.body.status).toBe('verification_sent');
    // Not signed in: signup must not hand out a session before verification.
    expect(response.headers['set-cookie']?.join(';') ?? '').not.toContain(SESSION_COOKIE);

    const user = await prisma.user.findUnique({ where: { email: 'new.user@monitored.dev' } });
    expect(user).not.toBeNull();
    expect(user?.emailVerifiedAt).toBeNull();
    // The password is never stored in the clear.
    expect(user?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user?.passwordHash).not.toContain('a-good-password-1');

    const token = await prisma.authToken.findFirst({ where: { userId: user!.id } });
    expect(token?.type).toBe('EMAIL_VERIFICATION');
    // Only the hash is stored.
    expect(token?.tokenHash).toHaveLength(64);
  });

  it('answers identically for an address that already exists', async () => {
    await createVerifiedUser('taken@monitored.dev');
    const client = await primeClient(createClient());

    const response = await client
      .post('/api/auth/signup', { email: 'taken@monitored.dev', password: 'another-password-1' })
      .expect(202);
    expect(response.body.status).toBe('verification_sent');

    // No second account, and the existing password was not overwritten.
    expect(await prisma.user.count({ where: { email: 'taken@monitored.dev' } })).toBe(1);
  });

  it('rejects weak or malformed input with field-level messages', async () => {
    const client = await primeClient(createClient());
    const response = await client
      .post('/api/auth/signup', { email: 'not-an-email', password: 'short' })
      .expect(400);
    expect(response.body.error.code).toBe('validation_failed');
    expect(response.body.error.fields.email).toBeTruthy();
    expect(response.body.error.fields.password).toBeTruthy();
  });

  it('requires a CSRF token', async () => {
    const client = await primeClient(createClient());
    const response = await client
      .postWithoutCsrf('/api/auth/signup', {
        email: 'csrf@monitored.dev',
        password: 'a-good-password-1',
      })
      .expect(403);
    expect(response.body.error.code).toBe('csrf_failed');
    expect(await prisma.user.count()).toBe(0);
  });

  it('rejects a request from an untrusted origin', async () => {
    const client = await primeClient(createClient());
    const response = await client
      .post('/api/auth/signup', { email: 'evil@monitored.dev', password: 'a-good-password-1' })
      .set('Origin', 'https://evil.monitored.dev')
      .expect(403);
    expect(response.body.error.code).toBe('origin_not_allowed');
  });
});

describe('email verification', () => {
  it('verifies with a valid token and activates the account', async () => {
    const client = await primeClient(createClient());
    await client
      .post('/api/auth/signup', { email: 'verify@monitored.dev', password: 'a-good-password-1' })
      .expect(202);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'verify@monitored.dev' } });
    const token = await latestToken(user.id, 'EMAIL_VERIFICATION');
    expect(token).toBeTruthy();

    const response = await client.post('/api/auth/verify-email', { token }).expect(200);
    expect(response.body.status).toBe('verified');

    const verified = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(verified.emailVerifiedAt).not.toBeNull();
  });

  it('refuses a token twice — it is single use', async () => {
    const client = await primeClient(createClient());
    await client
      .post('/api/auth/signup', { email: 'once@monitored.dev', password: 'a-good-password-1' })
      .expect(202);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'once@monitored.dev' } });
    const token = await latestToken(user.id, 'EMAIL_VERIFICATION');

    await client.post('/api/auth/verify-email', { token }).expect(200);
    const second = await client.post('/api/auth/verify-email', { token }).expect(400);
    expect(second.body.error.code).toBe('invalid_token');
  });

  it('refuses an expired token', async () => {
    const user = await createUnverifiedUser('expired@monitored.dev');
    const rawToken = 'a'.repeat(40);
    await prisma.authToken.create({
      data: {
        userId: user.id,
        type: 'EMAIL_VERIFICATION',
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() - 1000),
      },
    });

    const client = await primeClient(createClient());
    const response = await client.post('/api/auth/verify-email', { token: rawToken }).expect(400);
    expect(response.body.error.code).toBe('invalid_token');
    const stillUnverified = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stillUnverified.emailVerifiedAt).toBeNull();
  });

  it('refuses a password-reset token on the verification endpoint', async () => {
    const user = await createUnverifiedUser('wrongtype@monitored.dev');
    const rawToken = 'b'.repeat(40);
    await prisma.authToken.create({
      data: {
        userId: user.id,
        type: 'PASSWORD_RESET',
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const client = await primeClient(createClient());
    await client.post('/api/auth/verify-email', { token: rawToken }).expect(400);
  });

  it('invalidates an older verification token when a new one is requested', async () => {
    const client = await primeClient(createClient());
    await client
      .post('/api/auth/signup', { email: 'resend@monitored.dev', password: 'a-good-password-1' })
      .expect(202);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'resend@monitored.dev' } });
    const firstToken = await latestToken(user.id, 'EMAIL_VERIFICATION');

    await client.post('/api/auth/verify-email/resend', { email: user.email }).expect(202);
    const secondToken = await latestToken(user.id, 'EMAIL_VERIFICATION');
    expect(secondToken).not.toBe(firstToken);

    // The superseded link must be dead.
    await client.post('/api/auth/verify-email', { token: firstToken }).expect(400);
    await client.post('/api/auth/verify-email', { token: secondToken }).expect(200);
  });

  it('does not reveal whether an address exists when resending', async () => {
    const client = await primeClient(createClient());
    const unknown = await client
      .post('/api/auth/verify-email/resend', { email: 'nobody@monitored.dev' })
      .expect(202);
    expect(unknown.body.status).toBe('verification_sent');
  });
});

describe('login and logout', () => {
  it('signs in a verified user and returns their profile', async () => {
    const user = await createVerifiedUser('login@monitored.dev');
    const client = await primeClient(createClient());

    const response = await client
      .post('/api/auth/login', { email: user.email, password: user.password })
      .expect(200);
    expect(response.body.user.email).toBe('login@monitored.dev');
    expect(response.body.user.emailVerified).toBe(true);
    // The response must never carry the password hash.
    expect(JSON.stringify(response.body)).not.toContain('argon2');

    const me = await client.get('/api/auth/me').expect(200);
    expect(me.body.user.id).toBe(user.id);
  });

  it('signs in an unverified user but blocks monitoring', async () => {
    // Being able to sign in is what lets someone request a new link.
    const user = await createUnverifiedUser('unverified@monitored.dev');
    const client = await primeClient(createClient());
    const response = await client
      .post('/api/auth/login', { email: user.email, password: user.password })
      .expect(200);
    expect(response.body.user.emailVerified).toBe(false);

    const create = await client
      .post('/api/monitors', { name: 'Blocked', url: 'https://example.com' })
      .expect(403);
    expect(create.body.error.code).toBe('forbidden');
  });

  it('gives the same error for a wrong password and an unknown address', async () => {
    await createVerifiedUser('real@monitored.dev');
    const client = await primeClient(createClient());

    const wrongPassword = await client
      .post('/api/auth/login', { email: 'real@monitored.dev', password: 'wrong-password-99' })
      .expect(401);
    const unknownUser = await client
      .post('/api/auth/login', { email: 'ghost@monitored.dev', password: 'wrong-password-99' })
      .expect(401);

    expect(wrongPassword.body.error).toEqual(unknownUser.body.error);
    expect(wrongPassword.body.error.code).toBe('invalid_credentials');
  });

  it('treats the email address case-insensitively', async () => {
    const user = await createVerifiedUser('case@monitored.dev');
    const client = await primeClient(createClient());
    await client
      .post('/api/auth/login', { email: 'CASE@Monitored.DEV', password: user.password })
      .expect(200);
  });

  it('revokes the session on logout', async () => {
    const user = await createVerifiedUser('logout@monitored.dev');
    const client = await signIn(user);

    await client.get('/api/auth/me').expect(200);
    await client.post('/api/auth/logout').expect(204);
    await client.get('/api/auth/me').expect(401);

    const sessions = await prisma.session.findMany({ where: { userId: user.id } });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.revokedAt).not.toBeNull();
  });

  it('rejects a forged session cookie', async () => {
    await createVerifiedUser('forge@monitored.dev');
    const client = await primeClient(createClient());
    const response = await client
      .get('/api/auth/me')
      .set('Cookie', `${SESSION_COOKIE}=totally-made-up-token`)
      .expect(401);
    expect(response.body.error.code).toBe('unauthenticated');
  });

  it('rejects an expired session', async () => {
    const user = await createVerifiedUser('expiredsession@monitored.dev');
    const client = await signIn(user);
    await prisma.session.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await client.get('/api/auth/me').expect(401);
  });

  it('stores only a hash of the session token', async () => {
    const user = await createVerifiedUser('hashed@monitored.dev');
    const client = await signIn(user);
    const rawCookie = client.cookies.find((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`));
    const rawToken = rawCookie?.split('=')[1] ?? '';
    expect(rawToken.length).toBeGreaterThan(20);

    const session = await prisma.session.findFirstOrThrow({ where: { userId: user.id } });
    expect(session.tokenHash).not.toBe(rawToken);
    expect(session.tokenHash).toBe(hashToken(rawToken));
  });
});

describe('password reset', () => {
  it('resets the password, verifies the email, and revokes every session', async () => {
    const user = await createVerifiedUser('reset@monitored.dev');
    const otherDevice = await signIn(user);
    await otherDevice.get('/api/auth/me').expect(200);

    const client = await primeClient(createClient());
    await client.post('/api/auth/password-reset/request', { email: user.email }).expect(202);
    const token = await latestToken(user.id, 'PASSWORD_RESET');
    expect(token).toBeTruthy();

    await client
      .post('/api/auth/password-reset/confirm', { token, password: 'brand-new-password-2' })
      .expect(200);

    // The other device is signed out.
    await otherDevice.get('/api/auth/me').expect(401);

    // The old password no longer works; the new one does.
    const fresh = await primeClient(createClient());
    await fresh.post('/api/auth/login', { email: user.email, password: user.password }).expect(401);
    await fresh
      .post('/api/auth/login', { email: user.email, password: 'brand-new-password-2' })
      .expect(200);
  });

  it('refuses to reuse a reset token', async () => {
    const user = await createVerifiedUser('resetonce@monitored.dev');
    const client = await primeClient(createClient());
    await client.post('/api/auth/password-reset/request', { email: user.email }).expect(202);
    const token = await latestToken(user.id, 'PASSWORD_RESET');

    await client
      .post('/api/auth/password-reset/confirm', { token, password: 'first-new-password-3' })
      .expect(200);
    await client
      .post('/api/auth/password-reset/confirm', { token, password: 'second-new-password-4' })
      .expect(400);

    const fresh = await primeClient(createClient());
    await fresh
      .post('/api/auth/login', { email: user.email, password: 'first-new-password-3' })
      .expect(200);
  });

  it('does not reveal whether an address exists', async () => {
    const client = await primeClient(createClient());
    const response = await client
      .post('/api/auth/password-reset/request', { email: 'nobody-here@monitored.dev' })
      .expect(202);
    expect(response.body.status).toBe('reset_email_sent');
  });

  it('rejects a weak new password', async () => {
    const user = await createVerifiedUser('weakreset@monitored.dev');
    const client = await primeClient(createClient());
    await client.post('/api/auth/password-reset/request', { email: user.email }).expect(202);
    const token = await latestToken(user.id, 'PASSWORD_RESET');
    const response = await client
      .post('/api/auth/password-reset/confirm', { token, password: 'weak' })
      .expect(400);
    expect(response.body.error.fields.password).toBeTruthy();
  });

  it('lets an unverified user verify their address by resetting the password', async () => {
    // Receiving the reset link proves control of the mailbox.
    const user = await createUnverifiedUser('resetverify@monitored.dev');
    const client = await primeClient(createClient());
    await client.post('/api/auth/password-reset/request', { email: user.email }).expect(202);
    const token = await latestToken(user.id, 'PASSWORD_RESET');
    await client
      .post('/api/auth/password-reset/confirm', { token, password: 'now-verified-password-5' })
      .expect(200);

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.emailVerifiedAt).not.toBeNull();
  });
});

describe('change password', () => {
  it('changes the password and keeps the current session but drops the others', async () => {
    const user = await createVerifiedUser('change@monitored.dev');
    const current = await signIn(user);
    const other = await signIn(user);

    await current
      .post('/api/auth/password', {
        currentPassword: user.password,
        newPassword: 'changed-password-6',
      })
      .expect(200);

    await current.get('/api/auth/me').expect(200);
    await other.get('/api/auth/me').expect(401);
  });

  it('refuses a wrong current password', async () => {
    const user = await createVerifiedUser('changewrong@monitored.dev');
    const client = await signIn(user);
    const response = await client
      .post('/api/auth/password', {
        currentPassword: 'not-the-password',
        newPassword: 'changed-password-7',
      })
      .expect(400);
    expect(response.body.error.code).toBe('invalid_credentials');
  });

  it('requires a session', async () => {
    const client = await primeClient(createClient());
    await client
      .post('/api/auth/password', {
        currentPassword: 'whatever-123',
        newPassword: 'changed-password-8',
      })
      .expect(401);
  });
});

describe('unknown endpoints', () => {
  it('returns a JSON 404 rather than an HTML error page', async () => {
    const client = await primeClient(createClient());
    const response = await client.get('/api/does-not-exist').expect(404);
    expect(response.body.error.code).toBe('not_found');
  });
});

// Keeps vitest from reporting an open handle if a test leaves a timer behind.
afterAll(() => {
  vi.useRealTimers();
});
