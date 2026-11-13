import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';

process.env.RATE_LIMIT_AUTH_MAX = '3';

vi.mock('../src/db/models/User.js', () => ({
  UserModel: {
    findOne: vi.fn(() => Object.assign(Promise.resolve(null), { select: vi.fn(() => Promise.resolve(null)) })),
  },
}));

const { app } = await import('../src/app.js');

describe('platform security middleware', () => {
  it('returns 400 VALIDATION_ERROR (not 500) for malformed JSON', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": ');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 413 for bodies over 100kb', async () => {
    const response = await request(app)
      .post('/api/cases')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ seed: 'x'.repeat(120_000) }));
    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects MongoDB operator keys in request bodies', async () => {
    const response = await request(app)
      .post('/api/cases')
      .send({ seed: { $gt: '' }, difficulty: 'easy', tone: 'cozy' });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('sets helmet security headers and a request id', async () => {
    const response = await request(app).get('/api/health');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-request-id']).toMatch(/^[\w-]{8,64}$/);
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('rate-limits repeated sign-in attempts with the standard error format', async () => {
    const attempt = () => request(app).post('/api/auth/login').send({ email: 'a@example.com', password: 'nope' });
    for (let index = 0; index < 3; index += 1) expect((await attempt()).status).toBe(401);
    const limited = await attempt();
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
  });
});
