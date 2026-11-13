import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./server/tests/setup.ts'],
    exclude: [...configDefaults.exclude, 'e2e/**', '**/dist/**'],
  },
});
