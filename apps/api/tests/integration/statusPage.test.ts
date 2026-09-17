import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma.js';
import { createMonitor } from '../../src/domain/monitors.js';
import { closeQueues } from '../../src/queue/queues.js';
import { closeDatabase, resetDatabase } from '../helpers/db.js';
import { createClient, createVerifiedUser, primeClient, signIn } from '../helpers/api.js';
import { stubDnsGuard } from '../helpers/fixtureServer.js';

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closeQueues();
  await closeDatabase();
});

async function ownerWithMonitors(email: string) {
  const user = await createVerifiedUser(email);
  const publicMonitor = await createMonitor({
    userId: user.id,
    name: 'Marketing site',
    url: 'https://public.example.com/',
    isPublic: true,
    guard: stubDnsGuard,
  });
  const privateMonitor = await createMonitor({
    userId: user.id,
    name: 'Internal admin',
    url: 'https://admin.example.com/very-secret-path',
    guard: stubDnsGuard,
  });
  return { user, publicMonitor, privateMonitor };
}

/**
 * Every value in a JSON response, with a readable path, so a privacy assertion
 * can be made against the parsed body rather than against its text.
 */
function* walkNodes(value: unknown, path = '$'): Generator<{ path: string; value: unknown }> {
  yield { path, value };

  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) yield* walkNodes(item, `${path}[${index}]`);
    return;
  }

  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) yield* walkNodes(child, `${path}.${key}`);
  }
}

/**
 * Asserts an object carries exactly the fields listed and nothing else.
 *
 * Used on the public status page, where the risk is not a known secret slipping
 * through a filter but an *unknown* one arriving later: a field added to the
 * projection in good faith that happens to carry a URL, an address or an
 * upstream error. Comparing the sorted key set makes that a test failure rather
 * than a silent disclosure.
 */
function expectExactKeys(value: unknown, path: string, allowed: readonly string[]): void {
  expect(value, `${path} should be an object`).toBeTypeOf('object');
  expect(value, `${path} should not be null`).not.toBeNull();
  expect(Object.keys(value as object).sort(), `${path} has unexpected fields`).toEqual(
    [...allowed].sort(),
  );
}

describe('status page settings', () => {
  it('creates an unpublished page with an unguessable slug on first read', async () => {
    const user = await createVerifiedUser('sp@monitored.dev');
    const client = await signIn(user);

    const response = await client.get('/api/status-page').expect(200);
    const page = response.body.statusPage;
    expect(page.published).toBe(false);
    expect(page.slug).toMatch(/^[0-9a-f]{32}$/);
    expect(page.publicUrl).toBe(`http://localhost:5173/status/${page.slug}`);
    expect(page.publishedMonitorIds).toEqual([]);

    // Reading again returns the same page, not a new one.
    const again = await client.get('/api/status-page').expect(200);
    expect(again.body.statusPage.slug).toBe(page.slug);
    expect(await prisma.statusPage.count()).toBe(1);
  });

  it('publishes, renames, and unpublishes', async () => {
    const user = await createVerifiedUser('sppublish@monitored.dev');
    const client = await signIn(user);
    await client.get('/api/status-page').expect(200);

    const published = await client
      .patch('/api/status-page', { published: true, title: 'Acme status' })
      .expect(200);
    expect(published.body.statusPage.published).toBe(true);
    expect(published.body.statusPage.title).toBe('Acme status');

    const unpublished = await client.patch('/api/status-page', { published: false }).expect(200);
    expect(unpublished.body.statusPage.published).toBe(false);
  });

  it('rotates the slug so an old link stops working', async () => {
    const { user, publicMonitor } = await ownerWithMonitors('sprotate@monitored.dev');
    void publicMonitor;
    const client = await signIn(user);
    const before = (await client.get('/api/status-page').expect(200)).body.statusPage.slug;
    await client.patch('/api/status-page', { published: true }).expect(200);

    const anonymous = await primeClient(createClient());
    await anonymous.get(`/api/public/status/${before}`).expect(200);

    const rotated = (await client.post('/api/status-page/rotate-slug').expect(200)).body.statusPage;
    expect(rotated.slug).not.toBe(before);

    await anonymous.get(`/api/public/status/${before}`).expect(404);
    await anonymous.get(`/api/public/status/${rotated.slug}`).expect(200);
  });

  it('requires a session', async () => {
    const anonymous = await primeClient(createClient());
    await anonymous.get('/api/status-page').expect(401);
    await anonymous.patch('/api/status-page', { published: true }).expect(401);
    await anonymous.post('/api/status-page/rotate-slug').expect(401);
  });

  it('rejects an empty or overlong title', async () => {
    const user = await createVerifiedUser('sptitle@monitored.dev');
    const client = await signIn(user);
    await client.get('/api/status-page').expect(200);
    await client.patch('/api/status-page', { title: '   ' }).expect(400);
    await client.patch('/api/status-page', { title: 'x'.repeat(200) }).expect(400);
  });
});

describe('public status page', () => {
  it('shows only monitors the owner explicitly published', async () => {
    const { user, publicMonitor, privateMonitor } = await ownerWithMonitors('sponly@monitored.dev');
    const client = await signIn(user);
    const page = (await client.get('/api/status-page').expect(200)).body.statusPage;
    await client.patch('/api/status-page', { published: true, title: 'Acme status' }).expect(200);

    const anonymous = await primeClient(createClient());
    const response = await anonymous.get(`/api/public/status/${page.slug}`).expect(200);

    expect(response.body.title).toBe('Acme status');
    expect(response.body.monitors).toHaveLength(1);
    expect(response.body.monitors[0].id).toBe(publicMonitor.id);
    expect(response.body.monitors[0].name).toBe('Marketing site');
    // The unpublished monitor is absent by id and by name.
    const serialised = JSON.stringify(response.body);
    expect(serialised).not.toContain(privateMonitor.id);
    expect(serialised).not.toContain('Internal admin');
  });

  it('never exposes URLs, emails, slugs, status codes or failure detail', async () => {
    const { user, publicMonitor } = await ownerWithMonitors('spprivacy@monitored.dev');
    // Give the published monitor a failure with a revealing reason.
    await prisma.monitor.update({
      where: { id: publicMonitor.id },
      data: {
        state: 'DOWN',
        lastStatusCode: 503,
        lastFailureKind: 'HTTP_ERROR',
        lastFailureReason: 'Responded with HTTP 503 from origin-7.internal',
        lastCheckedAt: new Date(),
        consecutiveFailures: 3,
      },
    });
    const incident = await prisma.incident.create({
      data: {
        monitorId: publicMonitor.id,
        startedAt: new Date(Date.now() - 600_000),
        detectedAt: new Date(Date.now() - 300_000),
        causeKind: 'HTTP_ERROR',
        causeReason: 'Responded with HTTP 503 from origin-7.internal',
      },
    });

    const client = await signIn(user);
    const page = (await client.get('/api/status-page').expect(200)).body.statusPage;
    await client.patch('/api/status-page', { published: true }).expect(200);

    const anonymous = await primeClient(createClient());
    const response = await anonymous.get(`/api/public/status/${page.slug}`).expect(200);
    const serialised = JSON.stringify(response.body);

    for (const secret of [
      'public.example.com',
      'admin.example.com',
      'very-secret-path',
      'spprivacy@monitored.dev',
      'origin-7.internal',
      'HTTP 503',
      'HTTP_ERROR',
      page.slug,
    ]) {
      expect(serialised, `leaked ${secret}`).not.toContain(secret);
    }

    /*
     * The status code is asserted structurally, not by substring.
     *
     * A bare `.not.toContain('503')` used to sit in the list above, and it was
     * a false positive waiting to happen: this body legitimately carries a UUID
     * incident id and six millisecond-precision ISO timestamps (`generatedAt`,
     * `windowStart`/`windowEnd` on both uptime windows, and the incident's
     * `startedAt`). Any `.503Z` millisecond value, or a UUID that happened to
     * contain `503`, failed the test for no reason — about one run in seventy.
     *
     * Replacing it with an exact-shape assertion is both immune to that and
     * strictly stronger than the substring ever was. A substring list can only
     * catch the leaks somebody thought to enumerate; this catches *any* new
     * field appearing in the public projection, whatever it is called and
     * whatever it contains. Adding a field here is meant to be a deliberate act
     * that updates this allowlist — that is the point of the boundary.
     */
    expectExactKeys(response.body, '$', [
      'title',
      'generatedAt',
      'overall',
      'monitors',
      'intervalSeconds',
    ]);

    for (const [index, monitor] of (response.body.monitors as unknown[]).entries()) {
      const at = `$.monitors[${index}]`;
      expectExactKeys(monitor, at, [
        'id',
        'name',
        'displayState',
        'lastCheckedAt',
        'uptime24h',
        'uptime7d',
        'recentIncidents',
      ]);

      const summary = monitor as Record<string, unknown>;
      for (const window of ['uptime24h', 'uptime7d']) {
        expectExactKeys(summary[window], `${at}.${window}`, [
          'window',
          'windowStart',
          'windowEnd',
          'upChecks',
          'downChecks',
          'recordedChecks',
          'expectedChecks',
          'uptimePercent',
          'coveragePercent',
          'partialData',
        ]);
      }

      for (const [i, incident] of (summary['recentIncidents'] as unknown[]).entries()) {
        expectExactKeys(incident, `${at}.recentIncidents[${i}]`, [
          'id',
          'startedAt',
          'resolvedAt',
          'durationSeconds',
          'ongoing',
        ]);
      }
    }

    /*
     * The shape check above cannot see a status code smuggled into a field that
     * legitimately exists, so also assert no value anywhere *is* the code. This
     * is the type-aware version of the old substring check: it matches the
     * number 503 and the string "503", and cannot be tripped by a UUID or a
     * timestamp that merely contains those digits.
     */
    for (const node of walkNodes(response.body)) {
      expect(node.value, `${node.path} exposes the upstream status code`).not.toBe(503);
      expect(node.value, `${node.path} exposes the upstream status code`).not.toBe('503');
    }

    // What it *does* show: name, state, uptime and incident timing.
    expect(response.body.monitors[0].displayState).toBe('DOWN');
    expect(response.body.monitors[0].recentIncidents[0].id).toBe(incident.id);
    expect(response.body.monitors[0].recentIncidents[0].ongoing).toBe(true);
    expect(response.body.overall).toBe('DOWN');
  });

  it('returns 404 for an unpublished page, an unknown slug, and a malformed slug', async () => {
    const { user } = await ownerWithMonitors('spunpublished@monitored.dev');
    const client = await signIn(user);
    const page = (await client.get('/api/status-page').expect(200)).body.statusPage;

    const anonymous = await primeClient(createClient());
    // Never published.
    await anonymous.get(`/api/public/status/${page.slug}`).expect(404);
    await anonymous.get(`/api/public/status/${'0'.repeat(32)}`).expect(404);
    await anonymous.get('/api/public/status/short').expect(404);
    await anonymous.get('/api/public/status/..%2F..%2Fetc%2Fpasswd').expect(404);
  });

  it('removes public access as soon as the page is unpublished', async () => {
    const { user } = await ownerWithMonitors('sprevoke@monitored.dev');
    const client = await signIn(user);
    const page = (await client.get('/api/status-page').expect(200)).body.statusPage;
    await client.patch('/api/status-page', { published: true }).expect(200);

    const anonymous = await primeClient(createClient());
    await anonymous.get(`/api/public/status/${page.slug}`).expect(200);

    await client.patch('/api/status-page', { published: false }).expect(200);
    await anonymous.get(`/api/public/status/${page.slug}`).expect(404);
  });

  it('drops a monitor from the page as soon as it is unpublished', async () => {
    const { user, publicMonitor } = await ownerWithMonitors('spdeselect@monitored.dev');
    const client = await signIn(user);
    const page = (await client.get('/api/status-page').expect(200)).body.statusPage;
    await client.patch('/api/status-page', { published: true }).expect(200);

    const anonymous = await primeClient(createClient());
    const withMonitor = await anonymous.get(`/api/public/status/${page.slug}`).expect(200);
    expect(withMonitor.body.monitors).toHaveLength(1);

    await client.patch(`/api/monitors/${publicMonitor.id}`, { isPublic: false }).expect(200);

    const without = await anonymous.get(`/api/public/status/${page.slug}`).expect(200);
    expect(without.body.monitors).toHaveLength(0);
    expect(without.body.overall).toBe('UNKNOWN');
  });

  it('does not mix monitors from different users', async () => {
    const first = await ownerWithMonitors('spuser1@monitored.dev');
    const second = await ownerWithMonitors('spuser2@monitored.dev');

    const firstClient = await signIn(first.user);
    const firstPage = (await firstClient.get('/api/status-page').expect(200)).body.statusPage;
    await firstClient.patch('/api/status-page', { published: true }).expect(200);

    const anonymous = await primeClient(createClient());
    const response = await anonymous.get(`/api/public/status/${firstPage.slug}`).expect(200);
    expect(response.body.monitors).toHaveLength(1);
    expect(response.body.monitors[0].id).toBe(first.publicMonitor.id);
    expect(JSON.stringify(response.body)).not.toContain(second.publicMonitor.id);
  });

  it('reports a mixed page as degraded', async () => {
    const user = await createVerifiedUser('spmixed@monitored.dev');
    const up = await createMonitor({
      userId: user.id,
      name: 'Up site',
      url: 'https://up.example.com/',
      isPublic: true,
      guard: stubDnsGuard,
    });
    const down = await createMonitor({
      userId: user.id,
      name: 'Down site',
      url: 'https://down.example.com/',
      isPublic: true,
      guard: stubDnsGuard,
    });
    await prisma.monitor.update({
      where: { id: up.id },
      data: { state: 'UP', lastCheckedAt: new Date() },
    });
    await prisma.monitor.update({
      where: { id: down.id },
      data: { state: 'DOWN', lastCheckedAt: new Date() },
    });

    const client = await signIn(user);
    const page = (await client.get('/api/status-page').expect(200)).body.statusPage;
    await client.patch('/api/status-page', { published: true }).expect(200);

    const anonymous = await primeClient(createClient());
    const response = await anonymous.get(`/api/public/status/${page.slug}`).expect(200);
    expect(response.body.overall).toBe('DEGRADED');
    expect(response.body.intervalSeconds).toBe(300);
  });

  it('does not require a session or a CSRF token', async () => {
    const { user } = await ownerWithMonitors('spanon@monitored.dev');
    const client = await signIn(user);
    const page = (await client.get('/api/status-page').expect(200)).body.statusPage;
    await client.patch('/api/status-page', { published: true }).expect(200);

    // A bare client with no cookies at all.
    const bare = createClient();
    await bare.get(`/api/public/status/${page.slug}`).expect(200);
  });
});
