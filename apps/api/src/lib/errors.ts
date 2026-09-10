/**
 * The only error type route handlers should throw. Anything else that escapes a
 * handler is treated as a bug, logged with a stack, and reported to the client
 * as a generic 500 with no internal detail.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string>;
  /** Extra context for the log line only. Never serialised to the client. */
  readonly logContext?: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    options?: { fields?: Record<string, string>; logContext?: Record<string, unknown>; cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    if (options?.fields) this.fields = options.fields;
    if (options?.logContext) this.logContext = options.logContext;
  }
}

export const badRequest = (code: string, message: string, fields?: Record<string, string>) =>
  new AppError(400, code, message, fields ? { fields } : undefined);

export const unauthorized = (message = 'You need to sign in to do that.') =>
  new AppError(401, 'unauthenticated', message);

export const forbidden = (message = 'You do not have access to that.') =>
  new AppError(403, 'forbidden', message);

/**
 * Used for every "not yours or not there" case. Returning 404 rather than 403
 * for another user's resource avoids confirming that the id exists.
 */
export const notFound = (message = 'Not found.') => new AppError(404, 'not_found', message);

export const conflict = (code: string, message: string) => new AppError(409, code, message);

export const tooManyRequests = (message = 'Too many requests. Try again shortly.') =>
  new AppError(429, 'rate_limited', message);
