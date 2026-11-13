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
    const value = await generateStructured(
      session,
      {
        model: 'fixture-model',
        buildPrompt: (error) => ({ system: 'JSON only', user: `Fix any error: ${error ?? 'none'}` }),
        jsonSchema: {},
        temperature: 0.1,
        timeoutMs: 1000,
      },
      SafetyResultSchema,
    );
    expect(value.safe).toBe(true);
    expect(session.generateJson).toHaveBeenCalledTimes(2);
    expect(vi.mocked(session.generateJson).mock.calls[1][0].prompt.user).toContain('Expected boolean');
  });

  it('does not retry a non-transient request error as a schema failure', async () => {
    const session = fakeSession([Object.assign(new Error('unauthorized'), { status: 401 })]);
    await expect(
      generateStructured(
        session,
        {
          model: 'fixture-model',
          buildPrompt: () => ({ system: 'system', user: 'user' }),
          jsonSchema: {},
          temperature: 0.1,
          timeoutMs: 1000,
        },
        SafetyResultSchema,
      ),
    ).rejects.toThrow('unauthorized');
    expect(session.generateJson).toHaveBeenCalledOnce();
  });

  it('does not retry quota/rate-limit errors and retries transient server errors', () => {
    expect(isRetryableGeminiError({ status: 429 })).toBe(false);
    expect(isRetryableGeminiError({ status: 503 })).toBe(true);
    expect(isRetryableGeminiError({ status: 401 })).toBe(false);
  });
});

describe('Gemini model fallback detection', () => {
  it('treats 5xx, gateway deadlines and our own timeouts as overloaded, but not quota errors', async () => {
    const { isOverloaded } = await import('../src/services/gemini/client.js');
    expect(isOverloaded({ status: 503 })).toBe(true);
    expect(
      isOverloaded(new Error('{"error":{"code":504,"message":"Deadline expired","status":"DEADLINE_EXCEEDED"}}')),
    ).toBe(true);
    expect(isOverloaded(Object.assign(new Error('timed out'), { name: 'TimeoutError' }))).toBe(true);
    expect(isOverloaded({ status: 429, message: 'Rate limit exceeded' })).toBe(false);
    expect(isOverloaded(new Error('Invalid argument'))).toBe(false);
  });
});

describe('Gemini retry policy', () => {
  it('waits out a per-minute 429 and then succeeds', async () => {
    const { retry } = await import('../src/services/gemini/client.js');
    const waits: number[] = [];
    let calls = 0;
    const result = await retry(
      async () => {
        calls += 1;
        if (calls === 1)
          throw Object.assign(
            new Error(
              JSON.stringify({
                error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'limit', details: [{ retryDelay: '12s' }] },
              }),
            ),
            { status: 429 },
          );
        return 'ok';
      },
      async (ms) => waits.push(ms),
    );
    expect(result).toBe('ok');
    expect(waits[0]).toBeGreaterThanOrEqual(12_000);
  });

  it('turns schema issues into short field-level feedback for the model', async () => {
    const { describeValidationError } = await import('../src/services/gemini/client.js');
    const { z } = await import('zod');
    const parsed = z.object({ items: z.array(z.object({ messages: z.array(z.string()).min(8) })) }).safeParse({
      items: [{ messages: ['a'] }],
    });
    expect(parsed.success).toBe(false);
    expect(describeValidationError(parsed.error)).toBe('items.0.messages: Array must contain at least 8 element(s)');
  });
});
