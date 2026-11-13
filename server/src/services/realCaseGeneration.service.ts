import type { Difficulty, Tone } from '@ai-mystery-room/shared';
import { CaseModel } from '../db/models/Case.js';
import { env } from '../config/env.js';
import { createGeminiSession, generateStructured, type GeminiSession } from './gemini/client.js';
import {
  BlueprintJsonSchema,
  BlueprintSchema,
  EvidenceBatchJsonSchema,
  EvidenceBatchSchema,
  ValidatorJsonSchema,
  ValidatorResultSchema,
  type Blueprint,
  type EvidenceText,
  type ValidatorResult,
} from './gemini/schemas.js';
import { buildBlueprintPrompt, DIFFICULTY_PLAN, PROMPT_VERSION } from './gemini/prompts/blueprint.prompt.js';
import { buildEvidenceBatchPrompt } from './gemini/prompts/evidence.prompt.js';
import { buildValidatorPrompt } from './gemini/prompts/validator.prompt.js';
import { getStorageDriver, type StorageDriver } from './storage/index.js';
import { classifyGeminiError, isGeminiQuotaError } from './gemini/errors.js';
import { logger } from '../utils/logger.js';

/** Evidence items generated per Gemini call (DEC-016). */
export const EVIDENCE_BATCH_SIZE = 5;
const PLACEHOLDER_PORTRAIT = '/media/portrait-placeholder.svg';
const PLACEHOLDER_EVIDENCE = '/media/evidence-placeholder.svg';

export type RealGenerationOptions = { generateImages?: boolean };

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
  const { suspects: expectedSuspects, evidence: expectedEvidence } = DIFFICULTY_PLAN[difficulty];
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
  const { trueClues: requiredTrueClues, redHerrings: requiredRedHerrings } = DIFFICULTY_PLAN[difficulty];
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
  const plannedTypes = countBy(blueprint.clueMap.map((clue) => clue.evidenceType));
  if (
    (plannedTypes.get('chat') ?? 0) < 2 ||
    (plannedTypes.get('image') ?? 0) < 2 ||
    (plannedTypes.get('cctv') ?? 0) < 1 ||
    (plannedTypes.get('document') ?? 0) < 1
  )
    throw new CaseValidationError(
      'The clueMap evidenceType mix needs at least 2 chat, 2 image, 1 cctv and 1 document items.',
    );
  const culprit = suspects.find((suspect) => suspect.id === blueprint.truth.culpritId);
  if (culprit && blueprint.hints.some((hint) => hint.toLocaleLowerCase().includes(culprit.name.toLocaleLowerCase())))
    throw new CaseValidationError('Hints must never name the culprit.');
}

function validateEvidence(evidence: EvidenceText[], blueprint: Blueprint, difficulty: Difficulty): void {
  const expectedCount = DIFFICULTY_PLAN[difficulty].evidence;
  if (evidence.some((item, index) => item.type !== blueprint.clueMap[index]?.evidenceType))
    throw new CaseValidationError('Each evidence item must use the type planned in the clueMap.');
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
        timeoutMs: env.GEMINI_TEXT_TIMEOUT_MS,
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

const ISO_WITH_ZONE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(?:Z|[+-]\d{2}:?\d{2})$/;

/**
 * Evidence times are case-local wall-clock times (DEC-018). Models pick arbitrary UTC
 * offsets per batch, so keep the clock time and rewrite every offset to +00:00.
 */
export function normalizeCaseTimestamps<T>(value: T): T {
  if (typeof value === 'string') {
    const match = ISO_WITH_ZONE.exec(value);
    return (match ? `${match[1]}+00:00` : value) as T;
  }
  if (Array.isArray(value)) return value.map((item) => normalizeCaseTimestamps(item)) as T;
  if (typeof value === 'object' && value !== null)
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalizeCaseTimestamps(child)])) as T;
  return value;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

/** Generates evidence in batches; every batch sees the full hidden plan (DEC-016). */
async function makeEvidence(
  session: GeminiSession,
  blueprint: Blueprint,
  difficulty: Difficulty,
  tone: Tone,
): Promise<EvidenceText[]> {
  const batches = chunk(blueprint.clueMap, EVIDENCE_BATCH_SIZE);
  const results = await mapWithLimit(batches, 3, (batch) =>
    generateStructured(
      session,
      {
        model: env.GEMINI_FAST_MODEL,
        buildPrompt: (error) => buildEvidenceBatchPrompt(blueprint, batch, difficulty, tone, error),
        jsonSchema: EvidenceBatchJsonSchema,
        temperature: 0.7,
        timeoutMs: env.GEMINI_TEXT_TIMEOUT_MS,
      },
      {
        parse(value: unknown): EvidenceText[] {
          const { items } = EvidenceBatchSchema.parse(value);
          if (items.length !== batch.length)
            throw new Error(`Return exactly ${batch.length} items; you returned ${items.length}.`);
          const wrong = items.findIndex((item, index) => item.type !== batch[index].evidenceType);
          if (wrong >= 0)
            throw new Error(
              `Item ${wrong + 1} must have type "${batch[wrong].evidenceType}", not "${items[wrong].type}".`,
            );
          return items;
        },
      },
    ),
  );
  return normalizeCaseTimestamps(results.flat());
}

/** Free-tier keys cannot generate images: use styled placeholders and keep the text (DEC-015). */
function applyPlaceholderMedia(evidence: Array<Record<string, unknown>>, suspects: Array<Record<string, unknown>>) {
  for (const suspect of suspects) suspect.portraitPath = PLACEHOLDER_PORTRAIT;
  for (const item of evidence) {
    const content = item.content as Record<string, unknown>;
    if (item.type === 'image') {
      delete content.imagePrompt;
      content.imageUrl = PLACEHOLDER_EVIDENCE;
      item.mediaStatus = 'placeholder';
    }
    if (item.type === 'cctv' && Array.isArray(content.frames)) {
      content.frames = content.frames.map((frame) => {
        const visible = { ...(frame as Record<string, unknown>) };
        delete visible.imagePrompt;
        visible.imageUrl = PLACEHOLDER_EVIDENCE;
        return visible;
      });
      item.mediaStatus = 'placeholder';
    }
  }
}

function isRetryableValidation(error: unknown): boolean {
  return (
    error instanceof CaseValidationError || (error instanceof Error && error.message.includes('failed validation'))
  );
}

export async function generateRealCase(
  caseId: string,
  session: GeminiSession = createGeminiSession(),
  storage: StorageDriver = getStorageDriver(),
  options: RealGenerationOptions = {},
): Promise<void> {
  const generateImages = options.generateImages ?? env.ENABLE_IMAGE_GENERATION;
  const caseDoc = await CaseModel.findById(caseId);
  if (!caseDoc) return;
  const difficulty = caseDoc.difficulty as Difficulty;
  const tone = caseDoc.tone as Tone;
  const storedFiles: string[] = [];
  const progress = (stage: string, percent: number) =>
    CaseModel.updateOne({ _id: caseId }, { $set: { progress: { stage, percent } } });
  let lastValidationError: string | undefined;
  // When only the evidence stage fails, the next attempt keeps the blueprint (spec FR-13, Stage 4).
  let blueprint: Blueprint | undefined;
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0) await cleanupMedia(storage, storedFiles);
      await CaseModel.updateOne(
        { _id: caseId },
        {
          $set: {
            status: 'generating',
            generationAttempts: attempt + 1,
            progress: { stage: 'blueprint', percent: blueprint ? 25 : 5 },
          },
        },
      );
      blueprint ??= await makeBlueprint(session, caseDoc.seed, difficulty, tone, lastValidationError);
      const plan = blueprint;
      await progress('evidence', 30);

      let evidenceTexts: EvidenceText[];
      try {
        evidenceTexts = await makeEvidence(session, plan, difficulty, tone);
        validateEvidence(evidenceTexts, plan, difficulty);
      } catch (error) {
        if (!isRetryableValidation(error)) throw error;
        lastValidationError = error instanceof Error ? error.message : 'Evidence failed validation.';
        logger.warn({ caseId, attempt, reason: lastValidationError }, 'evidence failed validation');
        if (attempt < 2) continue;
        throw new CaseValidationError(lastValidationError);
      }
      const evidence: Array<Record<string, unknown>> = evidenceTexts.map((item, index) => ({
        ...item,
        id: `e${index + 1}`,
        clueId: plan.clueMap[index].clueId,
        pointsTo: plan.clueMap[index].pointsTo,
        kind: plan.clueMap[index].kind,
        mediaStatus: 'ok',
      }));
      await progress('evidence', 55);

      const suspects: Array<Record<string, unknown>> = plan.suspects.map((suspect) => ({
        ...suspect,
        portraitPath: '',
      }));
      await progress('media', 55);
      if (generateImages) await generateMedia(caseId, evidence, suspects, session, storage, storedFiles);
      else applyPlaceholderMedia(evidence, suspects);
      await progress('validation', 90);

      let validator: ValidatorResult;
      try {
        validator = await generateStructured(
          session,
          {
            model: env.GEMINI_VALIDATOR_MODEL,
            buildPrompt: () => buildValidatorPrompt(makeValidatorCase(plan, evidenceTexts), difficulty, tone),
            jsonSchema: ValidatorJsonSchema,
            temperature: 0.1,
            timeoutMs: env.GEMINI_TEXT_TIMEOUT_MS,
          },
          ValidatorResultSchema,
        );
        checkBlindValidation(validator, plan, evidenceTexts);
      } catch (error) {
        if (!isRetryableValidation(error)) throw error;
        lastValidationError = error instanceof Error ? error.message : 'Blind validation failed.';
        logger.warn({ caseId, attempt, reason: lastValidationError }, 'case failed blind validation');
        // The plan itself may be unsolvable: regenerate from Stage 1.
        blueprint = undefined;
        if (attempt < 2) continue;
        throw new CaseValidationError(lastValidationError);
      }

      const hidden = {
        truth: plan.truth,
        clueMap: plan.clueMap,
        hints: plan.hints,
        validationReport: {
          mode: 'gemini',
          passed: true,
          checkedAt: new Date().toISOString(),
          media: generateImages ? 'generated' : 'disabled',
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
            title: plan.title,
            setting: plan.setting,
            briefing: plan.briefing,
            suspects,
            evidence,
            hidden,
            promptVersion: PROMPT_VERSION,
          },
        },
      );
      logger.info({ event: 'case_generation_cost', caseId, attempts: attempt + 1, ...session.usage() }, 'case ready');
      return;
    }
    throw new CaseValidationError(lastValidationError ?? 'Case validation failed after three attempts.');
  } catch (error) {
    await cleanupMedia(storage, storedFiles);
    logger.info({ event: 'case_generation_cost', caseId, failed: true, ...session.usage() }, 'case generation failed');
    throw error;
  }
}
