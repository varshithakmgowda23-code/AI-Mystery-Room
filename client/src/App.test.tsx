import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatRetryTime, getCaseStatus } from './App.js';

function mockStatusResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

describe('case status client handling', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it.each(['queued', 'generating', 'ready', 'failed'] as const)(
    'preserves the %s status returned by the status API', async (status) => {
      const progress = { stage: status, percent: status === 'ready' ? 100 : 0, label: 'Preparing the case.' };
      fetchMock.mockResolvedValue(mockStatusResponse({ status, progress }));

      await expect(getCaseStatus('case-123')).resolves.toMatchObject({ status, progress });
      expect(fetchMock).toHaveBeenCalledWith('http://localhost:5000/api/cases/case-123/status', { credentials: 'include' });
    },
  );

  it('keeps quota errors structured, friendly, and includes an approximate retry time', async () => {
    fetchMock.mockResolvedValue(mockStatusResponse({
      status: 'failed',
      progress: { stage: 'failed', percent: 0, label: 'Preparing the case.' },
      error: {
        code: 'AI_QUOTA_EXCEEDED',
        message: 'Raw provider quota details must not be exposed.',
        retryAt: '2026-11-05T08:00:01.018Z',
      },
    }));

    const result = await getCaseStatus('case-123');
    expect(result).toMatchObject({
      status: 'failed',
      errorCode: 'AI_QUOTA_EXCEEDED',
      error: expect.stringContaining('Daily AI generation limit reached.'),
    });
    expect(result.error).toContain('Approximate retry time:');
    expect(result.error).not.toContain('Raw provider quota details');
  });

  it('hides unknown legacy failure text behind the safe generic message', async () => {
    fetchMock.mockResolvedValue(mockStatusResponse({
      status: 'failed',
      progress: { stage: 'failed', percent: 0, label: 'Preparing the case.' },
      error: { code: 'GENERATION_FAILED', message: 'Invalid option : option' },
    }));

    await expect(getCaseStatus('case-123')).resolves.toMatchObject({
      errorCode: 'GENERATION_FAILED',
      error: 'Something went wrong while generating the case.',
    });
  });

  it('does not expose backend details when a status request fails', async () => {
    fetchMock.mockResolvedValue(mockStatusResponse({ error: { message: 'internal database stack trace' } }, false, 500));

    await expect(getCaseStatus('case-123')).rejects.toThrow('Something went wrong while checking case generation.');
  });

  it('formats valid retry timestamps and safely ignores invalid ones', () => {
    expect(formatRetryTime('2026-11-05T08:00:01.018Z')).toBeTruthy();
    expect(formatRetryTime('not-a-date')).toBeNull();
    expect(formatRetryTime()).toBeNull();
  });
});
