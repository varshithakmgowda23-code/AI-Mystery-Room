import { randomUUID } from 'node:crypto';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { globalLimiter, pollingLimiter, rejectMongoOperators } from './middleware/security.js';
import { authRouter } from './routes/auth.js';
import { casesRouter } from './routes/cases.js';
import { healthRouter } from './routes/health.js';
import { mediaRouter } from './routes/media.js';
import { publicRouter } from './routes/public.js';
import { logger } from './utils/logger.js';

export const app = express();

app.disable('x-powered-by');
if (env.NODE_ENV === 'production') app.set('trust proxy', 1);
app.use(
  pinoHttp({
    logger,
    genReqId: (request, response) => {
      const incoming = request.headers['x-request-id'];
      const id = typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
      response.setHeader('X-Request-Id', id);
      return id;
    },
    autoLogging: { ignore: (request) => request.url === '/api/health' },
  }),
);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));
app.use('/api', globalLimiter, pollingLimiter);
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use('/api/health', healthRouter);
app.use('/api', (request, response, next) => {
  if (['POST', 'PUT', 'PATCH'].includes(request.method) && !request.is('application/json')) {
    response
      .status(400)
      .json({ error: { code: 'VALIDATION_ERROR', message: 'Mutating requests must use application/json.' } });
    return;
  }
  next();
});
app.use('/api', rejectMongoOperators);
app.use('/api/auth', authRouter);
app.use('/api/cases', casesRouter);
app.use('/api/media', mediaRouter);
app.use('/api/public', publicRouter);
app.use(notFoundHandler);
app.use(errorHandler);
