import type { SessionContext } from '../domain/sessions.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by `attachSession`. Present only for a valid, unrevoked session. */
      auth?: SessionContext;
      /** Correlation id, echoed in the `x-request-id` response header. */
      requestId?: string;
    }
  }
}

export {};
