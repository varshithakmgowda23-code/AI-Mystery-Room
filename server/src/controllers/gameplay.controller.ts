import type { Request, Response } from 'express';
import { z } from 'zod';
import { CaseIdSchema, EvidenceIdSchema, NotesSchema, SuspectTagsSchema } from '@ai-mystery-room/shared';
import { CaseModel } from '../db/models/Case.js';
import { HINTS_PER_CASE, toPlayerView, toResolvedView, type StoredCase } from '../services/caseView.service.js';

const ACTIVE = ['ready', 'in_progress'];

function fail(response: Response, status: number, code: string, message: string): void {
  response.status(status).json({ error: { code, message } });
}

function caseIdOf(request: Request, response: Response): string | undefined {
  const parsed = CaseIdSchema.safeParse(request.params.id);
  if (!parsed.success) fail(response, 400, 'VALIDATION_ERROR', 'The case ID is invalid.');
  return parsed.success ? parsed.data : undefined;
}

const notFound = (response: Response) => fail(response, 404, 'NOT_FOUND', 'That case could not be found.');

/** Loads an owned case that can still be played, or sends the right error. */
async function loadActive(request: Request, response: Response, fields: string) {
  const caseId = caseIdOf(request, response);
  if (!caseId) return undefined;
  const doc = await CaseModel.findOne({ _id: caseId, userId: response.locals.userId })
    .select(`status ${fields}`)
    .lean();
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
  return { caseId, doc };
}

export const gameplayController = {
  /** API-10. The first open starts the clock (FR-21). */
  async get(request: Request, response: Response): Promise<void> {
    const caseId = caseIdOf(request, response);
    if (!caseId) return;
    const doc = (await CaseModel.findOne({ _id: caseId, userId: response.locals.userId })
      .select('+hidden +evidence.clueId +evidence.pointsTo +evidence.kind')
      .lean()) as StoredCase | null;
    if (!doc) return notFound(response);
    if (doc.status === 'ready') {
      const startedAt = new Date();
      const update = await CaseModel.updateOne(
        { _id: caseId, status: 'ready' },
        { $set: { status: 'in_progress', 'state.startedAt': startedAt } },
      );
      if (update.modifiedCount === 1) {
        doc.status = 'in_progress';
        doc.state = { ...(doc.state ?? {}), startedAt };
      }
    }
    response.setHeader('Cache-Control', 'private, no-store');
    response.status(200).json(doc.status === 'resolved' ? toResolvedView(doc) : toPlayerView(doc));
  },

  /** API-14. */
  async notes(request: Request, response: Response): Promise<void> {
    const input = response.locals.validatedBody as z.infer<typeof NotesSchema>;
    const loaded = await loadActive(request, response, '_id');
    if (!loaded) return;
    await CaseModel.updateOne({ _id: loaded.caseId }, { $set: { 'state.notes': input.notes } });
    response.status(200).json({ notes: input.notes });
  },

  /** API-15. Tags are a private aid; they never affect scoring (FR-19). */
  async suspectTags(request: Request, response: Response): Promise<void> {
    const input = response.locals.validatedBody as z.infer<typeof SuspectTagsSchema>;
    const loaded = await loadActive(request, response, 'suspects.id');
    if (!loaded) return;
    const known = new Set((loaded.doc.suspects ?? []).map((suspect) => suspect.id));
    if (Object.keys(input.tags).some((id) => !known.has(id)))
      return fail(response, 400, 'VALIDATION_ERROR', 'One of those suspects is not part of this case.');
    await CaseModel.updateOne({ _id: loaded.caseId }, { $set: { 'state.suspectTags': input.tags } });
    response.status(200).json({ suspectTags: input.tags });
  },

  /** API-16. */
  async viewEvidence(request: Request, response: Response): Promise<void> {
    const evidenceId = EvidenceIdSchema.safeParse(request.params.evidenceId);
    if (!evidenceId.success) return fail(response, 400, 'VALIDATION_ERROR', 'The evidence ID is invalid.');
    const loaded = await loadActive(request, response, 'evidence.id');
    if (!loaded) return;
    if (!(loaded.doc.evidence ?? []).some((item) => item.id === evidenceId.data)) return notFound(response);
    const updated = await CaseModel.findOneAndUpdate(
      { _id: loaded.caseId },
      { $addToSet: { 'state.viewedEvidence': evidenceId.data } },
      { new: true, projection: { 'state.viewedEvidence': 1 } },
    ).lean();
    response.status(200).json({ viewedEvidence: updated?.state?.viewedEvidence ?? [evidenceId.data] });
  },

  /** API-17. Atomic so double clicks cannot reveal two hints for one request. */
  async hint(request: Request, response: Response): Promise<void> {
    const loaded = await loadActive(request, response, 'state.hintsUsed');
    if (!loaded) return;
    const updated = (await CaseModel.findOneAndUpdate(
      { _id: loaded.caseId, status: { $in: ACTIVE }, 'state.hintsUsed': { $lt: HINTS_PER_CASE } },
      { $inc: { 'state.hintsUsed': 1 } },
      { new: true, projection: { 'state.hintsUsed': 1, hidden: 1 } },
    )
      .select('+hidden')
      .lean()) as StoredCase | null;
    const hintsUsed = updated?.state?.hintsUsed ?? 0;
    const hint = updated?.hidden?.hints?.[hintsUsed - 1];
    if (!updated || !hint) return fail(response, 400, 'VALIDATION_ERROR', 'You have used every hint for this case.');
    response.status(200).json({ hint, hintsUsed, hintsAvailable: HINTS_PER_CASE });
  },
};
