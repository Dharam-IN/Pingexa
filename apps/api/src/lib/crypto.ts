import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2';
import { env } from '../config/env.js';

/**
 * Argon2id parameters. 19 MiB / 2 iterations / 1 lane is the OWASP-recommended
 * baseline and takes roughly 40-60 ms on a modern CPU, which is slow enough to
 * be expensive to attack and fast enough for a login request.
 */
/**
 * `@node-rs/argon2` declares `Algorithm` as an ambient `const enum`, which has no
 * runtime value to import, so the variant is written out. Argon2id is 2.
 */
const ARGON2ID = 2;

const ARGON2_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return argon2Hash(password, ARGON2_OPTIONS);
}

/**
 * Verifies a password. Returns false rather than throwing when the stored hash
 * is malformed, so a corrupt row cannot turn into a 500 on the login path.
 */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2Verify(hash, password);
  } catch {
    return false;
  }
}

/** 32 bytes of CSPRNG output, URL-safe. Used for session and email tokens. */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

/** 16 bytes as hex. Used for status page slugs (32 characters, unguessable). */
export function generateSlug(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Keyed hash for values we store but must be able to look up: session tokens and
 * email tokens. HMAC with `SESSION_SECRET` (rather than a bare SHA-256) means a
 * stolen database dump cannot be brute-forced offline into working tokens
 * without also stealing the application secret.
 */
export function hashToken(token: string): string {
  return createHmac('sha256', env.SESSION_SECRET).update(token).digest('hex');
}

/** Constant-time comparison of two same-purpose strings (CSRF tokens). */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Short, non-reversible tag for a user agent string, stored so a user can tell
 * their sessions apart without us keeping the raw fingerprint.
 */
export function userAgentTag(userAgent: string | undefined): string | null {
  if (!userAgent) return null;
  return userAgent.slice(0, 80).replace(/[^\x20-\x7E]/g, '');
}
