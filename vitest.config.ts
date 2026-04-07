import { defineConfig } from 'vitest/config'

export default defineConfig({
  define: {
    __APP_PRODUCT__: JSON.stringify('unified')
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 15000,
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      reporter: ['text', 'text-summary', 'html', 'lcov'],
      include: ['src/shared/**/*.ts', 'src/main/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts']
    }
  }
})
