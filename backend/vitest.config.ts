import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test-setup.ts'],
    // Integration tests share one DB — run files sequentially to prevent cross-file interference
    fileParallelism: false,
  },
});
