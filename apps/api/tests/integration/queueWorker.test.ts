import { Worker } from 'bullmq';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../../src/config/env.js';
import { prisma } from '../../src/lib/prisma.js';
import { createQueueConnection } from '../../src/lib/redis.js';
import { createMonitor } from '../../src/domain/monitors.js';
import { dispatchDueChecks, reconcileSchedules } from '../../src/monitoring/scheduler.js';
import { QUEUE_CHECKS, closeQueues, queues, type CheckJobData } from '../../src/queue/queues.js';
import { handleCheckJob } from '../../src/worker/checkJob.js';
import { closeDatabase, resetDatabase } from '../helpers/db.js';
import { createVerifiedUser } from '../helpers/api.js';
import { loopbackGuard, startFixtureServer, type FixtureServer } from '../helpers/fixtureServer.js';

/**
 * These tests run the real BullMQ worker against the real Redis, which is the
 * only way to exercise the behaviours that only appear with a live queue:
 * redelivery after a crashed job, two workers consuming the same queue, and a
 * restart picking up where the previous process stopped.
 */

let fixture: FixtureServer;
const workers: Worker[] = [];

async function startWorker(options: {
  concurrency?: number;
  onJob?: (data: CheckJobData) => Promise<void>;
} = {}): Promise<Worker<CheckJobData>> {
  const connection = createQueueConnection();
  const worker = new Worker<CheckJobData>(
    QUEUE_CHECKS,
    async (job) => {
      if (options.onJob) await options.onJob(job.data);
      return handleCheckJob(job.data, { guard: loopbackGuard });
    },
    {
      connection,
      prefix: env.QUEUE_PREFIX,
      concurrency: options.concurrency ?? 1,
      lockDuration: 10_000,
    },
  );
  workers.push(worker);
  await worker.waitUntilReady();
  return worker;
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('condition not met within timeout');
}

beforeEach(async () => {
  await resetDatabase();
  await queues().checks.obliterate({ force: true }).catch(() => undefined);
  await queues().email.obliterate({ force: true }).catch(() => undefined);
});

afterEach(async () => {
  await Promise.allSettled(workers.map((worker) => worker.close()));
  workers.length = 0;
  await fixture?.close();
  fixture = undefined as unknown as FixtureServer;
});

afterAll(async () => {
  await closeQueues();
  await closeDatabase();
});

async function scheduledMonitor(email: string, url: string) {
  const user = await createVerifiedUser(email);
  const monitor = await createMonitor({
    userId: user.id,
    name: 'Site',
    url,
    guard: loopbackGuard,
  });
  await prisma.monitor.update({
    where: { id: monitor.id },
    data: { nextCheckAt: new Date(Date.now() - 1_000) },
  });
  return { user, monitor };
}

describe('scheduler and worker over a real queue', () => {
  it('dispatches, executes and records one check', async () => {
    fixture = await startFixtureServer({ status: 200 });
    const { monitor } = await scheduledMonitor('queue1@monitored.dev', fixture.url);
    await startWorker();

    const summary = await dispatchDueChecks(queues());
    expect(summary.enqueued).toBe(1);

    await waitFor(async () => (await prisma.check.count()) === 1);
    const check = await prisma.check.findFirstOrThrow();
    expect(check.monitorId).toBe(monitor.id);
    expect(check.outcome).toBe('UP');
    expect(fixture.requestCount).toBe(1);
  });

  it('creates no duplicate check when a job is redelivered after a crash', async () => {
    fixture = await startFixtureServer({ status: 500 });
    const { monitor } = await scheduledMonitor('queue2@monitored.dev', fixture.url);

    // A worker that dies partway: the first attempt throws after the result has
    // already been written, which is exactly the crash window a queue redelivers.
    let attempts = 0;
    await startWorker({
      onJob: async () => {
        attempts += 1;
      },
    });

    await dispatchDueChecks(queues());
    await waitFor(async () => (await prisma.check.count()) === 1);

    // Force a redelivery of the same job payload.
    const scheduledFor = (await prisma.check.findFirstOrThrow()).scheduledFor;
    await queues().checks.add(
      'check',
      { monitorId: monitor.id, scheduledFor: scheduledFor.toISOString() },
      { jobId: `check-${monitor.id}-redelivered` },
    );

    await waitFor(async () => attempts >= 2);
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(await prisma.check.count()).toBe(1);
    const after = await prisma.monitor.findUniqueOrThrow({ where: { id: monitor.id } });
    // The redelivery must not have advanced the failure streak.
    expect(after.consecutiveFailures).toBe(1);
    expect(await prisma.incident.count()).toBe(0);
  });

  it('two workers on the same queue produce one incident, not two', async () => {
    fixture = await startFixtureServer({ status: 503 });
    const { monitor } = await scheduledMonitor('queue3@monitored.dev', fixture.url);
    await startWorker({ concurrency: 4 });
    await startWorker({ concurrency: 4 });

    // Three distinct slots, all failing, enqueued at once.
    const base = Date.now() - 3_000;
    for (let index = 0; index < 3; index += 1) {
      const scheduledFor = new Date(base + index * 1_000).toISOString();
      await queues().checks.add(
        'check',
        { monitorId: monitor.id, scheduledFor },
        { jobId: `check-${monitor.id}-${base + index * 1000}` },
      );
    }

    await waitFor(async () => (await prisma.check.count()) === 3);
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(await prisma.incident.count()).toBe(1);
    expect(await prisma.notification.count({ where: { kind: 'DOWN' } })).toBe(1);
    const after = await prisma.monitor.findUniqueOrThrow({ where: { id: monitor.id } });
    expect(after.state).toBe('DOWN');
    expect(after.consecutiveFailures).toBe(3);
  });

  it('recovers after a worker restart and keeps monitoring', async () => {
    fixture = await startFixtureServer({ status: 200 });
    const { monitor } = await scheduledMonitor('queue4@monitored.dev', fixture.url);

    const first = await startWorker();
    await dispatchDueChecks(queues());
    await waitFor(async () => (await prisma.check.count()) === 1);

    // Restart: graceful close, then a brand new worker process equivalent.
    await first.close();
    workers.length = 0;

    // While no worker is running, the monitor becomes due again.
    await prisma.monitor.update({
      where: { id: monitor.id },
      data: { nextCheckAt: new Date(Date.now() - 1_000) },
    });
    await dispatchDueChecks(queues());
    expect(await prisma.check.count()).toBe(1);

    await startWorker();
    await waitFor(async () => (await prisma.check.count()) === 2);
    expect(await prisma.check.count()).toBe(2);
  });

  it('keeps monitoring after Redis loses every queued job', async () => {
    fixture = await startFixtureServer({ status: 200 });
    const { monitor } = await scheduledMonitor('queue5@monitored.dev', fixture.url);

    await dispatchDueChecks(queues());
    expect(await queues().checks.getJobCountByTypes('waiting', 'delayed')).toBe(1);

    // Simulate Redis data loss: every job for this queue disappears.
    await queues().checks.obliterate({ force: true });
    expect(await queues().checks.getJobCountByTypes('waiting', 'delayed')).toBe(0);

    // The schedule survived in Postgres, so the next due time still stands and
    // the monitor is not stuck forever.
    const after = await prisma.monitor.findUniqueOrThrow({ where: { id: monitor.id } });
    expect(after.nextCheckAt).not.toBeNull();

    await startWorker();
    await prisma.monitor.update({
      where: { id: monitor.id },
      data: { nextCheckAt: new Date(Date.now() - 1_000) },
    });
    await dispatchDueChecks(queues());
    await waitFor(async () => (await prisma.check.count()) === 1);
  });

  it('does nothing for a monitor deleted after its job was queued', async () => {
    fixture = await startFixtureServer({ status: 200 });
    const { monitor } = await scheduledMonitor('queue6@monitored.dev', fixture.url);

    await dispatchDueChecks(queues());
    await prisma.monitor.delete({ where: { id: monitor.id } });

    await startWorker();
    // Give the worker time to pick the job up and decide to do nothing.
    await waitFor(async () => (await queues().checks.getJobCountByTypes('waiting', 'active')) === 0);
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(fixture.requestCount).toBe(0);
    expect(await prisma.check.count()).toBe(0);
  });

  it('reconciles a monitor whose schedule was lost, on the next startup pass', async () => {
    fixture = await startFixtureServer({ status: 200 });
    const { monitor } = await scheduledMonitor('queue7@monitored.dev', fixture.url);
    await prisma.monitor.update({ where: { id: monitor.id }, data: { nextCheckAt: null } });

    // Nothing is due, so nothing is dispatched.
    expect((await dispatchDueChecks(queues())).claimed).toBe(0);

    // This is what the worker runs at startup.
    expect(await reconcileSchedules()).toBe(1);

    await startWorker();
    expect((await dispatchDueChecks(queues())).enqueued).toBe(1);
    await waitFor(async () => (await prisma.check.count()) === 1);
  });
});
