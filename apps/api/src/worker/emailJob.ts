import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { secondsBetween } from '../lib/time.js';
import {
  accountAlreadyExistsMail,
  monitorDownMail,
  monitorRecoveredMail,
  passwordChangedMail,
  passwordResetMail,
  verifyEmailMail,
} from '../mail/templates.js';
import { sendMail, type OutgoingMail } from '../mail/transport.js';
import type { EmailJobData } from '../queue/queues.js';

export type EmailJobOutcome = 'sent' | 'skipped' | 'failed_permanently';

export interface HandleEmailJobOptions {
  /** 1-based attempt number for this job. */
  readonly attempt: number;
  readonly maxAttempts?: number;
  /** Injected in tests to assert on the message without a live SMTP server. */
  readonly send?: (mail: OutgoingMail) => Promise<{ messageId: string }>;
}

/**
 * Delivers one queued email.
 *
 * Alert emails carry persisted delivery state (`Notification.status`,
 * `attempts`, `lastError`, `sentAt`). Everything about that state is designed so
 * ordinary duplicates are impossible:
 *
 *  * At most one DOWN and one RECOVERY notification can exist per incident
 *    (unique `(incidentId, kind)`).
 *  * The row is claimed with a conditional update (`status: 'PENDING'` in the
 *    WHERE clause), so two workers racing on the same job produce one sender.
 *  * A notification already marked SENT is skipped without sending.
 *
 * The remaining, honestly-stated gap: the row is marked SENT *after* the SMTP
 * transaction returns. If the process dies in that window the retry re-sends the
 * same alert. Closing it requires a provider-side idempotency key or a two-phase
 * outbox keyed on the provider's message id, neither of which V1 implements.
 */
export async function handleEmailJob(
  data: EmailJobData,
  options: HandleEmailJobOptions,
): Promise<EmailJobOutcome> {
  const send = options.send ?? sendMail;
  const maxAttempts = options.maxAttempts ?? env.MAIL_MAX_ATTEMPTS;

  if (data.kind === 'alert') {
    return deliverAlert(data.notificationId, { ...options, send, maxAttempts });
  }

  const mail = await buildSimpleMail(data);
  if (!mail) return 'skipped';
  await send(mail);
  logger.info({ kind: data.kind }, 'email sent');
  return 'sent';
}

async function buildSimpleMail(
  data: Exclude<EmailJobData, { kind: 'alert' }>,
): Promise<OutgoingMail | null> {
  if (data.kind === 'account-exists') {
    return accountAlreadyExistsMail(data.email);
  }

  const user = await prisma.user.findUnique({
    where: { id: data.userId },
    select: { email: true },
  });
  // The account was deleted between enqueue and delivery; nothing to send.
  if (!user) return null;

  switch (data.kind) {
    case 'verify-email':
      return verifyEmailMail(user.email, data.token);
    case 'password-reset':
      return passwordResetMail(user.email, data.token);
    case 'password-changed':
      return passwordChangedMail(user.email);
  }
}

async function deliverAlert(
  notificationId: string,
  options: Required<Pick<HandleEmailJobOptions, 'send' | 'attempt'>> & { maxAttempts: number },
): Promise<EmailJobOutcome> {
  const notification = await prisma.notification.findUnique({
    where: { id: notificationId },
    select: {
      id: true,
      kind: true,
      status: true,
      attempts: true,
      incident: {
        select: {
          id: true,
          startedAt: true,
          detectedAt: true,
          resolvedAt: true,
          causeReason: true,
          monitor: { select: { id: true, name: true, url: true } },
        },
      },
      user: { select: { email: true, emailVerifiedAt: true } },
    },
  });

  if (!notification) return 'skipped';
  if (notification.status === 'SENT') return 'skipped';
  // Alerts go to the verified account email, only.
  if (notification.user.emailVerifiedAt === null) {
    await prisma.notification.update({
      where: { id: notification.id },
      data: { status: 'FAILED', lastError: 'Account email is not verified' },
    });
    return 'failed_permanently';
  }

  const { incident } = notification;
  const monitor = incident.monitor;
  const context = {
    monitorId: monitor.id,
    monitorName: monitor.name,
    monitorUrl: monitor.url,
    at: notification.kind === 'DOWN' ? incident.detectedAt : (incident.resolvedAt ?? new Date()),
    ...(incident.causeReason ? { failureReason: incident.causeReason } : {}),
    ...(notification.kind === 'RECOVERY'
      ? {
          downtimeSeconds: secondsBetween(
            incident.startedAt,
            incident.resolvedAt ?? new Date(),
          ),
        }
      : {}),
  };

  const mail =
    notification.kind === 'DOWN'
      ? monitorDownMail(notification.user.email, context)
      : monitorRecoveredMail(notification.user.email, context);

  // Claim the row so two workers racing on the same job produce one sender.
  const claimed = await prisma.notification.updateMany({
    where: { id: notification.id, status: 'PENDING' },
    data: { attempts: { increment: 1 } },
  });
  if (claimed.count === 0) return 'skipped';

  try {
    await options.send(mail);
    await prisma.notification.update({
      where: { id: notification.id },
      data: { status: 'SENT', sentAt: new Date(), lastError: null },
    });
    logger.info(
      { notificationId: notification.id, kind: notification.kind, incidentId: incident.id },
      'alert email sent',
    );
    return 'sent';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const exhausted = options.attempt >= options.maxAttempts;
    await prisma.notification.update({
      where: { id: notification.id },
      data: {
        // Keep it PENDING while retries remain so reconciliation can pick it up.
        status: exhausted ? 'FAILED' : 'PENDING',
        lastError: message.slice(0, 500),
      },
    });
    logger.error(
      {
        notificationId: notification.id,
        attempt: options.attempt,
        maxAttempts: options.maxAttempts,
        exhausted,
        err: message,
      },
      'alert email delivery failed',
    );
    if (exhausted) return 'failed_permanently';
    // Rethrow so BullMQ schedules the next attempt with backoff.
    throw error;
  }
}

/**
 * Re-enqueues alerts that are still PENDING and older than `minAgeMs`.
 *
 * This is the outbox half of "email failure must not break monitoring or lose
 * incident records": if the alert could not be enqueued (Redis down at the
 * moment the incident opened), or the queue lost the job, the row is still here
 * and gets another chance. The deterministic job id means an alert whose job is
 * still in the queue is not enqueued twice.
 */
export async function reconcilePendingAlerts(
  enqueue: (notificationId: string, kind: 'DOWN' | 'RECOVERY') => Promise<void>,
  options: { minAgeMs?: number; limit?: number; now?: Date } = {},
): Promise<number> {
  const now = options.now ?? new Date();
  const minAgeMs = options.minAgeMs ?? 60_000;

  const stuck = await prisma.notification.findMany({
    where: { status: 'PENDING', createdAt: { lt: new Date(now.getTime() - minAgeMs) } },
    select: { id: true, kind: true },
    orderBy: { createdAt: 'asc' },
    take: options.limit ?? 100,
  });

  let requeued = 0;
  for (const notification of stuck) {
    try {
      await enqueue(notification.id, notification.kind);
      requeued += 1;
    } catch (error) {
      logger.error(
        {
          notificationId: notification.id,
          err: error instanceof Error ? error.message : String(error),
        },
        'failed to re-enqueue pending alert',
      );
    }
  }
  if (requeued > 0) logger.info({ requeued }, 'requeued pending alerts');
  return requeued;
}
