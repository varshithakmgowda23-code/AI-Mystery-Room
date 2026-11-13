import type { Request, Response } from 'express';
import { CaseIdSchema } from '@ai-mystery-room/shared';
import { CaseModel } from '../db/models/Case.js';
import { getStorageDriver } from '../services/storage/index.js';

function containsFilename(caseDoc: { suspects: Array<{ portraitPath?: string | null }>; evidence: Array<{ content: unknown }> }, filename: string): boolean {
  if (caseDoc.suspects.some((suspect) => suspect.portraitPath === filename)) return true;
  return caseDoc.evidence.some((item) => {
    if (typeof item.content !== 'object' || item.content === null) return false;
    const content = item.content as Record<string, unknown>;
    if (content.imageUrl === filename) return true;
    return Array.isArray(content.frames) && content.frames.some((frame) => typeof frame === 'object' && frame !== null && (frame as Record<string, unknown>).imageUrl === filename);
  });
}

export async function serveMedia(request: Request, response: Response): Promise<void> {
  const caseId = CaseIdSchema.safeParse(request.params.caseId);
  const filename = zodFilename.safeParse(request.params.filename);
  if (!caseId.success || !filename.success) {
    response.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'The media address is invalid.' } });
    return;
  }
  const caseDoc = await CaseModel.findOne({ _id: caseId.data, userId: response.locals.userId });
  if (!caseDoc || !containsFilename(caseDoc, filename.data)) {
    response.status(404).json({ error: { code: 'NOT_FOUND', message: 'The requested media was not found.' } });
    return;
  }
  try {
    const media = await getStorageDriver().read(filename.data);
    response.setHeader('Cache-Control', 'private, no-store');
    response.type(media.mimeType).send(media.bytes);
  } catch {
    response.status(404).json({ error: { code: 'NOT_FOUND', message: 'The requested media was not found.' } });
  }
}

import { z } from 'zod';
const zodFilename = z.string().regex(/^[\da-f-]{36}\.(png|jpg|webp)$/i);
