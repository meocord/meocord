import { defineConfig } from 'vitest/config'
import swc from 'unplugin-swc'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  // SWC is required for emitDecoratorMetadata — esbuild (vite's default)
  // cannot emit decorator metadata, which inversify's DI relies on.
  plugins: [
    swc.vite({
      // Coverage reads a file no test imports as file.ts?cache=…&vitest-uncovered-coverage=true; the default
      // pattern ends at the extension, so it would pass such a file to istanbul as raw TypeScript
      include: /\.m?[jt]sx?(?:\?.*)?$/,
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
    // restoreMocks stays false: vitest's restoreAllMocks resets vi.fn() factory
    // implementations (jest's only restored spies), which would wipe the Logger
    // mock created in vi.mock factories. Spies are restored manually per-test
    // instead, and each test file runs in an isolated worker so spies don't leak.
    restoreMocks: false,
    include: ['src/**/*.spec.ts', 'tools/**/*.spec.ts', 'scripts/**/*.spec.ts'],
    // Type-level behaviour is erased before a runtime test can observe it, so
    // the assertions in *.test-d.ts run through tsc instead. Negative cases use
    // `@ts-expect-error`, which fails once the rejected form starts compiling —
    // that is what stops a regression here from passing silently.
    typecheck: {
      enabled: true,
      include: ['src/**/*.test-d.ts'],
      tsconfig: './tsconfig.test.json',
    },
    coverage: {
      // istanbul rather than v8: it instruments at transform time, so coverage is the same
      // whichever runtime runs the suite.
      provider: 'istanbul',
      // Naming `include` is what pulls in files no test ever imported, so a module with
      // no spec at all is reported at zero rather than left out of the percentage. They
      // go through SWC like imported ones, types and decorators included.
      include: ['src/**/*.ts'],
      // Excluded because there is nothing to measure, not to flatter the number:
      // specs and type tests are the tests themselves, `src/interface` declares types
      // that erase at runtime, and `src/bin` is the CLI rather than the framework.
      exclude: ['src/**/*.spec.ts', 'src/**/*.test-d.ts', 'src/interface/**', 'src/bin/**', 'src/**/index.ts'],
      // A floor, not a target. Set just under what the suite covers today so a change that
      // drops coverage fails the Coverage job on its own — without it that job can only fail
      // when Test already has, which makes it a required check that checks nothing. Raise
      // these as coverage grows; never lower them to make a red build green.
      thresholds: {
        statements: 85,
        branches: 75,
        functions: 85,
        lines: 86,
      },
    },
  },
})
