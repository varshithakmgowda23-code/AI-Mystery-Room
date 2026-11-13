import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ updateOne: vi.fn(), screenSeed: vi.fn(), generateRealCase: vi.fn() }));

vi.mock('../src/config/env.js', () => ({ env: { MOCK_GEMINI: false } }));
vi.mock('../src/db/models/Case.js', () => ({
  CaseModel: { findById: vi.fn(async () => ({ seed: 'A valid fictional seed.' })), updateOne: state.updateOne },
}));
vi.mock('../src/services/gemini/safety.js', () => ({
  CONTENT_POLICY_MESSAGE: 'Please choose a fictional, non-graphic mystery seed.',
  screenSeed: state.screenSeed,
}));
vi.mock('../src/services/realCaseGeneration.service.js', () => ({ generateRealCase: state.generateRealCase }));

import { generateCase } from '../src/services/caseGeneration.service.js';

describe('case generation failure handling', () => {
  it('marks a case failed when real media failures exceed thirty percent', async () => {
    state.updateOne.mockReset().mockResolvedValue({ modifiedCount: 1 });
    state.screenSeed.mockReset().mockResolvedValue({ safe: true });
    state.generateRealCase.mockReset().mockRejectedValue(new Error('Too many generated media items failed.'));
    await generateCase('aaaaaaaaaaaaaaaaaaaaaaaa');
    expect(state.screenSeed).toHaveBeenCalledOnce();
    expect(state.generateRealCase).toHaveBeenCalledOnce();
    expect(state.screenSeed.mock.invocationCallOrder[0]).toBeLessThan(
      state.generateRealCase.mock.invocationCallOrder[0],
    );
    expect(state.updateOne).toHaveBeenCalledWith(
      { _id: 'aaaaaaaaaaaaaaaaaaaaaaaa' },
      {
        $set: {
          status: 'failed',
          failureCode: 'GENERATION_FAILED',
          failureReason: 'Something went wrong while generating the case.',
          failureRetryAt: null,
          progress: { stage: 'failed', percent: 0 },
        },
      },
    );
  });

  it('stops after the queued Gemini safety screen rejects a seed', async () => {
    state.updateOne.mockReset().mockResolvedValue({ modifiedCount: 1 });
    state.screenSeed.mockReset().mockResolvedValue({ safe: false });
    state.generateRealCase.mockReset();

    await generateCase('aaaaaaaaaaaaaaaaaaaaaaaa');

    expect(state.screenSeed).toHaveBeenCalledOnce();
    expect(state.generateRealCase).not.toHaveBeenCalled();
    expect(state.updateOne).toHaveBeenCalledWith(
      { _id: 'aaaaaaaaaaaaaaaaaaaaaaaa' },
      {
        $set: {
          status: 'failed',
          failureCode: 'CONTENT_POLICY',
          failureReason: 'Please choose a fictional, non-graphic mystery seed.',
          failureRetryAt: null,
          progress: { stage: 'failed', percent: 0 },
        },
      },
    );
  });
});
