import type { Request, Response, NextFunction } from 'express';
import type { ZodType } from 'zod';

export function validateBody<T>(schema: ZodType<T>) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const result = schema.safeParse(request.body ?? {});
    if (!result.success) {
      response.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Please check the submitted information.',
          details: result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
        },
      });
      return;
    }
    response.locals.validatedBody = result.data;
    next();
  };
}
