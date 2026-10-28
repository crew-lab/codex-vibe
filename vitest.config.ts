import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.{ts,mjs}'],
    globalSetup: ['tests/global-setup.ts'],
    testTimeout: 15_000,
    maxWorkers: 4
  }
});
