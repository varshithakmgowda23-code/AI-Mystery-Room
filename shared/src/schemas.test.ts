import { describe, expect, it } from 'vitest';
import { DifficultySchema, HealthResponseSchema, ToneSchema } from './schemas.js';

describe('shared foundation schemas', () => {
  it('accepts the supported difficulty and tone values', () => {
    expect(DifficultySchema.safeParse('medium').success).toBe(true);
    expect(ToneSchema.safeParse('cozy').success).toBe(true);
    expect(DifficultySchema.safeParse('extreme').success).toBe(false);
  });

  it('validates the API health payload', () => {
    expect(
      HealthResponseSchema.safeParse({
        status: 'degraded',
        service: 'ai-mystery-room-api',
        timestamp: new Date().toISOString(),
        database: 'disconnected',
      }).success,
    ).toBe(true);
  });
});
