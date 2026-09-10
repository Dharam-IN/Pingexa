import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma.js';
import { createMonitor } from '../../src/domain/monitors.js';
import { processCheckResult } from '../../src/monitoring/resultProcessor.js';
import { handleCheckJob } from '../../src/worker/checkJob.js';
import {
  claimDueMonitors,
  dispatchDueChecks,
  reconcileSchedules,
} from '../../src/monitoring/scheduler.js';
import { runRetention } from '../../src/monitoring/retention.js';
import { closeQueues, queues } from '../../src/queue/queues.js';
import { closeDatabase, resetDatabase } from '../helpers/db.js';
import { createVerifiedUser, createUnverifiedUser } from '../helpers/api.js';
import {
  loopbackGuard,
  startFixtureServer,
  stubDnsGuard,
  type FixtureServer,
} from '../helpers/fixtureServer.js';
import type { HttpCheckResult } from '../../src/monitoring/httpCheck.js';

/**
 * Incident lifecycle, idempotency, scheduling and retention, against real
 * Postgres and real Redis.
 *
 * These tests drive the same functions the worker calls, with explicit
 * `scheduledFor` slots instead of waiting five minutes between checks. Nothing
 * about the production interval changes; the slot is simply supplied rather
 * than derived from wall-clock waiting. `MONITOR_INTERVAL_SECONDS` stays at 300
 * throughout (see tests/env.ts).
 */

const INTERVAL_MS = 300_000;
let fixture: FixtureServer;

function slot(index: number, base = Date.now()): Date {
  // Slots ascend, and stay within the scheduler's 3-interval lag tolerance.
  return new Date(base - (3 - index) * 1_000);
}

function upResult(at = new Date()): HttpCheckResult {
  return {
    outcome: 'UP',
    statusCode: 200,
    responseTimeMs: 42,
    startedAt: new Date(at.getTime() - 42),
    finishedAt: at,
  };
}

function downResult(at = new Date()): HttpCheckResult {
  return {
    outcome: 'DOWN',
    failureKind: 'HTTP_ERROR',
    failureReason: 'Responded with HTTP 500',
    statusCode: 500,
    responseTimeMs: 30,
    startedAt: new Date(at.getTime() - 30),
    finishedAt: at,
  };
}

beforeEach(async () => {
  await resetDatabase();
  await queues().checks.obliterate({ force: true }).catch(() => undefined);
  await queues().email.obliterate({ force: true }).catch(() => undefined);
});

afterEach(async () => {
  await fixture?.close();
  fixture = undefined as unknown as FixtureServer;
});

afterAll(async () => {
  await closeQueues();
  await closeDatabase();
});

/**
 * Creates a verified user and one monitor. A fixture-server URL needs the
 * loopback guard, since the production policy refuses loopback addresses and
 * non-standard ports and must not be weakened.
 */
async function newMonitor(email: string, url = 'https://example.com/') {
  const user = await createVerifiedUser(email);
  const usesFixture = url.startsWith('http://127.0.0.1:');
  const monitor = await createMonitor({
    userId: user.id,
    name: 'Site',
    url,
    guard: usesFixture ? loopbackGuard : stubDnsGuard,
  });
  return { user, monitor };
}

describe('incident lifecycle', () => {
  it('goes UP -> three failures -> one incident + one DOWN alert -> UP -> recovery alert', async () => {
    const { user, monitor } = await newMonitor('lifecycle@monitored.dev');
    const t0 = new Date('2026-09-10T10:00:00.000Z');

    // 1. First check succeeds: PENDING -> UP, no incident.
    const first = await processCheckResult({
      monitorId: monitor.id,
      scheduledFor: t0,
      result: upResult(t0),
    });
    expect(first.status).toBe('recorded');
    expect(first.monitorState).toBe('UP');
    expect(first.notifications).toEqual([]);

    // 2. First failure: still UP, streak 1, no incident, no alert.
    const failure1At = new Date(t0.getTime() + INTERVAL_MS);
    const f1 = await processCheckResult({
      monitorId: monitor.id,
      scheduledFor: failure1At,
      result: downResult(failure1At),
    });
    expect(f1.consecutiveFailures).toBe(1);
    expect(f1.monitorState).toBe('UP');
    expect(f1.incidentOpened).toBeUndefined();

    // 3. Second failure: still no incident.
    const failure2At = new Date(t0.getTime() + 2 * INTERVAL_MS);
    const f2 = await processCheckResult({
      monitorId: monitor.id,
      scheduledFor: failure2At,
      result: downResult(failure2At),
    });
    expect(f2.consecutiveFailures).toBe(2);
    expect(f2.incidentOpened).toBeUndefined();
    expect(await prisma.incident.count()).toBe(0);
    expect(await prisma.notification.count()).toBe(0);

    // 4. Third failure: DOWN declared, exactly one incident and one DOWN alert.
    const failure3At = new Date(t0.getTime() + 3 * INTERVAL_MS);
    const f3 = await processCheckResult({
      monitorId: monitor.id,
      scheduledFor: failure3At,
      result: downResult(failure3At),
    });
    expect(f3.consecutiveFailures).toBe(3);
    expect(f3.monitorState).toBe('DOWN');
    expect(f3.incidentOpened).toBeTruthy();
    expect(f3.notifications).toHaveLength(1);
    expect(f3.notifications[0]?.kind).toBe('DOWN');

    const incident = await prisma.incident.findFirstOrThrow();
    // startedAt is the first failure, detectedAt is the confirming one.
    expect(incident.startedAt.toISOString()).toBe(failure1At.toISOString());
    expect(incident.detectedAt.toISOString()).toBe(failure3At.toISOString());
    expect(incident.resolvedAt).toBeNull();
    expect(incident.causeKind).toBe('HTTP_ERROR');

    // 5. A fourth failure must not open a second incident or send a second alert.
    const failure4At = new Date(t0.getTime() + 4 * INTERVAL_MS);
    const f4 = await processCheckResult({
      monitorId: monitor.id,
      scheduledFor: failure4At,
      result: downResult(failure4At),
    });
    expect(f4.consecutiveFailures).toBe(4);
    expect(f4.incidentOpened).toBeUndefined();
    expect(f4.notifications).toEqual([]);
    expect(await prisma.incident.count()).toBe(1);
    expect(await prisma.notification.count({ where: { kind: 'DOWN' } })).toBe(1);

    // 6. First success closes the incident and produces exactly one recovery alert.
    const recoveryAt = new Date(t0.getTime() + 5 * INTERVAL_MS);
    const recovery = await processCheckResult({
      monitorId: monitor.id,
      scheduledFor: recoveryAt,
      result: upResult(recoveryAt),
    });
    expect(recovery.monitorState).toBe('UP');
    expect(recovery.consecutiveFailures).toBe(0);
    expect(recovery.incidentResolved).toBe(incident.id);
    expect(recovery.notifications).toHaveLength(1);
    expect(recovery.notifications[0]?.kind).toBe('RECOVERY');

    const resolved = await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } });
    expect(resolved.resolvedAt?.toISOString()).toBe(recoveryAt.toISOString());
    expect(resolved.closeReason).toBe('RECOVERED');

    // Exactly two alerts for the whole outage, both for this user.
    const notifications = await prisma.notification.findMany({ where: { userId: user.id } });
    expect(notifications).toHaveLength(2);
    expect(notifications.map((row) => row.kind).sort()).toEqual(['DOWN', 'RECOVERY']);

    // 7. A second incident can open after recovery.
    for (let index = 1; index <= 3; index += 1) {
      const at = new Date(t0.getTime() + (5 + index) * INTERVAL_MS);
      await processCheckResult({ monitorId: monitor.id, scheduledFor: at, result: downResult(at) });
    }
    expect(await prisma.incident.count()).toBe(2);
    expect(await prisma.notification.count({ where: { kind: 'DOWN' } })).toBe(2);
  });

  it('resets the failure streak on any success', async () => {
    const { monitor } = await newMonitor('streak@monitored.dev');
    const t0 = new Date('2026-09-10T10:00:00.000Z');

    for (const index of [0, 1]) {
      const at = new Date(t0.getTime() + index * INTERVAL_MS);
      await processCheckResult({ monitorId: monitor.id, scheduledFor: at, result: downResult(at) });
    }
    const successAt = new Date(t0.getTime() + 2 * INTERVAL_MS);
    await processCheckResult({
      monitorId: monitor.id,
      scheduledFor: successAt,
      result: upResult(successAt),
    });

    const after = await prisma.monitor.findUniqueOrThrow({ where: { id: monitor.id } });
    expect(after.consecutiveFailures).toBe(0);
    expect(after.failingSince).toBeNull();

    // Two more failures must not be enough: the streak restarted.
    for (const index of [3, 4]) {
      const at = new Date(t0.getTime() + index * INTERVAL_MS);
      await processCheckResult({ monitorId: monitor.id, scheduledFor: at, result: downResult(at) });
    }
    expect(await prisma.incident.count()).toBe(0);
  });

  it('never declares DOWN from a first-ever failure', async () => {
    const { monitor } = await newMonitor('firstfail@monitored.dev');
    const at = new Date();
    const result = await processCheckResult({
      monitorId: monitor.id,
      scheduledFor: at,
      result: downResult(at),
    });
    // A brand new monitor with one failure is still PENDING, not DOWN.
    expect(result.monitorState).toBe('PENDING');
    expect(await prisma.incident.count()).toBe(0);
  });

  it('records a safe failure reason and no response body', async () => {
    const { monitor } = await newMonitor('reason@monitored.dev');
    const at = new Date();
    await processCheckResult({
      monitorId: monitor.id,
      scheduledFor: at,
      result: {
        outcome: 'DOWN',
        failureKind: 'TIMEOUT',
        failureReason: 'No response within 10000 ms',
        statusCode: null,
        responseTimeMs: null,
        startedAt: at,
        finishedAt: at,
      },
    });
    const check = await prisma.check.findFirstOrThrow();
    expect(check.failureKind).toBe('TIMEOUT');
    expect(check.failureReason).toBe('No response within 10000 ms');
    expect(check.statusCode).toBeNull();
    expect(Object.keys(check)).not.toContain('body');
  });
});

describe('idempotency and duplicate protection', () => {
  it('ignores a redelivered result for the same scheduled slot', async () => {
    const { monitor } = await newMonitor('redeliver@monitored.dev');
    const at = new Date('2026-09-10T10:00:00.000Z');

    const first = await processCheckResult({
      monitorId: monitor.id,
      scheduledFor: at,
      result: downResult(at),
    });
    expect(first.status).toBe('recorded');
    expect(first.consecutiveFailures).toBe(1);

    // Same slot again, as a queue redelivery would produce.
    const second = await processCheckResult({
      monitorId: monitor.id,
      scheduledFor: at,
      result: downResult(new Date(at.getTime() + 5_000)),
    });
    expect(second.status).toBe('duplicate');

    const monitorAfter = await prisma.monitor.findUniqueOrThrow({ where: { id: monitor.id } });
    // The critical assertion: a retry did not advance the failure streak.
    expect(monitorAfter.consecutiveFailures).toBe(1);
    expect(await prisma.check.count()).toBe(1);
  });

  it('cannot be pushed to DOWN by repeatedly retrying one slot', async () => {
    const { monitor } = await newMonitor('retrystorm@monitored.dev');
    const at = new Date('2026-09-10T10:00:00.000Z');

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await processCheckResult({
        monitorId: monitor.id,
        scheduledFor: at,
        result: downResult(at),
      });
    }
    const after = await prisma.monitor.findUniqueOrThrow({ where: { id: monitor.id } });
    expect(after.consecutiveFailures).toBe(1);
    expect(after.state).toBe('PENDING');
    expect(await prisma.incident.count()).toBe(0);
  });

  it('handles concurrent processing of the same slot without duplicating anything', async () => {
    const { monitor } = await newMonitor('concurrent@monitored.dev');
    const at = new Date('2026-09-10T10:00:00.000Z');
    await prisma.monitor.update({
      where: { id: monitor.id },
      data: { state: 'UP', consecutiveFailures: 2, failingSince: new Date(at.getTime() - 600_000) },
    });

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        processCheckResult({ monitorId: monitor.id, scheduledFor: at, result: downResult(at) }),
      ),
    );

    expect(results.filter((result) => result.status === 'recorded')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'duplicate')).toHaveLength(4);
    expect(await prisma.check.count()).toBe(1);
    expect(await prisma.incident.count()).toBe(1);
    expect(await prisma.notification.count()).toBe(1);
  });

  it('does not open two incidents when two different slots race', async () => {
    const { monitor } = await newMonitor('tworace@monitored.dev');
    const base = new Date('2026-09-10T10:00:00.000Z');
    await prisma.monitor.update({
      where: { id: monitor.id },
      data: { state: 'UP', consecutiveFailures: 2, failingSince: base },
    });

    const slotA = new Date(base.getTime() + INTERVAL_MS);
    const slotB = new Date(base.getTime() + 2 * INTERVAL_MS);
    await Promise.all([
      processCheckResult({ monitorId: monitor.id, scheduledFor: slotA, result: downResult(slotA) }),
      processCheckResult({ monitorId: monitor.id, scheduledFor: slotB, result: downResult(slotB) }),
    ]);

    // Both checks are recorded, but the partial unique index plus the row lock
    // means only one incident and one DOWN alert exist.
    expect(await prisma.check.count()).toBe(2);
    expect(await prisma.incident.count()).toBe(1);
    expect(await prisma.notification.count({ where: { kind: 'DOWN' } })).toBe(1);
  });

  it('refuses a second open incident at the database level', async () => {
    const { monitor } = await newMonitor('twoopen@monitored.dev');
    await prisma.incident.create({
      data: { monitorId: monitor.id, startedAt: new Date(), detectedAt: new Date() },
    });
    await expect(
      prisma.incident.create({
        data: { monitorId: monitor.id, startedAt: new Date(), detectedAt: new Date() },
      }),
    ).rejects.toThrow();
  });

  it('refuses a second alert of the same kind for one incident', async () => {
    const { user, monitor } = await newMonitor('twoalerts@monitored.dev');
    const incident = await prisma.incident.create({
      data: { monitorId: monitor.id, startedAt: new Date(), detectedAt: new Date() },
    });
    await prisma.notification.create({
      data: { incidentId: incident.id, userId: user.id, kind: 'DOWN' },
    });
    await expect(
      prisma.notification.create({
        data: { incidentId: incident.id, userId: user.id, kind: 'DOWN' },
      }),
    ).rejects.toThrow();
    // A RECOVERY alert for the same incident is still allowed.
    await prisma.notification.create({
      data: { incidentId: incident.id, userId: user.id, kind: 'RECOVERY' },
    });
  });
});

describe('jobs whose monitor changed while queued', () => {
  it('does nothing when the monitor was deleted', async () => {
    const { monitor } = await newMonitor('deleted@monitored.dev');
    const scheduledFor = new Date();
    await prisma.monitor.delete({ where: { id: monitor.id } });

    const outcome = await handleCheckJob({
      monitorId: monitor.id,
      scheduledFor: scheduledFor.toISOString(),
    });
    expect(outcome).toBe('monitor_missing');
    expect(await prisma.check.count()).toBe(0);
  });

  it('does not check or alert on a monitor paused after the job was queued', async () => {
    fixture = await startFixtureServer({ status: 500 });
    const { monitor } = await newMonitor('pausedjob@monitored.dev', fixture.url);
    await prisma.monitor.update({ where: { id: monitor.id }, data: { paused: true } });

    const outcome = await handleCheckJob(
      { monitorId: monitor.id, scheduledFor: new Date().toISOString() },
      { guard: loopbackGuard },
    );
    expect(outcome).toBe('monitor_paused');
    // No outbound request at all.
    expect(fixture.requestCount).toBe(0);
    expect(await prisma.check.count()).toBe(0);
  });

  it('does not check a monitor whose account is no longer verified', async () => {
    fixture = await startFixtureServer({ status: 200 });
    const user = await createUnverifiedUser('unverifiedjob@monitored.dev');
    const monitor = await prisma.monitor.create({
      data: { userId: user.id, slot: 0, name: 'Site', url: fixture.url, nextCheckAt: new Date() },
    });

    const outcome = await handleCheckJob(
      { monitorId: monitor.id, scheduledFor: new Date().toISOString() },
      { guard: loopbackGuard },
    );
    expect(outcome).toBe('email_unverified');
    expect(fixture.requestCount).toBe(0);
  });

  it('drops a job whose slot is far in the past instead of inventing a result', async () => {
    fixture = await startFixtureServer({ status: 200 });
    const { monitor } = await newMonitor('stalejob@monitored.dev', fixture.url);

    const outcome = await handleCheckJob(
      {
        monitorId: monitor.id,
        // Two hours late: this slot is meaningless now.
        scheduledFor: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      },
      { guard: loopbackGuard },
    );
    expect(outcome).toBe('stale_slot');
    expect(fixture.requestCount).toBe(0);
    expect(await prisma.check.count()).toBe(0);
  });

  it('uses the URL as edited, not the URL at enqueue time', async () => {
    const oldFixture = await startFixtureServer({ status: 500 });
    fixture = await startFixtureServer({ status: 200 });
    try {
      const { monitor } = await newMonitor('editedjob@monitored.dev', oldFixture.url);
      await prisma.monitor.update({ where: { id: monitor.id }, data: { url: fixture.url } });

      const outcome = await handleCheckJob(
        { monitorId: monitor.id, scheduledFor: new Date().toISOString() },
        { guard: loopbackGuard },
      );
      expect(outcome).toBe('recorded');
      expect(oldFixture.requestCount).toBe(0);
      expect(fixture.requestCount).toBe(1);

      const check = await prisma.check.findFirstOrThrow();
      expect(check.outcome).toBe('UP');
    } finally {
      await oldFixture.close();
    }
  });

  it('skips the outbound request when the slot is already recorded', async () => {
    fixture = await startFixtureServer({ status: 200 });
    const { monitor } = await newMonitor('shortcircuit@monitored.dev', fixture.url);
    const scheduledFor = new Date();

    const first = await handleCheckJob(
      { monitorId: monitor.id, scheduledFor: scheduledFor.toISOString() },
      { guard: loopbackGuard },
    );
    expect(first).toBe('recorded');
    expect(fixture.requestCount).toBe(1);

    const second = await handleCheckJob(
      { monitorId: monitor.id, scheduledFor: scheduledFor.toISOString() },
      { guard: loopbackGuard },
    );
    expect(second).toBe('duplicate');
    // The redelivery cost no traffic to the monitored site.
    expect(fixture.requestCount).toBe(1);
  });
});

describe('scheduler', () => {
  it('claims a due monitor exactly once, even across concurrent ticks', async () => {
    const { monitor } = await newMonitor('claim@monitored.dev');
    await prisma.monitor.update({
      where: { id: monitor.id },
      data: { nextCheckAt: new Date(Date.now() - 1_000) },
    });

    const [a, b, c] = await Promise.all([
      claimDueMonitors(),
      claimDueMonitors(),
      claimDueMonitors(),
    ]);
    const claims = [...a, ...b, ...c].filter((entry) => entry.monitorId === monitor.id);
    expect(claims).toHaveLength(1);

    // nextCheckAt advanced, so the monitor is no longer due.
    expect(await claimDueMonitors()).toEqual([]);
    const after = await prisma.monitor.findUniqueOrThrow({ where: { id: monitor.id } });
    expect(after.nextCheckAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it('does not claim paused monitors or unverified accounts', async () => {
    const paused = await newMonitor('pausedclaim@monitored.dev');
    await prisma.monitor.update({
      where: { id: paused.monitor.id },
      data: { paused: true, nextCheckAt: new Date(Date.now() - 1000) },
    });

    const unverified = await createUnverifiedUser('unverifiedclaim@monitored.dev');
    await prisma.monitor.create({
      data: {
        userId: unverified.id,
        slot: 0,
        name: 'Site',
        url: 'https://example.com/',
        nextCheckAt: new Date(Date.now() - 1000),
      },
    });

    expect(await claimDueMonitors()).toEqual([]);
  });

  it('re-bases a monitor that fell far behind rather than replaying its backlog', async () => {
    const { monitor } = await newMonitor('behind@monitored.dev');
    // Simulate a worker that was down for two hours.
    await prisma.monitor.update({
      where: { id: monitor.id },
      data: { nextCheckAt: new Date(Date.now() - 2 * 60 * 60 * 1000) },
    });

    const claimed = await claimDueMonitors();
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.rebased).toBe(true);
    // The slot is now, not two hours ago, so the check is actually performed.
    expect(Math.abs((claimed[0]!.scheduledFor.getTime() - Date.now())) ).toBeLessThan(5_000);

    // And exactly one further check is scheduled, one interval out, not 24.
    const after = await prisma.monitor.findUniqueOrThrow({ where: { id: monitor.id } });
    expect(after.nextCheckAt!.getTime() - Date.now()).toBeGreaterThan(INTERVAL_MS - 10_000);
    expect(after.nextCheckAt!.getTime() - Date.now()).toBeLessThan(INTERVAL_MS + 10_000);
    expect(await claimDueMonitors()).toEqual([]);
  });

  it('keeps the real slot for a monitor that is only slightly late', async () => {
    const { monitor } = await newMonitor('slightlylate@monitored.dev');
    const dueAt = new Date(Date.now() - 30_000);
    await prisma.monitor.update({ where: { id: monitor.id }, data: { nextCheckAt: dueAt } });

    const claimed = await claimDueMonitors();
    expect(claimed[0]?.rebased).toBe(false);
    expect(claimed[0]?.scheduledFor.toISOString()).toBe(dueAt.toISOString());
  });

  it('reconciles a monitor that lost its schedule', async () => {
    // The failure this repairs: a crash between verifying an email and
    // activating the account's monitors.
    const { monitor } = await newMonitor('lostschedule@monitored.dev');
    await prisma.monitor.update({ where: { id: monitor.id }, data: { nextCheckAt: null } });
    expect(await claimDueMonitors()).toEqual([]);

    const repaired = await reconcileSchedules();
    expect(repaired).toBe(1);
    const claimed = await claimDueMonitors();
    expect(claimed).toHaveLength(1);
  });

  it('does not reconcile paused monitors back onto the schedule', async () => {
    const { monitor } = await newMonitor('stayoff@monitored.dev');
    await prisma.monitor.update({
      where: { id: monitor.id },
      data: { paused: true, nextCheckAt: null },
    });
    expect(await reconcileSchedules()).toBe(0);
  });

  it('enqueues one job per claimed slot with a deterministic id', async () => {
    const { monitor } = await newMonitor('dispatch@monitored.dev');
    await prisma.monitor.update({
      where: { id: monitor.id },
      data: { nextCheckAt: new Date(Date.now() - 1_000) },
    });

    const summary = await dispatchDueChecks(queues());
    expect(summary.claimed).toBe(1);
    expect(summary.enqueued).toBe(1);

    const waiting = await queues().checks.getJobs(['waiting', 'delayed', 'active']);
    expect(waiting).toHaveLength(1);
    expect(waiting[0]?.id).toMatch(new RegExp(`^check-${monitor.id}-\\d+$`));
    expect((waiting[0]?.data as { monitorId: string }).monitorId).toBe(monitor.id);

    // A second dispatch in the same slot must not add a second job. (The claim
    // already advanced nextCheckAt, so nothing is due; assert the queue too.)
    await dispatchDueChecks(queues());
    expect(await queues().checks.getJobs(['waiting', 'delayed', 'active'])).toHaveLength(1);
  });
});

describe('retention', () => {
  it('deletes checks older than the retention window and keeps newer ones', async () => {
    const { monitor } = await newMonitor('retention@monitored.dev');
    const now = new Date();

    const makeCheck = (ageDays: number) => {
      const at = new Date(now.getTime() - ageDays * 24 * 60 * 60 * 1000);
      return prisma.check.create({
        data: {
          monitorId: monitor.id,
          scheduledFor: at,
          startedAt: at,
          checkedAt: at,
          outcome: 'UP',
          statusCode: 200,
          responseTimeMs: 10,
        },
      });
    };

    await makeCheck(0);
    await makeCheck(3);
    await makeCheck(6.9);
    await makeCheck(7.1);
    await makeCheck(30);

    const summary = await runRetention(now);
    expect(summary.checksDeleted).toBe(2);
    expect(await prisma.check.count()).toBe(3);
  });

  it('keeps resolved incidents inside the incident window and drops older ones', async () => {
    const { monitor } = await newMonitor('incidentretention@monitored.dev');
    const now = new Date();

    const makeIncident = (ageDays: number, resolved: boolean) => {
      const at = new Date(now.getTime() - ageDays * 24 * 60 * 60 * 1000);
      return prisma.incident.create({
        data: {
          monitorId: monitor.id,
          startedAt: at,
          detectedAt: at,
          ...(resolved
            ? { resolvedAt: new Date(at.getTime() + 60_000), closeReason: 'RECOVERED' as const }
            : {}),
        },
      });
    };

    await makeIncident(1, true);
    await makeIncident(89, true);
    await makeIncident(120, true);
    // An open incident is never deleted, however old it is.
    const open = await makeIncident(200, false);

    const summary = await runRetention(now);
    expect(summary.incidentsDeleted).toBe(1);
    expect(await prisma.incident.findUnique({ where: { id: open.id } })).not.toBeNull();
  });

  it('removes expired sessions and spent auth tokens', async () => {
    const user = await createVerifiedUser('purge@monitored.dev');
    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: 'expired-hash',
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: 'live-hash',
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    await prisma.authToken.create({
      data: {
        userId: user.id,
        type: 'EMAIL_VERIFICATION',
        tokenHash: 'used-hash',
        expiresAt: new Date(Date.now() + 86_400_000),
        consumedAt: new Date(),
      },
    });

    const summary = await runRetention();
    expect(summary.sessionsDeleted).toBe(1);
    expect(summary.authTokensDeleted).toBe(1);
    expect(await prisma.session.count()).toBe(1);
  });
});

describe('check history and uptime as the API reports them', () => {
  it('reports coverage below 100% when checks are missing, without inventing downtime', async () => {
    const { monitor } = await newMonitor('coverage@monitored.dev');
    // Backdate creation so the 24h window expects a full 288 checks.
    await prisma.monitor.update({
      where: { id: monitor.id },
      data: { createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) },
    });

    // Record only 24 successful checks in the last 24 hours.
    for (let index = 0; index < 24; index += 1) {
      const at = new Date(Date.now() - index * 60 * 60 * 1000);
      await prisma.check.create({
        data: {
          monitorId: monitor.id,
          scheduledFor: at,
          startedAt: at,
          checkedAt: at,
          outcome: 'UP',
          statusCode: 200,
          responseTimeMs: 20,
        },
      });
    }

    const client = await (await import('../helpers/api.js')).signIn({
      id: monitor.userId,
      email: 'coverage@monitored.dev',
      password: 'test-password-123',
    });
    const detail = await client.get(`/api/monitors/${monitor.id}`).expect(200);

    expect(detail.body.uptime['24h'].uptimePercent).toBe(100);
    expect(detail.body.uptime['24h'].downChecks).toBe(0);
    expect(detail.body.uptime['24h'].coveragePercent).toBeLessThan(15);
    expect(detail.body.uptime['24h'].partialData).toBe(true);
  });

  it('surfaces a stale monitor rather than freezing its last known state', async () => {
    const { monitor, user } = await newMonitor('stale@monitored.dev');
    const longAgo = new Date(Date.now() - 60 * 60 * 1000);
    await prisma.monitor.update({
      where: { id: monitor.id },
      data: { state: 'UP', lastCheckedAt: longAgo, nextCheckAt: new Date() },
    });

    const client = await (await import('../helpers/api.js')).signIn({
      id: user.id,
      email: user.email,
      password: user.password,
    });
    const detail = await client.get(`/api/monitors/${monitor.id}`).expect(200);

    expect(detail.body.monitor.monitoringStale).toBe(true);
    expect(detail.body.monitor.displayState).toBe('STALE');
    // The last known state is still available, just not presented as current.
    expect(detail.body.monitor.state).toBe('UP');
  });
});

// `slot` is exported for readability in future tests; reference it so lint is happy.
void slot;
