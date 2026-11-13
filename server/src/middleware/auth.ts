import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

/** Like requireAuth but never rejects: sets response.locals.userId only for a valid session. */
export function optionalAuth(request: Request, response: Response, next: NextFunction): void {
  const token = request.cookies?.session;
  if (token) {
    try {
      const payload = jwt.verify(token, env.JWT_SECRET);
      if (typeof payload !== 'string' && typeof payload.sub === 'string') response.locals.userId = payload.sub;
    } catch {
      // Expired or tampered cookie: treat as signed out.
    }
  }
  next();
}

export function requireAuth(request: Request, response: Response, next: NextFunction): void {
  const token = request.cookies?.session;
  if (!token) {
    response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Please sign in to continue.' } });
    return;
  }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET);
    if (typeof payload === 'string' || typeof payload.sub !== 'string') throw new Error('Invalid subject');
    response.locals.userId = payload.sub;
    next();
  } catch {
    response
      .status(401)
      .json({ error: { code: 'UNAUTHENTICATED', message: 'Your session has expired. Please sign in again.' } });
  }
}
