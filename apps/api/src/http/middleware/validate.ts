import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodType } from 'zod';

/**
 * Replaces `req.body` with the parsed, coerced value.
 *
 * Every write endpoint goes through one of these, so no handler ever reads a
 * raw request field. A `ZodError` reaches the error handler and becomes a 400
 * with per-field messages.
 */
export function validateBody<T>(schema: ZodType<T>): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      next(result.error);
      return;
    }
    req.body = result.data;
    next();
  };
}

export function validateQuery<T>(schema: ZodType<T>): { parse: (req: Request) => T } {
  return {
    parse(req: Request) {
      return schema.parse(req.query);
    },
  };
}
