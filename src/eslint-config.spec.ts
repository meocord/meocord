import { vi } from 'vitest'
import fs from 'fs'
import { createRequire } from 'module'
import os from 'os'
import path from 'path'
import { ESLint, type Linter } from 'eslint'
import esmConfig from '../meocord.eslint.mjs'

// `meocord/eslint` is what a generated application lints with, and flat config does not read
// .gitignore, so build and coverage output is skipped only if these configs ignore it themselves.
const cjsConfig: Linter.Config[] = createRequire(import.meta.url)('../meocord.eslint.cjs')

describe.each([
  ['meocord.eslint.mjs', esmConfig as Linter.Config[]],
  ['meocord.eslint.cjs', cjsConfig],
])('%s', (_name, config) => {
  const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: config })

  it.each(['dist/main.js', 'coverage/prettify.js', 'coverage/lcov-report/sorter.js'])(
    'ignores %s',
    async file => {
      expect(await eslint.isPathIgnored(file)).toBe(true)
    },
  )

  it('still lints application sources', async () => {
    expect(await eslint.isPathIgnored('src/main.ts')).toBe(false)
  })
})

describe('import-x/no-cycle', () => {
  // The real path: macOS links its temp folder, and the resolver answers with where the link points
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'meocord-no-cycle-')))
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

  // A project of its own, with the three tsconfigs the config's type-aware parser reads, shaped as a generated
  // app's: specs only in tsconfig.test.json, and the `@src/*` alias in the one both extend
  const compilerOptions = { strict: true, module: 'ESNext', moduleResolution: 'Bundler', paths: { '@src/*': ['./src/*'] } }
  const tsconfigs = {
    'tsconfig.json': { compilerOptions, include: ['src/**/*.ts'], exclude: ['src/**/*.spec.ts'] },
    // With an alias only the tests use, as an app may add for its test helpers
    'tsconfig.test.json': {
      extends: './tsconfig.json',
      compilerOptions: { paths: { '@src/*': ['./src/*'], '@test/*': ['./test/*'] } },
      include: ['src/**/*.ts', 'test/**/*.ts'],
      exclude: [],
    },
    'tsconfig.eslint.json': { extends: './tsconfig.json', include: ['src/**/*.ts'] },
  }
  for (const [name, tsconfig] of Object.entries(tsconfigs)) fs.writeFileSync(path.join(root, name), JSON.stringify(tsconfig))
  // import-x tells an alias from a package by the package.json above what it resolves to
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'no-cycle', type: 'module' }))
  // The resolver warns once per process, when first asked, so it is watched from before any lint; not with a
  // spy, which the suite's settings restore after each test
  const warnings: unknown[] = []
  const consoleWarn = console.warn
  beforeAll(() => {
    console.warn = (...args: unknown[]) => {
      warnings.push(...args)
      consoleWarn(...args)
    }
  })
  afterAll(() => {
    console.warn = consoleWarn
  })
  const files: Record<string, string> = {
    // Two classes that import each other, as two services injecting one another would
    'notes.ts': "import { Store } from './store'\n\nexport class Notes {\n  constructor(readonly store: Store) {}\n}\n",
    'store.ts': "import { Notes } from './notes'\n\nexport class Store {\n  constructor(readonly notes: Notes) {}\n}\n",
    // A cycle through a type-only import loses nothing at runtime
    'user.ts': "import type { Team } from './team'\n\nexport interface User {\n  team: Team\n}\n",
    'team.ts': "import type { User } from './user'\n\nexport interface Team {\n  members: User[]\n}\n",
    // A cycle through a spec, which only tsconfig.test.json includes, by the alias
    'ledger.spec.ts': "import { Book } from '@src/book'\n\nexport class Ledger {\n  constructor(readonly book: Book) {}\n}\n",
    'book.ts': "import { Ledger } from '@src/ledger.spec'\n\nexport class Book {\n  constructor(readonly ledger: Ledger) {}\n}\n",
  }
  fs.mkdirSync(path.join(root, 'src'))
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(root, 'src', name), text)
  // A cycle through a test helper, by the alias only tsconfig.test.json declares
  fs.mkdirSync(path.join(root, 'test'))
  fs.writeFileSync(
    path.join(root, 'src', 'fixture.spec.ts'),
    "import { Helper } from '@test/helper'\n\nexport class Fixture {\n  constructor(readonly helper: Helper) {}\n}\n",
  )
  fs.writeFileSync(
    path.join(root, 'test', 'helper.ts'),
    "import { Fixture } from '@src/fixture.spec'\n\nexport class Helper {\n  constructor(readonly fixture: Fixture) {}\n}\n",
  )

  const lintCycles = async (file: string) => {
    const eslint = new ESLint({
      cwd: root,
      overrideConfigFile: true,
      overrideConfig: [
        ...(esmConfig as Linter.Config[]),
        { files: ['**/*.ts'], languageOptions: { parserOptions: { tsconfigRootDir: root } } },
      ],
    })
    // The resolver reads the config's tsconfigs from the working directory, as an app's lint runs from its root
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(root)
    const [result] = await eslint.lintFiles([path.join(root, 'src', file)]).finally(() => cwd.mockRestore())
    return result.messages
      .filter(message => message.ruleId === 'import-x/no-cycle')
      .map(message => [message.severity, message.message])
  }

  it('warns on two modules that import each other', async () => {
    expect(await lintCycles('notes.ts')).toEqual([[1, 'Dependency cycle detected']])
  })

  // A project created before the resolver joined the template: its imports cannot be resolved, so the check
  // stays off rather than warn on every import and fail `eslint --max-warnings=0`
  it('is left out, with the resolver setting, where the project cannot resolve the TypeScript resolver', async () => {
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(root)
    try {
      vi.resetModules()
      const esm = ((await import('../meocord.eslint.mjs')) as { default: Linter.Config[] }).default
      const requireFresh = createRequire(import.meta.url)
      delete requireFresh.cache[requireFresh.resolve('../meocord.eslint.cjs')]
      const cjs: Linter.Config[] = requireFresh('../meocord.eslint.cjs')

      for (const config of [esm, cjs]) {
        const merged = config.filter(entry => entry.rules?.['prettier/prettier'])
        expect(merged.map(entry => entry.rules?.['import-x/no-cycle'])).toEqual([undefined])
        expect(merged.map(entry => entry.settings?.['import-x/resolver'])).toEqual([undefined])

        const eslint = new ESLint({
          cwd: root,
          overrideConfigFile: true,
          overrideConfig: [...config, { files: ['**/*.ts'], languageOptions: { parserOptions: { tsconfigRootDir: root } } }],
        })
        const results = await eslint.lintFiles([path.join(root, 'src', 'notes.ts'), path.join(root, 'src', 'store.ts')])
        expect(results.flatMap(result => result.messages).filter(message => message.ruleId !== 'prettier/prettier')).toEqual([])
      }
    } finally {
      cwd.mockRestore()
    }
  })

  it('ignores a cycle made only of type imports', async () => {
    expect(await lintCycles('user.ts')).toEqual([])
  })

  it("resolves the alias from a spec, which only tsconfig.test.json includes, through tsconfig.json's paths", async () => {
    expect(await lintCycles('ledger.spec.ts')).toEqual([[1, 'Dependency cycle detected']])
  })

  it('resolves an alias only tsconfig.test.json declares, from a spec', async () => {
    expect(await lintCycles('fixture.spec.ts')).toEqual([[1, 'Dependency cycle detected']])
  })

  // The first thing a new application's `bun run lint` would print
  it('lints without the resolver warning about several projects', () => {
    expect(warnings.filter(text => String(text).includes('Multiple projects found'))).toEqual([])
  })
})

describe('@typescript-eslint/no-floating-promises', () => {
  const roots: string[] = []
  afterAll(() => roots.forEach(root => fs.rmSync(root, { recursive: true, force: true })))

  // A project of its own for each config, so the two never share a program, shaped as a generated app's: the three
  // tsconfigs the type-aware parser reads, and the `@src/*` alias
  const project = () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'meocord-floating-')))
    roots.push(root)
    const compilerOptions = { strict: true, module: 'ESNext', moduleResolution: 'Bundler', paths: { '@src/*': ['./src/*'] } }
    const tsconfigs = {
      'tsconfig.json': { compilerOptions, include: ['src/**/*.ts'] },
      'tsconfig.test.json': { extends: './tsconfig.json', include: ['src/**/*.ts'] },
      'tsconfig.eslint.json': { extends: './tsconfig.json', include: ['src/**/*.ts'] },
    }
    for (const [name, tsconfig] of Object.entries(tsconfigs)) fs.writeFileSync(path.join(root, name), JSON.stringify(tsconfig))
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'floating', type: 'module' }))
    fs.mkdirSync(path.join(root, 'src'))
    // An interceptor's shape: the handler's promise, and what the interceptor does with it
    const files: Record<string, string> = {
      'next.ts': "export const next = { handle: async (): Promise<string> => { throw new Error('handler failed') } }\n",
      'dropped.ts': "import { next } from './next'\n\nexport async function intercept(): Promise<void> {\n  next.handle()\n}\n",
      'awaited.ts': "import { next } from './next'\n\nexport async function intercept(): Promise<string> {\n  return await next.handle()\n}\n",
      'voided.ts': "import { next } from './next'\n\nexport function intercept(): void {\n  void next.handle()\n}\n",
    }
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(root, 'src', name), text)
    return root
  }

  describe.each([
    ['meocord.eslint.mjs', esmConfig as Linter.Config[]],
    ['meocord.eslint.cjs', cjsConfig],
  ])('%s', (_name, config) => {
    const root = project()
    // Every path absolute, from the project's own root, so nothing reads the working directory
    const eslint = new ESLint({
      cwd: root,
      overrideConfigFile: true,
      overrideConfig: [
        ...config,
        {
          files: ['**/*.ts'],
          languageOptions: {
            parserOptions: {
              tsconfigRootDir: root,
              project: ['tsconfig.json', 'tsconfig.test.json', 'tsconfig.eslint.json'].map(name => path.join(root, name)),
            },
          },
        },
      ],
    })
    const floating = async (file: string) => {
      const [result] = await eslint.lintFiles([path.join(root, 'src', file)])
      return result.messages
        .filter(message => message.ruleId === '@typescript-eslint/no-floating-promises')
        .map(message => [message.severity, message.line])
    }

    it('fails a promise nothing awaits, as an interceptor that drops next.handle() leaves one', async () => {
      expect(await floating('dropped.ts')).toEqual([[2, 4]])
    })

    it('passes a promise awaited, or one marked as meant to run on its own with void', async () => {
      expect(await floating('awaited.ts')).toEqual([])
      expect(await floating('voided.ts')).toEqual([])
    })
  })
})
