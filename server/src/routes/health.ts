import { Router } from 'express';
import { HealthResponseSchema } from '@ai-mystery-room/shared';
import { databaseStatus } from '../db/connect.js';

export const healthRouter = Router();

healthRouter.get('/', (_request, response) => {
  const database = databaseStatus();
  const result = HealthResponseSchema.parse({
    status: database === 'connected' ? 'ok' : 'degraded',
    service: 'ai-mystery-room-api',
    timestamp: new Date().toISOString(),
    database,
  });
  response.status(200).json(result);
});
