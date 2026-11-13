import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { buildMockCase } from '../src/services/mockGeneration.service.js';
import { toPlayerView, toResolvedView, type StoredCase } from '../src/services/caseView.service.js';

const state = vi.hoisted(() => ({
  doc: null as null | Record<string, unknown>,
  findOneFilter: undefined as unknown,
  updateOne: vi.fn(),
  findOneAndUpdate: vi.fn(),
}));

vi.mock('../src/db/models/Case.js', () => {
  const chain = (value: () => unknown) => {
    const query = { select: () => query, lean: async () => value() };
    return query;
  };
  return {
    CaseModel: {
      findOne: vi.fn((filter: unknown) => {
        state.findOneFilter = filter;
        return chain(() => (state.doc ? structuredClone(state.doc) : null));
      }),
      updateOne: state.updateOne,
      findOneAndUpdate: vi.fn((...args: unknown[]) => chain(() => state.findOneAndUpdate(...args))),
      countDocuments: vi.fn(async () => 0),
    },
  };
});

const { app } = await import('../src/app.js');

const cookie = `session=${jwt.sign({}, process.env.JWT_SECRET ?? '', { subject: 'user-123', expiresIn: '7d' })}`;

/** A stored case exactly as generation persists it, hidden fields included. */
function storedCase(status: StoredCase['status'], hintsUsed = 0): Record<string, unknown> {
  const mock = buildMockCase('medium', 'classic_noir', 'A portrait vanishes during the gallery opening.');
  // Simulate leftovers that must never be forwarded even if they slip into storage.
  const evidence = mock.evidence.map((item, index) =>
    index === 2 ? { ...item, content: { ...item.content, imagePrompt: 'SECRET IMAGE PROMPT' } } : item,
  );
  return {
    _id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    userId: 'user-123',
    difficulty: 'medium',
    tone: 'classic_noir',
    status,
    title: mock.title,
    setting: mock.setting,
    briefing: mock.briefing,
    suspects: mock.suspects,
    evidence,
    hidden: { ...mock.hidden, validationReport: { mode: 'mock', reasoning: 'VALIDATOR REASONING' } },
    state: {
      viewedEvidence: ['e1'],
      hintsUsed,
      attemptsUsed: 0,
      maxAttempts: 2,
      accusations: [],
      notes: '',
      suspectTags: { s1: 'cleared' },
      startedAt: new Date('2026-01-01T10:00:00Z'),
    },
    ...(status === 'resolved' ? { result: { score: 840, correct: true, culpritId: 's2', gaveUp: false } } : {}),
    createdAt: new Date('2026-01-01T09:59:00Z'),
  };
}

function expectNoSpoilers(json: string, doc: Record<string, unknown>, revealedHints: number) {
  const hidden = doc.hidden as { truth: { motive: string; method: string; explanation: string }; hints: string[] };
  const suspects = doc.suspects as Array<{ secret: string; appearancePrompt: string }>;
  for (const key of ['truth', 'culpritId', 'pointsTo', 'clueMap', 'clueId', '"kind"', 'validationReport', 'solution']) {
    expect(json, `leaked key ${key}`).not.toContain(key);
  }
  for (const secret of [
    hidden.truth.motive,
    hidden.truth.method,
    hidden.truth.explanation,
    'SECRET IMAGE PROMPT',
    'imagePrompt',
    'VALIDATOR REASONING',
    'appearancePrompt',
    'secret',
    ...suspects.map((suspect) => suspect.secret),
    ...hidden.hints.slice(revealedHints),
  ]) {
    expect(json, `leaked value ${secret.slice(0, 40)}`).not.toContain(secret);
  }
}

describe('spoiler protection (spec §15.1)', () => {
  beforeEach(() => {
    state.updateOne.mockReset().mockResolvedValue({ modifiedCount: 1 });
    state.findOneAndUpdate.mockReset();
  });

  it('toPlayerView exposes no hidden data and only paid-for hints', () => {
    const doc = storedCase('in_progress', 1);
    const view = toPlayerView(doc as unknown as StoredCase);
    expectNoSpoilers(JSON.stringify(view), doc, 1);
    expect(view.revealedHints).toEqual([(doc.hidden as { hints: string[] }).hints[0]]);
    expect(view.evidence.find((item) => item.id === 'e1')?.viewed).toBe(true);
    expect(view.suspectTags).toEqual({ s1: 'cleared' });
  });

  it('GET /api/cases/:id for an in-progress case contains no truth, culprit, clue roles or clue map', async () => {
    state.doc = storedCase('in_progress');
    const response = await request(app).get('/api/cases/aaaaaaaaaaaaaaaaaaaaaaaa').set('Cookie', cookie);
    expect(response.status).toBe(200);
    expectNoSpoilers(response.text, state.doc, 0);
    expect(response.body.evidence).toHaveLength(11);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(state.findOneFilter).toMatchObject({ userId: 'user-123' });
  });

  it('opening a ready case starts the clock and still leaks nothing', async () => {
    state.doc = storedCase('ready');
    const response = await request(app).get('/api/cases/aaaaaaaaaaaaaaaaaaaaaaaa').set('Cookie', cookie);
    expect(response.body.status).toBe('in_progress');
    expect(state.updateOne).toHaveBeenCalledWith(
      { _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', status: 'ready' },
      { $set: expect.objectContaining({ status: 'in_progress' }) },
    );
    expectNoSpoilers(response.text, state.doc, 0);
  });

  it('a resolved case includes the full solution and clue breakdown', async () => {
    state.doc = storedCase('resolved');
    const response = await request(app).get('/api/cases/aaaaaaaaaaaaaaaaaaaaaaaa').set('Cookie', cookie);
    expect(response.body.solution.culpritId).toBe('s2');
    expect(response.body.solution.clueBreakdown).toHaveLength(11);
    expect(response.body.result).toMatchObject({ score: 840, correct: true });
    expect(response.text).not.toContain('appearancePrompt');
    expect(response.text).not.toContain('VALIDATOR REASONING');
    expect(toResolvedView(state.doc as unknown as StoredCase).solution?.timeline.length).toBeGreaterThan(0);
  });

  it("returns 404 for another user's case", async () => {
    state.doc = null;
    const response = await request(app).get('/api/cases/aaaaaaaaaaaaaaaaaaaaaaaa').set('Cookie', cookie);
    expect(response.status).toBe(404);
  });

  it('reveals only the next hint, and refuses once all three are used', async () => {
    state.doc = storedCase('in_progress');
    const hints = (state.doc.hidden as { hints: string[] }).hints;
    state.findOneAndUpdate.mockReturnValueOnce({ state: { hintsUsed: 1 }, hidden: { hints } });
    const first = await request(app).post('/api/cases/aaaaaaaaaaaaaaaaaaaaaaaa/hints').set('Cookie', cookie).send({});
    expect(first.body).toEqual({ hint: hints[0], hintsUsed: 1, hintsAvailable: 3 });
    expect(first.text).not.toContain(hints[1]);

    state.findOneAndUpdate.mockReturnValueOnce(null);
    const exhausted = await request(app)
      .post('/api/cases/aaaaaaaaaaaaaaaaaaaaaaaa/hints')
      .set('Cookie', cookie)
      .send({});
    expect(exhausted.status).toBe(400);
  });

  it('rejects gameplay changes on a resolved case', async () => {
    state.doc = storedCase('resolved');
    const response = await request(app)
      .patch('/api/cases/aaaaaaaaaaaaaaaaaaaaaaaa/notes')
      .set('Cookie', cookie)
      .send({ notes: 'late thoughts' });
    expect(response.status).toBe(400);
    expect(response.body.error.message).toBe('This case is closed.');
  });

  it('rejects tags for suspects that are not in the case', async () => {
    state.doc = storedCase('in_progress');
    const response = await request(app)
      .patch('/api/cases/aaaaaaaaaaaaaaaaaaaaaaaa/suspect-tags')
      .set('Cookie', cookie)
      .send({ tags: { s6: 'suspicious' } });
    expect(response.status).toBe(400);
  });
});
