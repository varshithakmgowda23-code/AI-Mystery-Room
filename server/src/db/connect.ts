import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

// Fail fast instead of queueing queries for 10s when the database is down (audit S-5).
mongoose.set('bufferTimeoutMS', 3000);

export async function connectDatabase(): Promise<void> {
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
}

/**
 * Connects with retry so the API recovers if MongoDB starts after the server.
 * Resolves once connected; never rejects.
 */
export async function connectDatabaseWithRetry(maxDelayMs = 30_000): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await connectDatabase();
      return;
    } catch (error) {
      const delay = Math.min(maxDelayMs, 2000 * 2 ** attempt);
      logger.warn(
        { err: { name: (error as Error).name, message: (error as Error).message }, retryInMs: delay },
        'MongoDB unavailable, retrying',
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

export function databaseStatus(): 'connected' | 'disconnected' | 'connecting' {
  if (mongoose.connection.readyState === 1) return 'connected';
  if (mongoose.connection.readyState === 2) return 'connecting';
  return 'disconnected';
}
