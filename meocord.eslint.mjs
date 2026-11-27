// Loaded up front, with nothing awaited. The parser below gives typescript-eslint the bot's folder as its tsconfig
// root; a file above every config falls back to the eslint.config.* frame typescript-eslint finds on the call stack,
// which an await would drop.
import { importX } from 'eslint-plugin-import-x'
import globals from 'globals'
import tsParser from '@typescript-eslint/parser'
import eslintTs from 'typescript-eslint'
import eslintConfigPrettier from 'eslint-config-prettier'
import eslintPluginPrettier from 'eslint-plugin-prettier'
import fs from 'fs'
import { createRequire } from 'module'
import path from 'path'

const tsFiles = ['**/*.ts']

// The tsconfigs a bot's files are typed and resolved through, beside its eslint.config.*
const TSCONFIGS = ['./tsconfig.json', './tsconfig.test.json', './tsconfig.eslint.json']
// ESLint's config file names, as typescript-eslint matches them on the call stack
const CONFIG_FILE = /^eslint\.config\.[cm]?[jt]s$/
const TYPESCRIPT_RESOLVER = 'eslint-import-resolver-typescript'

// Each folder's bot, kept for the process: a config file added or removed later is seen by the next ESLint process
const rootByFolder = new Map()

/**
 * The bot a file belongs to: the folder of the nearest eslint.config.* above it, or undefined above every one. Read
 * from the file rather than from where ESLint runs, so a bot linted from a workspace root still reads its own tsconfigs
 * whatever form its config file takes.
 */
function botRoot(file) {
  const visited = []
  let folder = path.dirname(path.resolve(file))
  let root
  for (;;) {
    if (rootByFolder.has(folder)) {
      root = rootByFolder.get(folder)
      break
    }
    visited.push(folder)
    if (hasConfigFile(folder)) {
      root = folder
      break
    }
    const parent = path.dirname(folder)
    if (parent === folder) break
    folder = parent
  }
  for (const each of visited) rootByFolder.set(each, root)
  return root
}

function hasConfigFile(folder) {
  try {
    return fs.readdirSync(folder).some(name => CONFIG_FILE.test(name))
  } catch {
    return false
  }
}

// typescript-eslint's parser, given the bot's folder as the root its tsconfigs are read from; a root the app sets wins,
// and above every config file typescript-eslint finds one as it would without this
const parser = {
  meta: { name: 'meocord/typescript-parser', version: tsParser.meta.version },
  parseForESLint(code, options = {}) {
    const root = options.tsconfigRootDir ?? botRoot(options.filePath ?? '')
    return tsParser.parseForESLint(code, root === undefined ? options : { ...options, tsconfigRootDir: root })
  },
}

// Each bot's resolver, kept for the process as its root is
const resolverByRoot = new Map()

// eslint-import-resolver-typescript as the bot installed it, reading the bot's tsconfigs. A bot without it resolves
// nothing, so the cycle check finds no cycle there rather than warn on every import that the resolver is missing
const typescriptResolver = {
  interfaceVersion: 2,
  resolve(source, file, options) {
    const root = botRoot(file) ?? process.cwd()
    if (!resolverByRoot.has(root)) {
      let resolver = null
      try {
        resolver = createRequire(path.join(root, 'package.json'))(TYPESCRIPT_RESOLVER)
      } catch {
        // Not installed for this bot
      }
      resolverByRoot.set(root, resolver)
    }
    const resolver = resolverByRoot.get(root)
    if (!resolver) return { found: false }
    return resolver.resolve(source, file, { ...options, project: TSCONFIGS.map(name => path.join(root, name)) })
  },
}

const languageOptions = {
  globals: {
    ...globals.node,
    ...globals.jest,
  },
  ecmaVersion: 2023,
  sourceType: 'module',
  parserOptions: {
    project: TSCONFIGS,
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
    parser,
  },
  settings: {
    'import-x/parsers': {
      '@typescript-eslint/parser': ['.ts'],
    },
    'import-x/resolver': [
      {
        name: 'typescript',
        resolver: typescriptResolver,
        options: {
          alwaysTryTypes: true,
          // Each file resolves through the tsconfig that includes it, so a spec sees an alias only the tests
          // declare; several projects are the intended setup, which the resolver otherwise warns about on every lint
          noWarnOnMultipleProjects: true,
        },
      },
    ],
  },
  rules: {
    'prettier/prettier': 'error',
    // Classes that import each other lose the constructor types injection reads; type-only imports are skipped
    'import-x/no-cycle': ['warn', { maxDepth: 10, ignoreExternal: true }],
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
