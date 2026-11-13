import type {
  AccuseResponse,
  CaseListResponse,
  CaseStatus,
  Difficulty,
  PlayerCaseView,
  PublicCaseView,
  SuspectTag,
  Tone,
} from '@ai-mystery-room/shared';
import { API_BASE, request } from './http.js';

export const PLAYABLE_STATUSES: readonly CaseStatus[] = ['ready', 'in_progress', 'resolved'];
export const isPlayable = (status?: CaseStatus) => status !== undefined && PLAYABLE_STATUSES.includes(status);

export const generationErrorMessages: Record<string, string> = {
  CONTENT_POLICY:
    'Please choose a fictional, non-graphic mystery seed without real people, ongoing crimes, or instructions for real-world harm.',
  AI_QUOTA_EXCEEDED:
    'Daily AI generation limit reached. Our AI detective needs a break! Please try again after your quota resets.',
  AI_RATE_LIMITED: 'The AI service is receiving too many requests. Please wait a bit and try again.',
  AI_UNAVAILABLE: 'The AI model is temporarily unavailable. Please try again later.',
  AI_NETWORK_ERROR: 'Unable to connect to the AI service. Please try again when your connection is available.',
  GENERATION_FAILED: 'Something went wrong while generating the case.',
};
export const genericGenerationError = generationErrorMessages.GENERATION_FAILED;

export function safeGenerationErrorMessage(message?: string): string {
  if (!message) return genericGenerationError;
  if (message.startsWith('Please choose a fictional, non-graphic mystery seed'))
    return generationErrorMessages.CONTENT_POLICY;
  const knownMessage = Object.values(generationErrorMessages).find(
    (safeMessage) => message === safeMessage || message.startsWith(`${safeMessage} Approximate retry time:`),
  );
  return knownMessage ? message : genericGenerationError;
}

export type NewCase = { seed: string; difficulty: Difficulty; tone: Tone };

export async function createCase(payload: NewCase): Promise<string> {
  const { caseId } = await request<{ caseId: string }>('/cases', { method: 'POST', body: payload });
  return caseId;
}

export async function regenerateCase(caseId: string): Promise<void> {
  await request(`/cases/${caseId}/regenerate`, { method: 'POST' });
}

export const getCase = (caseId: string) => request<PlayerCaseView>(`/cases/${caseId}`);

export const saveNotes = (caseId: string, notes: string) =>
  request<{ notes: string }>(`/cases/${caseId}/notes`, { method: 'PATCH', body: { notes } });

export const saveSuspectTags = (caseId: string, tags: Record<string, SuspectTag>) =>
  request<{ suspectTags: Record<string, SuspectTag> }>(`/cases/${caseId}/suspect-tags`, {
    method: 'PATCH',
    body: { tags },
  });

export const markEvidenceViewed = (caseId: string, evidenceId: string) =>
  request<{ viewedEvidence: string[] }>(`/cases/${caseId}/evidence/${evidenceId}/view`, { method: 'POST' });

export const revealHint = (caseId: string) =>
  request<{ hint: string; hintsUsed: number; hintsAvailable: number }>(`/cases/${caseId}/hints`, { method: 'POST' });

export const accuse = (caseId: string, suspectId: string, reasoning?: string) =>
  request<AccuseResponse>(`/cases/${caseId}/accuse`, {
    method: 'POST',
    body: reasoning ? { suspectId, reasoning } : { suspectId },
  });

export const giveUp = (caseId: string) => request<PlayerCaseView>(`/cases/${caseId}/reveal`, { method: 'POST' });

export const listCases = (page: number) => request<CaseListResponse>(`/cases?page=${page}`);

export const deleteCase = (caseId: string) => request<{ deleted: true }>(`/cases/${caseId}`, { method: 'DELETE' });

export const setSharing = (caseId: string, enabled: boolean) =>
  request<{ shareToken: string | null }>(`/cases/${caseId}/share`, { method: 'POST', body: { enabled } });

export const getPublicCase = (token: string) => request<PublicCaseView>(`/public/cases/${token}`);

export type CaseProgress = {
  status: CaseStatus;
  progress: { stage: string; percent: number; label: string };
  error?: string;
  errorCode?: string;
};
export function formatRetryTime(value?: string): string | null {
  const retryAt = value ? new Date(value) : null;
  if (!retryAt || Number.isNaN(retryAt.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(retryAt);
}
export async function getCaseStatus(caseId: string): Promise<CaseProgress> {
  const response = await fetch(`${API_BASE}/cases/${caseId}/status`, { credentials: 'include' });
  const result = (await response.json()) as Omit<CaseProgress, 'error' | 'errorCode'> & {
    error?: string | { code?: string; message?: string; retryAt?: string };
  };
  if (!response.ok)
    throw new Error(
      response.status === 404
        ? 'That case could not be found.'
        : 'Something went wrong while checking case generation.',
    );
  if (!result.error) return { status: result.status, progress: result.progress };
  const errorCode = typeof result.error === 'object' ? result.error.code : undefined;
  const safeMessage = errorCode
    ? (generationErrorMessages[errorCode] ?? genericGenerationError)
    : typeof result.error === 'string' && result.error.startsWith('Please choose a fictional, non-graphic mystery seed')
      ? generationErrorMessages.CONTENT_POLICY
      : genericGenerationError;
  const retryValue = typeof result.error === 'object' ? result.error.retryAt : undefined;
  const retryTime = formatRetryTime(retryValue);
  return { ...result, errorCode, error: `${safeMessage}${retryTime ? ` Approximate retry time: ${retryTime}.` : ''}` };
}
