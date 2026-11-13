export type UserFacingGenerationError = {
  code: 'AI_QUOTA_EXCEEDED' | 'AI_RATE_LIMITED' | 'AI_UNAVAILABLE' | 'AI_NETWORK_ERROR' | 'GENERATION_FAILED';
  message: string;
  retryAt?: string;
};

type ErrorRecord = Record<string, unknown>;

function isRecord(value: unknown): value is ErrorRecord {
  return typeof value === 'object' && value !== null;
}

function errorRecords(error: unknown): ErrorRecord[] {
  const records: ErrorRecord[] = [];
  const pending: Array<{ value: unknown; depth: number }> = [{ value: error, depth: 0 }];
  const seen = new Set<object>();
  while (pending.length > 0) {
    const current = pending.shift();
    if (!current || current.depth > 4 || !isRecord(current.value) || seen.has(current.value)) continue;
    seen.add(current.value);
    records.push(current.value);
    for (const key of ['error', 'cause', 'response', 'data', 'body', 'details']) {
      const value = current.value[key];
      if (Array.isArray(value)) {
        for (const item of value) pending.push({ value: item, depth: current.depth + 1 });
      } else if (isRecord(value)) {
        pending.push({ value, depth: current.depth + 1 });
      }
    }
    if (typeof current.value.message === 'string') {
      try {
        pending.push({ value: JSON.parse(current.value.message) as unknown, depth: current.depth + 1 });
      } catch {
        // The message is plain text rather than a serialized API error.
      }
    }
  }
  return records;
}

function numericStatus(records: ErrorRecord[]): number | undefined {
  for (const record of records) {
    for (const key of ['status', 'statusCode', 'code']) {
      const value = record[key];
      if (typeof value === 'number') return value;
      if (typeof value === 'string' && /^\d{3}$/.test(value)) return Number(value);
    }
  }
  return undefined;
}

function apiCode(records: ErrorRecord[]): string {
  const values: string[] = [];
  for (const record of records) {
    for (const key of ['status', 'code', 'name']) {
      const value = record[key];
      if (typeof value === 'string' && !/^\d{3}$/.test(value)) values.push(value.toUpperCase());
    }
  }
  const recognized = [
    'RESOURCE_EXHAUSTED',
    'UNAVAILABLE',
    'SERVICE_UNAVAILABLE',
    'ECONNRESET',
    'ETIMEDOUT',
    'EAI_AGAIN',
    'ENOTFOUND',
    'ECONNREFUSED',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_SOCKET',
  ];
  return values.find((value) => recognized.includes(value)) ?? values[0] ?? '';
}

function retryDelaySeconds(records: ErrorRecord[]): number | undefined {
  for (const record of records) {
    const value = record.retryDelay ?? record.retry_after ?? record.retryAfter;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
    if (typeof value === 'string') {
      const duration = /^(\d+(?:\.\d+)?)s$/.exec(value.trim());
      if (duration) return Number(duration[1]);
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) return seconds;
    }
    const headers = record.headers;
    if (headers && typeof headers === 'object' && 'get' in headers && typeof headers.get === 'function') {
      const headerValue = headers.get('retry-after');
      if (typeof headerValue === 'string') {
        const seconds = Number(headerValue);
        if (Number.isFinite(seconds) && seconds >= 0) return seconds;
        const date = Date.parse(headerValue);
        if (!Number.isNaN(date)) return Math.max(0, (date - Date.now()) / 1000);
      }
    } else if (isRecord(headers)) {
      const headerValue = headers['retry-after'] ?? headers['Retry-After'];
      if (typeof headerValue === 'string') {
        const seconds = Number(headerValue);
        if (Number.isFinite(seconds) && seconds >= 0) return seconds;
        const date = Date.parse(headerValue);
        if (!Number.isNaN(date)) return Math.max(0, (date - Date.now()) / 1000);
      }
    }
  }
  return undefined;
}

const DAILY_LIMIT = /per ?day|daily|PerDay/i;

/**
 * For a short-term (per-minute) Gemini rate limit, returns how long to wait in ms.
 * Daily quota exhaustion returns undefined so callers fail fast (DEC-019).
 */
export function shortRateLimitDelayMs(error: unknown, maxSeconds = 70): number | undefined {
  const records = errorRecords(error);
  const status = numericStatus(records);
  const code = apiCode(records);
  if (status !== 429 && code !== 'RESOURCE_EXHAUSTED') return undefined;
  const text = records.map((record) => (typeof record.message === 'string' ? record.message : '')).join(' ');
  if (DAILY_LIMIT.test(text)) return undefined;
  const seconds = retryDelaySeconds(records);
  if (seconds === undefined) return /per ?minute|PerMinute/i.test(text) ? 30_000 : undefined;
  return seconds <= maxSeconds ? Math.ceil(seconds * 1000) : undefined;
}

export function classifyGeminiError(error: unknown): UserFacingGenerationError {
  const records = errorRecords(error);
  const status = numericStatus(records);
  const code = apiCode(records);
  const text = records
    .map((record) => (typeof record.message === 'string' ? record.message : ''))
    .join(' ')
    .toLowerCase();
  const seconds = retryDelaySeconds(records);
  const retryAt = seconds === undefined ? undefined : new Date(Date.now() + seconds * 1000).toISOString();

  const shortDelay = shortRateLimitDelayMs(error);
  if (shortDelay !== undefined) {
    return {
      code: 'AI_RATE_LIMITED',
      message: 'The AI service is receiving too many requests. Please wait a bit and try again.',
      retryAt: new Date(Date.now() + shortDelay).toISOString(),
    };
  }
  if (status === 429 || code === 'RESOURCE_EXHAUSTED') {
    const exhausted = code === 'RESOURCE_EXHAUSTED' || /daily|per day|free.?tier|quota|exhausted/i.test(text);
    return {
      code: exhausted ? 'AI_QUOTA_EXCEEDED' : 'AI_RATE_LIMITED',
      message: exhausted
        ? 'Daily AI generation limit reached. Our AI detective needs a break! Please try again after your quota resets.'
        : 'The AI service is receiving too many requests. Please wait a bit and try again.',
      ...(retryAt ? { retryAt } : {}),
    };
  }
  if (status === 503 || code === 'UNAVAILABLE' || code === 'SERVICE_UNAVAILABLE') {
    return {
      code: 'AI_UNAVAILABLE',
      message: 'The AI model is temporarily unavailable. Please try again later.',
      ...(retryAt ? { retryAt } : {}),
    };
  }

  const networkCodes = [
    'ECONNRESET',
    'ETIMEDOUT',
    'EAI_AGAIN',
    'ENOTFOUND',
    'ECONNREFUSED',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_SOCKET',
  ];
  if (
    networkCodes.includes(code) ||
    /network error|fetch failed|socket hang up|connection (?:reset|refused|timed out)|dns/i.test(text)
  ) {
    return {
      code: 'AI_NETWORK_ERROR',
      message: 'Unable to connect to the AI service. Please try again when your connection is available.',
    };
  }

  return { code: 'GENERATION_FAILED', message: 'Something went wrong while generating the case.' };
}

export function classifyStoredGenerationError(
  failureCode: string | null | undefined,
  failureReason: string | null | undefined,
): UserFacingGenerationError {
  const message = failureReason ?? '';
  switch (failureCode) {
    case 'AI_QUOTA_EXCEEDED':
      return classifyGeminiError({ status: 429, code: 'RESOURCE_EXHAUSTED', message });
    case 'AI_RATE_LIMITED':
      return classifyGeminiError({ status: 429, code: 'RATE_LIMITED', message });
    case 'AI_UNAVAILABLE':
      return classifyGeminiError({ status: 503, code: 'UNAVAILABLE', message });
    case 'AI_NETWORK_ERROR':
      return classifyGeminiError({ code: 'ECONNRESET', message });
    default:
      return classifyGeminiError(new Error(message));
  }
}

export function isGeminiQuotaError(error: unknown): boolean {
  return classifyGeminiError(error).code === 'AI_QUOTA_EXCEEDED';
}
