import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { serveMedia } from '../controllers/media.controller.js';

export const mediaRouter = Router();
mediaRouter.get('/:caseId/:filename', requireAuth, (request, response, next) => {
  void serveMedia(request, response).catch(next);
});
