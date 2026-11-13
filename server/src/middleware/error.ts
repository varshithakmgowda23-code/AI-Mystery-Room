import type { ErrorRequestHandler, RequestHandler } from 'express';

export const notFoundHandler: RequestHandler = (_request, response) => {
  response.status(404).json({ error: { code: 'NOT_FOUND', message: 'The requested resource was not found.' } });
};

export const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
  void _request;
  void _next;
  console.error('Request failed:', error);
  response.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } });
};
