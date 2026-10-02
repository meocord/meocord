import { importX } from 'eslint-plugin-import-x'
import globals from 'globals'
import tsParser from '@typescript-eslint/parser'
import eslintTs from 'typescript-eslint'
import eslintConfigPrettier from 'eslint-config-prettier'
import eslintPluginPrettier from 'eslint-plugin-prettier'
import { createRequire } from 'module'
import path from 'path'

const tsFiles = ['**/*.ts']

// The cycle check needs eslint-import-resolver-typescript; in a project without it every import would warn that it
// cannot be resolved, so the check and the resolver setting are left out there
const hasTypeScriptResolver = (() => {
  try {
    createRequire(path.join(process.cwd(), 'package.json')).resolve('eslint-import-resolver-typescript')
    return true
  } catch {
    return false
  }
})()

const languageOptions = {
  globals: {
    ...globals.node,
    ...globals.jest,
  },
  ecmaVersion: 2023,
  sourceType: 'module',
  parserOptions: {
    project: ['./tsconfig.json', './tsconfig.test.json', './tsconfig.eslint.json'],
  },
}

export const typescriptConfig = {
  files: tsFiles,
  plugins: {
    'import-x': importX,
    prettier: eslintPluginPrettier,
  },
  languageOptions: {
    ...languageOptions,
    parser: tsParser,
  },
  settings: {
    'import-x/parsers': {
      '@typescript-eslint/parser': ['.ts'],
    },
    ...(hasTypeScriptResolver && {
      'import-x/resolver': {
        typescript: {
          alwaysTryTypes: true,
          // Each file resolves through the tsconfig that includes it, so a spec sees an alias only the tests
          // declare; several projects are the intended setup, which the resolver otherwise warns about on every lint
          project: ['./tsconfig.json', './tsconfig.test.json', './tsconfig.eslint.json'],
          noWarnOnMultipleProjects: true,
        },
      },
    }),
  },
  rules: {
    'prettier/prettier': 'error',
    // Classes that import each other lose the constructor types injection reads; type-only imports are skipped
    ...(hasTypeScriptResolver && { 'import-x/no-cycle': ['warn', { maxDepth: 10, ignoreExternal: true }] }),
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/ban-ts-comment': 'off',
    '@typescript-eslint/no-var-requires': 'warn',
    '@typescript-eslint/no-unused-expressions': 'off',
    // A promise nothing awaits, such as an unawaited respond().send() or database write, rejects where no filter sees it;
    // an interceptor awaits or returns next.handle() so the code after it sees the handler's result
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        vars: 'all',
        varsIgnorePattern: '^_',
        args: 'all',
        argsIgnorePattern: '^_',
      },
    ],
  },
}

const recommendedTypeScriptConfigs = [
  ...eslintTs.configs.recommended.map(config => ({
    ...config,
    files: tsFiles,
  })),
  ...eslintTs.configs.stylistic.map(config => ({
    ...config,
    files: tsFiles,
  })),
]

const specConfig = {
  files: ['**/*.spec.ts'],
  rules: {
    '@typescript-eslint/no-empty-function': 'off',
  },
}

export default [
  { ignores: ['docs/*', 'build/*', 'lib/*', 'dist/*', 'coverage/*', 'vitest.config.ts'] },
  ...recommendedTypeScriptConfigs,
  specConfig,
  eslintConfigPrettier,
  typescriptConfig,
]
