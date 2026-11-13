import type { ErrorRequestHandler, RequestHandler } from 'express';
import { logger } from '../utils/logger.js';

export const notFoundHandler: RequestHandler = (_request, response) => {
  response.status(404).json({ error: { code: 'NOT_FOUND', message: 'The requested resource was not found.' } });
};

type HttpLikeError = { type?: unknown; status?: unknown; name?: unknown; message?: unknown };

function isBodyParserError(error: unknown): error is HttpLikeError {
  if (typeof error !== 'object' || error === null) return false;
  const { type } = error as HttpLikeError;
  return type === 'entity.parse.failed' || type === 'entity.too.large' || type === 'encoding.unsupported';
}

function isDatabaseUnavailable(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { name, message } = error as HttpLikeError;
  return (
    name === 'MongooseServerSelectionError' ||
    name === 'MongoServerSelectionError' ||
    name === 'MongoNotConnectedError' ||
    (typeof message === 'string' && /buffering timed out/i.test(message))
  );
}

export const errorHandler: ErrorRequestHandler = (error: unknown, request, response, _next) => {
  void _next;
  if (isBodyParserError(error)) {
    const tooLarge = error.type === 'entity.too.large';
    response.status(tooLarge ? 413 : 400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: tooLarge ? 'The request body is too large.' : 'The request body is not valid JSON.',
      },
    });
    return;
  }
  if (isDatabaseUnavailable(error)) {
    (request.log ?? logger).error({ err: error }, 'database unavailable');
    response
      .status(503)
      .json({ error: { code: 'INTERNAL', message: 'The case archive is temporarily unavailable. Please try again.' } });
    return;
  }
  (request.log ?? logger).error({ err: error }, 'request failed');
  response.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } });
};
