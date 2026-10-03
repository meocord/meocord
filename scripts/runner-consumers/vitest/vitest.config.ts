import swc from 'unplugin-swc'
import { defineConfig } from 'vitest/config'

// SWC for decorator metadata, as a generated app's vitest.config.ts does
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
  test: { include: ['vitest.test.ts'] },
})
