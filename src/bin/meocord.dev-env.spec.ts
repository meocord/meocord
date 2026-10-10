import { vi } from 'vitest'

vi.mock('@src/common/index.js', () => ({
  Logger: vi.fn(
    class {
      log = vi.fn()
      error = vi.fn()
      warn = vi.fn()
      debug = vi.fn()
    },
  ),
}))

vi.mock('node:child_process', async importOriginal => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: vi.fn(),
}))

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, default: { ...actual }, existsSync: vi.fn().mockReturnValue(true) }
})

vi.mock('@src/util/meocord-cli.util.js', async importOriginal => ({
  ...(await importOriginal<typeof import('@src/util/meocord-cli.util.js')>()),
  ensureReady: vi.fn(),
}))

// The NODE_ENV each config load sees, which picks the .env files its dotenv reads
const loadedUnder: (string | undefined)[] = []
vi.mock('@src/util/common.util.js', async importOriginal => {
  const actual = await importOriginal<typeof import('@src/util/common.util.js')>()
  const load = async () => (loadedUnder.push(process.env.NODE_ENV), {})
  return { ...actual, compileAndValidateConfig: vi.fn(load), validateRunConfig: vi.fn(load), validateDiscordToken: vi.fn() }
})

import { spawn } from 'node:child_process'
import { MeoCordCLI } from '@src/bin/meocord.js'

const spawnMock = vi.mocked(spawn)
const child = { on: vi.fn().mockReturnThis(), once: vi.fn().mockReturnThis(), kill: vi.fn() }

/** Runs `meocord <args>` through the CLI's own commands, with the shell's NODE_ENV set to `shellEnv`. */
async function run(shellEnv: string | undefined, ...args: string[]) {
  if (shellEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = shellEnv
  const cli = new MeoCordCLI()
  vi.spyOn(cli, 'startDev').mockResolvedValue(undefined)
  vi.spyOn(cli, 'startProd').mockResolvedValue(undefined)
  vi.spyOn(cli, 'build').mockResolvedValue(undefined)
  vi.spyOn(cli, 'compileConfig').mockResolvedValue(true)
  await cli.program().parseAsync(['node', 'meocord', ...args])
}

const spawnedNodeEnv = () => (spawnMock.mock.calls.at(-1)?.[2] as { env: NodeJS.ProcessEnv }).env.NODE_ENV

describe("the mode a command runs in, against the shell's NODE_ENV", () => {
  const original = process.env.NODE_ENV

  beforeEach(() => {
    loadedUnder.length = 0
    spawnMock.mockReset().mockReturnValue(child as never)
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    vi.spyOn(process, 'on').mockReturnValue(process)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (original === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = original
  })

  it.each([['start --dev'], ['start'], ['build --dev']])('%s loads the config as development under NODE_ENV=production', async command => {
    await run('production', ...command.split(' '))

    expect(loadedUnder).toEqual(['development'])
  })

  it('register --dev loads the config and registers as development under NODE_ENV=production', async () => {
    await run('production', 'register', '--dev')

    expect(loadedUnder).toEqual(['development'])
    expect(spawnedNodeEnv()).toBe('development')
  })

  it("start --prod and register keep a NODE_ENV the shell set, and default to production", async () => {
    await run('staging', 'start', '--prod')
    await run(undefined, 'register')

    expect(loadedUnder).toEqual(['staging', 'production'])
    expect(spawnedNodeEnv()).toBe('production')
  })
})
