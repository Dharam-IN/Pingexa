import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';
import type { LookupFunction } from 'node:net';
import { classifyAddress } from './ipRanges.js';

/**
 * SSRF guard for user-supplied monitor URLs.
 *
 * Three separate jobs, in this order:
 *  1. Shape: scheme, no embedded credentials, standard port, no internal-only
 *     hostname suffix.
 *  2. Resolution: resolve every A/AAAA record and refuse the URL unless at least
 *     one answer is an ordinary globally routable address. Any non-routable
 *     answer refuses the whole URL rather than just being filtered out, so a
 *     host that answers with both a public and a private address cannot be used
 *     to probe the private one.
 *  3. Pinning: hand back a `lookup` function that can only ever return the
 *     addresses approved in step 2. Without this, the socket re-resolves the
 *     hostname and a short-TTL record can point the connection somewhere else
 *     between validation and connect (DNS rebinding).
 *
 * There is deliberately no environment variable that relaxes any of this. Tests
 * that need to reach a loopback fixture construct their own guard with
 * `allowPrivateAddresses: true`; production code always uses `strictUrlGuard`.
 */

export interface UrlGuardPolicy {
  /**
   * Test-only escape hatch. Set by unit/integration tests that run a fixture
   * HTTP server on 127.0.0.1. Never set from configuration.
   */
  readonly allowPrivateAddresses?: boolean;
  /**
   * Test-only escape hatch, for the same reason: a fixture server binds to an
   * ephemeral port. Never set from configuration.
   */
  readonly allowNonStandardPorts?: boolean;
  /** Override DNS resolution, so guard behaviour can be tested without a network. */
  readonly resolve?: (hostname: string) => Promise<ResolvedAddress[]>;
}

export interface ResolvedAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

export type UrlRejectionCode =
  | 'invalid_url'
  | 'unsupported_scheme'
  | 'credentials_in_url'
  | 'non_standard_port'
  | 'internal_hostname'
  | 'dns_failure'
  | 'blocked_address';

export interface UrlRejection {
  readonly ok: false;
  readonly code: UrlRejectionCode;
  /** Safe to show the monitor's owner; contains no response data. */
  readonly message: string;
}

export interface UrlApproval {
  readonly ok: true;
  /** Normalised absolute URL to request. */
  readonly url: string;
  readonly hostname: string;
  readonly port: number;
  readonly protocol: 'http:' | 'https:';
  /** Addresses the connection is allowed to use. Never empty. */
  readonly addresses: readonly ResolvedAddress[];
  /**
   * DNS lookup pinned to `addresses`. Pass this to the HTTP client so the socket
   * cannot resolve the hostname a second time.
   */
  readonly pinnedLookup: LookupFunction;
}

export type UrlGuardResult = UrlApproval | UrlRejection;

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const DEFAULT_PORTS: Record<string, number> = { 'http:': 80, 'https:': 443 };

/**
 * Hostname suffixes that only ever name something inside a network. Blocked by
 * name as well as by address, because a split-horizon resolver can answer these
 * with a public-looking address.
 */
const BLOCKED_HOST_SUFFIXES = [
  '.local',
  '.localhost',
  '.localdomain',
  '.internal',
  '.intranet',
  '.lan',
  '.home',
  '.home.arpa',
  '.corp',
  '.private',
  '.test',
  '.example',
  '.invalid',
  '.onion',
  '.alt',
  '.in-addr.arpa',
  '.ip6.arpa',
];
const BLOCKED_HOST_EXACT = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata',
  'metadata.google.internal',
  'instance-data',
]);

async function defaultResolve(hostname: string): Promise<ResolvedAddress[]> {
  // `lookup` (getaddrinfo) is used rather than resolve4/resolve6 so the result
  // matches what the socket layer would have done, including /etc/hosts and
  // any search-domain handling on the host.
  const answers = await dns.lookup(hostname, { all: true, verbatim: true });
  return answers.map((answer) => ({
    address: answer.address,
    family: answer.family === 6 ? 6 : 4,
  }));
}

function reject(code: UrlRejectionCode, message: string): UrlRejection {
  return { ok: false, code, message };
}

function buildPinnedLookup(
  expectedHostname: string,
  addresses: readonly ResolvedAddress[],
): LookupFunction {
  return ((hostname, options, callback) => {
    // The client must not be able to ask for a different host on this connection.
    if (hostname !== expectedHostname) {
      callback(new Error('Refusing to resolve an unexpected hostname'), '', 4);
      return;
    }

    const requestedFamily =
      typeof options === 'number' ? options : (options?.family as number | undefined);
    const usable =
      requestedFamily === 4 || requestedFamily === 6
        ? addresses.filter((entry) => entry.family === requestedFamily)
        : addresses;

    if (usable.length === 0) {
      callback(new Error('No approved address for the requested address family'), '', 4);
      return;
    }

    const wantsAll = typeof options === 'object' && options !== null && options.all === true;
    if (wantsAll) {
      callback(
        null,
        usable.map((entry) => ({ address: entry.address, family: entry.family })) as never,
      );
      return;
    }
    const first = usable[0] as ResolvedAddress;
    callback(null, first.address as never, first.family);
  }) as LookupFunction;
}

export interface UrlGuard {
  /** Validates shape only. Cheap, no DNS. Used by the create/update endpoints. */
  checkShape(rawUrl: string): UrlRejection | { ok: true; url: string; hostname: string; port: number; protocol: 'http:' | 'https:' };
  /** Full validation including DNS resolution and connection pinning. */
  check(rawUrl: string): Promise<UrlGuardResult>;
}

export function createUrlGuard(policy: UrlGuardPolicy = {}): UrlGuard {
  const resolve = policy.resolve ?? defaultResolve;
  const allowPrivate = policy.allowPrivateAddresses === true;
  const allowAnyPort = policy.allowNonStandardPorts === true;

  function checkShape(rawUrl: string) {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return reject('invalid_url', 'Enter a full URL, for example https://example.com');
    }

    if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
      return reject('unsupported_scheme', 'Only http:// and https:// URLs can be monitored');
    }

    if (url.username !== '' || url.password !== '') {
      return reject(
        'credentials_in_url',
        'Remove the username and password from the URL. Pingexa never sends credentials to a monitored site.',
      );
    }

    const defaultPort = DEFAULT_PORTS[url.protocol] as number;
    if (!allowAnyPort && url.port !== '' && Number(url.port) !== defaultPort) {
      return reject(
        'non_standard_port',
        `Only the standard port is allowed (${defaultPort} for ${url.protocol.replace(':', '')})`,
      );
    }

    const hostname = url.hostname.toLowerCase();
    if (hostname.length === 0) {
      return reject('invalid_url', 'The URL is missing a hostname');
    }

    // A bracketed IPv6 literal arrives from URL.hostname wrapped in brackets.
    const bareHost = hostname.startsWith('[') && hostname.endsWith(']')
      ? hostname.slice(1, -1)
      : hostname;

    if (isIP(bareHost) === 0) {
      if (BLOCKED_HOST_EXACT.has(hostname)) {
        return reject('internal_hostname', 'That hostname refers to a private or internal machine');
      }
      if (BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
        return reject('internal_hostname', 'That hostname is reserved for internal or test use');
      }
      if (!hostname.includes('.')) {
        return reject(
          'internal_hostname',
          'Use a full public hostname, for example example.com',
        );
      }
    } else if (!allowPrivate) {
      const classification = classifyAddress(bareHost);
      if (!classification.publiclyRoutable) {
        return reject('blocked_address', `That URL points at a non-public address: ${classification.reason}`);
      }
    }

    return {
      ok: true as const,
      url: url.toString(),
      hostname: bareHost,
      port: url.port === '' ? defaultPort : Number(url.port),
      protocol: url.protocol as 'http:' | 'https:',
    };
  }

  async function check(rawUrl: string): Promise<UrlGuardResult> {
    const shape = checkShape(rawUrl);
    if (!shape.ok) return shape;

    let resolved: ResolvedAddress[];
    if (isIP(shape.hostname) !== 0) {
      resolved = [{ address: shape.hostname, family: isIP(shape.hostname) === 6 ? 6 : 4 }];
    } else {
      try {
        resolved = await resolve(shape.hostname);
      } catch (error) {
        const code = (error as { code?: string }).code ?? 'UNKNOWN';
        return reject('dns_failure', `DNS lookup failed (${code})`);
      }
      if (resolved.length === 0) {
        return reject('dns_failure', 'DNS lookup returned no addresses');
      }
    }

    if (!allowPrivate) {
      for (const entry of resolved) {
        const classification = classifyAddress(entry.address);
        if (!classification.publiclyRoutable) {
          // Refuse the whole hostname, not just this answer: a host that also
          // answers with a private address must not be monitorable at all.
          return reject(
            'blocked_address',
            `That hostname resolves to a non-public address: ${classification.reason}`,
          );
        }
      }
    }

    return {
      ok: true,
      url: shape.url,
      hostname: shape.hostname,
      port: shape.port,
      protocol: shape.protocol,
      addresses: resolved,
      pinnedLookup: buildPinnedLookup(shape.hostname, resolved),
    };
  }

  return { checkShape, check };
}

/** The only guard production code is allowed to use. */
export const strictUrlGuard: UrlGuard = createUrlGuard();
