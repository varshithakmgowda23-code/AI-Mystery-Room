import { GoogleGenAI, HarmBlockThreshold, HarmCategory } from '@google/genai';
import { env } from '../../config/env.js';

export type GeminiUsage = { textCalls: number; inputTokens: number; outputTokens: number; images: number };
export type GenerateJsonOptions = { model: string; prompt: { system: string; user: string }; jsonSchema: unknown; temperature: number; timeoutMs: number };
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
  return typeof error === 'object' && error !== null && ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'].includes(String((error as { code?: unknown }).code));
}

class GeminiContentBlockedError extends Error {
  constructor(reason: string) { super(`Gemini blocked this content for safety: ${reason}`); this.name = 'GeminiContentBlockedError'; }
}

async function retry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try { return await operation(); }
    catch (error) {
      if (!isRetryable(error) || attempt >= 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 350 * 2 ** attempt));
    }
  }
}

export class GoogleGeminiSession implements GeminiSession {
  private readonly textClient: GoogleGenAI;
  private readonly imageClient: GoogleGenAI;
  private readonly metrics: GeminiUsage = { textCalls: 0, inputTokens: 0, outputTokens: 0, images: 0 };

  constructor(apiKey = env.GEMINI_API_KEY) {
    if (!apiKey) throw new Error('GEMINI_API_KEY is required when MOCK_GEMINI=false.');
    this.textClient = new GoogleGenAI({ apiKey });
    this.imageClient = new GoogleGenAI({ apiKey });
  }

  async generateJson(options: GenerateJsonOptions): Promise<unknown> {
    return retry(async () => {
      const response = await this.textClient.models.generateContent({
        model: options.model,
        contents: options.prompt.user,
        config: {
          systemInstruction: options.prompt.system,
          responseMimeType: 'application/json',
          responseJsonSchema: options.jsonSchema,
          temperature: options.temperature,
          safetySettings: [
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
          ],
          httpOptions: { timeout: options.timeoutMs, retryOptions: { attempts: 1 } },
          abortSignal: AbortSignal.timeout(options.timeoutMs),
        },
      });
      const text = response.text;
      if (!text && response.promptFeedback?.blockReason) throw new GeminiContentBlockedError(String(response.promptFeedback.blockReason));
      if (!text) throw new Error('Gemini returned no JSON content.');
      this.metrics.textCalls += 1;
      this.metrics.inputTokens += response.usageMetadata?.promptTokenCount ?? 0;
      this.metrics.outputTokens += response.usageMetadata?.candidatesTokenCount ?? 0;
      return JSON.parse(text) as unknown;
    });
  }

  async generateImage(prompt: string): Promise<GeneratedImage> {
    return retry(async () => {
      const interaction = await this.imageClient.interactions.create({
        model: env.GEMINI_IMAGE_MODEL,
        input: prompt,
      }, { timeout_ms: 90_000, retries: { strategy: 'none' } });
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

export async function generateStructured<T>(
  session: GeminiSession,
  input: Omit<GenerateJsonOptions, 'prompt'> & { buildPrompt: (validationError?: string) => { system: string; user: string } },
  schema: { parse(value: unknown): T },
): Promise<T> {
  let validationError: string | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let value: unknown;
    try {
      value = await session.generateJson({ ...input, prompt: input.buildPrompt(validationError) });
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      validationError = error instanceof Error ? error.message : 'Output did not match the required JSON schema.';
      if (attempt === 2) throw new Error(`Gemini output failed validation after three attempts: ${validationError}`);
      continue;
    }
    try {
      return schema.parse(value);
    } catch (error) {
      validationError = error instanceof Error ? error.message : 'Output did not match the required JSON schema.';
      if (attempt === 2) throw new Error(`Gemini output failed validation after three attempts: ${validationError}`);
    }
  }
  throw new Error('Gemini output failed validation.');
}

export function isContentBlocked(error: unknown): boolean {
  return typeof error === 'object' && error !== null && /blocked|safety|prohibited/i.test(String((error as { message?: unknown }).message ?? ''));
}

export function isRetryableGeminiError(error: unknown): boolean { return isRetryable(error); }
