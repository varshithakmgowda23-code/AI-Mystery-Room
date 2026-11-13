import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { buildMockCase } from '../src/services/mockGeneration.service.js';

const db = vi.hoisted(() => ({
  doc: null as null | Record<string, unknown>,
  findOneFilter: undefined as unknown,
  findOneAndUpdate: vi.fn(),
  updateOne: vi.fn(),
  findOneAndDelete: vi.fn(),
  storageDelete: vi.fn(),
  list: [] as Array<Record<string, unknown>>,
}));

vi.mock('../src/db/models/Case.js', () => {
  const chain = (value: () => unknown) => {
    const query = {
      select: () => query,
      sort: () => query,
      skip: () => query,
      limit: () => query,
      lean: async () => value(),
    };
    return query;
  };
  return {
    CaseModel: {
      findOne: vi.fn((filter: unknown) => {
        db.findOneFilter = filter;
        return chain(() => (db.doc ? structuredClone(db.doc) : null));
      }),
      findOneAndUpdate: vi.fn((...args: unknown[]) => chain(() => db.findOneAndUpdate(...args))),
      findOneAndDelete: vi.fn((...args: unknown[]) => chain(() => db.findOneAndDelete(...args))),
      updateOne: db.updateOne,
      countDocuments: vi.fn(async () => db.list.length),
      find: vi.fn(() => chain(() => db.list)),
    },
  };
});
vi.mock('../src/services/storage/index.js', () => ({
  getStorageDriver: () => ({ delete: db.storageDelete }),
}));

const { app } = await import('../src/app.js');
const cookie = `session=${jwt.sign({}, process.env.JWT_SECRET ?? '', { subject: 'user-123', expiresIn: '7d' })}`;
const url = '/api/cases/aaaaaaaaaaaaaaaaaaaaaaaa';

function activeCase(attemptsUsed = 0, maxAttempts = 2) {
  const mock = buildMockCase('medium', 'classic_noir', 'A portrait vanishes during the gallery opening.');
  return {
    _id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    userId: 'user-123',
    difficulty: 'medium',
    tone: 'classic_noir',
    status: 'in_progress',
    title: mock.title,
    setting: mock.setting,
    briefing: mock.briefing,
    suspects: mock.suspects,
    evidence: mock.evidence,
    hidden: mock.hidden,
    state: {
      attemptsUsed,
      maxAttempts,
      hintsUsed: 1,
      accusations: attemptsUsed ? [{ suspectId: 's1', at: new Date(), correct: false }] : [],
      startedAt: new Date(Date.now() - 4 * 60_000),
    },
    createdAt: new Date(),
  };
}

/** Mimics MongoDB applying the resolve update ($set + $inc + $push) and returning the new document. */
function applyUpdate(_filter: unknown, update: Record<string, Record<string, unknown>>) {
  const doc = structuredClone(db.doc) as Record<string, unknown> & { state: Record<string, unknown> };
  for (const [path, value] of Object.entries(update.$set ?? {})) {
    if (path.startsWith('state.')) doc.state[path.slice(6)] = value;
    else doc[path] = value;
  }
  if (update.$inc) doc.state.attemptsUsed = Number(doc.state.attemptsUsed) + 1;
  if (update.$push)
    doc.state.accusations = [...(doc.state.accusations as unknown[]), update.$push['state.accusations']];
  return doc;
}

describe('accusation, verdict and history API', () => {
  beforeEach(() => {
    db.findOneAndUpdate.mockReset().mockImplementation(applyUpdate);
    db.updateOne.mockReset().mockResolvedValue({ modifiedCount: 1 });
    db.findOneAndDelete.mockReset();
    db.storageDelete.mockReset().mockResolvedValue(undefined);
    db.list = [];
  });

  it('a wrong guess with attempts left returns a generic nudge and no solution', async () => {
    db.doc = activeCase();
    const response = await request(app).post(`${url}/accuse`).set('Cookie', cookie).send({ suspectId: 's1' });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      correct: false,
      resolved: false,
      attemptsRemaining: 1,
      message: 'Not quite. Re-examine the timeline.',
    });
    expect(response.text).not.toMatch(/s2|Theo|culprit|motive/i);
    expect(db.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ 'state.attemptsUsed': 0 }),
      expect.objectContaining({ $inc: { 'state.attemptsUsed': 1 } }),
    );
  });

  it('a correct guess resolves the case with a score and the full solution', async () => {
    db.doc = activeCase();
    const response = await request(app)
      .post(`${url}/accuse`)
      .set('Cookie', cookie)
      .send({ suspectId: 's2', reasoning: 'The cart record contradicts his chat.' });
    expect(response.body.correct).toBe(true);
    expect(response.body.resolved).toBe(true);
    // (1000 - 100 hint + 180 time) * 1.0
    expect(response.body.score).toBe(1080);
    expect(response.body.case.status).toBe('resolved');
    expect(response.body.case.solution.culpritId).toBe('s2');
    expect(response.body.case.result.breakdown).toMatchObject({ hintPenalty: 100, timeBonus: 180 });
  });

  it('a wrong final attempt resolves the case with score 0', async () => {
    db.doc = activeCase(1, 2);
    const response = await request(app).post(`${url}/accuse`).set('Cookie', cookie).send({ suspectId: 's3' });
    expect(response.body).toMatchObject({ correct: false, resolved: true, score: 0 });
    expect(response.body.case.solution.culpritId).toBe('s2');
  });

  it('rejects an accusation of someone who is not a suspect', async () => {
    db.doc = activeCase();
    const response = await request(app).post(`${url}/accuse`).set('Cookie', cookie).send({ suspectId: 's6' });
    expect(response.status).toBe(400);
  });

  it('reports a conflict instead of double-counting a concurrent accusation', async () => {
    db.doc = activeCase();
    db.updateOne.mockResolvedValueOnce({ modifiedCount: 0 });
    const response = await request(app).post(`${url}/accuse`).set('Cookie', cookie).send({ suspectId: 's1' });
    expect(response.status).toBe(409);
  });

  it('giving up resolves with score 0 and reveals the solution', async () => {
    db.doc = activeCase();
    const response = await request(app).post(`${url}/reveal`).set('Cookie', cookie).send({});
    expect(response.body.status).toBe('resolved');
    expect(response.body.result).toMatchObject({ score: 0, gaveUp: true, correct: false });
    expect(response.body.solution.explanation).toBeTruthy();
  });

  it('refuses to accuse on a closed case', async () => {
    db.doc = { ...activeCase(), status: 'resolved' };
    const response = await request(app).post(`${url}/accuse`).set('Cookie', cookie).send({ suspectId: 's2' });
    expect(response.status).toBe(400);
  });

  it("returns 404 when accusing on another user's case", async () => {
    db.doc = null;
    const response = await request(app).post(`${url}/accuse`).set('Cookie', cookie).send({ suspectId: 's2' });
    expect(response.status).toBe(404);
    expect(db.findOneFilter).toMatchObject({ userId: 'user-123' });
  });

  it('lists the player’s cases with scores and pagination', async () => {
    db.list = [
      {
        _id: 'c1',
        title: 'Solved one',
        seed: 's',
        difficulty: 'easy',
        tone: 'cozy',
        status: 'resolved',
        createdAt: new Date(),
        result: { score: 900, correct: true },
        evidence: [{ id: 'e1' }],
        state: { viewedEvidence: ['e1'] },
      },
      {
        _id: 'c2',
        seed: 'A long seed that is still generating its title',
        difficulty: 'hard',
        tone: 'cozy',
        status: 'generating',
        createdAt: new Date(),
      },
    ];
    const response = await request(app).get('/api/cases?page=1').set('Cookie', cookie);
    expect(response.body).toMatchObject({ page: 1, total: 2, totalPages: 1 });
    expect(response.body.items[0]).toMatchObject({
      id: 'c1',
      score: 900,
      correct: true,
      evidenceViewed: 1,
      evidenceTotal: 1,
    });
    expect(response.body.items[1].title).toContain('A long seed');
  });

  it('deletes a case and its stored media files only', async () => {
    db.findOneAndDelete.mockReturnValue({
      suspects: [
        { portraitPath: '11111111-1111-1111-1111-111111111111.png' },
        { portraitPath: '/media/portrait-placeholder.svg' },
      ],
      evidence: [{ content: { frames: [{ imageUrl: '22222222-2222-2222-2222-222222222222.png' }] } }],
    });
    const response = await request(app).delete(url).set('Cookie', cookie);
    expect(response.status).toBe(200);
    expect(db.storageDelete.mock.calls.map(([file]) => file).sort()).toEqual([
      '11111111-1111-1111-1111-111111111111.png',
      '22222222-2222-2222-2222-222222222222.png',
    ]);
  });

  it('shares only resolved cases and serves a public summary without evidence', async () => {
    db.doc = activeCase();
    const refused = await request(app).post(`${url}/share`).set('Cookie', cookie).send({ enabled: true });
    expect(refused.status).toBe(400);

    db.doc = { ...activeCase(), status: 'resolved', share: { enabled: false } };
    const shared = await request(app).post(`${url}/share`).set('Cookie', cookie).send({ enabled: true });
    expect(shared.body.shareToken).toMatch(/^[\w-]{22}$/);

    db.doc = { ...activeCase(), status: 'resolved', result: { score: 900, correct: true, culpritId: 's2' } };
    const publicView = await request(app).get(`/api/public/cases/${shared.body.shareToken}`);
    expect(publicView.status).toBe(200);
    expect(publicView.body.culprit.name).toBe('Theo Venn');
    expect(publicView.body).not.toHaveProperty('evidence');
    expect(publicView.text).not.toContain('Planning chat');
    expect(db.findOneFilter).toMatchObject({ 'share.enabled': true, status: 'resolved' });
  });
});
