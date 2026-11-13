import type { NextFunction, Request, Response } from 'express';
import { rateLimit, type Options } from 'express-rate-limit';
import { env } from '../config/env.js';

const FIFTEEN_MINUTES = 15 * 60 * 1000;

function limiter(max: number, windowMs: number, message: string, extra: Partial<Options> = {}) {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => !env.RATE_LIMIT_ENABLED,
    handler: (_request, response) => {
      response.status(429).json({ error: { code: 'RATE_LIMITED', message } });
    },
    ...extra,
  });
}

const ID = '[a-f\\d]{24}';
const GAMEPLAY_ROUTES: Array<[string, RegExp]> = [
  ['GET', new RegExp(`^/api/cases/${ID}(?:/status)?$`, 'i')],
  ['PATCH', new RegExp(`^/api/cases/${ID}/(?:notes|suspect-tags)$`, 'i')],
  ['POST', new RegExp(`^/api/cases/${ID}/evidence/e\\d{1,2}/view$`, 'i')],
  ['GET', /^\/api\/media\//],
];

/**
 * Routine gameplay traffic (status polling, opening the board, notes autosave, tags,
 * viewed markers, media) gets its own larger bucket (DEC-007).
 */
export function isGameplayTraffic(request: Pick<Request, 'method' | 'originalUrl'>): boolean {
  const path = request.originalUrl.split('?')[0];
  return GAMEPLAY_ROUTES.some(([method, pattern]) => request.method === method && pattern.test(path));
}

/** Spec §15.4: global 100 requests / 15 min / IP. */
export const globalLimiter = limiter(
  env.RATE_LIMIT_GLOBAL_MAX,
  FIFTEEN_MINUTES,
  'Too many requests. Please slow down and try again shortly.',
  {
    skip: (request) => !env.RATE_LIMIT_ENABLED || isGameplayTraffic(request),
  },
);

export const pollingLimiter = limiter(
  env.RATE_LIMIT_POLLING_MAX,
  FIFTEEN_MINUTES,
  'Too many requests. Please slow down and try again shortly.',
  {
    skip: (request) => !env.RATE_LIMIT_ENABLED || !isGameplayTraffic(request),
  },
);

/** Stricter limit on credential endpoints to slow brute-force attempts. */
export const authLimiter = limiter(
  env.RATE_LIMIT_AUTH_MAX,
  FIFTEEN_MINUTES,
  'Too many sign-in attempts. Please wait a few minutes and try again.',
);

/** Per-IP cap on case creation, on top of the per-user limits in FR-06. */
export const generationLimiter = limiter(
  env.RATE_LIMIT_GENERATION_MAX,
  60 * 60 * 1000,
  'Too many cases opened from this network. Please try again later.',
);

function hasOperatorKey(value: unknown, depth = 0): boolean {
  if (depth > 10 || typeof value !== 'object' || value === null) return false;
  if (Array.isArray(value)) return value.some((item) => hasOperatorKey(item, depth + 1));
  return Object.entries(value).some(
    ([key, child]) => key.startsWith('$') || key.includes('.') || hasOperatorKey(child, depth + 1),
  );
}

/**
 * Rejects request bodies containing MongoDB operator keys (`$where`, `a.b`, ...).
 * Replaces express-mongo-sanitize, which is incompatible with Express 5 (DEC-006).
 * Route params are validated separately (e.g. CaseIdSchema) and bodies by strict Zod schemas.
 */
export function rejectMongoOperators(request: Request, response: Response, next: NextFunction): void {
  if (hasOperatorKey(request.body)) {
    response.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'The request contains unsupported characters in its field names.' },
    });
    return;
  }
  next();
}
