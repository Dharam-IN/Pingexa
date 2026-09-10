import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createUrlGuard, type UrlGuard } from '../../src/monitoring/urlGuard.js';

/**
 * A loopback HTTP server used as a monitoring target in tests.
 *
 * Because production URL protection blocks loopback addresses and must never be
 * weakened from configuration, tests that need to reach this server pass
 * `loopbackGuard` explicitly. That guard exists only in test code.
 */
export const loopbackGuard: UrlGuard = createUrlGuard({
  allowPrivateAddresses: true,
  allowNonStandardPorts: true,
});

export interface FixtureBehaviour {
  status?: number;
  body?: string;
  /** Delay before responding, to exercise the timeout path. */
  delayMs?: number;
  headers?: Record<string, string>;
  /** Destroy the socket without responding, to exercise the connection path. */
  hangUp?: boolean;
}

export interface FixtureServer {
  readonly url: string;
  readonly port: number;
  /** Replace the behaviour used for the next requests. */
  set(behaviour: FixtureBehaviour): void;
  /** Number of requests received so far. */
  readonly requestCount: number;
  /** Headers of the most recent request, for asserting what we send. */
  readonly lastHeaders: Record<string, string | string[] | undefined>;
  close(): Promise<void>;
}

export async function startFixtureServer(
  initial: FixtureBehaviour = { status: 200, body: 'ok' },
): Promise<FixtureServer> {
  let behaviour: FixtureBehaviour = initial;
  let requestCount = 0;
  let lastHeaders: Record<string, string | string[] | undefined> = {};

  const server: Server = createServer((req, res) => {
    requestCount += 1;
    lastHeaders = req.headers;

    const respond = () => {
      if (behaviour.hangUp) {
        req.socket.destroy();
        return;
      }
      res.writeHead(behaviour.status ?? 200, {
        'content-type': 'text/plain',
        ...(behaviour.headers ?? {}),
      });
      res.end(behaviour.body ?? 'ok');
    };

    if (behaviour.delayMs) setTimeout(respond, behaviour.delayMs);
    else respond();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${address.port}/`,
    port: address.port,
    set(next) {
      behaviour = next;
    },
    get requestCount() {
      return requestCount;
    },
    get lastHeaders() {
      return lastHeaders;
    },
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
