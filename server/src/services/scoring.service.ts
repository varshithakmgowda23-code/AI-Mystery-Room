import type { Difficulty } from '@ai-mystery-room/shared';

/** Spec §14. */
export const SCORING = {
  base: 1000,
  multiplier: { easy: 0.8, medium: 1.0, hard: 1.3 } as Record<Difficulty, number>,
  hintPenalty: 100,
  wrongPenalty: 150,
  timeBonusMax: 200,
  timeBonusPerMinute: 5,
} as const;

export type ScoreInput = {
  difficulty: Difficulty;
  correct: boolean;
  gaveUp: boolean;
  hintsUsed: number;
  wrongAccusations: number;
  elapsedMs: number;
};

export type ScoreBreakdown = {
  base: number;
  hintPenalty: number;
  wrongPenalty: number;
  timeBonus: number;
  multiplier: number;
  elapsedMinutes: number;
  score: number;
};

export function computeScore(input: ScoreInput): ScoreBreakdown {
  const elapsedMinutes = Math.max(0, Math.floor(input.elapsedMs / 60_000));
  const hintPenalty = SCORING.hintPenalty * Math.max(0, input.hintsUsed);
  const wrongPenalty = SCORING.wrongPenalty * Math.max(0, input.wrongAccusations);
  const timeBonus = Math.max(0, SCORING.timeBonusMax - elapsedMinutes * SCORING.timeBonusPerMinute);
  const multiplier = SCORING.multiplier[input.difficulty];
  // Score is 0 if the player gave up or used every attempt without the right answer.
  const score =
    input.correct && !input.gaveUp
      ? Math.max(0, Math.round((SCORING.base - hintPenalty - wrongPenalty + timeBonus) * multiplier))
      : 0;
  return { base: SCORING.base, hintPenalty, wrongPenalty, timeBonus, multiplier, elapsedMinutes, score };
}
