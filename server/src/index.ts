import { app } from './app.js';
import { connectDatabaseWithRetry } from './db/connect.js';
import { env } from './config/env.js';
import { failStuckGenerations } from './services/caseGeneration.service.js';
import { logger } from './utils/logger.js';

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, mockGemini: env.MOCK_GEMINI }, `API listening on http://localhost:${env.PORT}`);
});

void connectDatabaseWithRetry().then(async () => {
  logger.info('MongoDB connected');
  const failedCount = await failStuckGenerations();
  if (failedCount > 0) logger.warn({ failedCount }, 'Marked interrupted case generations as failed');
});

server.on('error', (error: NodeJS.ErrnoException) => {
  logger.fatal({ err: error }, error.code === 'EADDRINUSE' ? `Port ${env.PORT} is already in use` : 'API server error');
  process.exit(1);
});

function shutdown(): void {
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
