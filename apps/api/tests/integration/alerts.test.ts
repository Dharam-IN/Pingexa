import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/lib/prisma.js';
import { createMonitor } from '../../src/domain/monitors.js';
import { handleEmailJob, reconcilePendingAlerts } from '../../src/worker/emailJob.js';
import { closeQueues, queues } from '../../src/queue/queues.js';
import { closeDatabase, resetDatabase } from '../helpers/db.js';
import { createVerifiedUser } from '../helpers/api.js';
import { stubDnsGuard } from '../helpers/fixtureServer.js';
import type { OutgoingMail } from '../../src/mail/transport.js';

/**
 * Alert delivery: persisted state, bounded retries, and the duplicate
 * protections. SMTP itself is replaced by a recording function so the exact
 * delivery sequence can be asserted; the real Mailpit path is covered by the
 * manual smoke run and by the Playwright end-to-end suite.
 */

let sent: OutgoingMail[] = [];
const recorder = async (mail: OutgoingMail) => {
  sent.push(mail);
  return { messageId: `test-${sent.length}` };
};

beforeEach(async () => {
  await resetDatabase();
  sent = [];
  await queues().email.obliterate({ force: true }).catch(() => undefined);
});

afterAll(async () => {
  await closeQueues();
  await closeDatabase();
});

async function outageFixture(email: string) {
  const user = await createVerifiedUser(email);
  const monitor = await createMonitor({
    userId: user.id,
    name: 'Acme site',
    url: 'https://example.com/',
    guard: stubDnsGuard,
  });
  const startedAt = new Date(Date.now() - 900_000);
  const incident = await prisma.incident.create({
    data: {
      monitorId: monitor.id,
      startedAt,
      detectedAt: new Date(startedAt.getTime() + 600_000),
      causeKind: 'HTTP_ERROR',
      causeReason: 'Responded with HTTP 500',
    },
  });
  const notification = await prisma.notification.create({
    data: { incidentId: incident.id, userId: user.id, kind: 'DOWN' },
  });
  return { user, monitor, incident, notification };
}

describe('alert delivery', () => {
  it('sends a down alert to the verified account email and records the state', async () => {
    const { user, notification } = await outageFixture('alert@monitored.dev');

    const outcome = await handleEmailJob(
      { kind: 'alert', notificationId: notification.id, notificationKind: 'DOWN' },
      { attempt: 1, send: recorder },
    );

    expect(outcome).toBe('sent');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(user.email);
    expect(sent[0]?.subject).toBe('[Pingexa] Acme site is DOWN');
    expect(sent[0]?.text).toContain('Responded with HTTP 500');

    const stored = await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } });
    expect(stored.status).toBe('SENT');
    expect(stored.attempts).toBe(1);
    expect(stored.sentAt).not.toBeNull();
    expect(stored.lastError).toBeNull();
  });

  it('does not resend a notification already marked SENT', async () => {
    const { notification } = await outageFixture('alertonce@monitored.dev');
    await prisma.notification.update({
      where: { id: notification.id },
      data: { status: 'SENT', sentAt: new Date(), attempts: 1 },
    });

    const outcome = await handleEmailJob(
      { kind: 'alert', notificationId: notification.id, notificationKind: 'DOWN' },
      { attempt: 2, send: recorder },
    );
    expect(outcome).toBe('skipped');
    expect(sent).toHaveLength(0);
  });

  it('sends exactly one email when several workers race on the same notification', async () => {
    const { notification } = await outageFixture('alertrace@monitored.dev');

    // Ten concurrent handlers, i.e. several workers picking up the same job.
    const outcomes = await Promise.all(
      Array.from({ length: 10 }, () =>
        handleEmailJob(
          { kind: 'alert', notificationId: notification.id, notificationKind: 'DOWN' },
          { attempt: 1, send: recorder },
        ),
      ),
    );

    expect(outcomes.filter((outcome) => outcome === 'sent')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === 'skipped')).toHaveLength(9);
    expect(sent).toHaveLength(1);

    // Only the winner consumed an attempt. If the claim were not exclusive this
    // would be 10, which is how the original (broken) implementation showed up.
    const stored = await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } });
    expect(stored.attempts).toBe(1);
    expect(stored.status).toBe('SENT');
  });

  it('records the error and keeps retrying while attempts remain', async () => {
    const { notification } = await outageFixture('alertretry@monitored.dev');
    const failing = async () => {
      throw new Error('SMTP 421 service unavailable');
    };

    await expect(
      handleEmailJob(
        { kind: 'alert', notificationId: notification.id, notificationKind: 'DOWN' },
        { attempt: 1, maxAttempts: 3, send: failing },
      ),
    ).rejects.toThrow('SMTP 421');

    const afterFirst = await prisma.notification.findUniqueOrThrow({
      where: { id: notification.id },
    });
    // Still PENDING so a retry (and the reconciliation pass) can pick it up.
    expect(afterFirst.status).toBe('PENDING');
    expect(afterFirst.attempts).toBe(1);
    expect(afterFirst.lastError).toContain('SMTP 421');

    // A later attempt succeeds and the state converges.
    const outcome = await handleEmailJob(
      { kind: 'alert', notificationId: notification.id, notificationKind: 'DOWN' },
      { attempt: 2, maxAttempts: 3, send: recorder },
    );
    expect(outcome).toBe('sent');
    const afterSecond = await prisma.notification.findUniqueOrThrow({
      where: { id: notification.id },
    });
    expect(afterSecond.status).toBe('SENT');
    expect(afterSecond.attempts).toBe(2);
    expect(afterSecond.lastError).toBeNull();
  });

  it('marks the notification FAILED after the last attempt instead of retrying forever', async () => {
    const { notification } = await outageFixture('alertexhausted@monitored.dev');
    const failing = async () => {
      throw new Error('SMTP 550 mailbox unavailable');
    };

    const outcome = await handleEmailJob(
      { kind: 'alert', notificationId: notification.id, notificationKind: 'DOWN' },
      { attempt: 3, maxAttempts: 3, send: failing },
    );
    expect(outcome).toBe('failed_permanently');

    const stored = await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } });
    expect(stored.status).toBe('FAILED');
    expect(stored.lastError).toContain('SMTP 550');
  });

  it('refuses to alert an unverified address', async () => {
    const { user, notification } = await outageFixture('alertunverified@monitored.dev');
    await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: null } });

    const outcome = await handleEmailJob(
      { kind: 'alert', notificationId: notification.id, notificationKind: 'DOWN' },
      { attempt: 1, send: recorder },
    );
    expect(outcome).toBe('failed_permanently');
    expect(sent).toHaveLength(0);
  });

  it('reports the downtime duration in the recovery alert', async () => {
    const { user, incident } = await outageFixture('alertrecovery@monitored.dev');
    await prisma.incident.update({
      where: { id: incident.id },
      data: {
        resolvedAt: new Date(incident.startedAt.getTime() + 930_000),
        closeReason: 'RECOVERED',
      },
    });
    const recovery = await prisma.notification.create({
      data: { incidentId: incident.id, userId: user.id, kind: 'RECOVERY' },
    });

    await handleEmailJob(
      { kind: 'alert', notificationId: recovery.id, notificationKind: 'RECOVERY' },
      { attempt: 1, send: recorder },
    );

    expect(sent[0]?.subject).toBe('[Pingexa] Acme site is back UP');
    expect(sent[0]?.text).toContain('15m 30s');
  });

  it('skips silently when the notification no longer exists', async () => {
    const outcome = await handleEmailJob(
      {
        kind: 'alert',
        notificationId: '11111111-1111-4111-8111-111111111111',
        notificationKind: 'DOWN',
      },
      { attempt: 1, send: recorder },
    );
    expect(outcome).toBe('skipped');
  });
});

describe('outbox reconciliation', () => {
  it('re-enqueues alerts left PENDING and skips fresh or completed ones', async () => {
    const stuck = await outageFixture('stuck@monitored.dev');
    const fresh = await outageFixture('fresh@monitored.dev');
    const done = await outageFixture('done@monitored.dev');

    // Age the stuck one past the reconciliation threshold.
    await prisma.notification.update({
      where: { id: stuck.notification.id },
      data: { createdAt: new Date(Date.now() - 10 * 60 * 1000) },
    });
    await prisma.notification.update({
      where: { id: done.notification.id },
      data: { status: 'SENT', createdAt: new Date(Date.now() - 10 * 60 * 1000) },
    });

    const requeued: string[] = [];
    const count = await reconcilePendingAlerts(async (id) => {
      requeued.push(id);
    });

    expect(count).toBe(1);
    expect(requeued).toEqual([stuck.notification.id]);
    expect(requeued).not.toContain(fresh.notification.id);
    expect(requeued).not.toContain(done.notification.id);
  });

  it('keeps going when one re-enqueue fails', async () => {
    const first = await outageFixture('reconcile1@monitored.dev');
    const second = await outageFixture('reconcile2@monitored.dev');
    await prisma.notification.updateMany({
      data: { createdAt: new Date(Date.now() - 10 * 60 * 1000) },
    });

    let calls = 0;
    const count = await reconcilePendingAlerts(async () => {
      calls += 1;
      if (calls === 1) throw new Error('redis unavailable');
    });

    expect(calls).toBe(2);
    expect(count).toBe(1);
    // Neither incident nor notification was lost.
    expect(await prisma.notification.count({ where: { status: 'PENDING' } })).toBe(2);
    void first;
    void second;
  });
});

describe('auth emails', () => {
  it('builds a verification email for the account address', async () => {
    const user = await createVerifiedUser('authmail@monitored.dev');
    const outcome = await handleEmailJob(
      { kind: 'verify-email', userId: user.id, token: 'tok-abc' },
      { attempt: 1, send: recorder },
    );
    expect(outcome).toBe('sent');
    expect(sent[0]?.to).toBe(user.email);
    expect(sent[0]?.text).toContain('tok-abc');
  });

  it('skips an email for an account that no longer exists', async () => {
    const outcome = await handleEmailJob(
      {
        kind: 'password-reset',
        userId: '22222222-2222-4222-8222-222222222222',
        token: 'tok-gone',
      },
      { attempt: 1, send: recorder },
    );
    expect(outcome).toBe('skipped');
    expect(sent).toHaveLength(0);
  });

  it('sends the account-exists notice without needing a user row', async () => {
    const outcome = await handleEmailJob(
      { kind: 'account-exists', email: 'someone@monitored.dev' },
      { attempt: 1, send: recorder },
    );
    expect(outcome).toBe('sent');
    expect(sent[0]?.to).toBe('someone@monitored.dev');
  });
});

afterAll(() => {
  vi.restoreAllMocks();
});
