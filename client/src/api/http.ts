export const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

/** Error carrying the server's standard error body (spec §11.1). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly retryAt?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type ErrorBody = { error?: { code?: string; message?: string; retryAt?: string } };

export async function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = init.method ?? 'GET';
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      credentials: 'include',
      headers: method === 'GET' ? undefined : { 'Content-Type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(init.body ?? {}),
    });
  } catch {
    throw new ApiError('You appear to be offline. Check your connection and try again.', 0, 'OFFLINE');
  }
  const body = (await response.json().catch(() => ({}))) as T & ErrorBody;
  if (!response.ok) {
    const fallback =
      response.status >= 500 ? 'Something went wrong. Please try again.' : 'That request could not be completed.';
    throw new ApiError(body.error?.message ?? fallback, response.status, body.error?.code, body.error?.retryAt);
  }
  return body;
}
