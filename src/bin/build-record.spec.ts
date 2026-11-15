import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  BUILD_RECORD_FILE,
  type BuildRecord,
  fileDependenciesOf,
  readBuildRecord,
  recordBuild,
  sourceFiles,
  STALE_CHECK_BUDGET_MS,
  stalenessMessage,
  stalenessOf,
  tsconfigChain,
} from '@src/bin/build-record.js'

let root: string
const file = (name: string) => path.join(root, ...name.split('/'))
const write = (name: string, text: string) => {
  mkdirSync(path.dirname(file(name)), { recursive: true })
  writeFileSync(file(name), text)
}
/** Moves a file's mtime a minute on, as a checkout or a copy does, leaving its content alone. */
const touch = (name: string) => {
  const later = new Date(statSync(file(name)).mtimeMs + 60_000)
  utimesSync(file(name), later, later)
}
const recordPath = () => file(`dist/${BUILD_RECORD_FILE}`)
const record = () => JSON.parse(readFileSync(recordPath(), 'utf8')) as BuildRecord
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')
/** Builds both parts in production: the application from src/, the config from meocord.config.ts. */
const built = () => {
  recordBuild(root, 'production', 'app', [file('src/ping.ts'), file('src/pong.ts')])
  recordBuild(root, 'production', 'config', [file('meocord.config.ts')])
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'meocord-build-record-'))
  write('src/ping.ts', 'export const ping = 1\n')
  write('src/pong.ts', 'export const pong = 2\n')
  write('meocord.config.ts', 'export default {}\n')
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('fileDependenciesOf', () => {
  /** Stats of one compilation that depended on `dependencies` and built `modules`. */
  const statsOf = (dependencies: string[], modules: string[]) =>
    ({
      compilation: { fileDependencies: new Set(dependencies) },
      toJson: () => ({ modules: modules.map(nameForCondition => ({ nameForCondition })) }),
    }) as never

  it('leaves out a package.json the resolver read but the bundle does not import', () => {
    expect(fileDependenciesOf(statsOf([file('package.json'), file('src/ping.ts')], [file('src/ping.ts')]))).toEqual([file('src/ping.ts')])
  })

  it('keeps a package.json the bundle imports', () => {
    const dependencies = [file('package.json'), file('src/ping.ts')]

    expect(fileDependenciesOf(statsOf(dependencies, dependencies))).toEqual(dependencies)
  })

  it("takes every compilation's dependencies from a multi-compilation", () => {
    const multi = { stats: [statsOf([file('src/ping.ts')], []), statsOf([file('src/pong.ts')], [])] } as never

    expect(fileDependenciesOf(multi)).toEqual([file('src/ping.ts'), file('src/pong.ts')])
  })
})

describe('sourceFiles', () => {
  it("keeps the project's own files once each, from its root with forward slashes, without node_modules, dist or outside files", () => {
    const dependencies = [
      file('src/ping.ts'),
      file('src/ping.ts'),
      file('node_modules/discord.js/index.js'),
      file('src/vendor/node_modules/x/index.js'),
      file('dist/main.js'),
      path.join(path.dirname(root), 'elsewhere.ts'),
      root,
      file('meocord.config.ts'),
    ]

    expect(sourceFiles(dependencies, root)).toEqual(['meocord.config.ts', 'src/ping.ts'])
  })

  it('records Windows paths with forward slashes, so a dist built there compares anywhere', () => {
    const dependencies = ['D:\\bot\\src\\controllers\\ping.ts', 'D:\\bot\\node_modules\\x\\index.js', 'D:\\bot\\dist\\main.js', 'C:\\elsewhere.ts']

    expect(sourceFiles(dependencies, 'D:\\bot', path.win32)).toEqual(['src/controllers/ping.ts'])
  })
})

describe('recordBuild', () => {
  it("writes the mode and each file's size, mtime and SHA-256, adding tsconfig.json to the application part", () => {
    write('tsconfig.json', '{}\n')
    recordBuild(root, 'production', 'app', [file('src/ping.ts')])

    expect(record()).toEqual({
      mode: 'production',
      app: [
        { path: 'src/ping.ts', size: 22, mtimeMs: statSync(file('src/ping.ts')).mtimeMs, sha256: sha256('export const ping = 1\n') },
        { path: 'tsconfig.json', size: 3, mtimeMs: statSync(file('tsconfig.json')).mtimeMs, sha256: sha256('{}\n') },
      ],
      config: [],
    })
  })

  it('keeps the other part from a build of the same mode, and drops it from a build of the other', () => {
    built()
    expect(record().app.map(each => each.path)).toEqual(['src/ping.ts', 'src/pong.ts'])
    expect(record().config.map(each => each.path)).toEqual(['meocord.config.ts'])

    recordBuild(root, 'development', 'config', [file('meocord.config.ts')])

    expect(record()).toMatchObject({ mode: 'development', app: [], config: [{ path: 'meocord.config.ts' }] })
  })

  it('records each tsconfig file tsconfig.json extends, so an edit there makes the build old', () => {
    write('tsconfig.json', '{ "extends": "./tsconfig.base.json" }')
    write('tsconfig.base.json', '{ "compilerOptions": { "strict": true } }')
    built()
    write('tsconfig.base.json', '{ "compilerOptions": { "strict": false } }')
    touch('tsconfig.base.json')

    expect(stalenessOf(root, 'production')).toEqual({ changed: 'tsconfig.base.json' })
  })

  it('records the lockfiles with bundleDependencies, whose packages the build copied in, and not without', () => {
    write('bun.lock', '{ "lockfileVersion": 1 }\n')
    write('package-lock.json', '{}\n')

    recordBuild(root, 'production', 'app', [file('src/ping.ts')], { bundleDependencies: true })
    expect(record().app.map(each => each.path)).toEqual(['src/ping.ts', 'package-lock.json', 'bun.lock'])

    recordBuild(root, 'production', 'app', [file('src/ping.ts')])
    expect(record().app.map(each => each.path)).toEqual(['src/ping.ts'])
  })

  it('leaves out a dependency that is gone by the time it is recorded', () => {
    recordBuild(root, 'production', 'app', [file('src/ping.ts'), file('src/deleted.ts')])

    expect(record().app.map(each => each.path)).toEqual(['src/ping.ts'])
  })
})

describe('tsconfigChain', () => {
  it('follows extends by path, with comments and trailing commas, through an array and a name without .json', () => {
    write('tsconfig.json', '{\n  // the app\n  "extends": ["./configs/base", "@tsconfig/node22/tsconfig.json"],\n}\n')
    write('configs/base.json', '{ "extends": "../tsconfig.strict.json", /* paths */ "compilerOptions": { "baseUrl": "..", }, }')
    write('tsconfig.strict.json', '{ "compilerOptions": { "strict": true } }')

    expect(tsconfigChain(root)).toEqual(['configs/base.json', 'tsconfig.json', 'tsconfig.strict.json'])
  })

  it('stops at a file it cannot read and at a cycle', () => {
    write('tsconfig.json', '{ "extends": "./a.json" }')
    write('a.json', '{ "extends": "./tsconfig.json" }')

    expect(tsconfigChain(root)).toEqual(['a.json', 'tsconfig.json'])
  })
})

describe('readBuildRecord', () => {
  it.each([
    ['not JSON', '{'],
    ['of no known mode', JSON.stringify({ mode: 'test', app: [], config: [] })],
    ['without its parts', JSON.stringify({ mode: 'production' })],
  ])('reads nothing from a record %s', (_name, text) => {
    write(`dist/${BUILD_RECORD_FILE}`, text)

    expect(readBuildRecord(root)).toBeUndefined()
    expect(stalenessOf(root, 'production')).toBeUndefined()
  })
})

describe('stalenessOf', () => {
  it('finds nothing when no recorded file changed', () => {
    built()

    expect(stalenessOf(root, 'production')).toBeUndefined()
  })

  it('finds nothing without a record, as for a dist an older meocord built', () => {
    expect(stalenessOf(root, 'production')).toBeUndefined()
  })

  it('names a file whose content changed, though its size did not', () => {
    built()
    write('src/pong.ts', 'export const pong = 3\n')
    touch('src/pong.ts')

    expect(stalenessOf(root, 'production')).toEqual({ changed: 'src/pong.ts' })
  })

  it('names a changed config file', () => {
    built()
    write('meocord.config.ts', 'export default { logLevel: "debug" }\n')

    expect(stalenessOf(root, 'production')).toEqual({ changed: 'meocord.config.ts' })
  })

  it('finds nothing for a file whose mtime moved but whose content is the same, as after a checkout or a copy', () => {
    built()
    touch('src/ping.ts')
    touch('meocord.config.ts')

    expect(stalenessOf(root, 'production')).toBeUndefined()
  })

  // A file that can't be read throws if hashed, which would give up before the changed file after it
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('reads no file whose size and mtime match the record', () => {
    built()
    chmodSync(file('src/ping.ts'), 0o000)
    write('src/pong.ts', 'export const pong = 3\n')
    touch('src/pong.ts')

    try {
      expect(stalenessOf(root, 'production')).toEqual({ changed: 'src/pong.ts' })
    } finally {
      chmodSync(file('src/ping.ts'), 0o644)
    }
  })

  it('skips a missing file and goes on to the next', () => {
    built()
    rmSync(file('src/ping.ts'))
    write('src/pong.ts', 'export const pong = 3\n')
    touch('src/pong.ts')

    expect(stalenessOf(root, 'production')).toEqual({ changed: 'src/pong.ts' })
  })

  it('finds nothing when no recorded file is present, as on a server with dist alone', () => {
    built()
    rmSync(file('src'), { recursive: true })
    rmSync(file('meocord.config.ts'))

    expect(stalenessOf(root, 'production')).toBeUndefined()
  })

  it('reports a development record where the command runs production, and compares one where it runs development', () => {
    recordBuild(root, 'development', 'app', [file('src/ping.ts')])

    expect(stalenessOf(root, 'production')).toEqual({ development: true })
    expect(stalenessOf(root, 'development')).toBeUndefined()

    write('src/ping.ts', 'export const ping = 10\n')
    expect(stalenessOf(root, 'development')).toEqual({ changed: 'src/ping.ts' })
  })

  it('gives up silently once the budget is spent', () => {
    built()
    write('src/pong.ts', 'export const pong = 3\n')
    touch('src/pong.ts')
    // Started at 0; ping is checked at 0, and pong after the budget has run out
    const times = [0, 0, STALE_CHECK_BUDGET_MS + 1]
    const now = () => times.shift() ?? Number.POSITIVE_INFINITY

    expect(stalenessOf(root, 'production', { now, budgetMs: STALE_CHECK_BUDGET_MS })).toBeUndefined()
  })

  it('gives up partway through hashing one file once the budget is spent', () => {
    write('src/ping.ts', 'x'.repeat(3 * 1024 * 1024))
    built()
    write('src/ping.ts', 'y'.repeat(3 * 1024 * 1024))
    touch('src/ping.ts')
    // Each reading of the clock is 60 ms later, so the budget runs out after a few chunks of the first file
    let clock = 0
    const now = () => (clock += 60)

    expect(stalenessOf(root, 'production', { now, budgetMs: STALE_CHECK_BUDGET_MS })).toBeUndefined()
    expect(stalenessOf(root, 'production', { now: () => 0, budgetMs: STALE_CHECK_BUDGET_MS })).toEqual({ changed: 'src/ping.ts' })
  })

  it('reads no recorded path that leaves the project', () => {
    built()
    const outside = path.join(path.dirname(root), `${path.basename(root)}-outside.ts`)
    writeFileSync(outside, 'export const outside = 1\n')
    const tampered = record()
    tampered.app.unshift({ path: `../${path.basename(outside)}`, size: 0, mtimeMs: 0, sha256: '0'.repeat(64) })
    writeFileSync(recordPath(), JSON.stringify(tampered))

    try {
      expect(stalenessOf(root, 'production')).toBeUndefined()
    } finally {
      rmSync(outside, { force: true })
    }
  })

  it('checks every file within the budget', () => {
    built()
    write('src/pong.ts', 'export const pong = 3\n')
    touch('src/pong.ts')

    expect(stalenessOf(root, 'production', { now: () => 0, budgetMs: STALE_CHECK_BUDGET_MS })).toEqual({ changed: 'src/pong.ts' })
  })
})

describe('stalenessMessage', () => {
  it.each([
    [
      { changed: 'src/ping.ts' },
      'start',
      'production',
      'dist was built before src/ping.ts changed, so start --prod runs the previous build. Add --build, or run meocord build --prod first.',
    ],
    [
      { changed: 'meocord.config.ts' },
      'register',
      'production',
      "dist was built before meocord.config.ts changed, so register sends the previous build's commands. Add --build, or run meocord build --prod first.",
    ],
    [
      { changed: 'src/ping.ts' },
      'register',
      'development',
      "dist was built before src/ping.ts changed, so register sends the previous build's commands. Add --build, or run meocord build --dev first.",
    ],
    [
      { development: true },
      'start',
      'production',
      'dist holds a development build, from meocord start --dev or build --dev. Add --build to start a production one.',
    ],
    [
      { development: true },
      'register',
      'production',
      'dist holds a development build, from meocord start --dev or build --dev. Add --build to register from a production one.',
    ],
  ] as const)('words %j for %s in %s', (staleness, command, mode, message) => {
    expect(stalenessMessage(staleness, command, mode)).toBe(message)
  })
})
