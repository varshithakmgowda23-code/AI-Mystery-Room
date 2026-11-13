import { z } from 'zod';
import type { Request, Response } from 'express';
import { CaseCreationSchema, CaseIdSchema, CaseStatusSchema } from '@ai-mystery-room/shared';
import { CaseModel } from '../db/models/Case.js';
import { UserModel } from '../db/models/User.js';
import { env } from '../config/env.js';
import { generationStageLabel } from '../services/caseGeneration.service.js';
import type { JobQueue } from '../jobs/queue.js';
import { generateCase } from '../services/caseGeneration.service.js';
import { CONTENT_POLICY_MESSAGE, isSeedOnDenylist } from '../services/gemini/safety.js';
import { classifyStoredGenerationError } from '../services/gemini/errors.js';

export function casesController(queue: JobQueue) {
  return {
    create: async (_request: Request, response: Response): Promise<void> => {
      void _request;
      const input = response.locals.validatedBody as z.infer<typeof CaseCreationSchema>;
      const userId = response.locals.userId as string;
      const user = await UserModel.findById(userId).select('isGuest guestExpiresAt');
      if (!user) {
        response
          .status(401)
          .json({ error: { code: 'UNAUTHENTICATED', message: 'Your session has expired. Please sign in again.' } });
        return;
      }
      const activeCount = await CaseModel.countDocuments({ userId, status: { $in: ['queued', 'generating'] } });
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const dailyCount = await CaseModel.countDocuments({ userId, createdAt: { $gte: dayAgo } });
      const dailyLimit = user.isGuest ? env.MAX_GENERATIONS_PER_DAY_GUEST : env.MAX_GENERATIONS_PER_DAY_USER;
      if (activeCount >= 2 || dailyCount >= dailyLimit) {
        response.status(429).json({
          error: {
            code: 'RATE_LIMITED',
            message:
              activeCount >= 2
                ? 'You already have two cases generating. Wait for one to finish before opening another.'
                : `You have reached your ${dailyLimit}-case daily limit.`,
          },
        });
        return;
      }

      if (isSeedOnDenylist(input.seed)) {
        response.status(422).json({ error: { code: 'CONTENT_POLICY', message: CONTENT_POLICY_MESSAGE } });
        return;
      }

      const caseDoc = new CaseModel({
        userId,
        seed: input.seed,
        difficulty: input.difficulty,
        tone: input.tone,
        status: 'queued',
        progress: { stage: 'queued', percent: 0 },
        generationAttempts: 0,
        state: {
          hintsUsed: 0,
          attemptsUsed: 0,
          maxAttempts: input.difficulty === 'easy' ? 3 : 2,
          startedAt: new Date(),
        },
        ...(user.isGuest ? { expiresAt: user.guestExpiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) } : {}),
      });
      await caseDoc.save();
      const caseId = String(caseDoc._id);
      queue.enqueue(() => generateCase(caseId));
      response.status(202).json({ caseId, status: 'queued' });
    },
    /** API-13: retry a failed generation (NFR-04 "with retry available"). */
    regenerate: async (request: Request, response: Response): Promise<void> => {
      const parsedId = CaseIdSchema.safeParse(request.params.id);
      if (!parsedId.success) {
        response.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'The case ID is invalid.' } });
        return;
      }
      const userId = response.locals.userId as string;
      const caseDoc = await CaseModel.findOne({ _id: parsedId.data, userId });
      if (!caseDoc) {
        response.status(404).json({ error: { code: 'NOT_FOUND', message: 'That case could not be found.' } });
        return;
      }
      if (caseDoc.status !== 'failed') {
        response.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'Only a case whose generation failed can be retried.' },
        });
        return;
      }
      if (caseDoc.failureCode === 'CONTENT_POLICY') {
        response.status(422).json({ error: { code: 'CONTENT_POLICY', message: CONTENT_POLICY_MESSAGE } });
        return;
      }
      const retryAt = caseDoc.failureRetryAt ? new Date(caseDoc.failureRetryAt) : undefined;
      // Only a short per-minute wait blocks a retry; a daily reset may be served by the fallback model (DEC-022).
      const waitMs = retryAt ? retryAt.getTime() - Date.now() : 0;
      if (retryAt && waitMs > 0 && waitMs <= 5 * 60 * 1000) {
        response.status(429).json({
          error: {
            code: 'RATE_LIMITED',
            message: 'The AI service limit has not reset yet. Please try again later.',
            retryAt: retryAt.toISOString(),
          },
        });
        return;
      }
      const activeCount = await CaseModel.countDocuments({ userId, status: { $in: ['queued', 'generating'] } });
      if (activeCount >= 2) {
        response.status(429).json({
          error: {
            code: 'RATE_LIMITED',
            message: 'You already have two cases generating. Wait for one to finish before retrying.',
          },
        });
        return;
      }
      // Conditional update so two simultaneous retries cannot both enqueue a job.
      const update = await CaseModel.updateOne(
        { _id: parsedId.data, userId, status: 'failed' },
        {
          $set: { status: 'queued', progress: { stage: 'queued', percent: 0 }, generationAttempts: 0 },
          $unset: { failureCode: 1, failureReason: 1, failureRetryAt: 1 },
        },
      );
      if (update.modifiedCount !== 1) {
        response.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'Only a case whose generation failed can be retried.' },
        });
        return;
      }
      queue.enqueue(() => generateCase(parsedId.data));
      response.status(202).json({ caseId: parsedId.data, status: 'queued' });
    },
    status: async (request: Request, response: Response): Promise<void> => {
      const parsedId = CaseIdSchema.safeParse(request.params.id);
      if (!parsedId.success) {
        response.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'The case ID is invalid.', details: parsedId.error.issues },
        });
        return;
      }
      const caseDoc = await CaseModel.findOne({ _id: parsedId.data, userId: response.locals.userId });
      if (!caseDoc) {
        response.status(404).json({ error: { code: 'NOT_FOUND', message: 'That case could not be found.' } });
        return;
      }
      const status = CaseStatusSchema.parse(caseDoc.status);
      const generationError =
        status === 'failed'
          ? caseDoc.failureCode === 'CONTENT_POLICY'
            ? { code: 'CONTENT_POLICY', message: CONTENT_POLICY_MESSAGE }
            : classifyStoredGenerationError(caseDoc.failureCode, caseDoc.failureReason)
          : undefined;
      response.status(200).json({
        status,
        progress: {
          stage: caseDoc.progress?.stage ?? 'queued',
          percent: caseDoc.progress?.percent ?? 0,
          label: generationStageLabel(caseDoc.progress?.stage ?? 'queued'),
        },
        ...(generationError
          ? {
              error: {
                ...generationError,
                ...(caseDoc.failureRetryAt ? { retryAt: new Date(caseDoc.failureRetryAt).toISOString() } : {}),
              },
            }
          : {}),
      });
    },
  };
}
