import { defineConfig, devices } from '@playwright/test';

/**
 * E2E smoke (spec §18). Runs its own API (port 5051, MOCK_GEMINI=true, separate database)
 * and client (port 5174) so it never uses real AI quota or your development data.
 * Requires MongoDB running locally (or MONGODB_URI_E2E).
 */
const mongo = process.env.MONGODB_URI_E2E ?? 'mongodb://127.0.0.1:27017/ai-mystery-room-e2e';
const secret = process.env.JWT_SECRET ?? 'e2e-only-session-secret-0123456789abcdef';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:5174', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      command: 'npm run build --workspace=shared && cd server && npx tsx src/index.ts',
      url: 'http://localhost:5051/api/health',
      env: {
        PORT: '5051',
        MOCK_GEMINI: 'true',
        MONGODB_URI: mongo,
        JWT_SECRET: secret,
        CLIENT_ORIGIN: 'http://localhost:5174',
        RATE_LIMIT_ENABLED: 'false',
        LOG_LEVEL: 'warn',
      },
      reuseExistingServer: false,
      timeout: 90_000,
    },
    {
      command: 'cd client && npx vite --port 5174 --strictPort',
      url: 'http://localhost:5174',
      env: { API_PROXY_TARGET: 'http://localhost:5051', VITE_API_BASE_URL: '' },
      reuseExistingServer: false,
      timeout: 90_000,
    },
  ],
});
