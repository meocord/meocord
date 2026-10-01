import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { envFileValuesFor, envFiles, inheritedEnvironment } from '@src/util/inherited-env.util.js'

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

describe('envFileValuesFor', () => {
  // A bot on node reads .env through the config's dotenv import, and no other file
  it('gives a bot on node the files after .env as they are now, a later one winning', () => {
    writeFileSync(path.join(root, '.env'), 'A=env\nD=env\n')
    writeFileSync(path.join(root, '.env.development'), 'A=mode\nB=mode\nC=mode\n')
    writeFileSync(path.join(root, '.env.local'), 'A=local\nB=local\n')
    writeFileSync(path.join(root, '.env.development.local'), 'A=mode-local\n')

    expect(envFileValuesFor(false, root, undefined)).toEqual({ A: 'mode-local', B: 'local', C: 'mode' })
  })

  it('gives a bot on Bun nothing, since Bun reads every file itself', () => {
    writeFileSync(path.join(root, '.env.local'), 'A=local\n')

    expect(envFileValuesFor(true, root, undefined)).toEqual({})
  })
})
