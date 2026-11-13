import type { Difficulty, Tone } from './schemas.js';

export interface CaseCreationInput {
  seed: string;
  difficulty: Difficulty;
  tone: Tone;
}
