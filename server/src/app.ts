import cors from 'cors';
import cookieParser from 'cookie-parser';
import express from 'express';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { authRouter } from './routes/auth.js';
import { casesRouter } from './routes/cases.js';
import { healthRouter } from './routes/health.js';
import { mediaRouter } from './routes/media.js';

export const app = express();

app.disable('x-powered-by');
app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use('/api/health', healthRouter);
app.use('/api', (request, response, next) => {
  if (request.method !== 'GET' && !request.is('application/json')) {
    response.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Mutating requests must use application/json.' } });
    return;
  }
  next();
});
app.use('/api/auth', authRouter);
app.use('/api/cases', casesRouter);
app.use('/api/media', mediaRouter);
app.use(notFoundHandler);
app.use(errorHandler);
