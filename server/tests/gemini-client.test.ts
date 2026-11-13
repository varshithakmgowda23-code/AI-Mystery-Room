import { describe, expect, it, vi } from 'vitest';
import { generateStructured, isRetryableGeminiError, type GeminiSession } from '../src/services/gemini/client.js';
import { SafetyResultSchema } from '../src/services/gemini/schemas.js';

function fakeSession(responses: unknown[]): GeminiSession {
  let index = 0;
  return {
    generateJson: vi.fn(async () => {
      const response = responses[Math.min(index, responses.length - 1)];
      index += 1;
      if (response instanceof Error) throw response;
      return response;
    }),
    generateImage: vi.fn(async () => ({ bytes: Buffer.from('image'), mimeType: 'image/png' })),
    usage: () => ({ textCalls: 0, inputTokens: 0, outputTokens: 0, images: 0 }),
  };
}

describe('Gemini structured output handling', () => {
  it('retries malformed output and sends the validation error back to the prompt', async () => {
    const session = fakeSession([
      { safe: 'yes', categories: [], userMessage: '' },
      { safe: true, categories: ['none'], userMessage: '' },
    ]);
    const value = await generateStructured(session, {
      model: 'fixture-model',
      buildPrompt: (error) => ({ system: 'JSON only', user: `Fix any error: ${error ?? 'none'}` }),
      jsonSchema: {}, temperature: 0.1, timeoutMs: 1000,
    }, SafetyResultSchema);
    expect(value.safe).toBe(true);
    expect(session.generateJson).toHaveBeenCalledTimes(2);
    expect(vi.mocked(session.generateJson).mock.calls[1][0].prompt.user).toContain('Expected boolean');
  });

  it('does not retry a non-transient request error as a schema failure', async () => {
    const session = fakeSession([Object.assign(new Error('unauthorized'), { status: 401 })]);
    await expect(generateStructured(session, {
      model: 'fixture-model', buildPrompt: () => ({ system: 'system', user: 'user' }), jsonSchema: {}, temperature: 0.1, timeoutMs: 1000,
    }, SafetyResultSchema)).rejects.toThrow('unauthorized');
    expect(session.generateJson).toHaveBeenCalledOnce();
  });

  it('does not retry quota/rate-limit errors and retries transient server errors', () => {
    expect(isRetryableGeminiError({ status: 429 })).toBe(false);
    expect(isRetryableGeminiError({ status: 503 })).toBe(true);
    expect(isRetryableGeminiError({ status: 401 })).toBe(false);
  });
});
