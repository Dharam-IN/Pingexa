import { Queue, type JobsOptions } from 'bullmq';
import type { Redis } from 'ioredis';
import type { NotificationKind } from '@pingexa/shared';
import { env } from '../config/env.js';
import { createQueueConnection } from '../lib/redis.js';
import { logger } from '../lib/logger.js';

export const QUEUE_CHECKS = 'checks';
export const QUEUE_EMAIL = 'email';

/** Payload of a scheduled check. Intentionally minimal: the worker re-reads the
 * monitor from Postgres, so an edit, pause or delete that lands after the job was
 * queued is always honoured. */
export interface CheckJobData {
  readonly monitorId: string;
  /** ISO timestamp of the scheduled slot. Half of the idempotency key. */
  readonly scheduledFor: string;
}

export type EmailJobData =
  | { readonly kind: 'verify-email'; readonly userId: string; readonly token: string }
  | { readonly kind: 'password-reset'; readonly userId: string; readonly token: string }
  | { readonly kind: 'password-changed'; readonly userId: string }
  | { readonly kind: 'account-exists'; readonly email: string }
  | {
      readonly kind: 'alert';
      readonly notificationId: string;
      readonly notificationKind: NotificationKind;
    };

/**
 * Deterministic job id, so two scheduler ticks in one slot enqueue one job.
 * BullMQ rejects `:` in a custom id (it is the key separator), so the slot is
 * encoded as epoch milliseconds rather than as an ISO timestamp.
 */
export function checkJobId(monitorId: string, scheduledForIso: string): string {
  return `check-${monitorId}-${Date.parse(scheduledForIso)}`;
}

/** Deterministic job id for one alert email. */
export function alertJobId(notificationId: string): string {
  return `alert-${notificationId}`;
}

const CHECK_JOB_OPTIONS: JobsOptions = {
  // One retry only. A check that fails to *execute* is not the same as a site
  // being down, and retries must never look like extra failed checks — the
  // (monitorId, scheduledFor) unique constraint guarantees they cannot.
  attempts: 2,
  backoff: { type: 'exponential', delay: 2_000 },
  removeOnComplete: { count: 500, age: 3_600 },
  removeOnFail: { count: 500, age: 86_400 },
};

const EMAIL_JOB_OPTIONS: JobsOptions = {
  attempts: env.MAIL_MAX_ATTEMPTS,
  backoff: { type: 'exponential', delay: 15_000 },
  removeOnComplete: { count: 200, age: 86_400 },
  removeOnFail: { count: 500, age: 604_800 },
};

export interface Queues {
  readonly checks: Queue<CheckJobData>;
  readonly email: Queue<EmailJobData>;
  readonly connection: Redis;
  close(): Promise<void>;
}

let shared: Queues | undefined;

export function createQueues(): Queues {
  const connection = createQueueConnection();
  connection.on('error', (error: Error) => {
    logger.warn({ err: error.message }, 'queue redis connection error');
  });

  const checks = new Queue<CheckJobData>(QUEUE_CHECKS, {
    connection,
    prefix: env.QUEUE_PREFIX,
    defaultJobOptions: CHECK_JOB_OPTIONS,
  });
  const email = new Queue<EmailJobData>(QUEUE_EMAIL, {
    connection,
    prefix: env.QUEUE_PREFIX,
    defaultJobOptions: EMAIL_JOB_OPTIONS,
  });

  return {
    checks,
    email,
    connection,
    async close() {
      await Promise.allSettled([checks.close(), email.close()]);
      await connection.quit().catch(() => connection.disconnect());
    },
  };
}

/** Process-wide queue handles. Created on first use so tests can opt out. */
export function queues(): Queues {
  if (!shared) shared = createQueues();
  return shared;
}

export async function closeQueues(): Promise<void> {
  if (shared) {
    await shared.close();
    shared = undefined;
  }
}

export async function enqueueEmail(data: EmailJobData): Promise<void> {
  // Alert emails carry a stable job id so a duplicate enqueue (for instance a
  // retried result transaction) cannot produce a second delivery attempt.
  const jobId = data.kind === 'alert' ? alertJobId(data.notificationId) : undefined;
  await queues().email.add(data.kind, data, jobId ? { jobId } : undefined);
}
