import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { bunDevelopmentValues, bunDevelopmentWarning, envFiles, inheritedEnvironment } from '@src/util/inherited-env.util.js'
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
    // Measured on Bun: any other NODE_ENV reads the development files
    ['staging', ['.env', '.env.development', '.env.local', '.env.development.local']],
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

describe('bunDevelopmentValues', () => {
  beforeEach(() => {
    ;(globalThis as Record<symbol, unknown>)[BUILD_MODE_KEY] = 'production'
    writeFileSync(path.join(root, '.env.development'), 'MODE=development\nSHARED=same\nONLY_DEV=dev\n')
    writeFileSync(path.join(root, '.env.development.local'), 'LOCAL_DEV=mine\n')
    writeFileSync(path.join(root, '.env.production'), 'MODE=production\nSHARED=same\n')
  })

  afterEach(() => {
    delete (globalThis as Record<symbol, unknown>)[BUILD_MODE_KEY]
  })

  // As Bun leaves the environment with NODE_ENV unset, the config's dotenv having filled in what it lacked
  const bunLoaded = { MODE: 'development', SHARED: 'same', ONLY_DEV: 'dev', LOCAL_DEV: 'mine' }

  it('names the variables a development file gave, other than what the production files give, and their files', () => {
    expect(bunDevelopmentValues(bunLoaded, root, true)).toEqual({
      files: ['.env.development', '.env.development.local'],
      keys: ['MODE', 'ONLY_DEV', 'LOCAL_DEV'],
    })
  })

  // Bun reads the development files for any NODE_ENV but production and test
  it('names them too when NODE_ENV is set to another mode, with that NODE_ENV', () => {
    expect(bunDevelopmentValues({ ...bunLoaded, NODE_ENV: 'staging' }, root, true)).toEqual({
      files: ['.env.development', '.env.development.local'],
      keys: ['MODE', 'ONLY_DEV', 'LOCAL_DEV'],
      nodeEnv: 'staging',
    })
  })

  it.each([
    // bun --no-env-file: only the config's dotenv read the files, the production ones
    ['when Bun read no .env files', { MODE: 'production', SHARED: 'same' }, true, 'production'],
    ['with NODE_ENV=production', { ...bunLoaded, NODE_ENV: 'production' }, true, 'production'],
    ['on Node', bunLoaded, false, 'production'],
    ['in a development build', bunLoaded, true, 'development'],
  ])('is empty %s', (_case, env: NodeJS.ProcessEnv, bun, mode) => {
    ;(globalThis as Record<symbol, unknown>)[BUILD_MODE_KEY] = mode

    expect(bunDevelopmentValues(env, root, bun)).toMatchObject({ files: [], keys: [] })
  })

  it('is empty when the development files agree with the production ones', () => {
    writeFileSync(path.join(root, '.env.development'), 'SHARED=same\n')
    rmSync(path.join(root, '.env.development.local'))

    expect(bunDevelopmentValues({ SHARED: 'same' }, root, true)).toMatchObject({ files: [], keys: [] })
  })
})

describe('bunDevelopmentWarning', () => {
  it('names each file and variable as a sentence lists them', () => {
    expect(bunDevelopmentWarning({ files: ['.env.development', '.env.development.local'], keys: ['FROM_MODE', 'ONLY_DEV', 'TOKEN'] })).toBe(
      'Bun loaded .env.development and .env.development.local because NODE_ENV is unset, and this is a production build, so ' +
        'FROM_MODE, ONLY_DEV and TOKEN have their development values; set NODE_ENV=production, or start with `bun --no-env-file`.',
    )
  })

  it('names the NODE_ENV Bun read for, and the mode whose values it loaded', () => {
    expect(bunDevelopmentWarning({ files: ['.env.test'], keys: ['FROM_MODE'], nodeEnv: 'test' })).toBe(
      'Bun loaded .env.test because NODE_ENV is test, and this is a production build, so FROM_MODE has its test value; ' +
        'set NODE_ENV=production, or start with `bun --no-env-file`.',
    )
  })
})
