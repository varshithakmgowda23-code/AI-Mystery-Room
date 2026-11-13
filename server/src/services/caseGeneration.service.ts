import { CaseModel } from '../db/models/Case.js';
import { env } from '../config/env.js';
import { buildMockCase } from './mockGeneration.service.js';
import { generateRealCase } from './realCaseGeneration.service.js';
import { CONTENT_POLICY_MESSAGE, screenSeed } from './gemini/safety.js';
import { classifyGeminiError } from './gemini/errors.js';

const stageLabels: Record<string, string> = {
  blueprint: 'Drafting the crime…',
  evidence: 'Fabricating evidence…',
  media: 'Developing photos and pulling CCTV footage…',
  validation: 'Verifying the case is solvable…',
};

async function setProgress(caseId: string, stage: string, percent: number): Promise<void> {
  await CaseModel.updateOne({ _id: caseId }, { $set: { status: 'generating', progress: { stage, percent } }, $inc: { generationAttempts: percent === 0 ? 1 : 0 } });
}

function assertMockCaseIsSolvable(content: ReturnType<typeof buildMockCase>, difficulty: string): string[] {
  const expectedSuspects = difficulty === 'easy' ? 4 : difficulty === 'medium' ? 5 : 6;
  const expectedEvidence = difficulty === 'easy' ? 8 : difficulty === 'medium' ? 11 : 14;
  const counts = content.evidence.reduce<Record<string, number>>((result, item) => {
    result[item.type] = (result[item.type] ?? 0) + 1;
    return result;
  }, {});
  const trueClues = content.evidence.filter((item) => item.kind === 'true_clue' && item.pointsTo === content.hidden.truth.culpritId);
  const redHerrings = content.evidence.filter((item) => item.kind === 'red_herring' && item.pointsTo !== content.hidden.truth.culpritId);
  const minimumTrueClues = difficulty === 'hard' ? 4 : 3;
  if (content.suspects.length !== expectedSuspects || content.evidence.length !== expectedEvidence) throw new Error('Generated content has the wrong number of suspects or evidence items.');
  if ((counts.chat ?? 0) < 2 || (counts.image ?? 0) < 2 || (counts.cctv ?? 0) < 1 || (counts.document ?? 0) < 1) throw new Error('Generated content is missing a required evidence type.');
  if (trueClues.length < minimumTrueClues || redHerrings.length < 2) throw new Error('Generated evidence does not provide enough clues to solve the case.');
  if (!content.suspects.some((suspect) => suspect.id === content.hidden.truth.culpritId)) throw new Error('The culprit must be one of the listed suspects.');
  const evidenceClueIds = new Set(content.evidence.map((item) => item.clueId));
  if (content.hidden.clueMap.length !== content.evidence.length || content.hidden.clueMap.some((clue) => !evidenceClueIds.has(clue.clueId))) throw new Error('The evidence does not realize every planned clue.');
  if (content.evidence.some((item) => Number.isNaN(Date.parse(item.occurredAt)))) throw new Error('Evidence timestamps must be valid.');
  return trueClues.map((item) => item.id);
}

export async function generateCase(caseId: string): Promise<void> {
  try {
    const caseDoc = await CaseModel.findById(caseId);
    if (!caseDoc) return;

    const safety = await screenSeed(caseDoc.seed);
    if (!safety.safe) {
      await CaseModel.updateOne({ _id: caseId }, {
        $set: { status: 'failed', failureCode: 'CONTENT_POLICY', failureReason: CONTENT_POLICY_MESSAGE, failureRetryAt: null, progress: { stage: 'failed', percent: 0 } },
      });
      return;
    }

    if (!env.MOCK_GEMINI) {
      await generateRealCase(caseId);
      return;
    }

    await setProgress(caseId, 'blueprint', 0);
    const content = buildMockCase(caseDoc.difficulty as 'easy' | 'medium' | 'hard', caseDoc.tone as 'classic_noir' | 'modern_thriller' | 'cozy' | 'corporate', caseDoc.seed);
    await setProgress(caseId, 'blueprint', 25);
    await new Promise((resolve) => setTimeout(resolve, 35));

    await setProgress(caseId, 'evidence', 45);
    await new Promise((resolve) => setTimeout(resolve, 35));
    await setProgress(caseId, 'evidence', 55);

    await setProgress(caseId, 'media', 70);
    await new Promise((resolve) => setTimeout(resolve, 35));
    await setProgress(caseId, 'media', 90);

    await setProgress(caseId, 'validation', 95);
    const supportingClues = assertMockCaseIsSolvable(content, caseDoc.difficulty);
    await CaseModel.updateOne({ _id: caseId }, {
      $set: {
        status: 'ready', progress: { stage: 'complete', percent: 100 }, title: content.title,
        setting: content.setting, briefing: content.briefing, suspects: content.suspects,
        evidence: content.evidence, hidden: { ...content.hidden, validationReport: { ...content.hidden.validationReport, supportingClues } },
      },
    });
  } catch (error) {
    const failure = classifyGeminiError(error);
    await CaseModel.updateOne({ _id: caseId }, { $set: {
      status: 'failed', failureCode: failure.code, failureReason: failure.message,
      failureRetryAt: failure.retryAt ? new Date(failure.retryAt) : null,
      progress: { stage: 'failed', percent: 0 },
    } });
  }
}

export async function failStuckGenerations(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 10 * 60 * 1000);
  const result = await CaseModel.updateMany({ status: { $in: ['queued', 'generating'] }, updatedAt: { $lt: cutoff } }, {
    $set: { status: 'failed', failureCode: 'GENERATION_FAILED', failureReason: 'Something went wrong while generating the case.', failureRetryAt: null, progress: { stage: 'failed', percent: 0 } },
  });
  return result.modifiedCount;
}

export function generationStageLabel(stage: string): string {
  return stageLabels[stage] ?? (stage === 'complete' ? 'Case ready.' : 'Preparing the case…');
}
