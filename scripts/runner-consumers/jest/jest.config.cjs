// CommonJS under jest, so meocord resolves through its require condition, as a project that require()s it does
module.exports = {
  testMatch: ['<rootDir>/jest.test.ts'],
  // The tests import TypeScript sources by their .js names, as Node's ES module resolution requires
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  transform: {
    '^.+\\.ts$': [
      '@swc/jest',
      {
        jsc: {
          parser: { syntax: 'typescript', decorators: true },
          transform: { legacyDecorator: true, decoratorMetadata: true },
          target: 'es2022',
        },
        module: { type: 'commonjs' },
      },
    ],
  },
}
