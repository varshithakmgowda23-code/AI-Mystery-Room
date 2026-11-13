import { z } from 'zod';
import type { Request, Response } from 'express';
import { UserModel } from '../db/models/User.js';
import { CaseModel } from '../db/models/Case.js';
import {
  clearSessionCookie,
  guestExpiry,
  hashPassword,
  makeGuestName,
  normalizeEmail,
  setSessionCookie,
  verifyPassword,
} from '../services/auth.service.js';

export const RegisterSchema = z
  .object({
    email: z.string().trim().email().max(254),
    password: z.string().min(8).max(128),
    displayName: z.string().trim().min(1).max(60),
  })
  .strict();

export const LoginSchema = z
  .object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(128) })
  .strict();
export const UpgradeSchema = z
  .object({
    email: z.string().trim().email().max(254),
    password: z.string().min(8).max(128),
    displayName: z.string().trim().min(1).max(60).optional(),
  })
  .strict();

function toPlayerUser(user: {
  _id: unknown;
  email?: string | null;
  displayName: string;
  isGuest: boolean;
  createdAt: Date;
}) {
  return {
    id: String(user._id),
    email: user.email ?? null,
    displayName: user.displayName,
    isGuest: user.isGuest,
    createdAt: user.createdAt,
  };
}

function sendFailure(response: Response, status: number, code: string, message: string): void {
  response.status(status).json({ error: { code, message } });
}

export async function register(response: Response): Promise<void> {
  const input = response.locals.validatedBody as z.infer<typeof RegisterSchema>;
  const email = normalizeEmail(input.email);
  if (await UserModel.exists({ email })) {
    sendFailure(response, 400, 'VALIDATION_ERROR', 'An account with that email already exists.');
    return;
  }
  const user = await UserModel.create({
    email,
    passwordHash: await hashPassword(input.password),
    displayName: input.displayName,
    isGuest: false,
  });
  setSessionCookie(response, String(user._id));
  response.status(201).json({ user: toPlayerUser(user) });
}

export async function login(response: Response): Promise<void> {
  const input = response.locals.validatedBody as z.infer<typeof LoginSchema>;
  const user = await UserModel.findOne({ email: normalizeEmail(input.email) }).select('+passwordHash');
  if (!user?.passwordHash || !(await verifyPassword(input.password, user.passwordHash))) {
    sendFailure(response, 401, 'UNAUTHENTICATED', 'Email or password is incorrect.');
    return;
  }
  setSessionCookie(response, String(user._id));
  response.status(200).json({ user: toPlayerUser(user) });
}

export async function createGuest(response: Response): Promise<void> {
  const user = await UserModel.create({ isGuest: true, displayName: makeGuestName(), guestExpiresAt: guestExpiry() });
  setSessionCookie(response, String(user._id));
  response.status(201).json({ user: toPlayerUser(user) });
}

export function logout(_request: Request, response: Response): void {
  void _request;
  clearSessionCookie(response);
  response.status(200).json({ success: true });
}

/** API-06. Signed-out visitors get `{ user: null }` (200) rather than a 401 (DEC-009). */
export async function me(response: Response): Promise<void> {
  const userId = response.locals.userId as string | undefined;
  const user = userId ? await UserModel.findById(userId) : null;
  if (!user) {
    if (userId) clearSessionCookie(response);
    response.status(200).json({ user: null });
    return;
  }
  response.status(200).json({ user: toPlayerUser(user) });
}

export async function upgrade(response: Response): Promise<void> {
  const input = response.locals.validatedBody as z.infer<typeof UpgradeSchema>;
  const user = await UserModel.findById(response.locals.userId as string).select('+passwordHash');
  if (!user) {
    sendFailure(response, 401, 'UNAUTHENTICATED', 'Your session has expired. Please sign in again.');
    return;
  }
  if (!user.isGuest) {
    sendFailure(response, 400, 'VALIDATION_ERROR', 'This account is already registered.');
    return;
  }
  const email = normalizeEmail(input.email);
  if (await UserModel.exists({ email })) {
    sendFailure(response, 400, 'VALIDATION_ERROR', 'An account with that email already exists.');
    return;
  }
  user.email = email;
  user.passwordHash = await hashPassword(input.password);
  if (input.displayName) user.displayName = input.displayName;
  user.isGuest = false;
  user.guestExpiresAt = undefined;
  await user.save();
  // FR-03: keep the guest's cases. Remove the guest TTL so they are not purged after 7 days.
  await CaseModel.updateMany({ userId: user._id, expiresAt: { $exists: true } }, { $unset: { expiresAt: 1 } });
  setSessionCookie(response, String(user._id));
  response.status(200).json({ user: toPlayerUser(user) });
}
