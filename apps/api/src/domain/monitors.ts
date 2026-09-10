import { MAX_MONITORS_PER_USER } from '@pingexa/shared';
import type { Monitor } from '../generated/prisma/client.js';
import { env } from '../config/env.js';
import { conflict, notFound } from '../lib/errors.js';
import { isUniqueViolation, prisma } from '../lib/prisma.js';
import { strictUrlGuard, type UrlGuard } from '../monitoring/urlGuard.js';
import { badRequest } from '../lib/errors.js';

export interface CreateMonitorArgs {
  readonly userId: string;
  readonly name: string;
  readonly url: string;
  readonly isPublic?: boolean;
  /** Injected only by tests that use a loopback fixture server. */
  readonly guard?: UrlGuard;
}

/**
 * Creates a monitor in the lowest free slot for the user.
 *
 * The 3-monitor cap is a database constraint (`unique (userId, slot)` plus
 * `CHECK slot BETWEEN 0 AND 2`), not a counted read. Concurrent requests race on
 * the same slot, one wins the unique index, and the loser retries into the next
 * free slot until the slots run out. That is why two simultaneous "create" calls
 * on a user with two monitors produce one success and one 409, never two.
 */
export async function createMonitor(args: CreateMonitorArgs): Promise<Monitor> {
  const guard = args.guard ?? strictUrlGuard;
  const shape = guard.checkShape(args.url);
  if (!shape.ok) {
    throw badRequest('invalid_monitor_url', shape.message, { url: shape.message });
  }

  // Resolve DNS and apply the address policy before we store anything, so a
  // rejected target never becomes a monitor row.
  const approval = await guard.check(args.url);
  if (!approval.ok) {
    throw badRequest('invalid_monitor_url', approval.message, { url: approval.message });
  }

  const user = await prisma.user.findUnique({
    where: { id: args.userId },
    select: { emailVerifiedAt: true },
  });
  if (!user) throw notFound('Account not found.');

  const normalisedUrl = approval.url;

  for (let slot = 0; slot < MAX_MONITORS_PER_USER; slot += 1) {
    try {
      return await prisma.monitor.create({
        data: {
          userId: args.userId,
          slot,
          name: args.name,
          url: normalisedUrl,
          isPublic: args.isPublic ?? false,
          intervalSeconds: env.MONITOR_INTERVAL_SECONDS,
          state: 'PENDING',
          // Monitoring only starts once the account email is verified.
          nextCheckAt: user.emailVerifiedAt ? new Date() : null,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) continue;
      throw error;
    }
  }

  throw conflict(
    'monitor_limit_reached',
    `You can monitor up to ${MAX_MONITORS_PER_USER} sites. Delete one to add another.`,
  );
}

export async function listMonitors(userId: string): Promise<Monitor[]> {
  return prisma.monitor.findMany({ where: { userId }, orderBy: { slot: 'asc' } });
}

/** Every read of a single monitor goes through here, so ownership is never optional. */
export async function getOwnedMonitor(userId: string, monitorId: string): Promise<Monitor> {
  const monitor = await prisma.monitor.findFirst({ where: { id: monitorId, userId } });
  // 404 rather than 403: a 403 would confirm that someone else owns this id.
  if (!monitor) throw notFound('Monitor not found.');
  return monitor;
}

export interface UpdateMonitorArgs {
  readonly userId: string;
  readonly monitorId: string;
  readonly name?: string;
  readonly url?: string;
  readonly paused?: boolean;
  readonly isPublic?: boolean;
  readonly guard?: UrlGuard;
}

/**
 * Applies an edit. Three edits have consequences beyond the field itself:
 *
 *  * Changing the URL makes the current failure streak and any open incident
 *    meaningless (they describe a different target), so the streak resets, the
 *    monitor returns to PENDING, and an open incident is closed as
 *    MONITOR_RECONFIGURED — closed without a recovery email, because nothing
 *    recovered.
 *  * Pausing stops scheduling (`nextCheckAt = null`) and closes an open incident
 *    as MONITOR_PAUSED: we stop knowing the state, so we stop counting downtime.
 *  * Resuming schedules an immediate check and returns the monitor to PENDING,
 *    since its state while paused is unknown.
 */
export async function updateMonitor(args: UpdateMonitorArgs): Promise<Monitor> {
  const existing = await getOwnedMonitor(args.userId, args.monitorId);

  let normalisedUrl: string | undefined;
  if (args.url !== undefined) {
    const guard = args.guard ?? strictUrlGuard;
    const approval = await guard.check(args.url);
    if (!approval.ok) {
      throw badRequest('invalid_monitor_url', approval.message, { url: approval.message });
    }
    normalisedUrl = approval.url;
  }

  const urlChanged = normalisedUrl !== undefined && normalisedUrl !== existing.url;
  const pausing = args.paused === true && !existing.paused;
  const resuming = args.paused === false && existing.paused;

  const user = await prisma.user.findUnique({
    where: { id: args.userId },
    select: { emailVerifiedAt: true },
  });
  const verified = user?.emailVerifiedAt != null;

  return prisma.$transaction(async (tx) => {
    if (pausing || urlChanged) {
      const reason = pausing ? 'MONITOR_PAUSED' : 'MONITOR_RECONFIGURED';
      await tx.incident.updateMany({
        where: { monitorId: existing.id, resolvedAt: null },
        data: { resolvedAt: new Date(), closeReason: reason },
      });
    }

    const resetTracking = urlChanged || pausing || resuming;
    const nextPaused = args.paused ?? existing.paused;

    const nextCheckAt = (() => {
      if (nextPaused) return null;
      if (!verified) return null;
      if (resuming || urlChanged || existing.nextCheckAt === null) return new Date();
      return existing.nextCheckAt;
    })();

    return tx.monitor.update({
      where: { id: existing.id },
      data: {
        ...(args.name !== undefined ? { name: args.name } : {}),
        ...(normalisedUrl !== undefined ? { url: normalisedUrl } : {}),
        ...(args.paused !== undefined ? { paused: args.paused } : {}),
        ...(args.isPublic !== undefined ? { isPublic: args.isPublic } : {}),
        ...(resetTracking
          ? {
              state: 'PENDING' as const,
              consecutiveFailures: 0,
              failingSince: null,
              lastFailureKind: null,
              lastFailureReason: null,
              lastStatusCode: null,
              lastResponseTimeMs: null,
              lastCheckedAt: null,
            }
          : {}),
        nextCheckAt,
      },
    });
  });
}

/**
 * Deletes a monitor. Checks, incidents and notifications cascade, and because
 * the row is gone the scheduler can no longer claim it — a queued job for it
 * finds nothing and exits without recording anything.
 */
export async function deleteMonitor(userId: string, monitorId: string): Promise<void> {
  const monitor = await getOwnedMonitor(userId, monitorId);
  await prisma.monitor.delete({ where: { id: monitor.id } });
}

/**
 * Called when an email is verified: monitors created before verification were
 * left unscheduled, so start them now.
 */
export async function activateMonitorsForUser(userId: string): Promise<number> {
  const result = await prisma.monitor.updateMany({
    where: { userId, paused: false, nextCheckAt: null },
    data: { nextCheckAt: new Date() },
  });
  return result.count;
}
