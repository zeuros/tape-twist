import { defineConfig } from 'vitest/config'

// Unit tests of the plain TypeScript parts (no Nuxt runtime): `npm test`.
export default defineConfig({
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
})
