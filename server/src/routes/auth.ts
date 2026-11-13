import { Router } from 'express';
import { z } from 'zod';
import { createGuest, login, LoginSchema, me, register, RegisterSchema, upgrade, UpgradeSchema } from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { logout } from '../controllers/auth.controller.js';

export const authRouter = Router();
const EmptySchema = z.object({}).strict();

authRouter.post('/register', validateBody(RegisterSchema), (request, response, next) => { void request; void register(response).catch(next); });
authRouter.post('/login', validateBody(LoginSchema), (request, response, next) => { void request; void login(response).catch(next); });
authRouter.post('/guest', validateBody(EmptySchema), (request, response, next) => { void request; void createGuest(response).catch(next); });
authRouter.post('/logout', validateBody(EmptySchema), logout);
authRouter.get('/me', requireAuth, (request, response, next) => { void request; void me(response).catch(next); });
authRouter.post('/upgrade', requireAuth, validateBody(UpgradeSchema), (request, response, next) => { void request; void upgrade(response).catch(next); });
