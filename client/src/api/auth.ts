import { request } from './http.js';

export type User = { id: string; email: string | null; displayName: string; isGuest: boolean };

export async function postAuth(
  action: 'guest' | 'login' | 'register' | 'upgrade',
  payload: Record<string, string> = {},
) {
  const { user } = await request<{ user: User }>(`/auth/${action}`, { method: 'POST', body: payload });
  return user;
}

export async function getCurrentUser(): Promise<User | null> {
  const { user } = await request<{ user: User | null }>('/auth/me');
  return user;
}

export async function logout(): Promise<void> {
  await request('/auth/logout', { method: 'POST' });
}
