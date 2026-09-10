import { describe, expect, it } from 'vitest';
import { createUrlGuard } from '../../src/monitoring/urlGuard.js';

const guard = createUrlGuard({
  // Deterministic DNS so these tests never touch the network.
  resolve: async (hostname) => {
    if (hostname === 'public.monitored.dev') return [{ address: '93.184.215.14', family: 4 }];
    if (hostname === 'public6.monitored.dev') return [{ address: '2606:4700::1111', family: 6 }];
    if (hostname === 'private.monitored.dev') return [{ address: '10.0.0.5', family: 4 }];
    if (hostname === 'rebind.monitored.dev') {
      // A host that answers with both a public and a private address.
      return [
        { address: '93.184.215.14', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ];
    }
    if (hostname === 'empty.monitored.dev') return [];
    const error = new Error('getaddrinfo ENOTFOUND') as Error & { code?: string };
    error.code = 'ENOTFOUND';
    throw error;
  },
});

describe('url guard — shape', () => {
  it('accepts ordinary public http and https URLs', async () => {
    for (const url of [
      'http://public.monitored.dev',
      'https://public.monitored.dev/status?deep=1',
      'https://public.monitored.dev:443/',
      'http://public.monitored.dev:80/',
    ]) {
      const result = await guard.check(url);
      expect(result.ok, url).toBe(true);
    }
  });

  it.each([
    ['ftp://public.monitored.dev', 'unsupported_scheme'],
    ['file:///etc/passwd', 'unsupported_scheme'],
    ['gopher://public.monitored.dev', 'unsupported_scheme'],
    ['not a url', 'invalid_url'],
    ['https://user:pass@public.monitored.dev', 'credentials_in_url'],
    ['https://user@public.monitored.dev', 'credentials_in_url'],
    ['http://public.monitored.dev:8080', 'non_standard_port'],
    ['https://public.monitored.dev:8443', 'non_standard_port'],
    ['http://public.monitored.dev:22', 'non_standard_port'],
    ['http://localhost', 'internal_hostname'],
    ['http://LOCALHOST/', 'internal_hostname'],
    ['http://box.local', 'internal_hostname'],
    ['http://metadata.google.internal/', 'internal_hostname'],
    ['http://something.internal/', 'internal_hostname'],
    ['http://intranet-host', 'internal_hostname'],
    ['http://a.onion/', 'internal_hostname'],
    ['http://site.example/', 'internal_hostname'],
    ['http://site.test/', 'internal_hostname'],
    ['http://site.invalid/', 'internal_hostname'],
    ['http://site.home.arpa/', 'internal_hostname'],
    ['http://127.0.0.1/', 'blocked_address'],
    ['http://[::1]/', 'blocked_address'],
    ['http://169.254.169.254/', 'blocked_address'],
    ['http://10.1.2.3/', 'blocked_address'],
    ['http://[fd00::1]/', 'blocked_address'],
  ])('refuses %s with %s', async (url, code) => {
    const result = await guard.check(url);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(code);
  });

  it('does not leak the reason into anything but a short message', async () => {
    const result = await guard.check('http://10.1.2.3/secret/path');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).not.toContain('secret');
      expect(result.message.length).toBeLessThan(200);
    }
  });
});

describe('url guard — DNS', () => {
  it('refuses a hostname that resolves to a private address', async () => {
    const result = await guard.check('https://private.monitored.dev');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('blocked_address');
  });

  it('refuses a hostname that resolves to a mix of public and private addresses', async () => {
    // Filtering the private answer out would leave a working monitor on a host
    // that can flip which address it serves. The whole hostname is refused.
    const result = await guard.check('https://rebind.monitored.dev');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('blocked_address');
  });

  it('refuses a hostname with no addresses', async () => {
    const result = await guard.check('https://empty.monitored.dev');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('dns_failure');
  });

  it('reports a DNS failure without exposing the resolver error', async () => {
    const result = await guard.check('https://missing.monitored.dev');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('dns_failure');
      expect(result.message).toBe('DNS lookup failed (ENOTFOUND)');
    }
  });

  it('does not resolve an IP literal through DNS', async () => {
    const result = await guard.check('https://93.184.215.14/');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.addresses).toEqual([{ address: '93.184.215.14', family: 4 }]);
  });
});

describe('url guard — connection pinning', () => {
  it('returns only the approved addresses, ignoring what the socket asks for', async () => {
    const result = await guard.check('https://public.monitored.dev');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const answers = await new Promise<unknown>((resolve, reject) => {
      result.pinnedLookup('public.monitored.dev', { all: true }, (error, address) =>
        error ? reject(error) : resolve(address),
      );
    });
    expect(answers).toEqual([{ address: '93.184.215.14', family: 4 }]);
  });

  it('refuses to resolve a different hostname on the pinned connection', async () => {
    // This is the DNS-rebinding defence: even if something later in the stack
    // tries to reuse the connector for another host, it gets nothing.
    const result = await guard.check('https://public.monitored.dev');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    await expect(
      new Promise((resolve, reject) => {
        result.pinnedLookup('evil.monitored.dev', { all: true }, (error, address) =>
          error ? reject(error) : resolve(address),
        );
      }),
    ).rejects.toThrow(/unexpected hostname/i);
  });

  it('reports no approved address when the requested family has none', async () => {
    const result = await guard.check('https://public.monitored.dev');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    await expect(
      new Promise((resolve, reject) => {
        result.pinnedLookup('public.monitored.dev', { all: true, family: 6 }, (error, address) =>
          error ? reject(error) : resolve(address),
        );
      }),
    ).rejects.toThrow(/No approved address/i);
  });

  it('supports the single-address lookup shape', async () => {
    const result = await guard.check('https://public6.monitored.dev');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const answer = await new Promise<{ address: unknown; family: unknown }>((resolve, reject) => {
      result.pinnedLookup('public6.monitored.dev', {}, (error, address, family) =>
        error ? reject(error) : resolve({ address, family }),
      );
    });
    expect(answer).toEqual({ address: '2606:4700::1111', family: 6 });
  });
});

describe('url guard — test policy is not reachable from configuration', () => {
  it('the strict guard refuses loopback even though a test guard can allow it', async () => {
    const strict = createUrlGuard();
    const permissive = createUrlGuard({
      allowPrivateAddresses: true,
      allowNonStandardPorts: true,
    });

    const strictResult = strict.checkShape('http://127.0.0.1:9999/');
    expect(strictResult.ok).toBe(false);

    const permissiveResult = permissive.checkShape('http://127.0.0.1:9999/');
    expect(permissiveResult.ok).toBe(true);
  });
});
