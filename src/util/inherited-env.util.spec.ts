import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { bunDevelopmentEnvFiles, envFiles, inheritedEnvironment } from '@src/util/inherited-env.util.js'
import { BUILD_MODE_KEY } from '@src/util/bundle-entry.util.js'

let root: string

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'meocord-env-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

// As Bun reads them, measured: a later file wins, and under test .env.local is left out
describe('envFiles', () => {
  it.each([
    [undefined, ['.env', '.env.development', '.env.local', '.env.development.local']],
    ['production', ['.env', '.env.production', '.env.local', '.env.production.local']],
    ['test', ['.env', '.env.test', '.env.test.local']],
  ])('lists the files for NODE_ENV %s', (nodeEnv, files) => {
    expect(envFiles(nodeEnv)).toEqual(files)
  })
})

describe('inheritedEnvironment', () => {
  it('leaves out what .env gave, keeps what the shell set to another value, and keeps the rest', () => {
    writeFileSync(path.join(root, '.env'), 'DISCORD_TOKEN=from-file\nGREETING=hello\n')

    expect(inheritedEnvironment({ DISCORD_TOKEN: 'from-file', GREETING: 'from-shell', PATH: '/bin' }, root)).toEqual({
      GREETING: 'from-shell',
      PATH: '/bin',
    })
  })

  // Bun reads these too, before any code runs
  it('leaves out what the mode and local .env files gave', () => {
    writeFileSync(path.join(root, '.env.production'), 'A=1\n')
    writeFileSync(path.join(root, '.env.local'), 'B=2\n')
    writeFileSync(path.join(root, '.env.production.local'), 'C=3\n')

    expect(inheritedEnvironment({ NODE_ENV: 'production', A: '1', B: '2', C: '3' }, root)).toEqual({ NODE_ENV: 'production' })
  })

  it('keeps everything when there is no .env', () => {
    expect(inheritedEnvironment({ A: '1' }, root)).toEqual({ A: '1' })
  })
})

describe('bunDevelopmentEnvFiles', () => {
  afterEach(() => {
    delete (globalThis as Record<symbol, unknown>)[BUILD_MODE_KEY]
  })

  // Bun reads the development files of an unset NODE_ENV before the config's dotenv, which keeps them
  it.each([
    ['names the development files on Bun in a production build with NODE_ENV unset', 'production', {}, true, ['.env.development', '.env.development.local']],
    ['is empty with NODE_ENV set', 'production', { NODE_ENV: 'production' }, true, []],
    ['is empty on Node', 'production', {}, false, []],
    ['is empty in a development build', 'development', {}, true, []],
    ['is empty outside a built application', undefined, {}, true, []],
  ])('%s', (_case, mode, env: NodeJS.ProcessEnv, bun, files) => {
    if (mode) (globalThis as Record<symbol, unknown>)[BUILD_MODE_KEY] = mode
    for (const file of ['.env', '.env.local', '.env.development', '.env.development.local']) writeFileSync(path.join(root, file), 'A=1\n')

    expect(bunDevelopmentEnvFiles(env, root, bun)).toEqual(files)
  })

  it('names only the development files there are', () => {
    ;(globalThis as Record<symbol, unknown>)[BUILD_MODE_KEY] = 'production'
    writeFileSync(path.join(root, '.env.development'), 'A=1\n')

    expect(bunDevelopmentEnvFiles({}, root, true)).toEqual(['.env.development'])
  })
})
