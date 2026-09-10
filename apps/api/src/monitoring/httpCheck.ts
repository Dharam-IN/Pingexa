import { Client } from 'undici';
import type { FailureKind } from '@pingexa/shared';
import { env } from '../config/env.js';
import type { UrlGuard } from './urlGuard.js';
import { strictUrlGuard } from './urlGuard.js';

/**
 * Executes one outbound uptime check.
 *
 * Rules, all of them deliberate:
 *  * GET only, with a fixed header set. No cookies, no authorization header, no
 *    user-supplied headers are ever forwarded to a monitored site.
 *  * Redirects are not followed (see docs/DECISIONS.md D7). A 3xx is a failure
 *    with kind REDIRECT.
 *  * TLS verification is always on and cannot be configured off.
 *  * Three bounds: a total time budget, a response-byte cap, and one connection
 *    per check.
 *  * The response body is read only to enforce the byte cap and is then thrown
 *    away. Nothing from a response body is stored or logged.
 */

export interface HttpCheckOptions {
  /** Total budget for the whole check, in milliseconds. */
  readonly timeoutMs?: number;
  /** Response bytes read before aborting. */
  readonly maxResponseBytes?: number;
  readonly userAgent?: string;
  /** Injected in tests. Production always gets the strict guard. */
  readonly guard?: UrlGuard;
}

export interface HttpCheckSuccess {
  readonly outcome: 'UP';
  readonly statusCode: number;
  /** Time to response headers, in milliseconds. */
  readonly responseTimeMs: number;
  readonly startedAt: Date;
  readonly finishedAt: Date;
}

export interface HttpCheckFailure {
  readonly outcome: 'DOWN';
  readonly failureKind: FailureKind;
  /** Short, safe explanation. Contains no response body and no secrets. */
  readonly failureReason: string;
  readonly statusCode: number | null;
  readonly responseTimeMs: number | null;
  readonly startedAt: Date;
  readonly finishedAt: Date;
}

export type HttpCheckResult = HttpCheckSuccess | HttpCheckFailure;

const GUARD_CODE_TO_FAILURE: Record<string, FailureKind> = {
  invalid_url: 'INVALID_URL',
  unsupported_scheme: 'INVALID_URL',
  credentials_in_url: 'INVALID_URL',
  non_standard_port: 'INVALID_URL',
  internal_hostname: 'BLOCKED_ADDRESS',
  dns_failure: 'DNS_ERROR',
  blocked_address: 'BLOCKED_ADDRESS',
};

const TIMEOUT_CODES = new Set([
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_ABORTED',
  'ABORT_ERR',
]);

const DNS_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'EAI_NODATA', 'EAI_NONAME']);

const CONNECTION_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENETDOWN',
  'EPIPE',
  'ETIMEDOUT',
  'EADDRNOTAVAIL',
  'UND_ERR_SOCKET',
  'UND_ERR_CLOSED',
  'UND_ERR_DESTROYED',
]);

const TLS_CODES = new Set([
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'ERR_SSL_WRONG_VERSION_NUMBER',
  'ERR_SSL_PACKET_LENGTH_TOO_LONG',
  'HOSTNAME_MISMATCH',
  'ERR_TLS_HANDSHAKE_TIMEOUT',
]);

interface ErrorLike {
  code?: string;
  message?: string;
  name?: string;
  cause?: unknown;
}

/** Walks `cause` chains, because undici wraps socket errors. */
function collectCodes(error: unknown, depth = 0): string[] {
  if (depth > 5 || typeof error !== 'object' || error === null) return [];
  const err = error as ErrorLike;
  const codes: string[] = [];
  if (typeof err.code === 'string') codes.push(err.code);
  if (typeof err.name === 'string') codes.push(err.name);
  return [...codes, ...collectCodes(err.cause, depth + 1)];
}

function classifyTransportError(error: unknown): { kind: FailureKind; reason: string } {
  const codes = collectCodes(error);
  const message = error instanceof Error ? error.message : String(error);

  // Our pinned lookup refuses to answer for anything but the approved addresses.
  if (message.includes('Refusing to resolve') || message.includes('No approved address')) {
    return { kind: 'BLOCKED_ADDRESS', reason: 'Connection blocked: address was not approved' };
  }
  for (const code of codes) {
    if (TIMEOUT_CODES.has(code)) {
      return { kind: 'TIMEOUT', reason: 'No response within the time limit' };
    }
    if (TLS_CODES.has(code)) {
      return { kind: 'TLS_ERROR', reason: `TLS verification failed (${code})` };
    }
    if (DNS_CODES.has(code)) {
      return { kind: 'DNS_ERROR', reason: `DNS lookup failed (${code})` };
    }
    if (CONNECTION_CODES.has(code)) {
      return { kind: 'CONNECTION_ERROR', reason: `Could not connect (${code})` };
    }
  }
  const first = codes[0];
  return {
    kind: 'UNKNOWN_ERROR',
    reason: first ? `Check failed (${first})` : 'Check failed for an unrecognised reason',
  };
}

export async function runHttpCheck(
  rawUrl: string,
  options: HttpCheckOptions = {},
): Promise<HttpCheckResult> {
  const guard = options.guard ?? strictUrlGuard;
  const timeoutMs = options.timeoutMs ?? env.MONITOR_TIMEOUT_MS;
  const maxResponseBytes = options.maxResponseBytes ?? env.MONITOR_MAX_RESPONSE_BYTES;
  const userAgent = options.userAgent ?? env.MONITOR_USER_AGENT;

  const startedAt = new Date();
  const startedHr = performance.now();
  const fail = (failureKind: FailureKind, failureReason: string, statusCode: number | null = null, responseTimeMs: number | null = null): HttpCheckFailure => ({
    outcome: 'DOWN',
    failureKind,
    failureReason,
    statusCode,
    responseTimeMs,
    startedAt,
    finishedAt: new Date(),
  });

  const approval = await guard.check(rawUrl);
  if (!approval.ok) {
    return fail(GUARD_CODE_TO_FAILURE[approval.code] ?? 'BLOCKED_ADDRESS', approval.message);
  }

  const origin = `${approval.protocol}//${
    approval.hostname.includes(':') ? `[${approval.hostname}]` : approval.hostname
  }:${approval.port}`;

  const client = new Client(origin, {
    connect: {
      // The connection may only go to an address the guard already approved.
      lookup: approval.pinnedLookup,
      // Non-negotiable. There is no configuration path that turns this off.
      rejectUnauthorized: true,
      servername: approval.protocol === 'https:' ? approval.hostname : undefined,
      timeout: Math.min(timeoutMs, 10_000),
    },
    // One socket per check keeps outbound concurrency equal to worker concurrency.
    pipelining: 0,
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
    maxResponseSize: maxResponseBytes,
  });

  const abort = new AbortController();
  const budget = setTimeout(() => abort.abort(), timeoutMs);

  try {
    const response = await client.request({
      method: 'GET',
      path: pathWithQuery(approval.url),
      headers: {
        // A fixed, minimal header set. Nothing here comes from the user.
        'user-agent': userAgent,
        accept: '*/*',
        'accept-encoding': 'identity',
        // Ask intermediaries for a real answer rather than a cached one.
        'cache-control': 'no-cache',
        connection: 'close',
      },
      signal: abort.signal,
    });
    // A bare undici `Client` never follows redirects — following them requires
    // opting into the redirect interceptor, which V1 deliberately does not do
    // (see docs/DECISIONS.md D7). A 3xx therefore arrives here as a status code.

    const responseTimeMs = Math.round(performance.now() - startedHr);
    const statusCode = response.statusCode;

    // Drain (and discard) the body so the socket closes cleanly, stopping at the
    // byte cap. Nothing read here is kept.
    const drain = await drainBounded(response.body, maxResponseBytes);

    if (drain === 'too-large') {
      return fail(
        'RESPONSE_TOO_LARGE',
        `Response exceeded the ${maxResponseBytes} byte limit`,
        statusCode,
        responseTimeMs,
      );
    }

    if (statusCode >= 200 && statusCode <= 299) {
      return { outcome: 'UP', statusCode, responseTimeMs, startedAt, finishedAt: new Date() };
    }
    if (statusCode >= 300 && statusCode <= 399) {
      return fail(
        'REDIRECT',
        `Redirected (HTTP ${statusCode}); Pingexa does not follow redirects`,
        statusCode,
        responseTimeMs,
      );
    }
    return fail('HTTP_ERROR', `Responded with HTTP ${statusCode}`, statusCode, responseTimeMs);
  } catch (error) {
    if (abort.signal.aborted) {
      return fail('TIMEOUT', `No response within ${timeoutMs} ms`);
    }
    const { kind, reason } = classifyTransportError(error);
    return fail(kind, reason);
  } finally {
    clearTimeout(budget);
    await client.close().catch(() => client.destroy());
  }
}

function pathWithQuery(absoluteUrl: string): string {
  const url = new URL(absoluteUrl);
  return `${url.pathname}${url.search}`;
}

/**
 * Reads and discards a response body, stopping as soon as the cap is exceeded.
 * Returns `'too-large'` if the cap was hit, `'ok'` otherwise.
 */
async function drainBounded(
  body: AsyncIterable<Uint8Array> & { destroy?: (error?: Error) => void },
  maxBytes: number,
): Promise<'ok' | 'too-large'> {
  let seen = 0;
  try {
    for await (const chunk of body) {
      seen += chunk.byteLength;
      if (seen > maxBytes) {
        body.destroy?.();
        return 'too-large';
      }
    }
    return 'ok';
  } catch (error) {
    // undici raises this when maxResponseSize is exceeded.
    const codes = collectCodes(error);
    if (codes.includes('UND_ERR_RES_EXCEEDED_MAX_SIZE')) return 'too-large';
    // A body that fails midway does not change the verdict: we already have the
    // status line, which is what an uptime check is about.
    return 'ok';
  }
}
