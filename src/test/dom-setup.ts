// DOM-suite setup (loaded only by vitest.dom.config.ts). Extends `expect` with jest-dom matchers;
// React Testing Library auto-registers cleanup between tests because `globals: true` is set there.
import '@testing-library/jest-dom/vitest'
