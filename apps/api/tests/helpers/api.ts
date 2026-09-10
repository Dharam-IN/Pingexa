import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../src/http/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { hashPassword } from '../../src/lib/crypto.js';
import { CSRF_COOKIE, SESSION_COOKIE } from '../../src/http/cookies.js';

export const app: Express = createApp();

/**
 * A supertest client that behaves like a browser: it keeps cookies and echoes
 * the CSRF cookie back in the header, so tests exercise the real middleware
 * chain rather than bypassing it.
 */
export interface Client {
  get(path: string): request.Test;
  post(path: string, body?: unknown): request.Test;
  patch(path: string, body?: unknown): request.Test;
  del(path: string): request.Test;
  /** Raw request without the CSRF header, for testing that CSRF is enforced. */
  postWithoutCsrf(path: string, body?: unknown): request.Test;
  cookies: string[];
  csrfToken: string;
}

function parseSetCookie(header: string[] | string | undefined, jar: Map<string, string>): void {
  if (!header) return;
  const list = Array.isArray(header) ? header : [header];
  for (const raw of list) {
    const pair = raw.split(';')[0] ?? '';
    const index = pair.indexOf('=');
    if (index <= 0) continue;
    const name = pair.slice(0, index);
    const value = pair.slice(index + 1);
    if (value === '') jar.delete(name);
    else jar.set(name, value);
  }
}

export function createClient(): Client {
  const jar = new Map<string, string>();

  const cookieHeader = () =>
    [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');

  const track = (test: request.Test): request.Test => {
    // superagent emits `response` without consuming the request, so the Test
    // stays chainable and `.expect(...)` still works in the test bodies.
    test.on('response', (response: { headers: Record<string, string[] | string> }) => {
      parseSetCookie(response.headers['set-cookie'], jar);
    });
    return test;
  };

  const withCsrf = (test: request.Test) => {
    const token = jar.get(CSRF_COOKIE);
    const cookies = cookieHeader();
    if (cookies) test.set('Cookie', cookies);
    if (token) test.set('X-CSRF-Token', token);
    test.set('Origin', 'http://localhost:5173');
    return track(test);
  };

  return {
    get(path) {
      const test = request(app).get(path);
      const cookies = cookieHeader();
      if (cookies) test.set('Cookie', cookies);
      return track(test);
    },
    post(path, body) {
      return withCsrf(request(app).post(path).send(body as object));
    },
    patch(path, body) {
      return withCsrf(request(app).patch(path).send(body as object));
    },
    del(path) {
      return withCsrf(request(app).delete(path));
    },
    postWithoutCsrf(path, body) {
      const test = request(app).post(path).send(body as object);
      const cookies = cookieHeader();
      if (cookies) test.set('Cookie', cookies);
      return track(test);
    },
    get cookies() {
      return [...jar.entries()].map(([name, value]) => `${name}=${value}`);
    },
    get csrfToken() {
      return jar.get(CSRF_COOKIE) ?? '';
    },
  };
}

/** Primes the CSRF cookie the way a first page load would. */
export async function primeClient(client: Client): Promise<Client> {
  await client.get('/api/meta').expect(200);
  return client;
}

export interface TestUser {
  readonly id: string;
  readonly email: string;
  readonly password: string;
}

/**
 * Creates a user directly in the database. Used when a test is about something
 * other than the signup flow itself; the signup flow has its own tests.
 */
export async function createVerifiedUser(
  email: string,
  password = 'test-password-123',
): Promise<TestUser> {
  const user = await prisma.user.create({
    data: { email, passwordHash: await hashPassword(password), emailVerifiedAt: new Date() },
    select: { id: true, email: true },
  });
  return { id: user.id, email: user.email, password };
}

export async function createUnverifiedUser(
  email: string,
  password = 'test-password-123',
): Promise<TestUser> {
  const user = await prisma.user.create({
    data: { email, passwordHash: await hashPassword(password) },
    select: { id: true, email: true },
  });
  return { id: user.id, email: user.email, password };
}

/** Signs a user in through the real login endpoint. */
export async function signIn(user: TestUser): Promise<Client> {
  const client = await primeClient(createClient());
  await client.post('/api/auth/login', { email: user.email, password: user.password }).expect(200);
  return client;
}

export { SESSION_COOKIE, CSRF_COOKIE };
