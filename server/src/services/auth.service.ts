import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Response } from 'express';
import { env } from '../config/env.js';

export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const GUEST_RETENTION_MS = SESSION_MAX_AGE_MS;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}

export function makeGuestName(): string {
  return `Detective ${randomBytes(3).toString('hex').toUpperCase()}`;
}

export function guestExpiry(from = new Date()): Date {
  return new Date(from.getTime() + GUEST_RETENTION_MS);
}

export function setSessionCookie(response: Response, userId: string): void {
  const token = jwt.sign({}, env.JWT_SECRET, { subject: userId, expiresIn: '7d' });
  response.cookie('session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production' || env.COOKIE_SECURE,
    maxAge: SESSION_MAX_AGE_MS,
    path: '/',
  });
}

export function clearSessionCookie(response: Response): void {
  response.clearCookie('session', {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production' || env.COOKIE_SECURE,
    path: '/',
  });
}
