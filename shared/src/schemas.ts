import { z } from 'zod';

export const DifficultySchema = z.enum(['easy', 'medium', 'hard']);
export const ToneSchema = z.enum(['classic_noir', 'modern_thriller', 'cozy', 'corporate']);
export const CaseCreationSchema = z
  .object({
    seed: z.string().trim().min(10).max(500),
    difficulty: DifficultySchema,
    tone: ToneSchema,
  })
  .strict();
export const CaseIdSchema = z.string().regex(/^[a-f\d]{24}$/i);
export const CaseStatusSchema = z.enum(['queued', 'generating', 'ready', 'in_progress', 'resolved', 'failed']);
export const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  service: z.literal('ai-mystery-room-api'),
  timestamp: z.string().datetime(),
  database: z.enum(['connected', 'disconnected', 'connecting']),
});

export type Difficulty = z.infer<typeof DifficultySchema>;
export type Tone = z.infer<typeof ToneSchema>;
export type CaseCreation = z.infer<typeof CaseCreationSchema>;
export type CaseStatus = z.infer<typeof CaseStatusSchema>;
