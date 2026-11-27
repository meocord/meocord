import fs from 'fs'
import { createRequire, isBuiltin } from 'module'
import os from 'os'
import path from 'path'
import ts from 'typescript'
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
  // The config file that makes this folder the app's root, which the configs below stand in for
  fs.writeFileSync(path.join(root, 'eslint.config.js'), 'export default []\n')
  // The resolver the cycle check loads, installed in the project as an app installs it
  fs.mkdirSync(path.join(root, 'node_modules'))
  const resolverPackage = path.join('node_modules', 'eslint-import-resolver-typescript')
  fs.symlinkSync(path.resolve(import.meta.dirname, '..', resolverPackage), path.join(root, resolverPackage), 'junction')
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
    const eslint = new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: esmConfig as Linter.Config[] })
    const [result] = await eslint.lintFiles([path.join(root, 'src', file)])
    return result.messages
      .filter(message => message.ruleId === 'import-x/no-cycle')
      .map(message => [message.severity, message.message])
  }

  it('warns on two modules that import each other', async () => {
    expect(await lintCycles('notes.ts')).toEqual([[1, 'Dependency cycle detected']])
  })

  // A project without eslint-import-resolver-typescript: its imports cannot be resolved, so the check finds nothing
  // rather than warn on every import and fail `eslint --max-warnings=0`
  it('finds no cycle and warns of nothing where the project has no TypeScript resolver', async () => {
    const bare = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'meocord-no-resolver-')))
    try {
      for (const [name, tsconfig] of Object.entries(tsconfigs)) fs.writeFileSync(path.join(bare, name), JSON.stringify(tsconfig))
      fs.writeFileSync(path.join(bare, 'package.json'), JSON.stringify({ name: 'no-resolver', type: 'module' }))
      fs.writeFileSync(path.join(bare, 'eslint.config.js'), 'export default []\n')
      fs.mkdirSync(path.join(bare, 'src'))
      for (const name of ['notes.ts', 'store.ts']) fs.writeFileSync(path.join(bare, 'src', name), files[name])
      const before = warnings.length

      for (const config of [esmConfig as Linter.Config[], cjsConfig]) {
        const eslint = new ESLint({ cwd: bare, overrideConfigFile: true, overrideConfig: config })
        const results = await eslint.lintFiles([path.join(bare, 'src', 'notes.ts'), path.join(bare, 'src', 'store.ts')])
        expect(results.flatMap(result => result.messages).filter(message => message.ruleId !== 'prettier/prettier')).toEqual([])
      }
      expect(warnings.slice(before)).toEqual([])
    } finally {
      fs.rmSync(bare, { recursive: true, force: true })
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

describe('the peer dependencies meocord/eslint needs', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    peerDependencies: Record<string, string>
    peerDependenciesMeta?: Record<string, { optional?: boolean }>
  }
  const CONFIG_FILES = ['meocord.eslint.mjs', 'meocord.eslint.cjs']
  // What every bot needs; every other peer is for meocord/eslint alone
  const BOT_PEERS = ['discord.js', 'dotenv']
  // Needed by the config without being imported: eslint runs it, typescript serves its typed rules and prettier its plugin
  const UNIMPORTED_NEEDS = ['eslint', 'typescript', 'prettier']
  const packageName = (request: string) => request.split('/').slice(0, request.startsWith('@') ? 2 : 1).join('/')
  const source = (file: string) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
  const imported = (file: string) =>
    [...source(file).matchAll(/(?:from |require\(|resolve\()'([^']+)'/g)]
      .map(([, request]) => request)
      .filter(request => !isBuiltin(request))
      .map(packageName)
  const configPeers = Object.keys(manifest.peerDependenciesMeta ?? {})

  it.each(CONFIG_FILES)('declares every package %s imports as an optional peer', file => {
    const packages = [...imported(file), ...UNIMPORTED_NEEDS]

    expect(packages).toContain('eslint-plugin-import-x')
    expect(packages.filter(name => !configPeers.includes(name))).toEqual([])
  })

  // In peerDependencies, npm and Yarn 1 would install them in the production install of a bot that has them as
  // devDependencies, and npm would fail `npm install meocord` with ERESOLVE for a bot whose version misses the range.
  // peerDependenciesMeta alone marks them as optional peers of any version for the managers that read it.
  it('declares them only in peerDependenciesMeta, each optional', () => {
    expect(Object.keys(manifest.peerDependencies).sort()).toEqual(BOT_PEERS)
    expect(configPeers).toHaveLength(10)
    expect(configPeers.filter(name => manifest.peerDependenciesMeta?.[name]?.optional !== true)).toEqual([])
  })

  // A file above every eslint.config.* gets its tsconfig root from the eslint.config.* frame typescript-eslint finds
  // on the call stack, which an await would drop
  it.each(CONFIG_FILES)('%s loads its packages without awaiting', file => {
    const tree = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
    const found: string[] = []
    const visit = (node: ts.Node): void => {
      const line = () => tree.getLineAndCharacterOfPosition(node.getStart()).line + 1
      if (ts.isAwaitExpression(node) || (ts.isForOfStatement(node) && node.awaitModifier)) found.push(`await, line ${line()}`)
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) found.push(`import(), line ${line()}`)
      ts.forEachChild(node, visit)
    }
    visit(tree)

    expect(found).toEqual([])
  })
})
