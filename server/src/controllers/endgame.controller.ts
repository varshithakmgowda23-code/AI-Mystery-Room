import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  AccuseSchema,
  CaseIdSchema,
  ShareSchema,
  ShareTokenSchema,
  type CaseListItem,
  type CaseListResponse,
  type Difficulty,
  type PublicCaseView,
} from '@ai-mystery-room/shared';
import { CaseModel } from '../db/models/Case.js';
import { computeScore } from '../services/scoring.service.js';
import { toResolvedView, type StoredCase } from '../services/caseView.service.js';
import { getStorageDriver } from '../services/storage/index.js';
import { logger } from '../utils/logger.js';

const ACTIVE = ['ready', 'in_progress'];
const PAGE_SIZE = 20;
const STORED_MEDIA = /^[\da-f-]{36}\.(png|jpg|webp)$/i;

/** Generic nudges: never depend on who was accused or who did it (FR-22, spec §15.1). */
const NUDGES = [
  'Not quite. Re-examine the timeline.',
  'Not quite. Check which alibis the evidence actually confirms.',
  'Not quite. Look again at what each suspect could not have known.',
];

function fail(response: Response, status: number, code: string, message: string): void {
  response.status(status).json({ error: { code, message } });
}

function caseIdOf(request: Request, response: Response): string | undefined {
  const parsed = CaseIdSchema.safeParse(request.params.id);
  if (!parsed.success) fail(response, 400, 'VALIDATION_ERROR', 'The case ID is invalid.');
  return parsed.success ? parsed.data : undefined;
}

const notFound = (response: Response) => fail(response, 404, 'NOT_FOUND', 'That case could not be found.');

type Resolution = { correct: boolean; gaveUp: boolean };

/**
 * Atomically closes an active case. `expectedAttempts` makes concurrent submissions safe:
 * only the request that saw the current attempt count can write.
 */
async function resolveCase(
  doc: StoredCase & { userId?: unknown },
  resolution: Resolution,
  push: object,
  expectedAttempts: number,
) {
  const state = doc.state ?? {};
  const wrongAccusations = (state.accusations ?? []).filter((accusation) => !accusation.correct).length;
  const resolvedAt = new Date();
  const breakdown = computeScore({
    difficulty: doc.difficulty as Difficulty,
    correct: resolution.correct,
    gaveUp: resolution.gaveUp,
    hintsUsed: state.hintsUsed ?? 0,
    wrongAccusations,
    elapsedMs: resolvedAt.getTime() - new Date(state.startedAt ?? resolvedAt).getTime(),
  });
  const culpritId = doc.hidden?.truth?.culpritId ?? '';
  const updated = await CaseModel.findOneAndUpdate(
    { _id: doc._id, status: { $in: ACTIVE }, 'state.attemptsUsed': expectedAttempts },
    {
      $set: {
        status: 'resolved',
        'state.resolvedAt': resolvedAt,
        result: {
          score: breakdown.score,
          correct: resolution.correct,
          culpritId,
          gaveUp: resolution.gaveUp,
          breakdown,
        },
      },
      ...push,
    },
    { new: true },
  )
    .select('+hidden +evidence.clueId +evidence.pointsTo +evidence.kind')
    .lean();
  return updated as StoredCase | null;
}

async function loadForAccusation(request: Request, response: Response) {
  const caseId = caseIdOf(request, response);
  if (!caseId) return undefined;
  const doc = (await CaseModel.findOne({ _id: caseId, userId: response.locals.userId }).select('+hidden').lean()) as
    (StoredCase & { userId?: unknown }) | null;
  if (!doc) {
    notFound(response);
    return undefined;
  }
  if (!ACTIVE.includes(doc.status)) {
    fail(
      response,
      400,
      'VALIDATION_ERROR',
      doc.status === 'resolved' ? 'This case is closed.' : 'This case is not ready yet.',
    );
    return undefined;
  }
  return doc;
}

const busy = (response: Response) =>
  fail(response, 409, 'VALIDATION_ERROR', 'Another action on this case was just recorded. Refresh and try again.');

export const endgameController = {
  /** API-18. Server-side only; a wrong guess reveals nothing about the culprit (FR-22). */
  async accuse(request: Request, response: Response): Promise<void> {
    const input = response.locals.validatedBody as z.infer<typeof AccuseSchema>;
    const doc = await loadForAccusation(request, response);
    if (!doc) return;
    if (!(doc.suspects ?? []).some((suspect) => suspect.id === input.suspectId))
      return fail(response, 400, 'VALIDATION_ERROR', 'That person is not a suspect in this case.');

    const state = doc.state ?? {};
    const attemptsUsed = state.attemptsUsed ?? 0;
    const maxAttempts = state.maxAttempts ?? 2;
    const correct = input.suspectId === doc.hidden?.truth?.culpritId;
    const accusation = {
      suspectId: input.suspectId,
      ...(input.reasoning ? { reasoning: input.reasoning } : {}),
      at: new Date(),
      correct,
    };
    const exhausted = attemptsUsed + 1 >= maxAttempts;

    if (correct || exhausted) {
      const resolved = await resolveCase(
        doc,
        { correct, gaveUp: false },
        { $inc: { 'state.attemptsUsed': 1 }, $push: { 'state.accusations': accusation } },
        attemptsUsed,
      );
      if (!resolved) return busy(response);
      const view = toResolvedView(resolved);
      response.status(200).json({ correct, resolved: true, score: view.result?.score ?? 0, case: view });
      return;
    }

    const updated = await CaseModel.updateOne(
      { _id: doc._id, status: { $in: ACTIVE }, 'state.attemptsUsed': attemptsUsed },
      {
        $set: { status: 'in_progress' },
        $inc: { 'state.attemptsUsed': 1 },
        $push: { 'state.accusations': accusation },
      },
    );
    if (updated.modifiedCount !== 1) return busy(response);
    response.status(200).json({
      correct: false,
      resolved: false,
      attemptsRemaining: maxAttempts - attemptsUsed - 1,
      message: NUDGES[attemptsUsed % NUDGES.length],
    });
  },

  /** API-19. Give up: resolve with score 0 (FR-24). */
  async reveal(request: Request, response: Response): Promise<void> {
    const doc = await loadForAccusation(request, response);
    if (!doc) return;
    const resolved = await resolveCase(doc, { correct: false, gaveUp: true }, {}, doc.state?.attemptsUsed ?? 0);
    if (!resolved) return busy(response);
    response.status(200).json(toResolvedView(resolved));
  },

  /** API-11. Newest first, 20 per page (FR-26). */
  async list(request: Request, response: Response): Promise<void> {
    const page = Math.max(1, Math.min(1000, Number.parseInt(String(request.query.page ?? '1'), 10) || 1));
    const filter = { userId: response.locals.userId };
    const [total, docs] = await Promise.all([
      CaseModel.countDocuments(filter),
      CaseModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .select('title seed difficulty tone status createdAt result state.viewedEvidence evidence.id')
        .lean(),
    ]);
    const items: CaseListItem[] = docs.map((doc) => ({
      id: String(doc._id),
      // Before generation finishes there is no title yet; show the player's own seed.
      title: doc.title ?? `“${doc.seed.length > 70 ? `${doc.seed.slice(0, 70)}…` : doc.seed}”`,
      difficulty: doc.difficulty as CaseListItem['difficulty'],
      tone: doc.tone as CaseListItem['tone'],
      status: doc.status as CaseListItem['status'],
      createdAt: new Date(doc.createdAt).toISOString(),
      ...(doc.result
        ? { score: doc.result.score, correct: doc.result.correct, gaveUp: Boolean(doc.result.gaveUp) }
        : {}),
      ...(doc.evidence?.length
        ? { evidenceTotal: doc.evidence.length, evidenceViewed: doc.state?.viewedEvidence?.length ?? 0 }
        : {}),
    }));
    const result: CaseListResponse = { items, page, total, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
    response.status(200).json(result);
  },

  /** API-12. Hard delete including stored media (FR-27). */
  async remove(request: Request, response: Response): Promise<void> {
    const caseId = caseIdOf(request, response);
    if (!caseId) return;
    const doc = await CaseModel.findOneAndDelete({ _id: caseId, userId: response.locals.userId })
      .select('suspects.portraitPath evidence.content')
      .lean();
    if (!doc) return notFound(response);
    const files = new Set<string>();
    for (const suspect of doc.suspects ?? []) if (suspect.portraitPath) files.add(suspect.portraitPath);
    for (const item of doc.evidence ?? []) {
      const content = (item.content ?? {}) as { imageUrl?: string; frames?: Array<{ imageUrl?: string }> };
      if (content.imageUrl) files.add(content.imageUrl);
      for (const frame of content.frames ?? []) if (frame.imageUrl) files.add(frame.imageUrl);
    }
    const storage = getStorageDriver();
    const stored = [...files].filter((file) => STORED_MEDIA.test(file));
    const results = await Promise.allSettled(stored.map((file) => storage.delete(file)));
    const failed = results.filter((result) => result.status === 'rejected').length;
    if (failed) logger.warn({ caseId, failed }, 'Some media files could not be deleted');
    response.status(200).json({ deleted: true });
  },

  /** API-20. Opt-in public link for resolved cases only (FR-28). */
  async share(request: Request, response: Response): Promise<void> {
    const input = response.locals.validatedBody as z.infer<typeof ShareSchema>;
    const caseId = caseIdOf(request, response);
    if (!caseId) return;
    const doc = await CaseModel.findOne({ _id: caseId, userId: response.locals.userId }).select('status share').lean();
    if (!doc) return notFound(response);
    if (doc.status !== 'resolved') return fail(response, 400, 'VALIDATION_ERROR', 'Only a closed case can be shared.');
    const token = input.enabled ? (doc.share?.token ?? randomBytes(16).toString('base64url')) : undefined;
    await CaseModel.updateOne(
      { _id: caseId },
      input.enabled
        ? { $set: { 'share.enabled': true, 'share.token': token } }
        : { $set: { 'share.enabled': false }, $unset: { 'share.token': 1 } },
    );
    response.status(200).json({ shareToken: token ?? null });
  },

  /** API-21. Public, read-only summary. Never includes evidence. */
  async publicCase(request: Request, response: Response): Promise<void> {
    const token = ShareTokenSchema.safeParse(request.params.shareToken);
    if (!token.success) return notFound(response);
    const doc = (await CaseModel.findOne({ 'share.token': token.data, 'share.enabled': true, status: 'resolved' })
      .select('+hidden title difficulty setting briefing suspects result state.attemptsUsed state.hintsUsed status')
      .lean()) as (StoredCase & { hidden?: StoredCase['hidden'] }) | null;
    if (!doc || !doc.hidden?.truth || !doc.result) return notFound(response);
    const culprit = (doc.suspects ?? []).find((suspect) => suspect.id === doc.hidden?.truth?.culpritId);
    const view: PublicCaseView = {
      title: doc.title ?? 'Untitled case',
      difficulty: doc.difficulty,
      setting: {
        location: doc.setting?.location ?? '',
        date: doc.setting?.date ?? '',
        timeframe: doc.setting?.timeframe ?? '',
      },
      briefing: doc.briefing ?? '',
      suspects: (doc.suspects ?? []).map(({ id, name, role }) => ({ id, name, role })),
      outcome: {
        correct: doc.result.correct,
        gaveUp: Boolean(doc.result.gaveUp),
        score: doc.result.score,
        attemptsUsed: doc.state?.attemptsUsed ?? 0,
        hintsUsed: doc.state?.hintsUsed ?? 0,
      },
      culprit: { name: culprit?.name ?? 'Unknown', role: culprit?.role ?? '' },
      explanation: doc.hidden.truth.explanation,
    };
    response.setHeader('Cache-Control', 'public, max-age=60');
    response.status(200).json(view);
  },
};
