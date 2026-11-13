import { env } from '../../config/env.js';
import { createGeminiSession, generateStructured, isContentBlocked } from './client.js';
import { SafetyJsonSchema, SafetyResultSchema, type SafetyResult } from './schemas.js';
import { buildSafetyPrompt } from './prompts/safety.prompt.js';

const DENYLIST = [
  /(?:sexual|explicit|erotic).{0,40}(?:minor|child|teen|underage)/i,
  /(?:minor|child|teen|underage).{0,40}(?:sexual|explicit|erotic)/i,
  /(?:graphic|detailed).{0,30}(?:gore|dismemberment|torture)/i,
  /(?:how to|steps to|instructions (?:for|to)).{0,50}(?:make a bomb|build a weapon|poison someone|evade police|commit (?:a )?real crime)/i,
  /(?:kill|attack|stalk|harass).{0,50}(?:my|a real|specific) (?:classmate|coworker|neighbor|teacher|ex-partner)/i,
];

export const CONTENT_POLICY_MESSAGE = 'Please choose a fictional, non-graphic mystery seed without real people, ongoing crimes, or instructions for real-world harm.';

export function isSeedOnDenylist(seed: string): boolean {
  return DENYLIST.some((pattern) => pattern.test(seed));
}

export async function screenSeed(seed: string): Promise<SafetyResult> {
  if (isSeedOnDenylist(seed)) {
    return { safe: false, categories: ['actionable_crime'], userMessage: CONTENT_POLICY_MESSAGE };
  }
  if (env.MOCK_GEMINI) return { safe: true, categories: ['none'], userMessage: '' };

  try {
    const session = createGeminiSession();
    return await generateStructured(session, {
      model: env.GEMINI_VALIDATOR_MODEL,
      buildPrompt: () => buildSafetyPrompt(seed),
      jsonSchema: SafetyJsonSchema,
      temperature: 0.1,
      timeoutMs: 60_000,
    }, SafetyResultSchema);
  } catch (error) {
    if (isContentBlocked(error)) return { safe: false, categories: ['none'], userMessage: CONTENT_POLICY_MESSAGE };
    throw error;
  }
}
