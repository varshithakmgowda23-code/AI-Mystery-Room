import { Router, type NextFunction, type Request, type Response } from 'express';
import { CaseCreationSchema, NotesSchema, SuspectTagsSchema } from '@ai-mystery-room/shared';
import { casesController } from '../controllers/cases.controller.js';
import { gameplayController } from '../controllers/gameplay.controller.js';
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
casesRouter.post('/:id/regenerate', generationLimiter, requireAuth, (request, response, next) => {
  void controller.regenerate(request, response).catch(next);
});

// Gameplay (spec §11.2 API-10, API-14..17). Every handler checks ownership and case state.
const wrap =
  (handler: (request: Request, response: Response) => Promise<void>) =>
  (request: Request, response: Response, next: NextFunction) =>
    void handler(request, response).catch(next);

casesRouter.get('/:id', requireAuth, wrap(gameplayController.get));
casesRouter.patch('/:id/notes', requireAuth, validateBody(NotesSchema), wrap(gameplayController.notes));
casesRouter.patch(
  '/:id/suspect-tags',
  requireAuth,
  validateBody(SuspectTagsSchema),
  wrap(gameplayController.suspectTags),
);
casesRouter.post('/:id/evidence/:evidenceId/view', requireAuth, wrap(gameplayController.viewEvidence));
casesRouter.post('/:id/hints', requireAuth, wrap(gameplayController.hint));
