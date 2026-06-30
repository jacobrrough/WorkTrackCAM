import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

/**
 * Interactive renderer tests — run in a real DOM (happy-dom) so they can click, type, Tab, and
 * assert BEHAVIOUR, the half the node-env suite (`renderToStaticMarkup` + source pins) can't reach.
 *
 * Deliberately a SEPARATE config from `vitest.config.ts` so the 17K-file node suite stays node-env
 * and fast: this one matches ONLY `*.dom.spec.tsx`, which the main config's `*.test.{ts,tsx}` glob
 * never picks up — the two suites are fully disjoint. Run with `npm run test:dom`.
 */
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_PRODUCT__: JSON.stringify('unified')
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['src/**/*.dom.spec.tsx'],
    setupFiles: ['./src/test/dom-setup.ts'],
    testTimeout: 15000
  }
})
