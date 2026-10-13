import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['tests/global-setup.ts'],
    testTimeout: 15_000,
    exclude: ['**/node_modules/**', 'tests/v1-*.test.mjs']
  }
});
