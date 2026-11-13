import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(5050),
  MONGODB_URI: z.string().min(1).default('mongodb://127.0.0.1:27017/ai-mystery-room'),
  JWT_SECRET: z
    .string()
    .min(32)
    .refine((value) => !value.startsWith('replace-with'), 'JWT_SECRET is still the example placeholder.'),
  CLIENT_ORIGIN: z.string().url().default('http://localhost:5173'),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  GEMINI_API_KEY: z.string().default(''),
  GEMINI_TEXT_MODEL: z.string().default('gemini-3.5-flash'),
  GEMINI_FAST_MODEL: z.string().default('gemini-3.5-flash-lite'),
  GEMINI_FALLBACK_MODEL: z.string().default('gemini-3.5-flash-lite'),
  GEMINI_MAX_CONCURRENT_CALLS: z.coerce.number().int().min(1).max(20).default(3),
  GEMINI_TEXT_TIMEOUT_MS: z.coerce.number().int().min(10_000).max(300_000).default(120_000),
  GEMINI_VALIDATOR_MODEL: z.string().default('gemini-3.5-flash'),
  GEMINI_IMAGE_MODEL: z.string().default('gemini-nano-banana-2.1'),
  ENABLE_IMAGE_GENERATION: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  MOCK_GEMINI: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  ENABLE_VIDEO_GENERATION: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./storage'),
  GENERATION_CONCURRENCY: z.coerce.number().int().positive().default(2),
  MAX_GENERATIONS_PER_DAY_USER: z.coerce.number().int().positive().default(10),
  MAX_GENERATIONS_PER_DAY_GUEST: z.coerce.number().int().positive().default(3),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
  RATE_LIMIT_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  RATE_LIMIT_GLOBAL_MAX: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_POLLING_MAX: z.coerce.number().int().positive().default(1000),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().default(20),
  RATE_LIMIT_GENERATION_MAX: z.coerce.number().int().positive().default(20),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid server environment:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  LOG_LEVEL: parsed.data.LOG_LEVEL ?? (parsed.data.NODE_ENV === 'test' ? 'silent' : 'info'),
};
