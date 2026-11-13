import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

const modelState = vi.hoisted(() => ({
  currentUser: null as null | Record<string, unknown>,
  create: vi.fn(),
  exists: vi.fn(),
  findOne: vi.fn(),
  findById: vi.fn(),
}));

vi.mock('../src/db/models/User.js', () => ({
  UserModel: {
    create: modelState.create,
    exists: modelState.exists,
    findOne: modelState.findOne,
    findById: modelState.findById,
  },
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
  });

  it('creates a guest session with an httpOnly seven-day cookie', async () => {
    const response = await request(app).post('/api/auth/guest').send({});

    expect(response.status).toBe(201);
    expect(response.body.user.isGuest).toBe(true);
    expect(response.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(response.headers['set-cookie'][0]).toContain('SameSite=Lax');
    expect(modelState.create.mock.calls[0][0].guestExpiresAt).toBeInstanceOf(Date);
  });

  it('requires a valid session to read the current user', async () => {
    const response = await request(app).get('/api/auth/me');
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
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
      email: 'Casey@example.com', password: 'a-secure-password',
    });

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({ id: 'user-123', email: 'casey@example.com', isGuest: false });
    expect(modelState.currentUser?.isGuest).toBe(false);
    expect(modelState.currentUser?.guestExpiresAt).toBeUndefined();
  });
});
