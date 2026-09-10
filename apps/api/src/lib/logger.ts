import { pino } from 'pino';
import { env } from '../config/env.js';

/**
 * Keys whose values must never reach the logs. Matched case-insensitively
 * against the last segment of the property path.
 */
const REDACT_KEYS = [
  'password',
  'passwordHash',
  'newPassword',
  'currentPassword',
  'token',
  'tokenHash',
  'sessionToken',
  'csrfToken',
  'secret',
  'authorization',
  'cookie',
  'set-cookie',
  'slug',
  'body',
  'responseBody',
];

const redactPaths = [
  ...REDACT_KEYS.map((key) => key),
  ...REDACT_KEYS.map((key) => `*.${key}`),
  ...REDACT_KEYS.map((key) => `*.*.${key}`),
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
];

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: { paths: redactPaths, censor: '[redacted]' },
  base: undefined,
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(env.LOG_PRETTY
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
        },
      }
    : {}),
});

export type Logger = typeof logger;

/**
 * Errors are logged as `{ type, message, stack }` only. Error objects from
 * undici/pg can carry request context we do not want written to disk.
 */
export function describeError(error: unknown): { type: string; message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      type: error.name,
      message: error.message,
      ...(env.NODE_ENV === 'production' ? {} : { stack: error.stack }),
    };
  }
  return { type: 'UnknownError', message: String(error) };
}
