import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

const modelState = vi.hoisted(() => ({
  currentUser: null as null | Record<string, unknown>,
  create: vi.fn(),
  exists: vi.fn(),
  findOne: vi.fn(),
  findById: vi.fn(),
  caseUpdateMany: vi.fn(),
}));

vi.mock('../src/db/models/User.js', () => ({
  UserModel: {
    create: modelState.create,
    exists: modelState.exists,
    findOne: modelState.findOne,
    findById: modelState.findById,
  },
}));

vi.mock('../src/db/models/Case.js', () => ({
  CaseModel: { updateMany: modelState.caseUpdateMany },
}));

import { app } from '../src/app.js';

function createUser(input: Record<string, unknown>) {
  return {
    _id: 'user-123',
    email: input.email,
    passwordHash: input.passwordHash,
    displayName: input.displayName ?? 'Detective A1B2C3',
    isGuest: input.isGuest ?? false,
    guestExpiresAt: input.guestExpiresAt,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    save: vi.fn(async () => undefined),
  };
}

function queryFor(value: unknown) {
  return Object.assign(Promise.resolve(value), { select: vi.fn(() => Promise.resolve(value)) });
}

describe('authentication API', () => {
  beforeEach(() => {
    modelState.currentUser = null;
    modelState.exists.mockReset().mockResolvedValue(false);
    modelState.create.mockReset().mockImplementation(async (input: Record<string, unknown>) => {
      modelState.currentUser = createUser(input);
      return modelState.currentUser;
    });
    modelState.findOne.mockReset().mockImplementation(() => queryFor(null));
    modelState.findById.mockReset().mockImplementation(() => queryFor(modelState.currentUser));
    modelState.caseUpdateMany.mockReset().mockResolvedValue({ modifiedCount: 0 });
  });

  it('creates a guest session with an httpOnly seven-day cookie', async () => {
    const response = await request(app).post('/api/auth/guest').send({});

    expect(response.status).toBe(201);
    expect(response.body.user.isGuest).toBe(true);
    expect(response.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(response.headers['set-cookie'][0]).toContain('SameSite=Lax');
    expect(modelState.create.mock.calls[0][0].guestExpiresAt).toBeInstanceOf(Date);
  });

  it('reports a signed-out visitor as user null without an error status', async () => {
    const response = await request(app).get('/api/auth/me');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ user: null });
  });

  it('treats a tampered session cookie as signed out', async () => {
    const response = await request(app).get('/api/auth/me').set('Cookie', 'session=not-a-real-token');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ user: null });
    expect(modelState.findById).not.toHaveBeenCalled();
  });

  it('validates register input before calling the database', async () => {
    const response = await request(app).post('/api/auth/register').send({ email: 'bad', password: 'short' });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(modelState.create).not.toHaveBeenCalled();
  });

  it('upgrades the same guest record so existing case ownership is retained', async () => {
    modelState.currentUser = createUser({ isGuest: true, displayName: 'Detective A1B2C3' });
    const guest = await request(app).post('/api/auth/guest').send({});
    const cookie = guest.headers['set-cookie'][0].split(';')[0];

    const response = await request(app).post('/api/auth/upgrade').set('Cookie', cookie).send({
      email: 'Casey@example.com',
      password: 'a-secure-password',
    });

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({ id: 'user-123', email: 'casey@example.com', isGuest: false });
    expect(modelState.currentUser?.isGuest).toBe(false);
    expect(modelState.currentUser?.guestExpiresAt).toBeUndefined();
  });

  it('removes the guest expiry from existing cases on upgrade so they are not purged (FR-03)', async () => {
    modelState.currentUser = createUser({ isGuest: true });
    const guest = await request(app).post('/api/auth/guest').send({});
    const cookie = guest.headers['set-cookie'][0].split(';')[0];

    await request(app)
      .post('/api/auth/upgrade')
      .set('Cookie', cookie)
      .send({ email: 'casey@example.com', password: 'a-secure-password' })
      .expect(200);

    expect(modelState.caseUpdateMany).toHaveBeenCalledWith(
      { userId: 'user-123', expiresAt: { $exists: true } },
      { $unset: { expiresAt: 1 } },
    );
  });

  it('rejects a wrong password with a generic message', async () => {
    modelState.findOne.mockImplementation(() =>
      queryFor(
        createUser({
          email: 'casey@example.com',
          passwordHash: '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv',
        }),
      ),
    );
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'casey@example.com', password: 'wrong-password' });
    expect(response.status).toBe(401);
    expect(response.body.error).toEqual({ code: 'UNAUTHENTICATED', message: 'Email or password is incorrect.' });
  });

  it('rejects registration with an email that already exists', async () => {
    modelState.exists.mockResolvedValue(true);
    const response = await request(app)
      .post('/api/auth/register')
      .send({ email: 'casey@example.com', password: 'a-secure-password', displayName: 'Casey' });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(modelState.create).not.toHaveBeenCalled();
  });
});
