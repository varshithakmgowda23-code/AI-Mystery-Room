import { beforeEach, describe, expect, it, vi } from 'vitest';

const modelState = vi.hoisted(() => ({
  caseDoc: { difficulty: 'medium', tone: 'classic_noir', seed: 'An old clock disappears from a quiet archive.' },
  updateOne: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock('../src/db/models/Case.js', () => ({
  CaseModel: {
    findById: vi.fn(async () => modelState.caseDoc),
    updateOne: modelState.updateOne,
    updateMany: modelState.updateMany,
  },
}));

import { failStuckGenerations, generateCase } from '../src/services/caseGeneration.service.js';
import { buildMockCase } from '../src/services/mockGeneration.service.js';

describe('mock generation pipeline', () => {
  beforeEach(() => {
    modelState.updateOne.mockReset().mockResolvedValue({ modifiedCount: 1 });
    modelState.updateMany.mockReset().mockResolvedValue({ modifiedCount: 2 });
  });

  it.each([
    ['easy', 4, 8],
    ['medium', 5, 11],
    ['hard', 6, 14],
  ] as const)('creates a fair %s fixture with required evidence', (difficulty, suspectCount, evidenceCount) => {
    const fixture = buildMockCase(difficulty, 'classic_noir', 'A clock disappears from an archive.');
    expect(fixture.suspects).toHaveLength(suspectCount);
    expect(fixture.evidence).toHaveLength(evidenceCount);
    expect(fixture.evidence.filter((item) => item.type === 'chat').length).toBeGreaterThanOrEqual(2);
    expect(fixture.evidence.filter((item) => item.type === 'image')).toHaveLength(2);
    expect(fixture.evidence.some((item) => item.type === 'cctv')).toBe(true);
    expect(fixture.evidence.some((item) => item.type === 'document')).toBe(true);
    expect(fixture.evidence.filter((item) => item.kind === 'true_clue')).toHaveLength(difficulty === 'hard' ? 4 : 3);
    expect(fixture.evidence.filter((item) => item.kind === 'red_herring')).toHaveLength(difficulty === 'hard' ? 3 : 2);
    expect(fixture.hidden.hints.every((hint) => !hint.includes('Theo'))).toBe(true);
  });

  it('moves a queued case through generation stages and publishes it only when validation passes', async () => {
    await generateCase('aaaaaaaaaaaaaaaaaaaaaaaa');
    expect(modelState.updateOne).toHaveBeenCalledWith(
      { _id: 'aaaaaaaaaaaaaaaaaaaaaaaa' },
      expect.objectContaining({
        $set: expect.objectContaining({ status: 'ready', progress: { stage: 'complete', percent: 100 } }),
      }),
    );
    expect(modelState.updateOne.mock.calls.some(([, update]) => update.$set?.progress?.stage === 'validation')).toBe(
      true,
    );
  });

  it('marks generations older than ten minutes as failed after a restart', async () => {
    const now = new Date('2026-01-01T12:00:00.000Z');
    await expect(failStuckGenerations(now)).resolves.toBe(2);
    expect(modelState.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        status: { $in: ['queued', 'generating'] },
        updatedAt: { $lt: new Date('2026-01-01T11:50:00.000Z') },
      }),
      expect.objectContaining({ $set: expect.objectContaining({ status: 'failed' }) }),
    );
  });
});
