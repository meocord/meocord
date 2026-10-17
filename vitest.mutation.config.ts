import { defineConfig } from 'vitest/config'
import swc from 'unplugin-swc'
import { fileURLToPath } from 'node:url'

// For `bun run test:mutation`: the specs of the framework's runtime, set up as in vitest.config.ts but
// without the type tests, which a mutated source cannot affect, the build, CLI and util specs, which
// build whole applications or read files outside Stryker's sandbox, or coverage. Worker counts are left
// out: Stryker's vitest runner runs one worker per test runner and sets its own pool.
export default defineConfig({
  plugins: [
    swc.vite({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        target: 'es2022',
      },
      module: { type: 'es6' },
    }),
  ],
  resolve: {
    alias: {
      '@src': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    setupFiles: ['reflect-metadata', './vitest.setup.ts'],
    clearMocks: true,
    restoreMocks: false,
    include: ['src/{common,core,decorator,testing}/**/*.spec.ts'],
  },
})
