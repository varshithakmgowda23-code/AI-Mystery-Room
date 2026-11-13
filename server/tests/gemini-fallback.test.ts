import { describe, expect, it, vi } from 'vitest';

const generateContent = vi.hoisted(() => vi.fn());

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent };
    interactions = { create: vi.fn() };
  },
  HarmBlockThreshold: { BLOCK_MEDIUM_AND_ABOVE: 'BLOCK_MEDIUM_AND_ABOVE' },
  HarmCategory: {
    HARM_CATEGORY_HARASSMENT: 'h',
    HARM_CATEGORY_HATE_SPEECH: 'hs',
    HARM_CATEGORY_SEXUALLY_EXPLICIT: 'se',
    HARM_CATEGORY_DANGEROUS_CONTENT: 'dc',
  },
}));

const { GoogleGeminiSession } = await import('../src/services/gemini/client.js');
const { env } = await import('../src/config/env.js');

const options = {
  model: 'primary-model',
  prompt: { system: 's', user: 'u' },
  jsonSchema: {},
  temperature: 0.1,
  timeoutMs: 5000,
};

const dailyQuota = Object.assign(
  new Error(
    JSON.stringify({
      error: {
        code: 429,
        status: 'RESOURCE_EXHAUSTED',
        message: 'Quota exceeded, limit: 20 requests per day',
        details: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', retryDelay: '40000s' }],
      },
    }),
  ),
  { status: 429 },
);

describe('Gemini fallback model (DEC-017, DEC-022)', () => {
  it('switches to the fallback model when the primary model hits its daily quota', async () => {
    generateContent.mockReset();
    generateContent.mockRejectedValueOnce(dailyQuota).mockResolvedValueOnce({ text: '{"ok":true}', usageMetadata: {} });
    const session = new GoogleGeminiSession('test-key');
    await expect(session.generateJson(options)).resolves.toEqual({ ok: true });
    expect(generateContent.mock.calls.map(([request]) => request.model)).toEqual([
      'primary-model',
      env.GEMINI_FALLBACK_MODEL,
    ]);
    expect(session.usage().fallbacks).toBe(1);
  });

  it('does not fall back for an ordinary request error', async () => {
    generateContent.mockReset();
    generateContent.mockRejectedValueOnce(Object.assign(new Error('Invalid argument'), { status: 400 }));
    const session = new GoogleGeminiSession('test-key');
    await expect(session.generateJson(options)).rejects.toThrow('Invalid argument');
    expect(generateContent).toHaveBeenCalledTimes(1);
  });
});
