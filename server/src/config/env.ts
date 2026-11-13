import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(5000),
  MONGODB_URI: z.string().min(1).default('mongodb://localhost:27017/ai-mystery-room'),
  JWT_SECRET: z.string().min(32),
  CLIENT_ORIGIN: z.string().url().default('http://localhost:5173'),
  COOKIE_SECURE: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  GEMINI_API_KEY: z.string().default(''),
  GEMINI_TEXT_MODEL: z.string().default('gemini-3.8-flash'),
  GEMINI_VALIDATOR_MODEL: z.string().default('gemini-3.8-flash'),
  GEMINI_IMAGE_MODEL: z.string().default('gemini-nano-banana-2.1'),
  MOCK_GEMINI: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  ENABLE_VIDEO_GENERATION: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./storage'),
  GENERATION_CONCURRENCY: z.coerce.number().int().positive().default(2),
  MAX_GENERATIONS_PER_DAY_USER: z.coerce.number().int().positive().default(10),
  MAX_GENERATIONS_PER_DAY_GUEST: z.coerce.number().int().positive().default(3),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid server environment:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
