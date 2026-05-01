import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@pfdsl/core': resolve(__dirname, '../core/src/index.ts'),
      '@pfdsl/graphviz-exporter': resolve(__dirname, '../graphviz-exporter/src/index.ts'),
    },
  },
  test: { include: ['src/**/*.test.ts'], testTimeout: 30000 },
});
