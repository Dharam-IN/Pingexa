import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma.js';
import { createMonitor } from '../../src/domain/monitors.js';
import { closeQueues } from '../../src/queue/queues.js';
import { closeDatabase, resetDatabase } from '../helpers/db.js';
import { createVerifiedUser, signIn } from '../helpers/api.js';
import { stubDnsGuard } from '../helpers/fixtureServer.js';

/**
 * The read-only aggregates behind the overview and the settings alert list.
 *
 * The things worth pinning here are the ones a unit test cannot reach: that the
 * queries are scoped to the session user, that the payload stays bounded, and
 * that the response never carries a field the UI has no business showing.
 */

const MINUTE = 60_000;

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closeQueues();
  await closeDatabase();
});

/** Creates a monitor with a stubbed resolver, so no DNS or network is touched. */
async function monitorFor(userId: string, name: string, url: string) {
  return createMonitor({ userId, name, url, guard: stubDnsGuard });
}

async function recordCheck(
  monitorId: string,
  options: { minutesAgo: number; outcome: 'UP' | 'DOWN'; responseTimeMs?: number | null },
) {
  const checkedAt = new Date(Date.now() - options.minutesAgo * MINUTE);
  return prisma.check.create({
    data: {
      monitorId,
      scheduledFor: checkedAt,
      startedAt: checkedAt,
      checkedAt,
      outcome: options.outcome,
      statusCode: options.outcome === 'UP' ? 200 : 503,
      responseTimeMs: options.responseTimeMs ?? (options.outcome === 'UP' ? 120 : null),
      failureKind: options.outcome === 'UP' ? null : 'HTTP_ERROR',
      failureReason: options.outcome === 'UP' ? null : 'Responded with HTTP 503',
    },
  });
}

describe('GET /api/overview', () => {
  it('requires a session', async () => {
    const { app } = await import('../helpers/api.js');
    const request = (await import('supertest')).default;
    await request(app).get('/api/overview').expect(401);
  });

  it('summarises only the signed-in user’s monitors', async () => {
    const mine = await createVerifiedUser('overview-mine@monitored.dev');
    const theirs = await createVerifiedUser('overview-theirs@monitored.dev');

    const ours = await monitorFor(mine.id, 'Mine', 'https://example.com/mine');
    const other = await monitorFor(theirs.id, 'Theirs', 'https://example.com/theirs');

    await recordCheck(ours.id, { minutesAgo: 5, outcome: 'UP' });
    await recordCheck(other.id, { minutesAgo: 5, outcome: 'DOWN' });

    const client = await signIn(mine);
    const response = await client.get('/api/overview').expect(200);

    expect(response.body.monitors).toHaveLength(1);
    expect(response.body.monitors[0].name).toBe('Mine');
    expect(response.body.used).toBe(1);
    // The other account's failing check must not appear in any figure here.
    expect(response.body.last24h.recordedChecks).toBe(1);
    expect(response.body.last24h.downChecks).toBe(0);
    expect(response.body.last24h.monitorsWithData).toBe(1);
  });

  it('returns a well-formed payload for an account with no monitors', async () => {
    const user = await createVerifiedUser('overview-empty@monitored.dev');
    const client = await signIn(user);

    const response = await client.get('/api/overview').expect(200);
    expect(response.body.monitors).toEqual([]);
    expect(response.body.timelines).toEqual([]);
    expect(response.body.openIncidents).toEqual([]);
    expect(response.body.recentIncidents).toEqual([]);
    expect(response.body.used).toBe(0);
    expect(response.body.last24h.recordedChecks).toBe(0);
    // No data must read as absent, never as zero milliseconds.
    expect(response.body.last24h.medianResponseTimeMs).toBeNull();
  });

  it('counts recorded outcomes and reports a median only from successes', async () => {
    const user = await createVerifiedUser('overview-counts@monitored.dev');
    const monitor = await monitorFor(user.id, 'Counted', 'https://example.com/counted');

    await recordCheck(monitor.id, { minutesAgo: 10, outcome: 'UP', responseTimeMs: 100 });
    await recordCheck(monitor.id, { minutesAgo: 20, outcome: 'UP', responseTimeMs: 300 });
    await recordCheck(monitor.id, { minutesAgo: 30, outcome: 'DOWN' });
    // Outside the 24h window: must not be counted.
    await recordCheck(monitor.id, { minutesAgo: 60 * 30, outcome: 'UP', responseTimeMs: 9_000 });

    const client = await signIn(user);
    const response = await client.get('/api/overview').expect(200);

    expect(response.body.last24h.recordedChecks).toBe(3);
    expect(response.body.last24h.upChecks).toBe(2);
    expect(response.body.last24h.downChecks).toBe(1);
    expect(response.body.last24h.medianResponseTimeMs).toBe(200);
  });

  it('returns a 24-hour timeline per monitor, with gaps left as gaps', async () => {
    const user = await createVerifiedUser('overview-timeline@monitored.dev');
    const monitor = await monitorFor(user.id, 'Timeline', 'https://example.com/timeline');
    await recordCheck(monitor.id, { minutesAgo: 5, outcome: 'UP' });

    const client = await signIn(user);
    const response = await client.get('/api/overview').expect(200);

    const timeline = response.body.timelines[0];
    expect(timeline.monitorId).toBe(monitor.id);
    expect(timeline.window).toBe('24h');
    expect(timeline.buckets).toHaveLength(48);

    const withData = timeline.buckets.filter((b: { recordedChecks: number }) => b.recordedChecks > 0);
    expect(withData).toHaveLength(1);

    // Every empty bucket is an explicit absence, not an implied zero.
    const empty = timeline.buckets.filter((b: { recordedChecks: number }) => b.recordedChecks === 0);
    expect(empty).toHaveLength(47);
    expect(empty.every((b: { avgResponseTimeMs: number | null }) => b.avgResponseTimeMs === null)).toBe(
      true,
    );
  });

  it('separates incidents that are open from those that merely started recently', async () => {
    const user = await createVerifiedUser('overview-incidents@monitored.dev');
    const monitor = await monitorFor(user.id, 'Incidents', 'https://example.com/incidents');

    const openIncident = await prisma.incident.create({
      data: {
        monitorId: monitor.id,
        startedAt: new Date(Date.now() - 30 * MINUTE),
        detectedAt: new Date(Date.now() - 20 * MINUTE),
        causeKind: 'HTTP_ERROR',
        causeReason: 'Responded with HTTP 503',
      },
    });
    await prisma.incident.create({
      data: {
        monitorId: monitor.id,
        startedAt: new Date(Date.now() - 2 * 24 * 60 * MINUTE),
        detectedAt: new Date(Date.now() - 2 * 24 * 60 * MINUTE),
        resolvedAt: new Date(Date.now() - 2 * 24 * 60 * MINUTE + 10 * MINUTE),
        closeReason: 'RECOVERED',
      },
    });

    const client = await signIn(user);
    const response = await client.get('/api/overview').expect(200);

    expect(response.body.openIncidents).toHaveLength(1);
    expect(response.body.openIncidents[0].id).toBe(openIncident.id);
    expect(response.body.openIncidents[0].ongoing).toBe(true);
    // Cross-monitor lists carry the monitor's name so the UI need not join.
    expect(response.body.openIncidents[0].monitorName).toBe('Incidents');

    expect(response.body.recentIncidents).toHaveLength(2);
    expect(response.body.recentIncidents[0].id).toBe(openIncident.id);
  });

  it('bounds the recent-incident list', async () => {
    const user = await createVerifiedUser('overview-bounded@monitored.dev');
    const monitor = await monitorFor(user.id, 'Many', 'https://example.com/many');

    for (let index = 0; index < 18; index += 1) {
      const startedAt = new Date(Date.now() - (index + 1) * 60 * MINUTE);
      await prisma.incident.create({
        data: {
          monitorId: monitor.id,
          startedAt,
          detectedAt: startedAt,
          resolvedAt: new Date(startedAt.getTime() + 5 * MINUTE),
          closeReason: 'RECOVERED',
        },
      });
    }

    const client = await signIn(user);
    const response = await client.get('/api/overview').expect(200);
    expect(response.body.recentIncidents).toHaveLength(10);
  });
});

describe('GET /api/alerts', () => {
  /**
   * Each alert needs its own incident, and each of those must be closed: a
   * partial unique index allows at most one *open* incident per monitor, so
   * leaving them open would (correctly) be refused by the database.
   */
  let alertSequence = 0;
  async function alertFor(userId: string, monitorId: string, kind: 'DOWN' | 'RECOVERY') {
    alertSequence += 1;
    const startedAt = new Date(Date.now() - (20 + alertSequence) * MINUTE);
    const incident = await prisma.incident.create({
      data: {
        monitorId,
        startedAt,
        detectedAt: startedAt,
        resolvedAt: new Date(startedAt.getTime() + 5 * MINUTE),
        closeReason: 'RECOVERED',
      },
    });
    return prisma.notification.create({
      data: {
        incidentId: incident.id,
        userId,
        kind,
        status: 'SENT',
        attempts: 1,
        sentAt: new Date(),
        // Written by the worker for the operator's logs; must never be served.
        lastError: 'smtp connection reset by mail.internal.example',
      },
    });
  }

  it('requires a session', async () => {
    const { app } = await import('../helpers/api.js');
    const request = (await import('supertest')).default;
    await request(app).get('/api/alerts').expect(401);
  });

  it('returns only the signed-in user’s alerts', async () => {
    const mine = await createVerifiedUser('alerts-mine@monitored.dev');
    const theirs = await createVerifiedUser('alerts-theirs@monitored.dev');
    const ours = await monitorFor(mine.id, 'Mine', 'https://example.com/a');
    const other = await monitorFor(theirs.id, 'Theirs', 'https://example.com/b');

    await alertFor(mine.id, ours.id, 'DOWN');
    await alertFor(theirs.id, other.id, 'DOWN');

    const client = await signIn(mine);
    const response = await client.get('/api/alerts').expect(200);

    expect(response.body.alerts).toHaveLength(1);
    expect(response.body.alerts[0].monitorName).toBe('Mine');
  });

  it('never exposes the SMTP diagnostic stored against the row', async () => {
    const user = await createVerifiedUser('alerts-noleak@monitored.dev');
    const monitor = await monitorFor(user.id, 'Quiet', 'https://example.com/quiet');
    await alertFor(user.id, monitor.id, 'DOWN');

    const client = await signIn(user);
    const response = await client.get('/api/alerts').expect(200);

    // `lastError` can contain provider hostnames and raw server replies. The UI
    // needs "did it arrive", which status and attempts already answer.
    expect(response.body.alerts[0]).not.toHaveProperty('lastError');
    expect(JSON.stringify(response.body)).not.toContain('mail.internal.example');
  });

  it('honours a limit and refuses one outside the allowed range', async () => {
    const user = await createVerifiedUser('alerts-limit@monitored.dev');
    const monitor = await monitorFor(user.id, 'Limited', 'https://example.com/limited');
    for (let index = 0; index < 4; index += 1) {
      await alertFor(user.id, monitor.id, index % 2 === 0 ? 'DOWN' : 'RECOVERY');
    }

    const client = await signIn(user);

    const limited = await client.get('/api/alerts?limit=2').expect(200);
    expect(limited.body.alerts).toHaveLength(2);
    expect(limited.body.limit).toBe(2);

    const dflt = await client.get('/api/alerts').expect(200);
    expect(dflt.body.limit).toBe(20);

    // An unbounded read is not on offer.
    await client.get('/api/alerts?limit=999').expect(400);
    await client.get('/api/alerts?limit=0').expect(400);
  });

  it('returns an empty list rather than an error when nothing was ever sent', async () => {
    const user = await createVerifiedUser('alerts-none@monitored.dev');
    const client = await signIn(user);
    const response = await client.get('/api/alerts').expect(200);
    expect(response.body.alerts).toEqual([]);
  });
});
