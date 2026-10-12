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

  // When the CLI runs on Bun, the values Bun expanded as it loaded the files, each as measured on Bun 1.4.3
  describe('on Bun', () => {
    it('leaves out a value Bun expanded, and keeps one the shell set to another value', () => {
      writeFileSync(path.join(root, '.env'), 'HOST=localhost\nURL=http://$HOST:3000\nAPI=${HOST}/api\n')

      expect(inheritedEnvironment({ HOST: 'localhost', URL: 'http://localhost:3000', API: 'example.com/api' }, root, true)).toEqual({
        API: 'example.com/api',
      })
    })

    it.each([
      ['an earlier line, as Bun set it', 'A=a\nB=$A-b\nC=$B-c\n', { A: 'a', B: 'a-b', C: 'a-b-c' }],
      ['a later line, as written', 'J=$K-j\nK=$A-k\nA=a\n', { J: '$A-k-j', K: 'a-k', A: 'a' }],
      ['an unset variable, as empty', 'E=x-$NOPE-y\n', { E: 'x--y' }],
      ["${NAME:-default}'s default for an unset one", 'D=${NOPE:-fallback}\n', { D: 'fallback' }],
      ['an escaped dollar sign, as one', 'F=costs \\$5\n', { F: 'costs $5' }],
      ['a dollar sign before no name, as itself', 'G=a$ $$A\nA=a\n', { G: 'a$ $a', A: 'a' }],
      ['a variable the shell set', 'S=$SHELL_VALUE/x\n', { SHELL_VALUE: 'shell', S: 'shell/x' }],
      ['a later line the shell set, as the shell set it', 'S=$SHELL_VALUE-x\nSHELL_VALUE=file\n', { SHELL_VALUE: 'shell', S: 'shell-x' }],
    ])('expands a reference to %s', (_, file, env) => {
      writeFileSync(path.join(root, '.env'), file)

      expect(inheritedEnvironment(env, root, true)).toEqual('SHELL_VALUE' in env ? { SHELL_VALUE: 'shell' } : {})
    })

    // Bun loads the file that wins first, so a reference to a variable only a later-loaded file sets is empty
    it('expands a reference across files in the order Bun loads them', () => {
      writeFileSync(path.join(root, '.env'), 'HOST=localhost\nFROM_LOCAL=$LOCAL-x\n')
      writeFileSync(path.join(root, '.env.local'), 'LOCAL=l\nNEEDS_HOST=at-$HOST\n')

      expect(inheritedEnvironment({ HOST: 'localhost', FROM_LOCAL: 'l-x', LOCAL: 'l', NEEDS_HOST: 'at-' }, root, true)).toEqual({})
    })

    it('expands nothing when the CLI runs on Node, where dotenv sets the text as written', () => {
      writeFileSync(path.join(root, '.env'), 'HOST=localhost\nURL=http://$HOST:3000\n')

      expect(inheritedEnvironment({ HOST: 'localhost', URL: 'http://localhost:3000' }, root, false)).toEqual({ URL: 'http://localhost:3000' })
      expect(inheritedEnvironment({ HOST: 'localhost', URL: 'http://$HOST:3000' }, root, false)).toEqual({})
    })
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

  it('names a variable a development file gave a value Bun expanded', () => {
    writeFileSync(path.join(root, '.env.development'), 'HOST=dev.local\nURL=http://$HOST:3000\n')
    rmSync(path.join(root, '.env.development.local'))

    expect(bunDevelopmentValues({ HOST: 'dev.local', URL: 'http://dev.local:3000' }, root, true)).toMatchObject({ keys: ['HOST', 'URL'] })
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
