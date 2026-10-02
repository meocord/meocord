import { defineConfig } from 'vitest/config'
import swc from 'unplugin-swc'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  // SWC, which emits the decorator metadata the dependency injection behind
  // @Controller and @Service reads at runtime.
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
    alias: { '@src': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // vi.fn() mocks only; vitest.setup.ts resets the mocks from meocord/testing
    clearMocks: true,
    include: ['src/**/*.spec.ts'],
    coverage: {
      // istanbul rather than v8, so coverage is the same under either runtime this template runs on
      provider: 'istanbul',
      include: ['src/**/*.ts'],
      // `include` reports untested files as zero rather than dropping them from the percentage; they go
      // through SWC like tested ones, decorators and all. app.ts and main.ts only wire and boot the app, and
      // declarations hold no code.
      exclude: ['src/**/*.spec.ts', 'src/**/*.d.ts', 'src/app.ts', 'src/main.ts'],
    },
  },
})
