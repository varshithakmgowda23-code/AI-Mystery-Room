import { Router } from 'express';
import { CaseCreationSchema } from '@ai-mystery-room/shared';
import { casesController } from '../controllers/cases.controller.js';
import { env } from '../config/env.js';
import { InProcessJobQueue } from '../jobs/queue.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { generationLimiter } from '../middleware/security.js';

const queue = new InProcessJobQueue(env.GENERATION_CONCURRENCY);
const controller = casesController(queue);
export const casesRouter = Router();

casesRouter.post('/', generationLimiter, requireAuth, validateBody(CaseCreationSchema), (request, response, next) => {
  void controller.create(request, response).catch(next);
});
casesRouter.get('/:id/status', requireAuth, (request, response, next) => {
  void controller.status(request, response).catch(next);
});
