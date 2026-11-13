import { app } from './app.js';
import { connectDatabase } from './db/connect.js';
import { env } from './config/env.js';
import { failStuckGenerations } from './services/caseGeneration.service.js';

const server = app.listen(env.PORT, () => {
  console.info(`API listening on http://localhost:${env.PORT}`);
});

void connectDatabase()
  .then(async () => {
    console.info('MongoDB connected');
    const failedCount = await failStuckGenerations();
    if (failedCount > 0) console.warn(`Marked ${failedCount} interrupted case generation(s) as failed.`);
  })
  .catch((error: unknown) => console.error('MongoDB connection unavailable:', error));

function shutdown(): void {
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
