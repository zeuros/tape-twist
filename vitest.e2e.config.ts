import { defineConfig } from 'vitest/config'

// End-to-end tests (real server, real browsers, PipeWire): `npm run test:e2e`. See test/e2e/.
export default defineConfig({
  test: {
    include: ['test/e2e/**/*.e2e.ts'],
    environment: 'node',
    testTimeout: 180_000, // the chaos test runs E2E_CHAOS_SEC (60 s) plus its checks
    hookTimeout: 120_000,
    fileParallelism: false,
  },
})
