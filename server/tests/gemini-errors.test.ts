import { describe, expect, it } from 'vitest';
import { classifyGeminiError, classifyStoredGenerationError } from '../src/services/gemini/errors.js';

describe('Gemini error mapping', () => {
  it('maps RESOURCE_EXHAUSTED quota errors to a safe message and extracts retry delay', () => {
    const error = Object.assign(
      new Error(
        JSON.stringify({
          error: {
            code: 429,
            status: 'RESOURCE_EXHAUSTED',
            message: 'You exceeded your current quota.',
            details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '3600s' }],
          },
        }),
      ),
      { status: 429 },
    );

    const result = classifyGeminiError(error);
    expect(result.code).toBe('AI_QUOTA_EXCEEDED');
    expect(result.message).toContain('Daily AI generation limit reached.');
    expect(result.retryAt).toBeDefined();
    expect(result.message).not.toContain('RESOURCE_EXHAUSTED');
  });

  it('maps 429 rate limits separately from daily quota exhaustion', () => {
    expect(classifyGeminiError(Object.assign(new Error('Too many requests.'), { status: 429 }))).toMatchObject({
      code: 'AI_RATE_LIMITED',
      message: 'The AI service is receiving too many requests. Please wait a bit and try again.',
    });
  });

  it('maps service unavailable, network, and unknown failures without exposing raw details', () => {
    expect(classifyGeminiError(Object.assign(new Error('internal endpoint details'), { status: 503 }))).toMatchObject({
      code: 'AI_UNAVAILABLE',
      message: 'The AI model is temporarily unavailable. Please try again later.',
    });
    expect(
      classifyGeminiError(Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNRESET' } })),
    ).toMatchObject({
      code: 'AI_NETWORK_ERROR',
      message: 'Unable to connect to the AI service. Please try again when your connection is available.',
    });
    expect(classifyGeminiError(new Error('raw provider response with internal details'))).toEqual({
      code: 'GENERATION_FAILED',
      message: 'Something went wrong while generating the case.',
    });
  });

  it('sanitizes old stored error text and retains recognized generation error categories', () => {
    expect(classifyStoredGenerationError('GENERATION_FAILED', 'Invalid option : option')).toEqual({
      code: 'GENERATION_FAILED',
      message: 'Something went wrong while generating the case.',
    });
    expect(classifyStoredGenerationError('AI_UNAVAILABLE', 'provider diagnostic')).toMatchObject({
      code: 'AI_UNAVAILABLE',
      message: 'The AI model is temporarily unavailable. Please try again later.',
    });
  });
});
