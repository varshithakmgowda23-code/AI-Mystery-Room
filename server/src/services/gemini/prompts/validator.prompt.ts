import type { Difficulty, Tone } from '@ai-mystery-room/shared';
import { FAIRNESS_SAFETY_CONTRACT } from './shared.js';

export function buildValidatorPrompt(playerVisibleCase: unknown, difficulty: Difficulty, tone: Tone) {
  return {
    system: `You are a blind detective checking whether a fictional mystery is fairly solvable. You receive only player-visible briefing, suspect descriptions and evidence. Do not guess from outside knowledge or hidden information. Return JSON with chosenSuspectId, supportingEvidenceIds (at least two), and concise reasoning. ${FAIRNESS_SAFETY_CONTRACT}`,
    user: `Analyze this case at difficulty=${difficulty}, tone=${tone}. Identify the single most likely culprit using only these visible clues. If the evidence does not support one suspect clearly, say so in reasoning and choose the best-supported candidate.
PLAYER-VISIBLE CASE JSON:
${JSON.stringify(playerVisibleCase).slice(0, 24_000)}
Return only JSON.`,
  };
}
