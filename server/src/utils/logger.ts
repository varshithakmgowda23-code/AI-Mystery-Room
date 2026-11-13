import { pino } from 'pino';
import { env } from '../config/env.js';

/**
 * Structured JSON logger (NFR-07). Secrets and session cookies are redacted;
 * request bodies are never logged so seeds, passwords and prompts stay out of logs.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'ai-mystery-room-api' },
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'res.headers["set-cookie"]',
      '*.password',
      '*.passwordHash',
      '*.apiKey',
    ],
    censor: '[redacted]',
  },
});
