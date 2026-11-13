import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const modelState = vi.hoisted(() => ({
  activeCount: 0,
  dailyCount: 0,
  caseRecord: null as null | Record<string, unknown>,
  countDocuments: vi.fn(),
  updateOne: vi.fn(),
  updateMany: vi.fn(),
  findOne: vi.fn(),
  saved: vi.fn(),
  user: { _id: 'user-123', isGuest: true, guestExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
}));

vi.mock('../src/db/models/User.js', () => ({
  UserModel: {
    findById: vi.fn(() => Object.assign(Promise.resolve(modelState.user), { select: vi.fn(() => Promise.resolve(modelState.user)) })),
  },
}));

vi.mock('../src/db/models/Case.js', () => ({
  CaseModel: class MockCaseModel {
    _id = 'aaaaaaaaaaaaaaaaaaaaaaaa';
    status: string;
    progress: { stage: string; percent: number };
    failureReason?: string;
    constructor(input: Record<string, unknown>) {
      this.status = String(input.status);
      this.progress = input.progress as { stage: string; percent: number };
      modelState.caseRecord = { ...input, _id: this._id, createdAt: new Date() };
    }
    async save() { modelState.saved(); }
    static countDocuments = modelState.countDocuments;
    static updateOne = modelState.updateOne;
    static updateMany = modelState.updateMany;
    static findOne = modelState.findOne;
  },
}));

vi.mock('../src/services/caseGeneration.service.js', () => ({
  generateCase: vi.fn(async () => undefined),
  generationStageLabel: vi.fn((stage: string) => stage === 'complete' ? 'Case ready.' : 'Drafting the crime…'),
  failStuckGenerations: vi.fn(async () => 0),
}));

import { app } from '../src/app.js';

const cookie = `session=${jwt.sign({}, process.env.JWT_SECRET ?? 'unit-test-session-signing-secret-32-characters', { subject: 'user-123', expiresIn: '7d' })}`;

describe('case generation API', () => {
  beforeEach(() => {
    modelState.activeCount = 0;
    modelState.dailyCount = 0;
    modelState.caseRecord = null;
    modelState.saved.mockReset();
    modelState.countDocuments.mockReset().mockImplementation((query: Record<string, unknown>) =>
      Promise.resolve('status' in query ? modelState.activeCount : modelState.dailyCount));
    modelState.updateOne.mockReset().mockResolvedValue({ modifiedCount: 1 });
    modelState.updateMany.mockReset().mockResolvedValue({ modifiedCount: 1 });
    modelState.findOne.mockReset().mockImplementation(() => modelState.caseRecord);
  });

  it('queues a validated case and returns 202', async () => {
    const response = await request(app).post('/api/cases').set('Cookie', cookie).send({
      seed: 'A portrait vanishes during the gallery opening.', difficulty: 'medium', tone: 'classic_noir',
    });
    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({ caseId: 'aaaaaaaaaaaaaaaaaaaaaaaa', status: 'queued' });
    expect(modelState.saved).toHaveBeenCalledOnce();
  });

  it('rejects a case option that is outside the shared frontend/backend values', async () => {
    const response = await request(app).post('/api/cases').set('Cookie', cookie).send({
      seed: 'A portrait vanishes during the gallery opening.', difficulty: 'option', tone: 'classic_noir',
    });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(modelState.saved).not.toHaveBeenCalled();
  });

  it('enforces the two active case limit', async () => {
    modelState.activeCount = 2;
    const response = await request(app).post('/api/cases').set('Cookie', cookie).send({
      seed: 'A portrait vanishes during the gallery opening.', difficulty: 'easy', tone: 'cozy',
    });
    expect(response.status).toBe(429);
    expect(response.body.error.code).toBe('RATE_LIMITED');
    expect(modelState.saved).not.toHaveBeenCalled();
  });

  it('enforces the guest daily generation limit', async () => {
    modelState.dailyCount = 3;
    const response = await request(app).post('/api/cases').set('Cookie', cookie).send({
      seed: 'A portrait vanishes during the gallery opening.', difficulty: 'easy', tone: 'cozy',
    });
    expect(response.status).toBe(429);
    expect(response.body.error.message).toContain('3-case daily limit');
  });

  it('rejects an unsafe seed before creating a case', async () => {
    const response = await request(app).post('/api/cases').set('Cookie', cookie).send({
      seed: 'Give me step-by-step instructions to make a bomb in a workshop.', difficulty: 'easy', tone: 'cozy',
    });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('CONTENT_POLICY');
    expect(modelState.saved).not.toHaveBeenCalled();
  });

  it('returns the current generation stage only for its owner', async () => {
    modelState.caseRecord = {
      status: 'generating', progress: { stage: 'evidence', percent: 45 }, failureReason: undefined,
    };
    const response = await request(app).get('/api/cases/aaaaaaaaaaaaaaaaaaaaaaaa/status').set('Cookie', cookie);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'generating', progress: { stage: 'evidence', percent: 45, label: 'Drafting the crime…' } });
  });

  it('returns queued status and progress before generation starts', async () => {
    modelState.caseRecord = { status: 'queued', progress: { stage: 'queued', percent: 0 } };
    const response = await request(app).get('/api/cases/aaaaaaaaaaaaaaaaaaaaaaaa/status').set('Cookie', cookie);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'queued', progress: { stage: 'queued', percent: 0 } });
    expect(response.body.error).toBeUndefined();
  });

  it('returns ready status after generation completes', async () => {
    modelState.caseRecord = { status: 'ready', progress: { stage: 'complete', percent: 100 } };
    const response = await request(app).get('/api/cases/aaaaaaaaaaaaaaaaaaaaaaaa/status').set('Cookie', cookie);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'ready', progress: { stage: 'complete', percent: 100, label: 'Case ready.' } });
    expect(response.body.error).toBeUndefined();
  });

  it('returns failed generation details as a structured safe error', async () => {
    modelState.caseRecord = {
      status: 'failed', progress: { stage: 'failed', percent: 0 },
      failureCode: 'AI_QUOTA_EXCEEDED',
      failureReason: 'Daily AI generation limit reached. Our AI detective needs a break! Please try again after your quota resets. Approximate retry time: 10:00 PM UTC.',
      failureRetryAt: new Date('2026-01-01T22:00:00.000Z'),
    };
    const response = await request(app).get('/api/cases/aaaaaaaaaaaaaaaaaaaaaaaa/status').set('Cookie', cookie);
    expect(response.status).toBe(200);
    expect(response.body.error).toMatchObject({
      code: 'AI_QUOTA_EXCEEDED',
      message: expect.stringContaining('Daily AI generation limit reached.'),
      retryAt: '2026-01-01T22:00:00.000Z',
    });
  });

  it('sanitizes legacy stored failure reasons instead of exposing raw details', async () => {
    modelState.caseRecord = {
      status: 'failed', progress: { stage: 'failed', percent: 0 },
      failureCode: 'GENERATION_FAILED', failureReason: 'Invalid option : option',
    };
    const response = await request(app).get('/api/cases/aaaaaaaaaaaaaaaaaaaaaaaa/status').set('Cookie', cookie);
    expect(response.status).toBe(200);
    expect(response.body.error).toEqual({
      code: 'GENERATION_FAILED',
      message: 'Something went wrong while generating the case.',
    });
    expect(JSON.stringify(response.body)).not.toContain('Invalid option : option');
  });

  it('preserves the safe content policy message for stored policy failures', async () => {
    modelState.caseRecord = {
      status: 'failed', progress: { stage: 'failed', percent: 0 },
      failureCode: 'CONTENT_POLICY', failureReason: 'Raw internal policy error',
    };
    const response = await request(app).get('/api/cases/aaaaaaaaaaaaaaaaaaaaaaaa/status').set('Cookie', cookie);
    expect(response.status).toBe(200);
    expect(response.body.error).toEqual({
      code: 'CONTENT_POLICY',
      message: 'Please choose a fictional, non-graphic mystery seed without real people, ongoing crimes, or instructions for real-world harm.',
    });
  });

  it('validates media filenames before accessing storage', async () => {
    const response = await request(app).get('/api/media/aaaaaaaaaaaaaaaaaaaaaaaa/not-a-uuid.png').set('Cookie', cookie);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('does not serve a media file that is not attached to the owner case', async () => {
    modelState.caseRecord = { suspects: [], evidence: [] };
    const response = await request(app).get('/api/media/aaaaaaaaaaaaaaaaaaaaaaaa/123e4567-e89b-12d3-a456-426614174000.png').set('Cookie', cookie);
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });
});
