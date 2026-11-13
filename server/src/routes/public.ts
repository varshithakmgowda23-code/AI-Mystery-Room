import { Router } from 'express';
import { endgameController } from '../controllers/endgame.controller.js';

/** Unauthenticated, read-only routes (spec §11: public share). */
export const publicRouter = Router();
publicRouter.get('/cases/:shareToken', (request, response, next) => {
  void endgameController.publicCase(request, response).catch(next);
});
