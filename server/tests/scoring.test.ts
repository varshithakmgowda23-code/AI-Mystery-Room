import { describe, expect, it } from 'vitest';
import { computeScore } from '../src/services/scoring.service.js';

const solved = { difficulty: 'medium' as const, correct: true, gaveUp: false, hintsUsed: 0, wrongAccusations: 0 };
const minutes = (value: number) => value * 60_000;

describe('scoring (spec §14)', () => {
  it('awards base plus the full time bonus for a fast, clean solve', () => {
    expect(computeScore({ ...solved, elapsedMs: minutes(0.5) }).score).toBe(1200);
  });

  it('applies the difficulty multiplier', () => {
    expect(computeScore({ ...solved, difficulty: 'easy', elapsedMs: 0 }).score).toBe(960);
    expect(computeScore({ ...solved, difficulty: 'hard', elapsedMs: 0 }).score).toBe(1560);
  });

  it('subtracts 100 per hint and 150 per wrong accusation', () => {
    const result = computeScore({ ...solved, hintsUsed: 2, wrongAccusations: 1, elapsedMs: 0 });
    expect(result).toMatchObject({ hintPenalty: 200, wrongPenalty: 150, timeBonus: 200, score: 850 });
  });

  it('loses 5 bonus points per whole minute and never goes below a zero bonus', () => {
    expect(computeScore({ ...solved, elapsedMs: minutes(10.9) }).timeBonus).toBe(150);
    expect(computeScore({ ...solved, elapsedMs: minutes(40) }).timeBonus).toBe(0);
    expect(computeScore({ ...solved, elapsedMs: minutes(120) }).timeBonus).toBe(0);
  });

  it('rounds after applying the multiplier', () => {
    // (1000 - 100 + 195) * 1.3 = 1423.5 -> 1424
    expect(computeScore({ ...solved, difficulty: 'hard', hintsUsed: 1, elapsedMs: minutes(1) }).score).toBe(1424);
  });

  it('never returns a negative score', () => {
    expect(computeScore({ ...solved, hintsUsed: 3, wrongAccusations: 5, elapsedMs: minutes(60) }).score).toBe(0);
  });

  it('scores 0 for a wrong final answer or giving up', () => {
    expect(computeScore({ ...solved, correct: false, elapsedMs: 0 }).score).toBe(0);
    expect(computeScore({ ...solved, gaveUp: true, elapsedMs: 0 }).score).toBe(0);
  });
});
