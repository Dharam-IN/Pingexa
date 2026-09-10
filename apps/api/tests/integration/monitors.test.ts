import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { MAX_MONITORS_PER_USER } from '@pingexa/shared';
import { prisma } from '../../src/lib/prisma.js';
import { createMonitor } from '../../src/domain/monitors.js';
import { closeQueues } from '../../src/queue/queues.js';
import { closeDatabase, resetDatabase } from '../helpers/db.js';
import {
  createClient,
  createUnverifiedUser,
  createVerifiedUser,
  primeClient,
  signIn,
} from '../helpers/api.js';
import {
  loopbackGuard,
  startFixtureServer,
  stubDnsGuard,
  type FixtureServer,
} from '../helpers/fixtureServer.js';

let fixture: FixtureServer;

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await fixture?.close();
  await closeQueues();
  await closeDatabase();
});

describe('monitor CRUD', () => {
  it('creates, lists, reads, edits, pauses, resumes and deletes', async () => {
    const user = await createVerifiedUser('crud@monitored.dev');
    const client = await signIn(user);

    const created = await client
      .post('/api/monitors', { name: 'Docs site', url: 'https://example.com' })
      .expect(201);
    const id = created.body.monitor.id as string;
    expect(created.body.monitor.state).toBe('PENDING');
    expect(created.body.monitor.displayState).toBe('PENDING');
    expect(created.body.monitor.intervalSeconds).toBe(300);
    // A verified account schedules immediately.
    expect(created.body.monitor.nextCheckAt).not.toBeNull();
    // The URL is normalised on the way in.
    expect(created.body.monitor.url).toBe('https://example.com/');

    const list = await client.get('/api/monitors').expect(200);
    expect(list.body.monitors).toHaveLength(1);
    expect(list.body.limit).toBe(MAX_MONITORS_PER_USER);
    expect(list.body.used).toBe(1);

    const detail = await client.get(`/api/monitors/${id}`).expect(200);
    expect(detail.body.monitor.id).toBe(id);
    expect(detail.body.checks).toEqual([]);
    expect(detail.body.incidents).toEqual([]);
    expect(detail.body.checkHistoryRetentionDays).toBe(7);

    const renamed = await client.patch(`/api/monitors/${id}`, { name: 'Renamed' }).expect(200);
    expect(renamed.body.monitor.name).toBe('Renamed');

    const paused = await client.patch(`/api/monitors/${id}`, { paused: true }).expect(200);
    expect(paused.body.monitor.paused).toBe(true);
    expect(paused.body.monitor.displayState).toBe('PAUSED');
    // A paused monitor must not be schedulable.
    expect(paused.body.monitor.nextCheckAt).toBeNull();

    const resumed = await client.patch(`/api/monitors/${id}`, { paused: false }).expect(200);
    expect(resumed.body.monitor.paused).toBe(false);
    expect(resumed.body.monitor.nextCheckAt).not.toBeNull();
    // State while paused is unknown, so resuming starts from PENDING.
    expect(resumed.body.monitor.state).toBe('PENDING');

    await client.del(`/api/monitors/${id}`).expect(204);
    await client.get(`/api/monitors/${id}`).expect(404);
    expect(await prisma.monitor.count()).toBe(0);
  });

  it('rejects a monitor URL that fails the SSRF policy', async () => {
    const user = await createVerifiedUser('ssrf@monitored.dev');
    const client = await signIn(user);

    for (const url of [
      'http://127.0.0.1/',
      'http://localhost/',
      'http://169.254.169.254/latest/meta-data/',
      'http://10.0.0.1/',
      'http://[::1]/',
      'http://example.com:8080/',
      'https://user:pw@example.com/',
      'ftp://example.com/',
      'http://box.local/',
    ]) {
      const response = await client.post('/api/monitors', { name: 'Bad', url });
      expect([400, 422], `${url} -> ${response.status}`).toContain(response.status);
      expect(response.body.error.code).toMatch(/invalid_monitor_url|validation_failed/);
    }
    expect(await prisma.monitor.count()).toBe(0);
  });

  it('rejects an empty or overlong name', async () => {
    const user = await createVerifiedUser('names@monitored.dev');
    const client = await signIn(user);

    await client.post('/api/monitors', { name: '   ', url: 'https://example.com' }).expect(400);
    await client
      .post('/api/monitors', { name: 'x'.repeat(200), url: 'https://example.com' })
      .expect(400);
  });

  it('rejects an update with no fields', async () => {
    const user = await createVerifiedUser('noop@monitored.dev');
    const client = await signIn(user);
    const created = await client
      .post('/api/monitors', { name: 'Site', url: 'https://example.com' })
      .expect(201);
    await client.patch(`/api/monitors/${created.body.monitor.id}`, {}).expect(400);
  });

  it('leaves monitors unscheduled until the email is verified', async () => {
    const user = await createUnverifiedUser('later@monitored.dev');
    // Created through the domain layer, because the endpoint itself is gated.
    const monitor = await createMonitor({
      userId: user.id,
      name: 'Waiting',
      url: 'https://example.com',
      guard: stubDnsGuard,
    });
    expect(monitor.nextCheckAt).toBeNull();
  });
});

describe('ownership', () => {
  it('never exposes another user\'s monitor', async () => {
    const owner = await createVerifiedUser('owner@monitored.dev');
    const stranger = await createVerifiedUser('stranger@monitored.dev');

    const ownerClient = await signIn(owner);
    const created = await ownerClient
      .post('/api/monitors', { name: 'Private', url: 'https://example.com' })
      .expect(201);
    const id = created.body.monitor.id as string;

    const strangerClient = await signIn(stranger);

    // 404, not 403: a 403 would confirm the id belongs to someone.
    await strangerClient.get(`/api/monitors/${id}`).expect(404);
    await strangerClient.get(`/api/monitors/${id}/checks`).expect(404);
    await strangerClient.get(`/api/monitors/${id}/incidents`).expect(404);
    await strangerClient.patch(`/api/monitors/${id}`, { name: 'Hijacked' }).expect(404);
    await strangerClient.del(`/api/monitors/${id}`).expect(404);

    // The monitor is untouched.
    const still = await prisma.monitor.findUniqueOrThrow({ where: { id } });
    expect(still.name).toBe('Private');

    // And the stranger's own list is empty.
    const list = await strangerClient.get('/api/monitors').expect(200);
    expect(list.body.monitors).toHaveLength(0);
  });

  it('requires a session for every monitor endpoint', async () => {
    const owner = await createVerifiedUser('anon@monitored.dev');
    const ownerClient = await signIn(owner);
    const created = await ownerClient
      .post('/api/monitors', { name: 'Private', url: 'https://example.com' })
      .expect(201);
    const id = created.body.monitor.id as string;

    const anonymous = await primeClient(createClient());
    await anonymous.get('/api/monitors').expect(401);
    await anonymous.get(`/api/monitors/${id}`).expect(401);
    await anonymous.post('/api/monitors', { name: 'x', url: 'https://example.com' }).expect(401);
    await anonymous.patch(`/api/monitors/${id}`, { name: 'x' }).expect(401);
    await anonymous.del(`/api/monitors/${id}`).expect(401);
  });

  it('rejects a malformed monitor id without a database error', async () => {
    const user = await createVerifiedUser('badid@monitored.dev');
    const client = await signIn(user);
    const response = await client.get('/api/monitors/not-a-uuid').expect(400);
    expect(response.body.error.code).toBe('validation_failed');
  });
});

describe('the 3-monitor limit', () => {
  it('allows exactly three and refuses the fourth', async () => {
    const user = await createVerifiedUser('limit@monitored.dev');
    const client = await signIn(user);

    for (let index = 0; index < MAX_MONITORS_PER_USER; index += 1) {
      await client
        .post('/api/monitors', { name: `Site ${index}`, url: `https://example.com/${index}` })
        .expect(201);
    }

    const fourth = await client
      .post('/api/monitors', { name: 'One too many', url: 'https://example.com/4' })
      .expect(409);
    expect(fourth.body.error.code).toBe('monitor_limit_reached');
    expect(await prisma.monitor.count({ where: { userId: user.id } })).toBe(3);
  });

  it('holds under concurrent creation attempts', async () => {
    // Eight simultaneous creates on an empty account. A count-then-insert
    // implementation would let several through; the unique slot constraint
    // cannot.
    const user = await createVerifiedUser('race@monitored.dev');

    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, (_, index) =>
        createMonitor({
          userId: user.id,
          name: `Racer ${index}`,
          url: `https://example.com/r${index}`,
          guard: stubDnsGuard,
        }),
      ),
    );

    const created = attempts.filter((result) => result.status === 'fulfilled');
    const rejected = attempts.filter((result) => result.status === 'rejected');

    expect(created).toHaveLength(MAX_MONITORS_PER_USER);
    expect(rejected).toHaveLength(8 - MAX_MONITORS_PER_USER);
    expect(await prisma.monitor.count({ where: { userId: user.id } })).toBe(MAX_MONITORS_PER_USER);

    const slots = (
      await prisma.monitor.findMany({ where: { userId: user.id }, select: { slot: true } })
    )
      .map((row) => row.slot)
      .sort();
    expect(slots).toEqual([0, 1, 2]);
  });

  it('frees a slot when a monitor is deleted', async () => {
    const user = await createVerifiedUser('reuse@monitored.dev');
    const client = await signIn(user);

    const first = await client
      .post('/api/monitors', { name: 'A', url: 'https://example.com/a' })
      .expect(201);
    await client.post('/api/monitors', { name: 'B', url: 'https://example.com/b' }).expect(201);
    await client.post('/api/monitors', { name: 'C', url: 'https://example.com/c' }).expect(201);
    await client.post('/api/monitors', { name: 'D', url: 'https://example.com/d' }).expect(409);

    await client.del(`/api/monitors/${first.body.monitor.id}`).expect(204);
    await client.post('/api/monitors', { name: 'D', url: 'https://example.com/d' }).expect(201);
    expect(await prisma.monitor.count({ where: { userId: user.id } })).toBe(3);
  });

  it('counts each user separately', async () => {
    const first = await createVerifiedUser('multi1@monitored.dev');
    const second = await createVerifiedUser('multi2@monitored.dev');

    for (const user of [first, second]) {
      const client = await signIn(user);
      for (let index = 0; index < 3; index += 1) {
        await client
          .post('/api/monitors', { name: `S${index}`, url: `https://example.com/${index}` })
          .expect(201);
      }
    }
    expect(await prisma.monitor.count()).toBe(6);
  });

  it('cannot be exceeded by a direct database insert either', async () => {
    const user = await createVerifiedUser('dbcap@monitored.dev');
    for (let slot = 0; slot < 3; slot += 1) {
      await prisma.monitor.create({
        data: { userId: user.id, slot, name: `S${slot}`, url: 'https://example.com/' },
      });
    }
    // The CHECK constraint refuses slot 3 outright.
    await expect(
      prisma.monitor.create({
        data: { userId: user.id, slot: 3, name: 'S3', url: 'https://example.com/' },
      }),
    ).rejects.toThrow();
  });
});

describe('editing a monitor while it has history', () => {
  it('resets tracking and closes an open incident when the URL changes', async () => {
    fixture = await startFixtureServer({ status: 500 });
    const user = await createVerifiedUser('edit@monitored.dev');
    const monitor = await createMonitor({
      userId: user.id,
      name: 'Flaky',
      url: fixture.url,
      guard: loopbackGuard,
    });

    // Put the monitor into a declared outage directly, which is what three
    // failed checks would have produced.
    const incident = await prisma.incident.create({
      data: {
        monitorId: monitor.id,
        startedAt: new Date(Date.now() - 900_000),
        detectedAt: new Date(Date.now() - 300_000),
        causeKind: 'HTTP_ERROR',
        causeReason: 'Responded with HTTP 500',
      },
    });
    await prisma.monitor.update({
      where: { id: monitor.id },
      data: { state: 'DOWN', consecutiveFailures: 3, failingSince: incident.startedAt },
    });

    const client = await signIn(user);
    const updated = await client
      .patch(`/api/monitors/${monitor.id}`, { url: 'https://example.com/moved' })
      .expect(200);

    expect(updated.body.monitor.state).toBe('PENDING');
    expect(updated.body.monitor.consecutiveFailures).toBe(0);
    expect(updated.body.monitor.openIncidentId).toBeNull();

    const closed = await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } });
    expect(closed.resolvedAt).not.toBeNull();
    // Not a recovery: nothing recovered, the target changed.
    expect(closed.closeReason).toBe('MONITOR_RECONFIGURED');
    // And no recovery email was created.
    expect(await prisma.notification.count({ where: { incidentId: incident.id } })).toBe(0);
  });

  it('closes an open incident as MONITOR_PAUSED when paused, with no alert', async () => {
    const user = await createVerifiedUser('pauseincident@monitored.dev');
    const monitor = await createMonitor({
      userId: user.id,
      name: 'Paused mid-outage',
      url: 'https://example.com/',
      guard: stubDnsGuard,
    });
    const incident = await prisma.incident.create({
      data: {
        monitorId: monitor.id,
        startedAt: new Date(Date.now() - 600_000),
        detectedAt: new Date(Date.now() - 300_000),
        causeKind: 'TIMEOUT',
        causeReason: 'No response within the time limit',
      },
    });
    await prisma.monitor.update({ where: { id: monitor.id }, data: { state: 'DOWN' } });

    const client = await signIn(user);
    await client.patch(`/api/monitors/${monitor.id}`, { paused: true }).expect(200);

    const closed = await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } });
    expect(closed.closeReason).toBe('MONITOR_PAUSED');
    expect(await prisma.notification.count()).toBe(0);
  });

  it('deletes checks, incidents and notifications with the monitor', async () => {
    const user = await createVerifiedUser('cascade@monitored.dev');
    const monitor = await createMonitor({
      userId: user.id,
      name: 'Doomed',
      url: 'https://example.com/',
      guard: stubDnsGuard,
    });
    const incident = await prisma.incident.create({
      data: { monitorId: monitor.id, startedAt: new Date(), detectedAt: new Date() },
    });
    await prisma.notification.create({
      data: { incidentId: incident.id, userId: user.id, kind: 'DOWN' },
    });
    await prisma.check.create({
      data: {
        monitorId: monitor.id,
        scheduledFor: new Date(),
        startedAt: new Date(),
        checkedAt: new Date(),
        outcome: 'UP',
        statusCode: 200,
        responseTimeMs: 12,
      },
    });

    const client = await signIn(user);
    await client.del(`/api/monitors/${monitor.id}`).expect(204);

    expect(await prisma.check.count()).toBe(0);
    expect(await prisma.incident.count()).toBe(0);
    expect(await prisma.notification.count()).toBe(0);
  });
});
