import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@pfdsl/core': resolve(__dirname, '../core/src/index.ts'),
    },
  },
  test: { include: ['src/**/*.test.ts'] },
});
