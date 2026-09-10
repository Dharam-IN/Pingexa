import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError } from 'zod';
import type { ApiErrorBody } from '@pingexa/shared';
import { AppError } from '../../lib/errors.js';
import { describeError, logger } from '../../lib/logger.js';

/** Wraps an async handler so a rejected promise reaches the error handler. */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  const body: ApiErrorBody = {
    error: { code: 'not_found', message: 'That endpoint does not exist.' },
  };
  res.status(404).json(body);
};

function zodToFields(error: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '_';
    if (!(key in fields)) fields[key] = issue.message;
  }
  return fields;
}

/**
 * Single exit point for every error.
 *
 * Only `AppError` and validation errors produce a message the client can see.
 * Anything else is a bug: it is logged with a stack and reported as a bare 500,
 * because an unexpected error message can contain a query, a hostname or a
 * connection string.
 */
export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (res.headersSent) return;

  if (error instanceof ZodError) {
    const body: ApiErrorBody = {
      error: {
        code: 'validation_failed',
        message: 'Some of the details you entered need fixing.',
        fields: zodToFields(error),
      },
    };
    res.status(400).json(body);
    return;
  }

  if (error instanceof AppError) {
    if (error.status >= 500) {
      logger.error(
        { requestId: req.requestId, code: error.code, ...error.logContext, err: describeError(error) },
        'request failed',
      );
    } else {
      logger.info(
        { requestId: req.requestId, code: error.code, status: error.status, ...error.logContext },
        'request rejected',
      );
    }
    const body: ApiErrorBody = {
      error: {
        code: error.code,
        message: error.message,
        ...(error.fields ? { fields: error.fields } : {}),
      },
    };
    res.status(error.status).json(body);
    return;
  }

  logger.error(
    { requestId: req.requestId, method: req.method, path: req.path, err: describeError(error) },
    'unhandled error',
  );
  const body: ApiErrorBody = {
    error: { code: 'internal_error', message: 'Something went wrong on our side.' },
  };
  res.status(500).json(body);
};
