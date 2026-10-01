import { importX } from 'eslint-plugin-import-x'
import globals from 'globals'
import tsParser from '@typescript-eslint/parser'
import eslintJs from '@eslint/js'
import eslintTs from 'typescript-eslint'
import eslintConfigPrettier from 'eslint-config-prettier'
import eslintPluginPrettier from 'eslint-plugin-prettier'
import unusedImports from 'eslint-plugin-unused-imports'

const tsFiles = ['**/*.ts']
const jsFiles = ['**/*.js']

const languageOptions = {
  globals: {
    ...globals.node,
    ...globals.jest,
  },
  ecmaVersion: 2023,
  sourceType: 'module',
  parserOptions: {
    project: ['./tsconfig.json', './tsconfig.test.json', './tsconfig.eslint.json', './src/interface/theme-augmented/tsconfig.json', './src/interface/theme-augmented/tsconfig.reserved.json'],
  },
}

const typescriptConfig = {
  files: tsFiles,
  plugins: {
    'import-x': importX,
    prettier: eslintPluginPrettier,
    'unused-imports': unusedImports,
  },
  languageOptions: {
    ...languageOptions,
    parser: tsParser,
  },
  settings: {
    'import-x/parsers': {
      '@typescript-eslint/parser': ['.ts'],
    },
    'import-x/resolver': {
      typescript: {
        alwaysTryTypes: true,
        project: ['./tsconfig.json', './tsconfig.test.json'],
      },
    },
  },
  rules: {
    'prettier/prettier': 'error',
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/ban-ts-comment': 'off',
    '@typescript-eslint/no-var-requires': 'warn',
    'unused-imports/no-unused-imports': 'error',
    '@typescript-eslint/no-unused-expressions': 'off',
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

const javaScriptConfig = {
  files: jsFiles,
  plugins: {
    'import-x': importX,
    prettier: eslintPluginPrettier,
    'unused-imports': unusedImports,
  },
  languageOptions,
  rules: {
    ...eslintJs.configs.recommended.rules,
    'prettier/prettier': 'error',
    'unused-imports/no-unused-imports': 'error',
    'no-var': 'error',
    'prefer-const': 'warn',
    'no-unused-vars': [
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

// The pre-entry is bundled into the application, where Rspack rewrites this free variable to its public path
const preEntryConfig = {
  files: ['src/build/load-config.pre-entry.js'],
  languageOptions: { globals: { __webpack_public_path__: 'writable' } },
}

const webpackConfig = {
  files: ['webpack.config.js'],
  plugins: {
    'import-x': importX,
    prettier: eslintPluginPrettier,
    'unused-imports': unusedImports,
  },
  languageOptions,
  rules: {
    ...eslintJs.configs.recommended.rules,
    'prettier/prettier': 'error',
    'unused-imports/no-unused-imports': 'error',
    'no-var': 'error',
    'prefer-const': 'warn',
    'no-unused-vars': [
      'error',
      {
        vars: 'all',
        varsIgnorePattern: '^_',
        args: 'all',
        argsIgnorePattern: '^_',
      },
    ],
    'import-x/no-unresolved': 'off',
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

// The shipped code runs on whichever runtime the application picks, so it uses no Bun-only API;
// Bun remains the repository's own tooling, in scripts/ and package.json.
const BUN_ONLY = 'MeoCord runs on Node.js as well as Bun; use a Node API instead.'
const nodeCompatibleConfig = {
  files: ['src/**/*.ts'],
  rules: {
    'no-restricted-globals': ['error', { name: 'Bun', message: BUN_ONLY }],
    'no-restricted-imports': ['error', { patterns: [{ group: ['bun', 'bun:*'], message: BUN_ONLY }] }],
    'no-restricted-syntax': [
      'error',
      {
        selector: "MemberExpression[object.type='MetaProperty'][property.name=/^(dir|file|path|main)$/]",
        message: `${BUN_ONLY} (import.meta.dirname and import.meta.filename work on both.)`,
      },
    ],
  },
}

export default [
  // The smoke app is typechecked by scripts/e2e.ts, inside the application it is installed into, and the
  // JSDoc example fixtures by scripts/check-jsdoc-examples.ts, against the build
  { ignores: ['dist/*', 'rollup.config.js', 'test/e2e/app/**', 'scripts/jsdoc-examples/**'] },
  ...recommendedTypeScriptConfigs,
  eslintConfigPrettier,
  typescriptConfig,
  specConfig,
  nodeCompatibleConfig,
  javaScriptConfig,
  preEntryConfig,
  webpackConfig,
]
