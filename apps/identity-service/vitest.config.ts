import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    // Integration test dùng MongoMemoryReplSet cần thời gian tải/khởi động binary
    testTimeout: 120_000,
    hookTimeout: 180_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/index.ts', 'src/**/*.schema.ts'],
      thresholds: { lines: 60, functions: 60 },
    },
  },
});
