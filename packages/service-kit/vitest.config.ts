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
      thresholds: {
        // service-kit chứa outbox + idempotency: bug ở đây lan ra MỌI service
        lines: 55,
        functions: 55,
      },
    },
  },
});
