import { GoogleGenAI, HarmBlockThreshold, HarmCategory } from '@google/genai';
import { env } from '../../config/env.js';
import { isGeminiQuotaError, shortRateLimitDelayMs } from './errors.js';
import { logger } from '../../utils/logger.js';

export type GeminiUsage = {
  textCalls: number;
  inputTokens: number;
  outputTokens: number;
  images: number;
  fallbacks: number;
};
export type GenerateJsonOptions = {
  model: string;
  prompt: { system: string; user: string };
  jsonSchema: unknown;
  temperature: number;
  timeoutMs: number;
};
export type GeneratedImage = { bytes: Buffer; mimeType: string };

export interface GeminiSession {
  generateJson(options: GenerateJsonOptions): Promise<unknown>;
  generateImage(prompt: string): Promise<GeneratedImage>;
  usage(): GeminiUsage;
}

function errorStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const record = error as { status?: unknown; statusCode?: unknown; code?: unknown };
  if (typeof record.status === 'number') return record.status;
  if (typeof record.statusCode === 'number') return record.statusCode;
  if (record.code === 'RESOURCE_EXHAUSTED') return 429;
  if (record.code === 'UNAVAILABLE') return 503;
  return undefined;
}

function isRetryable(error: unknown): boolean {
  const status = errorStatus(error);
  if (status === 429) return false;
  if (status !== undefined && status >= 500) return true;
  return (
    typeof error === 'object' &&
    error !== null &&
    ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'].includes(String((error as { code?: unknown }).code))
  );
}

/** 5xx, gateway deadline, or our own request timeout: worth trying another model. */
export function isOverloaded(error: unknown): boolean {
  const status = errorStatus(error);
  if (status !== undefined && status >= 500) return true;
  if (typeof error !== 'object' || error === null) return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  if (name === 'TimeoutError' || name === 'AbortError') return true;
  return typeof message === 'string' && /"code":\s*50[0-9]|DEADLINE_EXCEEDED|UNAVAILABLE|high demand/i.test(message);
}

class GeminiContentBlockedError extends Error {
  constructor(reason: string) {
    super(`Gemini blocked this content for safety: ${reason}`);
    this.name = 'GeminiContentBlockedError';
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Process-wide cap on in-flight Gemini requests so parallel cases cannot burst past per-minute limits. */
class Semaphore {
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  constructor(private readonly limit: number) {}
  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active += 1;
    try {
      return await task();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }
}
const pacer = new Semaphore(env.GEMINI_MAX_CONCURRENT_CALLS);

/**
 * Retries transient 5xx/network errors with backoff, and waits out short per-minute
 * rate limits (up to 3 times). Daily quota errors are thrown immediately (DEC-019).
 */
export async function retry<T>(
  operation: () => Promise<T>,
  wait: (ms: number) => Promise<unknown> = sleep,
): Promise<T> {
  let transientAttempts = 0;
  let rateLimitWaits = 0;
  for (;;) {
    try {
      return await pacer.run(operation);
    } catch (error) {
      const delay = shortRateLimitDelayMs(error);
      if (delay !== undefined && rateLimitWaits < 3) {
        rateLimitWaits += 1;
        logger.warn({ waitMs: delay }, 'Gemini per-minute limit reached, waiting');
        await wait(delay + 500 + Math.floor(Math.random() * 1500));
        continue;
      }
      if (!isRetryable(error) || transientAttempts >= 2) throw error;
      await wait(350 * 2 ** transientAttempts);
      transientAttempts += 1;
    }
  }
}

export class GoogleGeminiSession implements GeminiSession {
  private readonly textClient: GoogleGenAI;
  private readonly imageClient: GoogleGenAI;
  private readonly metrics: GeminiUsage = { textCalls: 0, inputTokens: 0, outputTokens: 0, images: 0, fallbacks: 0 };

  constructor(apiKey = env.GEMINI_API_KEY) {
    if (!apiKey) throw new Error('GEMINI_API_KEY is required when MOCK_GEMINI=false.');
    this.textClient = new GoogleGenAI({ apiKey });
    this.imageClient = new GoogleGenAI({ apiKey });
  }

  /**
   * Calls the requested model. If it is overloaded, times out, or its daily quota is
   * exhausted, retries once on GEMINI_FALLBACK_MODEL (DEC-017, DEC-022).
   */
  async generateJson(options: GenerateJsonOptions): Promise<unknown> {
    try {
      return await this.generateJsonWith(options.model, options);
    } catch (error) {
      const fallback = env.GEMINI_FALLBACK_MODEL;
      if (!fallback || fallback === options.model || !(isOverloaded(error) || isGeminiQuotaError(error))) throw error;
      this.metrics.fallbacks += 1;
      logger.warn(
        { model: options.model, fallback, reason: isOverloaded(error) ? 'overloaded' : 'daily_quota' },
        'Gemini model unavailable, using fallback model',
      );
      return this.generateJsonWith(fallback, options);
    }
  }

  private async generateJsonWith(model: string, options: GenerateJsonOptions): Promise<unknown> {
    return retry(async () => {
      const response = await this.textClient.models.generateContent({
        model,
        contents: options.prompt.user,
        config: {
          systemInstruction: options.prompt.system,
          responseMimeType: 'application/json',
          responseJsonSchema: options.jsonSchema,
          temperature: options.temperature,
          safetySettings: [
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
            {
              category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
              threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
            },
            {
              category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
              threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
            },
          ],
          httpOptions: { timeout: options.timeoutMs, retryOptions: { attempts: 1 } },
          abortSignal: AbortSignal.timeout(options.timeoutMs),
        },
      });
      const text = response.text;
      if (!text && response.promptFeedback?.blockReason)
        throw new GeminiContentBlockedError(String(response.promptFeedback.blockReason));
      if (!text) throw new Error('Gemini returned no JSON content.');
      this.metrics.textCalls += 1;
      this.metrics.inputTokens += response.usageMetadata?.promptTokenCount ?? 0;
      this.metrics.outputTokens += response.usageMetadata?.candidatesTokenCount ?? 0;
      return JSON.parse(text) as unknown;
    });
  }

  async generateImage(prompt: string): Promise<GeneratedImage> {
    return retry(async () => {
      const interaction = await this.imageClient.interactions.create(
        {
          model: env.GEMINI_IMAGE_MODEL,
          input: prompt,
        },
        { timeout_ms: 90_000, retries: { strategy: 'none' } },
      );
      const image = interaction.output_image;
      if (!image?.data) throw new Error('Gemini image generation returned no image data.');
      this.metrics.images += 1;
      return { bytes: Buffer.from(image.data, 'base64'), mimeType: image.mime_type ?? 'image/png' };
    });
  }

  usage(): GeminiUsage {
    return { ...this.metrics };
  }
}

export function createGeminiSession(): GeminiSession {
  return new GoogleGeminiSession();
}

/** Turns a ZodError into short lines the model can act on, e.g. `items.1.content.messages: needs at least 8`. */
export function describeValidationError(error: unknown): string {
  if (typeof error === 'object' && error !== null && Array.isArray((error as { issues?: unknown }).issues)) {
    const issues = (error as { issues: Array<{ path: Array<string | number>; message: string }> }).issues;
    return issues
      .slice(0, 8)
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
  }
  return error instanceof Error ? error.message : 'Output did not match the required JSON schema.';
}

export async function generateStructured<T>(
  session: GeminiSession,
  input: Omit<GenerateJsonOptions, 'prompt'> & {
    buildPrompt: (validationError?: string) => { system: string; user: string };
  },
  schema: { parse(value: unknown): T },
): Promise<T> {
  let validationError: string | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let value: unknown;
    try {
      value = await session.generateJson({ ...input, prompt: input.buildPrompt(validationError) });
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      validationError = describeValidationError(error);
      if (attempt === 2) throw new Error(`Gemini output failed validation after three attempts: ${validationError}`);
      continue;
    }
    try {
      return schema.parse(value);
    } catch (error) {
      validationError = describeValidationError(error);
      if (attempt === 2) throw new Error(`Gemini output failed validation after three attempts: ${validationError}`);
    }
  }
  throw new Error('Gemini output failed validation.');
}

export function isContentBlocked(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    /blocked|safety|prohibited/i.test(String((error as { message?: unknown }).message ?? ''))
  );
}

export function isRetryableGeminiError(error: unknown): boolean {
  return isRetryable(error);
}
