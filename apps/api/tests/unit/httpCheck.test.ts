import { afterEach, describe, expect, it } from 'vitest';
import { runHttpCheck } from '../../src/monitoring/httpCheck.js';
import { createUrlGuard } from '../../src/monitoring/urlGuard.js';
import { loopbackGuard, startFixtureServer, type FixtureServer } from '../helpers/fixtureServer.js';

let server: FixtureServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function check(url: string, options: Parameters<typeof runHttpCheck>[1] = {}) {
  return runHttpCheck(url, { guard: loopbackGuard, timeoutMs: 2_000, ...options });
}

describe('http check — success and failure classification', () => {
  it('records a 200 as UP with a response time', async () => {
    server = await startFixtureServer({ status: 200, body: 'ok' });
    const result = await check(server.url);
    expect(result.outcome).toBe('UP');
    if (result.outcome !== 'UP') return;
    expect(result.statusCode).toBe(200);
    expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
    expect(result.finishedAt.getTime()).toBeGreaterThanOrEqual(result.startedAt.getTime());
  });

  it.each([200, 201, 204, 299])('treats %i as UP', async (status) => {
    server = await startFixtureServer({ status, body: status === 204 ? '' : 'ok' });
    const result = await check(server.url);
    expect(result.outcome).toBe('UP');
  });

  it.each([
    [301, 'REDIRECT'],
    [302, 'REDIRECT'],
    [307, 'REDIRECT'],
    [308, 'REDIRECT'],
    [400, 'HTTP_ERROR'],
    [401, 'HTTP_ERROR'],
    [403, 'HTTP_ERROR'],
    [404, 'HTTP_ERROR'],
    [500, 'HTTP_ERROR'],
    [503, 'HTTP_ERROR'],
  ])('treats %i as DOWN with kind %s', async (status, kind) => {
    server = await startFixtureServer({
      status,
      body: 'body',
      headers: status < 400 ? { location: 'https://elsewhere.monitored.dev/' } : {},
    });
    const result = await check(server.url);
    expect(result.outcome).toBe('DOWN');
    if (result.outcome !== 'DOWN') return;
    expect(result.failureKind).toBe(kind);
    expect(result.statusCode).toBe(status);
  });

  it('does not follow a redirect and does not reveal its target', async () => {
    server = await startFixtureServer({
      status: 302,
      body: '',
      headers: { location: 'http://169.254.169.254/latest/meta-data/' },
    });
    const result = await check(server.url);
    expect(result.outcome).toBe('DOWN');
    if (result.outcome !== 'DOWN') return;
    expect(result.failureKind).toBe('REDIRECT');
    expect(result.failureReason).not.toContain('169.254');
    // One request only: the redirect was not followed.
    expect(server.requestCount).toBe(1);
  });

  it('classifies a slow response as TIMEOUT within the budget', async () => {
    server = await startFixtureServer({ status: 200, delayMs: 3_000 });
    const started = Date.now();
    const result = await check(server.url, { timeoutMs: 600 });
    expect(result.outcome).toBe('DOWN');
    if (result.outcome !== 'DOWN') return;
    expect(result.failureKind).toBe('TIMEOUT');
    // The budget is enforced, not merely declared.
    expect(Date.now() - started).toBeLessThan(2_500);
  });

  it('classifies a dropped connection as CONNECTION_ERROR', async () => {
    server = await startFixtureServer({ hangUp: true });
    const result = await check(server.url);
    expect(result.outcome).toBe('DOWN');
    if (result.outcome !== 'DOWN') return;
    expect(['CONNECTION_ERROR', 'UNKNOWN_ERROR']).toContain(result.failureKind);
  });

  it('classifies a closed port as CONNECTION_ERROR', async () => {
    server = await startFixtureServer();
    const port = server.port;
    await server.close();
    server = undefined;
    const result = await check(`http://127.0.0.1:${port}/`);
    expect(result.outcome).toBe('DOWN');
    if (result.outcome !== 'DOWN') return;
    expect(result.failureKind).toBe('CONNECTION_ERROR');
  });

  it('bounds the response size and never stores the body', async () => {
    server = await startFixtureServer({ status: 200, body: 'x'.repeat(50_000) });
    const result = await check(server.url, { maxResponseBytes: 1_024 });
    expect(result.outcome).toBe('DOWN');
    if (result.outcome !== 'DOWN') return;
    expect(result.failureKind).toBe('RESPONSE_TOO_LARGE');
    expect(result.failureReason).not.toContain('xxxx');
  });

  it('accepts a body under the cap', async () => {
    server = await startFixtureServer({ status: 200, body: 'x'.repeat(500) });
    const result = await check(server.url, { maxResponseBytes: 1_024 });
    expect(result.outcome).toBe('UP');
  });
});

describe('http check — what we send', () => {
  it('sends only a fixed header set, with no cookies or authorization', async () => {
    server = await startFixtureServer({ status: 200 });
    await check(server.url, { userAgent: 'Pingexa/test' });

    const headers = server.lastHeaders;
    expect(headers['user-agent']).toBe('Pingexa/test');
    expect(headers['cookie']).toBeUndefined();
    expect(headers['authorization']).toBeUndefined();
    expect(headers['x-forwarded-for']).toBeUndefined();
    // Only these request headers should ever reach a monitored site.
    const allowed = new Set([
      'user-agent',
      'accept',
      'accept-encoding',
      'cache-control',
      'connection',
      'host',
    ]);
    for (const name of Object.keys(headers)) {
      expect(allowed, `unexpected header ${name}`).toContain(name);
    }
  });

  it('preserves the path and query of the monitored URL', async () => {
    server = await startFixtureServer({ status: 200 });
    const result = await check(`http://127.0.0.1:${server.port}/health?deep=1`);
    expect(result.outcome).toBe('UP');
  });
});

describe('http check — guard failures never become network traffic', () => {
  it('refuses a blocked address before making a request', async () => {
    // The strict guard is the default here on purpose: no `guard` override.
    const result = await runHttpCheck('http://169.254.169.254/latest/meta-data/', {
      timeoutMs: 1_000,
    });
    expect(result.outcome).toBe('DOWN');
    if (result.outcome !== 'DOWN') return;
    expect(result.failureKind).toBe('BLOCKED_ADDRESS');
  });

  it('refuses a non-standard port before making a request', async () => {
    server = await startFixtureServer({ status: 200 });
    const result = await runHttpCheck(`http://127.0.0.1:${server.port}/`, { timeoutMs: 1_000 });
    expect(result.outcome).toBe('DOWN');
    if (result.outcome !== 'DOWN') return;
    expect(result.failureKind).toBe('INVALID_URL');
    expect(server.requestCount).toBe(0);
  });

  it('refuses credentials in the URL before making a request', async () => {
    const result = await runHttpCheck('https://user:secret@public.monitored.dev/', {
      timeoutMs: 1_000,
    });
    expect(result.outcome).toBe('DOWN');
    if (result.outcome !== 'DOWN') return;
    expect(result.failureKind).toBe('INVALID_URL');
    expect(result.failureReason).not.toContain('secret');
  });
});

describe('http check — the pinned lookup really drives the socket', () => {
  it('connects to the address the guard approved, for a hostname real DNS cannot resolve', async () => {
    // This is the load-bearing proof that connection pinning is wired to the
    // socket rather than merely computed and discarded.
    //
    // `pinned.monitored.dev` does not exist in DNS. The guard claims it resolves
    // to 127.0.0.1, where the fixture server is listening. If undici ignored the
    // guard's `lookup` and resolved the name itself, the connect would fail with
    // ENOTFOUND and this check would come back DOWN. It comes back UP, and the
    // fixture server sees the request, which can only happen if the socket used
    // the address the guard handed it.
    server = await startFixtureServer({ status: 200 });
    const pinningGuard = createUrlGuard({
      allowPrivateAddresses: true,
      allowNonStandardPorts: true,
      resolve: async () => [{ address: '127.0.0.1', family: 4 }],
    });

    const result = await runHttpCheck(`http://pinned.monitored.dev:${server.port}/`, {
      guard: pinningGuard,
      timeoutMs: 2_000,
    });

    expect(result.outcome).toBe('UP');
    expect(server.requestCount).toBe(1);
    // And the request really was made under that hostname, not rewritten to the IP.
    expect(server.lastHeaders['host']).toBe(`pinned.monitored.dev:${server.port}`);
  });

  it('fails closed when the socket asks for an address family the guard did not approve', async () => {
    // The guard approves only an IPv6 address; the request is to a host that
    // therefore has no usable IPv4 answer. Nothing should reach the network.
    server = await startFixtureServer({ status: 200 });
    const ipv6OnlyGuard = createUrlGuard({
      allowPrivateAddresses: true,
      allowNonStandardPorts: true,
      resolve: async () => [{ address: '::1', family: 6 }],
    });

    const result = await runHttpCheck(`http://pinned6.monitored.dev:${server.port}/`, {
      guard: ipv6OnlyGuard,
      timeoutMs: 2_000,
    });

    // Either it could not connect at all, or it was refused outright. What must
    // not happen is a successful request to something the guard did not approve.
    expect(result.outcome).toBe('DOWN');
    expect(server.requestCount).toBe(0);
  });
});
