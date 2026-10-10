import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { vi } from 'vitest'

vi.mock('@src/common/index.js', () => ({
  Logger: vi.fn(
    class {
      log = vi.fn()
      error = vi.fn()
      warn = vi.fn()
      debug = vi.fn()
      info = vi.fn()
    },
  ),
}))

vi.mock('node:child_process', async importOriginal => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: vi.fn(),
}))

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, default: { ...actual, watch: vi.fn() }, watch: vi.fn() }
})

vi.mock('@src/util/meocord-cli.util.js', async importOriginal => ({
  ...(await importOriginal<typeof import('@src/util/meocord-cli.util.js')>()),
  ensureReady: vi.fn(),
}))

import { spawn } from 'node:child_process'
import { watch } from 'node:fs'
import { MeoCordCLI } from '@src/bin/meocord.js'

/** A config with four options of the wrong type, which startup refuses with every one listed. */
const BAD_SHAPE = `export default { logLevel: 'loud', shutdownTimeout: -5, sharding: { shards: 0 }, bundleDependencies: 'yes' }\n`
/** A config that throws as it loads, for a variable it requires. */
const THROWS = `const required = process.env.MEOCORD_RELOAD_FOO\n\nif (!required) throw new Error('FOO is required')\nexport default {}\n`

let project: string
let printed: string[]

beforeEach(() => {
  project = realpathSync(mkdtempSync(path.join(tmpdir(), 'meocord-reload-')))
  writeFileSync(path.join(project, 'meocord.config.ts'), "export default { discordToken: 'token' }\n")
  vi.spyOn(process, 'cwd').mockReturnValue(project)
  printed = []
  vi.spyOn(console, 'error').mockImplementation((text: unknown) => void printed.push(String(text)))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(process, 'exit').mockImplementation((code => {
    throw new Error(`process.exit(${code})`)
  }) as never)
  vi.mocked(spawn).mockReturnValue({ on: vi.fn().mockReturnThis(), once: vi.fn().mockReturnThis(), kill: vi.fn() } as never)
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(project, { recursive: true, force: true })
})

/** Runs `start --dev`'s watch mode on the project, and gives a way to save meocord.config.ts with new content. */
async function startWatching() {
  let listener: (event: string, filename: string) => void = () => {}
  vi.mocked(watch).mockImplementationOnce(((_dir: string, callback: typeof listener) => {
    listener = callback
    return { close: vi.fn() }
  }) as never)
  const cli = new MeoCordCLI() as unknown as {
    startDev: () => Promise<void>
    clearScreen: () => void
    relayStopSignals: () => void
    compileConfig: () => Promise<boolean>
    createBundler: () => Promise<unknown>
  }
  vi.spyOn(cli, 'clearScreen').mockImplementation(() => {})
  vi.spyOn(cli, 'relayStopSignals').mockImplementation(() => {})
  const compileConfig = vi.spyOn(cli, 'compileConfig').mockResolvedValue(true)
  const createBundler = vi.spyOn(cli, 'createBundler').mockImplementation(async () => ({
    rsbuild: { initConfigs: async () => [], onAfterBuild: (callback: (params: object) => void) => callback({}), build: async () => ({ close: vi.fn() }) },
  }))
  await cli.startDev()
  const running = vi.mocked(spawn).mock.results.at(-1)?.value as { kill: ReturnType<typeof vi.fn> }
  const errors = vi.mocked((cli as unknown as { logger: { error: (text: string) => void } }).logger.error)
  const save = (source: string) => {
    writeFileSync(path.join(project, 'meocord.config.ts'), source)
    listener('change', 'meocord.config.ts')
  }
  return { save, compileConfig, createBundler, running, errors }
}

describe('a meocord.config.ts saved while start --dev runs', () => {
  it('is refused as at startup, with every problem listed once, and leaves the running bot alone', async () => {
    const dev = await startWatching()

    dev.save(BAD_SHAPE)
    await vi.waitFor(() => expect(printed.join('\n')).toContain('has 4 problem(s)'))
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(printed.filter(text => text.includes('has 4 problem(s)'))).toHaveLength(1)
    expect(printed.join('\n')).toMatch(/logLevel[\s\S]*shutdownTimeout[\s\S]*sharding\.shards[\s\S]*bundleDependencies/)
    expect(dev.compileConfig).toHaveBeenCalledTimes(1)
    expect(dev.createBundler).toHaveBeenCalledTimes(1)
    expect(dev.running.kill).not.toHaveBeenCalled()
  })

  // Reported as a failed compile is in watch mode, where the next save that loads reloads
  it('is reported as a failed compile, with where it threw, when it fails to load, and leaves the running bot alone', async () => {
    const dev = await startWatching()

    dev.save(THROWS)
    await vi.waitFor(() => expect(dev.errors).toHaveBeenCalled())

    expect(dev.errors).toHaveBeenCalledWith(expect.stringMatching(/^Failed to compile meocord\.config\.ts: FOO is required\n {4}at meocord\.config\.ts:3:\d+$/))
    expect(printed).toEqual([])
    expect(dev.compileConfig).toHaveBeenCalledTimes(1)
    expect(dev.running.kill).not.toHaveBeenCalled()
  })
})

describe('meocord build with a config of the wrong shape', () => {
  it('is refused before the application is built', async () => {
    writeFileSync(path.join(project, 'meocord.config.ts'), BAD_SHAPE)
    const cli = new MeoCordCLI()
    const build = vi.spyOn(cli, 'build').mockResolvedValue(undefined)

    await expect(cli.program().parseAsync(['node', 'meocord', 'build'])).rejects.toThrow('process.exit(1)')

    expect(printed.join('\n')).toContain('has 4 problem(s)')
    expect(build).not.toHaveBeenCalled()
  })
})
