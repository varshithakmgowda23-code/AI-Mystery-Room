import { API_BASE } from '../api/http.js';

/** Stored media is served through the auth-checked route (API-22); placeholders are static files. */
export function mediaUrl(caseId: string, value: string | undefined): string | null {
  if (!value) return null;
  if (value.startsWith('/media/')) return null;
  return `${API_BASE}/media/${caseId}/${encodeURIComponent(value)}`;
}
