import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/live/**', 'node_modules/**', 'dist/**', 'out/**'],
    environment: 'node',
    testTimeout: 30000
  }
});
