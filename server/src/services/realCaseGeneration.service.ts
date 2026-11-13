import type { Difficulty, Tone } from '@ai-mystery-room/shared';
import { CaseModel } from '../db/models/Case.js';
import { env } from '../config/env.js';
import { createGeminiSession, generateStructured, type GeminiSession } from './gemini/client.js';
import {
  BlueprintJsonSchema,
  BlueprintSchema,
  EvidenceJsonSchema,
  EvidenceTextSchema,
  ValidatorJsonSchema,
  ValidatorResultSchema,
  type Blueprint,
  type EvidenceText,
  type ValidatorResult,
} from './gemini/schemas.js';
import { buildBlueprintPrompt } from './gemini/prompts/blueprint.prompt.js';
import { buildEvidencePrompt } from './gemini/prompts/evidence.prompt.js';
import { buildValidatorPrompt } from './gemini/prompts/validator.prompt.js';
import { getStorageDriver, type StorageDriver } from './storage/index.js';
import { classifyGeminiError, isGeminiQuotaError } from './gemini/errors.js';

class CaseValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CaseValidationError';
  }
}

async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  operation: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await operation(items[index], index);
    }
  });
  const outcomes = await Promise.allSettled(workers);
  const failed = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');
  if (failed) throw failed.reason;
  return results;
}

function countBy<T extends string>(values: T[]): Map<T, number> {
  return values.reduce((counts, value) => counts.set(value, (counts.get(value) ?? 0) + 1), new Map<T, number>());
}

function validateBlueprint(blueprint: Blueprint, difficulty: Difficulty): void {
  const expectedSuspects = difficulty === 'easy' ? 4 : difficulty === 'medium' ? 5 : 6;
  const expectedEvidence = difficulty === 'easy' ? 8 : difficulty === 'medium' ? 11 : 14;
  const suspects = blueprint.suspects;
  const names = new Set(suspects.map((suspect) => suspect.name.trim().toLocaleLowerCase()));
  if (suspects.length !== expectedSuspects || blueprint.clueMap.length !== expectedEvidence)
    throw new CaseValidationError('Use the exact suspect and clue counts for the selected difficulty.');
  if (new Set(suspects.map((suspect) => suspect.id)).size !== expectedSuspects || names.size !== expectedSuspects)
    throw new CaseValidationError('Suspect IDs and names must be unique.');
  if (!suspects.some((suspect) => suspect.id === blueprint.truth.culpritId))
    throw new CaseValidationError('The culprit must be one of the listed suspects.');
  const clueIds = new Set(blueprint.clueMap.map((clue) => clue.clueId));
  if (
    clueIds.size !== blueprint.clueMap.length ||
    blueprint.clueMap.some((clue, index) => clue.clueId !== `c${index + 1}`)
  )
    throw new CaseValidationError('Clue IDs must be unique and sequential.');
  const trueClues = blueprint.clueMap.filter(
    (clue) => clue.kind === 'true_clue' && clue.pointsTo === blueprint.truth.culpritId,
  );
  const redHerrings = blueprint.clueMap.filter(
    (clue) => clue.kind === 'red_herring' && clue.pointsTo !== null && clue.pointsTo !== blueprint.truth.culpritId,
  );
  const requiredTrueClues = difficulty === 'hard' ? 4 : 3;
  const requiredRedHerrings = difficulty === 'hard' ? 3 : 2;
  if (trueClues.length < requiredTrueClues || redHerrings.length < requiredRedHerrings)
    throw new CaseValidationError('The clue plan needs more independent culprit clues or red herrings.');
  if (
    blueprint.clueMap.some(
      (clue) => clue.kind === 'red_herring' && (clue.pointsTo === null || clue.pointsTo === blueprint.truth.culpritId),
    )
  )
    throw new CaseValidationError('Every red herring must point to an innocent suspect.');
  if (blueprint.clueMap.some((clue) => clue.kind === 'true_clue' && clue.pointsTo !== blueprint.truth.culpritId))
    throw new CaseValidationError('Every true clue must point to the culprit.');
  const innocents = suspects.filter((suspect) => suspect.id !== blueprint.truth.culpritId);
  if (
    innocents.some(
      (suspect) => !blueprint.clueMap.some((clue) => clue.kind === 'alibi' && clue.pointsTo === suspect.id),
    )
  )
    throw new CaseValidationError('Every innocent suspect needs at least one evidence-backed alibi.');
  if (
    !blueprint.briefing.trim().split(/\s+/).length ||
    blueprint.briefing.trim().split(/\s+/).length < 80 ||
    blueprint.briefing.trim().split(/\s+/).length > 160
  )
    throw new CaseValidationError('The briefing must be 80–160 words.');
  const culprit = suspects.find((suspect) => suspect.id === blueprint.truth.culpritId);
  if (culprit && blueprint.hints.some((hint) => hint.toLocaleLowerCase().includes(culprit.name.toLocaleLowerCase())))
    throw new CaseValidationError('Hints must never name the culprit.');
}

function validateEvidence(evidence: EvidenceText[], blueprint: Blueprint, difficulty: Difficulty): void {
  const expectedCount = difficulty === 'easy' ? 8 : difficulty === 'medium' ? 11 : 14;
  const typeCounts = countBy(evidence.map((item) => item.type));
  if (evidence.length !== expectedCount)
    throw new CaseValidationError('Evidence count does not match the selected difficulty.');
  if (
    (typeCounts.get('chat') ?? 0) < 2 ||
    (typeCounts.get('image') ?? 0) < 2 ||
    (typeCounts.get('cctv') ?? 0) < 1 ||
    (typeCounts.get('document') ?? 0) < 1
  )
    throw new CaseValidationError('Evidence must include two chats, two images, CCTV, and a document.');
  const names = blueprint.suspects.map((suspect) => suspect.name.toLocaleLowerCase());
  const confessionPattern = /\b(i (?:stole|took|moved|killed|poisoned)|i did it|my confession|i am the culprit)\b/i;
  for (const item of evidence) {
    if (Number.isNaN(Date.parse(item.occurredAt)))
      throw new CaseValidationError('Evidence timestamps must be parseable.');
    const content = JSON.stringify(item.content);
    if (confessionPattern.test(content))
      throw new CaseValidationError('Player-visible evidence must not contain an outright confession.');
    if (
      names.some(
        (name) => content.toLocaleLowerCase().includes(name) && /\b(?:confess|admit|stole|culprit)\b/i.test(content),
      )
    )
      throw new CaseValidationError('Evidence must not name the culprit as guilty outright.');
  }
}

function playerVisibleContent(item: EvidenceText): Record<string, unknown> {
  const content = { ...item.content } as Record<string, unknown>;
  delete content.imagePrompt;
  if (Array.isArray(content.frames))
    content.frames = content.frames.map((frame) => {
      if (typeof frame !== 'object' || frame === null) return frame;
      const visible = { ...(frame as Record<string, unknown>) };
      delete visible.imagePrompt;
      return visible;
    });
  return content;
}

function imageStyle(prompt: string, type: 'photo' | 'cctv' | 'portrait'): string {
  const suffix =
    type === 'cctv'
      ? 'low-resolution security camera frame, wide angle, grainy, fictional people only, no legible text.'
      : type === 'portrait'
        ? 'stylized editorial illustration, clearly fictional adult, not photorealistic, no real-person likeness.'
        : 'realistic, natural lighting, no visible text, no faces of real people.';
  return `${prompt.trim()} ${suffix}`;
}

type MediaTask = {
  kind: 'portrait' | 'photo' | 'cctv';
  prompt: string;
  complete(filename: string): void;
  placeholder(): void;
};

async function generateMedia(
  caseId: string,
  evidence: Array<Record<string, unknown>>,
  suspects: Array<Record<string, unknown>>,
  session: GeminiSession,
  storage: StorageDriver,
  storedFiles: string[],
): Promise<void> {
  const tasks: MediaTask[] = [];
  for (const suspect of suspects) {
    const prompt = String(
      suspect.appearancePrompt ?? `Stylized editorial illustration of fictional adult ${suspect.role}.`,
    );
    tasks.push({
      kind: 'portrait',
      prompt: imageStyle(prompt, 'portrait'),
      complete: (filename) => {
        suspect.portraitPath = filename;
      },
      placeholder: () => {
        suspect.portraitPath = '/media/portrait-placeholder.svg';
      },
    });
  }
  for (const item of evidence) {
    const content = item.content as Record<string, unknown>;
    if (item.type === 'image') {
      const prompt = String(content.imagePrompt ?? content.caption ?? 'A fictional case evidence photograph.');
      delete content.imagePrompt;
      tasks.push({
        kind: 'photo',
        prompt: imageStyle(prompt, 'photo'),
        complete: (filename) => {
          content.imageUrl = filename;
          if (item.mediaStatus !== 'placeholder') item.mediaStatus = 'ok';
        },
        placeholder: () => {
          content.imageUrl = '/media/evidence-placeholder.svg';
          item.mediaStatus = 'placeholder';
        },
      });
    }
    if (item.type === 'cctv' && Array.isArray(content.frames)) {
      for (const frameValue of content.frames) {
        const frame = frameValue as Record<string, unknown>;
        const prompt = String(frame.imagePrompt ?? frame.note ?? 'A fictional empty gallery corridor.');
        delete frame.imagePrompt;
        tasks.push({
          kind: 'cctv',
          prompt: imageStyle(prompt, 'cctv'),
          complete: (filename) => {
            frame.imageUrl = filename;
            if (item.mediaStatus !== 'placeholder') item.mediaStatus = 'ok';
          },
          placeholder: () => {
            frame.imageUrl = '/media/evidence-placeholder.svg';
            item.mediaStatus = 'placeholder';
          },
        });
      }
    }
  }

  let completed = 0;
  let failures = 0;
  let quotaExhausted = false;
  const mediaErrors: unknown[] = [];
  await mapWithLimit(tasks, 3, async (task) => {
    if (quotaExhausted) return;
    try {
      const generated = await session.generateImage(task.prompt);
      const filename = await storage.save(generated.bytes, generated.mimeType);
      storedFiles.push(filename);
      task.complete(filename);
    } catch (error) {
      if (isGeminiQuotaError(error)) {
        quotaExhausted = true;
        throw error;
      }
      failures += 1;
      mediaErrors.push(error);
      task.placeholder();
    } finally {
      completed += 1;
      const percent = 55 + Math.floor((35 * completed) / tasks.length);
      await CaseModel.updateOne({ _id: caseId }, { $set: { progress: { stage: 'media', percent } } });
    }
  });

  if (tasks.length > 0 && failures / tasks.length > 0.3) {
    const serviceFailure = mediaErrors.find((error) => classifyGeminiError(error).code !== 'GENERATION_FAILED');
    if (serviceFailure) throw serviceFailure;
    throw new CaseValidationError(`Too many generated media items failed (${failures}/${tasks.length}).`);
  }
}

async function cleanupMedia(storage: StorageDriver, files: string[]): Promise<void> {
  await Promise.all(files.map((filename) => storage.delete(filename).catch(() => undefined)));
  files.splice(0, files.length);
}

function makeValidatorCase(blueprint: Blueprint, evidence: EvidenceText[]) {
  return {
    title: blueprint.title,
    setting: blueprint.setting,
    briefing: blueprint.briefing,
    suspects: blueprint.suspects.map(({ id, name, age, role, description, alibi }) => ({
      id,
      name,
      age,
      role,
      description,
      alibi,
    })),
    evidence: evidence.map((item, index) => ({
      id: `e${index + 1}`,
      type: item.type,
      title: item.title,
      summary: item.summary,
      occurredAt: item.occurredAt,
      source: item.source,
      content: playerVisibleContent(item),
    })),
  };
}

function checkBlindValidation(result: ValidatorResult, blueprint: Blueprint, evidence: EvidenceText[]): void {
  const supportingTrueClues = new Set(
    blueprint.clueMap.flatMap((clue, index) =>
      clue.kind === 'true_clue' && clue.pointsTo === blueprint.truth.culpritId ? [`e${index + 1}`] : [],
    ),
  );
  const validCitedClues = result.supportingEvidenceIds.filter((id) => supportingTrueClues.has(id));
  if (result.chosenSuspectId !== blueprint.truth.culpritId || new Set(validCitedClues).size < 2)
    throw new CaseValidationError(
      `Blind validator could not solve the case from visible evidence: ${result.reasoning}`,
    );
  if (result.supportingEvidenceIds.some((id) => Number(id.slice(1)) > evidence.length))
    throw new CaseValidationError('Blind validator cited an evidence item that does not exist.');
}

async function makeBlueprint(
  session: GeminiSession,
  seed: string,
  difficulty: Difficulty,
  tone: Tone,
  lastError?: string,
): Promise<Blueprint> {
  let validationError = lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const blueprint = await generateStructured(
      session,
      {
        model: env.GEMINI_TEXT_MODEL,
        buildPrompt: (error) => buildBlueprintPrompt(seed, difficulty, tone, error ?? validationError),
        jsonSchema: BlueprintJsonSchema,
        temperature: 0.9,
        timeoutMs: 60_000,
      },
      BlueprintSchema,
    );
    try {
      validateBlueprint(blueprint, difficulty);
      return blueprint;
    } catch (error) {
      validationError = error instanceof Error ? error.message : 'Blueprint failed deterministic checks.';
      if (attempt === 2) throw new CaseValidationError(validationError);
    }
  }
  throw new CaseValidationError('Blueprint failed validation.');
}

export async function generateRealCase(
  caseId: string,
  session: GeminiSession = createGeminiSession(),
  storage: StorageDriver = getStorageDriver(),
): Promise<void> {
  const caseDoc = await CaseModel.findById(caseId);
  if (!caseDoc) return;
  const difficulty = caseDoc.difficulty as Difficulty;
  const tone = caseDoc.tone as Tone;
  const storedFiles: string[] = [];
  let lastValidationError: string | undefined;
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0) await cleanupMedia(storage, storedFiles);
      await CaseModel.updateOne(
        { _id: caseId },
        {
          $set: { status: 'generating', generationAttempts: attempt + 1, progress: { stage: 'blueprint', percent: 5 } },
        },
      );
      const blueprint = await makeBlueprint(session, caseDoc.seed, difficulty, tone, lastValidationError);
      await CaseModel.updateOne({ _id: caseId }, { $set: { progress: { stage: 'blueprint', percent: 25 } } });

      await CaseModel.updateOne({ _id: caseId }, { $set: { progress: { stage: 'evidence', percent: 30 } } });
      let evidenceTexts: EvidenceText[];
      try {
        evidenceTexts = await mapWithLimit(blueprint.clueMap, 3, async (clue) =>
          generateStructured(
            session,
            {
              model: env.GEMINI_TEXT_MODEL,
              buildPrompt: () => buildEvidencePrompt(blueprint, clue, difficulty, tone),
              jsonSchema: EvidenceJsonSchema,
              temperature: 0.7,
              timeoutMs: 60_000,
            },
            EvidenceTextSchema,
          ),
        );
        validateEvidence(evidenceTexts, blueprint, difficulty);
      } catch (error) {
        if (
          error instanceof CaseValidationError ||
          (error instanceof Error && error.message.includes('failed validation'))
        ) {
          lastValidationError = error instanceof Error ? error.message : 'Evidence failed validation.';
          if (attempt < 2) continue;
          throw new CaseValidationError(lastValidationError);
        }
        throw error;
      }
      const evidence: Array<Record<string, unknown>> = evidenceTexts.map((item, index) => ({
        ...item,
        id: `e${index + 1}`,
        clueId: blueprint.clueMap[index].clueId,
        pointsTo: blueprint.clueMap[index].pointsTo,
        kind: blueprint.clueMap[index].kind,
        mediaStatus: 'ok',
      }));
      await CaseModel.updateOne({ _id: caseId }, { $set: { progress: { stage: 'evidence', percent: 55 } } });

      const suspects: Array<Record<string, unknown>> = blueprint.suspects.map((suspect) => ({
        ...suspect,
        portraitPath: '',
      }));
      await CaseModel.updateOne({ _id: caseId }, { $set: { progress: { stage: 'media', percent: 55 } } });
      await generateMedia(caseId, evidence, suspects, session, storage, storedFiles);
      await CaseModel.updateOne({ _id: caseId }, { $set: { progress: { stage: 'validation', percent: 90 } } });

      let validator: ValidatorResult;
      try {
        validator = await generateStructured(
          session,
          {
            model: env.GEMINI_VALIDATOR_MODEL,
            buildPrompt: () => buildValidatorPrompt(makeValidatorCase(blueprint, evidenceTexts), difficulty, tone),
            jsonSchema: ValidatorJsonSchema,
            temperature: 0.1,
            timeoutMs: 60_000,
          },
          ValidatorResultSchema,
        );
      } catch (error) {
        if (error instanceof Error && error.message.includes('failed validation')) {
          lastValidationError = error.message;
          if (attempt < 2) continue;
          throw new CaseValidationError(lastValidationError);
        }
        throw error;
      }
      try {
        checkBlindValidation(validator, blueprint, evidenceTexts);
      } catch (error) {
        lastValidationError = error instanceof Error ? error.message : 'Blind validation failed.';
        if (attempt === 2) throw new CaseValidationError(lastValidationError);
        continue;
      }

      const hidden = {
        truth: blueprint.truth,
        clueMap: blueprint.clueMap,
        hints: blueprint.hints,
        validationReport: {
          mode: 'gemini',
          passed: true,
          checkedAt: new Date().toISOString(),
          validator,
          supportingTrueClues: validator.supportingEvidenceIds,
        },
      };
      await CaseModel.updateOne(
        { _id: caseId },
        {
          $set: {
            status: 'ready',
            progress: { stage: 'complete', percent: 100 },
            title: blueprint.title,
            setting: blueprint.setting,
            briefing: blueprint.briefing,
            suspects,
            evidence,
            hidden,
            promptVersion: '1.0.0',
          },
        },
      );
      console.info(JSON.stringify({ event: 'case_generation_cost', caseId, ...session.usage() }));
      return;
    }
    throw new CaseValidationError(lastValidationError ?? 'Case validation failed after three attempts.');
  } catch (error) {
    await cleanupMedia(storage, storedFiles);
    console.info(JSON.stringify({ event: 'case_generation_cost', caseId, failed: true, ...session.usage() }));
    throw error;
  }
}
