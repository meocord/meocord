import { vi } from 'vitest'

vi.mock('@src/common/index.js', () => ({
  Logger: vi.fn(
    class {
      log = vi.fn()
      error = vi.fn()
      warn = vi.fn()
      debug = vi.fn()
      info = vi.fn()
      verbose = vi.fn()
    },
  ),
}))

vi.mock('node:child_process', async importOriginal => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: vi.fn(),
}))

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, default: { ...actual }, existsSync: vi.fn().mockReturnValue(true), watch: vi.fn(actual.watch) }
})

// The reload's config check reads meocord.config.ts, which these cases leave to a stubbed compileConfig
vi.mock('@src/util/common.util.js', async importOriginal => ({
  ...(await importOriginal<typeof import('@src/util/common.util.js')>()),
  checkSourceConfig: vi.fn(() => ({ config: {} })),
}))

vi.mock('@src/util/meocord-config-loader.util.js', async importOriginal => {
  const actual = await importOriginal<typeof import('@src/util/meocord-config-loader.util.js')>()
  return { ...actual, loadMeoCordConfig: vi.fn(actual.loadMeoCordConfig) }
})

import { spawn } from 'node:child_process'
import { existsSync, watch } from 'node:fs'
import { MeoCordCLI } from '@src/bin/meocord.js'
import { REPEAT_SIGNAL_WINDOW_MS } from '@src/util/stop-request.util.js'
import { DEFAULT_SHUTDOWN_TIMEOUT_MS, FORCE_STOP_GRACE_MS, MAX_SHUTDOWN_TIMEOUT_MS } from '@src/util/shutdown-timeout.util.js'
import { namePathProblem, nextStepFor } from '@src/bin/generator.js'
import { ControllerType } from '@src/enum/controller.enum.js'
import { RUNTIME_OVERRIDE_ENV } from '@src/util/runtime.util.js'
import { loadMeoCordConfig } from '@src/util/meocord-config-loader.util.js'

/** Stands in for the spawned application; `.on` is chained straight off `spawn`. */
const createChild = () => ({
  on: vi.fn().mockReturnThis(),
  once: vi.fn().mockReturnThis(),
  removeAllListeners: vi.fn().mockReturnThis(),
  kill: vi.fn(),
  exitCode: null as number | null,
  signalCode: null as NodeJS.Signals | null,
})

const spawnMock = vi.mocked(spawn)

/** The arguments that are not runtime flags, such as node's --enable-source-maps. */
const entryArgs = (args: string[]) => args.filter(arg => !arg.startsWith('--'))

const lastSpawn = () => {
  const call = spawnMock.mock.calls.at(-1)
  if (!call) throw new Error('spawn was never called')
  const [command, args, options] = call as [string, string[], Record<string, unknown>]
  return { command, args, options }
}

/** What bun exports when it runs a package script. */
const BUN_LAUNCHER = {
  npm_config_user_agent: 'bun/1.4.0 npm/? node/v26.3.0 darwin arm64',
  npm_execpath: '/Users/dev/.bun/bin/bun',
}

describe('spawning the application', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>
  let launcherEnv: Record<string, string | undefined>

  beforeEach(() => {
    spawnMock.mockReturnValue(createChild() as never)
    vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    // The suite is itself run through a package manager, so these are already set in the
    // ambient environment. Clearing them keeps each case testing the signal it names.
    launcherEnv = { npm_config_user_agent: process.env.npm_config_user_agent, npm_execpath: process.env.npm_execpath }
    delete process.env.npm_config_user_agent
    delete process.env.npm_execpath
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env[RUNTIME_OVERRIDE_ENV]
    Object.assign(process.env, launcherEnv)
  })

  // The CLI is launched by whichever runtime the user chose -- `bun --bun meocord start`
  // makes that bun. Naming a runtime in the source would hand the application to node
  // regardless, leaving a launcher process behind and putting the bot on a different
  // allocator than the one it was started with.
  describe('startProd()', () => {
    it('runs the entry file with the binary executing the CLI', async () => {
      await new MeoCordCLI().startProd()

      const { command, args } = lastSpawn()
      expect(command).toBe(process.execPath)
      expect(entryArgs(args)).toEqual([expect.stringContaining('main.js')])
    })

    it('honours the runtime override', async () => {
      process.env[RUNTIME_OVERRIDE_ENV] = '/opt/custom/bun'

      await new MeoCordCLI().startProd()

      expect(lastSpawn().command).toBe('/opt/custom/bun')
    })

    // A command string has to be re-split by a shell, and it splits on the space in a
    // project path such as `/Users/a b/bot`.
    it('passes the entry file as an argument rather than a command string', async () => {
      await new MeoCordCLI().startProd()

      const { command, args } = lastSpawn()
      expect(command).not.toContain('main.js')
      expect(entryArgs(args)).toHaveLength(1)
    })

    // Node maps a stack through dist/main.js.map only with the flag; shard processes inherit it
    it('runs node with --enable-source-maps', async () => {
      process.env[RUNTIME_OVERRIDE_ENV] = '/usr/bin/node'

      await new MeoCordCLI().startProd()

      expect(lastSpawn().args).toEqual(['--enable-source-maps', expect.stringContaining('main.js')])
    })

    it('passes node no source-map flag when the config sets sourceMappedStacks: false', async () => {
      process.env[RUNTIME_OVERRIDE_ENV] = '/usr/bin/node'
      vi.mocked(loadMeoCordConfig).mockReturnValueOnce({ discordToken: 't', sourceMappedStacks: false })

      await new MeoCordCLI().startProd()

      expect(lastSpawn().args).toEqual([expect.stringContaining('main.js')])
    })

    it('does not run through a shell', async () => {
      await new MeoCordCLI().startProd()

      expect(lastSpawn().options).not.toHaveProperty('shell', true)
    })

    it('propagates the exit code of the application', async () => {
      await new MeoCordCLI().startProd()

      const child = spawnMock.mock.results.at(-1)?.value as { on: ReturnType<typeof vi.fn> }
      const onExit = child.on.mock.calls.find(([event]) => event === 'exit')?.[1] as (code: number | null) => void

      onExit(3)

      expect(exitSpy).toHaveBeenCalledWith(3)
    })

    it('exits zero when the application reports no code', async () => {
      await new MeoCordCLI().startProd()

      const child = spawnMock.mock.results.at(-1)?.value as { on: ReturnType<typeof vi.fn> }
      const onExit = child.on.mock.calls.find(([event]) => event === 'exit')?.[1] as (code: number | null) => void

      onExit(null)

      expect(exitSpy).toHaveBeenCalledWith(0)
    })

    describe('stop signals', () => {
      const listenersBefore = { SIGINT: 0, SIGTERM: 0 }
      beforeEach(() => {
        vi.useFakeTimers()
        listenersBefore.SIGINT = process.listenerCount('SIGINT')
        listenersBefore.SIGTERM = process.listenerCount('SIGTERM')
      })
      afterEach(() => {
        vi.useRealTimers()
        for (const signal of ['SIGINT', 'SIGTERM'] as const) {
          process.listeners(signal).slice(listenersBefore[signal]).forEach(listener => process.removeListener(signal, listener))
        }
      })

      const started = async () => {
        await new MeoCordCLI().startProd()
        const child = spawnMock.mock.results.at(-1)?.value as ReturnType<typeof createChild>
        const send = (signal: 'SIGINT' | 'SIGTERM') => (process.listeners(signal).at(-1) as () => void)()
        return { child, send }
      }

      // Docker signals the CLI alone; the bot would otherwise keep running
      it.skipIf(process.platform === 'win32').each(['SIGINT', 'SIGTERM'] as const)('passes %s on to the application', async signal => {
        const { child, send } = await started()

        send(signal)

        expect(child.kill).toHaveBeenCalledWith(signal)
        expect(exitSpy).not.toHaveBeenCalled()
      })

      // A terminal's Ctrl+C also reaches the CLI's own process group, where the application hears it
      it('takes a copy of the signal within the window as the same request', async () => {
        const { child, send } = await started()

        send('SIGINT')
        vi.advanceTimersByTime(REPEAT_SIGNAL_WINDOW_MS - 1)
        send('SIGTERM')
        vi.advanceTimersByTime(FORCE_STOP_GRACE_MS)

        expect(child.kill).toHaveBeenCalledTimes(process.platform === 'win32' ? 0 : 1)
        expect(exitSpy).not.toHaveBeenCalled()
      })

      it('kills the application and exits 1 when a repeat after the window does not stop it', async () => {
        const { child, send } = await started()

        send('SIGINT')
        vi.advanceTimersByTime(REPEAT_SIGNAL_WINDOW_MS)
        send('SIGINT')
        expect(child.kill).not.toHaveBeenCalledWith('SIGKILL')
        vi.advanceTimersByTime(FORCE_STOP_GRACE_MS)

        expect(child.kill).toHaveBeenCalledWith('SIGKILL')
        expect(exitSpy).toHaveBeenCalledWith(1)
      })
    })
  })

  // `meocord register` runs the same bundle, told by its environment to register and exit.
  describe('register()', () => {
    // Only the keys register sets: a failed assertion prints what it received, and the rest is the
    // environment, which can hold tokens Bun loaded from a .env file
    const registerEnv = (env: unknown) =>
      Object.fromEntries(Object.entries((env ?? {}) as NodeJS.ProcessEnv).filter(([key]) => key.startsWith('MEOCORD_') && key.includes('REGISTER')))

    afterEach(() => {
      vi.mocked(existsSync).mockReturnValue(true)
    })

    it('runs the built application in register-only mode, sending even an unchanged payload', async () => {
      await new MeoCordCLI().register()

      const { args, options } = lastSpawn()
      expect(entryArgs(args)).toEqual([expect.stringContaining('main.js')])
      expect(registerEnv(options.env)).toEqual({ MEOCORD_REGISTER_ONLY: '1', MEOCORD_FORCE_REGISTER: '1' })
    })

    it('passes the guild it is given', async () => {
      await new MeoCordCLI().register('guild-id')

      expect(registerEnv(lastSpawn().options.env)).toMatchObject({ MEOCORD_REGISTER_GUILD: 'guild-id' })
    })

    it("exits with the application's code", async () => {
      await new MeoCordCLI().register()

      const child = spawnMock.mock.results.at(-1)?.value as { on: ReturnType<typeof vi.fn> }
      const onExit = child.on.mock.calls.find(([event]) => event === 'exit')?.[1] as (code: number | null) => void
      onExit(1)

      expect(exitSpy).toHaveBeenCalledWith(1)
    })

    it('exits 1, and spawns nothing, when there is no bundle', async () => {
      vi.mocked(existsSync).mockReturnValue(false)
      spawnMock.mockClear()

      await new MeoCordCLI().register()

      expect(exitSpy).toHaveBeenCalledWith(1)
      expect(spawnMock).not.toHaveBeenCalled()
    })
  })

  // Someone who typed `bun` expects a bun process. Pinning the binary the CLI happens to
  // be executing would hand them node, because the bin's shebang defers to it.
  describe('following the launcher', () => {
    beforeEach(() => Object.assign(process.env, BUN_LAUNCHER))

    it('runs the application on the runtime that launched the CLI', async () => {
      await new MeoCordCLI().startProd()

      expect(lastSpawn().command).toBe(BUN_LAUNCHER.npm_execpath)
    })

    it('runs the dev application on the runtime that launched the CLI', () => {
      const cli = new MeoCordCLI() as unknown as { restartApp: () => void }
      cli.restartApp()

      expect(lastSpawn().command).toBe(BUN_LAUNCHER.npm_execpath)
    })
  })

  describe('the terminal', () => {
    const ESC = '\u001b['
    const escapes = () =>
      vi
        .mocked(process.stdout.write)
        .mock.calls.map(([chunk]) => String(chunk))
        .filter(chunk => chunk.includes(ESC))
    const isTTY = process.stdout.isTTY
    afterEach(() => {
      process.stdout.isTTY = isTTY
    })

    /** startDev, as far as its first build, with the bundler and the config compile stood in for. */
    const startDev = async () => {
      vi.mocked(watch).mockReturnValueOnce({ close: vi.fn() } as never)
      const cli = new MeoCordCLI() as unknown as {
        startDev: () => Promise<void>
        relayStopSignals: () => void
        compileConfig: () => Promise<void>
        createBundler: () => Promise<unknown>
      }
      vi.spyOn(cli, 'relayStopSignals').mockImplementation(() => {})
      vi.spyOn(cli, 'compileConfig').mockResolvedValue(undefined)
      vi.spyOn(cli, 'createBundler').mockResolvedValue({
        rsbuild: { initConfigs: async () => [], onAfterBuild: () => {}, build: async () => ({ close: async () => {} }) },
      })
      await cli.startDev()
    }

    // In a log, a CI run or a process manager, an escape code is noise, and some viewers clear on it
    it('writes no escape code as a production start begins, even in a terminal', async () => {
      process.stdout.isTTY = true
      await new MeoCordCLI().startProd()

      expect(escapes()).toEqual([])
    })

    it("writes no escape code as a build begins, so the output before it stays on screen", async () => {
      process.stdout.isTTY = true
      const cli = new MeoCordCLI() as unknown as { build: (mode: string) => Promise<void>; createBundler: () => Promise<unknown> }
      vi.spyOn(cli, 'createBundler').mockRejectedValue(new Error('stopped here'))

      await cli.build('production')

      expect(escapes()).toEqual([])
    })

    it('clears the screen as watch mode starts in a terminal, and keeps the scrollback', async () => {
      process.stdout.isTTY = true
      await startDev()

      expect(escapes()).toEqual(['\u001b[2J\u001b[H'])
    })

    it('writes no escape code as watch mode starts with its output piped', async () => {
      process.stdout.isTTY = false
      await startDev()

      expect(escapes()).toEqual([])
    })
  })

  describe('dev watcher', () => {
    const watcher = () => new MeoCordCLI() as unknown as { restartApp: () => void; appProcess: unknown }

    // Watching and production reach the bundle through the same command, so a runtime
    // that works in development cannot silently differ from the one that ships.
    it('runs the application with the command and arguments production uses', async () => {
      await new MeoCordCLI().startProd()
      const production = lastSpawn()

      spawnMock.mockClear()
      watcher().restartApp()
      const development = lastSpawn()

      expect(development.command).toBe(production.command)
      expect(development.args).toEqual(production.args)
    })

    it('runs the entry file with the resolved runtime', () => {
      watcher().restartApp()

      const { command, args } = lastSpawn()
      expect(command).toBe(process.execPath)
      expect(entryArgs(args)).toEqual([expect.stringContaining('main.js')])
    })

    it('honours the runtime override', () => {
      process.env[RUNTIME_OVERRIDE_ENV] = '/opt/custom/bun'

      watcher().restartApp()

      expect(lastSpawn().command).toBe('/opt/custom/bun')
    })

    it('does not run through a shell', () => {
      watcher().restartApp()

      expect(lastSpawn().options).not.toHaveProperty('shell', true)
    })

    // Both processes hold the same gateway session, so the replacement has to wait for
    // the old one to let go rather than racing it for the login.
    it('waits for the running application to exit before replacing it', () => {
      const cli = watcher()
      cli.restartApp()

      const first = spawnMock.mock.results.at(-1)?.value as {
        once: ReturnType<typeof vi.fn>
        kill: ReturnType<typeof vi.fn>
        removeAllListeners: ReturnType<typeof vi.fn>
      }
      spawnMock.mockClear()

      cli.restartApp()

      expect(first.kill).toHaveBeenCalled()
      expect(spawnMock).not.toHaveBeenCalled()

      // The listener the restart added, after removing the one watching for an exit of its own
      const onExit = first.once.mock.calls.findLast(([event]) => event === 'exit')?.[1] as () => void
      onExit()

      expect(first.removeAllListeners).toHaveBeenCalledWith('exit')
      expect(spawnMock).toHaveBeenCalledTimes(1)
    })

    // A signal is no graceful stop on Windows, where kill() ends the process outright and its onShutdown hooks never run
    it('asks the running application to stop over its channel, on every platform, rather than signalling it', () => {
      const cli = watcher()
      cli.restartApp()
      const first = spawnMock.mock.results.at(-1)?.value as ReturnType<typeof createChild> & { connected: boolean; send: ReturnType<typeof vi.fn> }
      first.connected = true
      first.send = vi.fn()

      cli.restartApp()

      expect(first.send).toHaveBeenCalledWith({ meocord: 'stop' })
      expect(first.kill).not.toHaveBeenCalled()
    })

    it('signals an application whose channel is closed, as nothing else reaches it', () => {
      const cli = watcher()
      cli.restartApp()
      const first = spawnMock.mock.results.at(-1)?.value as ReturnType<typeof createChild> & { connected: boolean }
      first.connected = false

      cli.restartApp()

      expect(first.kill).toHaveBeenCalledWith()
    })

    describe('when builds finish while the previous application is still exiting', () => {
      type Child = ReturnType<typeof createChild>
      const onExit = (child: Child) => child.once.mock.calls.findLast(([event]) => event === 'exit')?.[1] as () => void

      function restarting() {
        spawnMock.mockImplementation(() => createChild() as never)
        const cli = watcher()
        cli.restartApp()
        const first = spawnMock.mock.results.at(-1)?.value as Child
        cli.restartApp()
        return { cli, first }
      }

      // A watcher can report one edit twice; a launch for each would leave a second bot running, untracked
      it('starts one application once the previous one exits', () => {
        const { cli, first } = restarting()
        spawnMock.mockClear()

        cli.restartApp()
        cli.restartApp()
        expect(spawnMock).not.toHaveBeenCalled()
        expect(first.kill).toHaveBeenCalledTimes(1)

        first.exitCode = 0
        onExit(first)()

        expect(spawnMock).toHaveBeenCalledTimes(1)
        expect(cli.appProcess).toBe(spawnMock.mock.results[0]?.value)
      })

      it('still tracks the exiting application, so a stop reaches it', () => {
        const { cli, first } = restarting()

        expect(cli.appProcess).toBe(first)
      })

      it('restarts normally after the coalesced restart', () => {
        const { cli, first } = restarting()
        first.exitCode = 0
        onExit(first)()
        const second = spawnMock.mock.results.at(-1)?.value as Child
        spawnMock.mockClear()

        cli.restartApp()

        expect(second.kill).toHaveBeenCalledTimes(1)
        expect(spawnMock).not.toHaveBeenCalled()
        second.exitCode = 0
        onExit(second)()
        expect(spawnMock).toHaveBeenCalledTimes(1)
      })

      it('waits for it to exit when the session stops during the restart, and starts nothing', async () => {
        spawnMock.mockImplementation(() => createChild() as never)
        vi.mocked(watch).mockReturnValueOnce({ close: vi.fn() } as never)
        let afterBuild = () => {}
        let stop = () => {}
        const cli = new MeoCordCLI() as unknown as {
          startDev: () => Promise<void>
          clearScreen: () => void
          relayStopSignals: (app: () => unknown, stopping: () => void) => void
          compileConfig: () => Promise<void>
          createBundler: () => Promise<unknown>
        }
        vi.spyOn(cli, 'clearScreen').mockImplementation(() => {})
        vi.spyOn(cli, 'relayStopSignals').mockImplementation((_app, stopping) => (stop = stopping))
        vi.spyOn(cli, 'compileConfig').mockResolvedValue(undefined)
        vi.spyOn(cli, 'createBundler').mockResolvedValue({
          rsbuild: { initConfigs: async () => [], onAfterBuild: (callback: (params: object) => void) => (afterBuild = () => callback({})), build: async () => ({ close: async () => {} }) },
        })
        await cli.startDev()
        afterBuild()
        const first = spawnMock.mock.results.at(-1)?.value as Child
        afterBuild()
        spawnMock.mockClear()

        stop()
        await new Promise(resolve => setTimeout(resolve, 10))
        expect(exitSpy).not.toHaveBeenCalled()

        first.exitCode = 0
        for (const [event, listener] of [...first.once.mock.calls, ...first.on.mock.calls]) {
          if (event === 'exit') (listener as (code: number) => void)(0)
        }
        await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(0))
        expect(spawnMock).not.toHaveBeenCalled()
      })
    })

    // One save can make two builds of the same output; the second may finish just after the replacement started.
    // Rspack gives every rebuild a new hash, even of unchanged sources, so each build here has its own.
    it('leaves a bot running that was launched from the output a build emitted, and restarts it for a new one', async () => {
      spawnMock.mockImplementation(() => createChild() as never)
      let build: (output: string) => void = () => {}
      let builds = 0
      const statsOf = (output: string) => ({
        hash: `build ${++builds}`,
        hasErrors: () => false,
        compilation: { getAssets: () => [{ name: 'main.js', source: { buffer: () => Buffer.from(output) } }] },
      })
      const cli = new MeoCordCLI() as unknown as {
        startDev: () => Promise<void>
        clearScreen: () => void
        relayStopSignals: () => void
        compileConfig: () => Promise<void>
        createBundler: () => Promise<unknown>
      }
      vi.spyOn(cli, 'clearScreen').mockImplementation(() => {})
      vi.spyOn(cli, 'relayStopSignals').mockImplementation(() => {})
      vi.spyOn(cli, 'compileConfig').mockResolvedValue(undefined)
      vi.spyOn(cli, 'createBundler').mockResolvedValue({
        rsbuild: {
          initConfigs: async () => [],
          onAfterBuild: (callback: (params: object) => void) => (build = output => callback({ stats: statsOf(output) })),
          build: async () => ({ close: async () => {} }),
        },
      })
      await cli.startDev()
      const exitOf = (child: ReturnType<typeof createChild>) => {
        child.exitCode = 0
        const listener = child.once.mock.calls.findLast(([event]) => event === 'exit')?.[1] as () => void
        listener()
      }

      build('first')
      const first = spawnMock.mock.results.at(-1)?.value as ReturnType<typeof createChild>
      build('saved')
      exitOf(first)
      const replacement = spawnMock.mock.results.at(-1)?.value as ReturnType<typeof createChild>
      expect(replacement).not.toBe(first)

      build('saved')
      expect(replacement.kill).not.toHaveBeenCalled()

      build('saved again')
      expect(replacement.kill).toHaveBeenCalled()
    })

    describe('when the running application does not exit', () => {
      afterEach(() => vi.useRealTimers())

      function restartOnce(shutdownTimeout?: number) {
        vi.useFakeTimers()
        vi.mocked(loadMeoCordConfig).mockReturnValue(shutdownTimeout === undefined ? undefined : ({ shutdownTimeout } as never))
        const first = createChild()
        spawnMock.mockReturnValueOnce(first as never)
        const cli = new MeoCordCLI() as unknown as { restartApp: () => void; logger: { warn: ReturnType<typeof vi.fn> } }
        cli.restartApp()
        cli.restartApp()
        const onExit = first.once.mock.calls.findLast(([event]) => event === 'exit')?.[1] as () => void
        return { first, onExit, warned: () => vi.mocked(cli.logger.warn).mock.calls.map(([message]) => String(message)) }
      }

      it('kills it once its shutdownTimeout and the grace period have passed, and says why', () => {
        const { first, warned } = restartOnce(3_000)

        vi.advanceTimersByTime(3_000 + FORCE_STOP_GRACE_MS - 1)
        expect(first.kill).not.toHaveBeenCalledWith('SIGKILL')

        vi.advanceTimersByTime(1)
        expect(first.kill).toHaveBeenCalledWith('SIGKILL')
        expect(warned()).toContainEqual(expect.stringContaining('its shutdownTimeout of 3000 ms'))
      })

      // The grace period on top still fits a timer, which Node would fire at once past its limit
      it('keeps the whole grace period after the longest shutdownTimeout', () => {
        const { first } = restartOnce(MAX_SHUTDOWN_TIMEOUT_MS)

        vi.advanceTimersByTime(MAX_SHUTDOWN_TIMEOUT_MS + FORCE_STOP_GRACE_MS - 1)
        expect(first.kill).not.toHaveBeenCalledWith('SIGKILL')
        vi.advanceTimersByTime(1)
        expect(first.kill).toHaveBeenCalledWith('SIGKILL')
      })

      it('waits the default shutdownTimeout when none is configured', () => {
        const { first } = restartOnce()

        vi.advanceTimersByTime(DEFAULT_SHUTDOWN_TIMEOUT_MS + FORCE_STOP_GRACE_MS - 1)
        expect(first.kill).not.toHaveBeenCalledWith('SIGKILL')
        vi.advanceTimersByTime(1)
        expect(first.kill).toHaveBeenCalledWith('SIGKILL')
      })

      it('kills nothing once it has exited', () => {
        const { first, onExit, warned } = restartOnce(3_000)

        onExit()
        vi.advanceTimersByTime(3_000 + FORCE_STOP_GRACE_MS)

        expect(first.kill).not.toHaveBeenCalledWith('SIGKILL')
        expect(warned()).toEqual([])
      })
    })

    // A child that exits on its own never emits `exit` again, so waiting for one would never restart it
    it('replaces an application that already exited on its own at once', () => {
      const cli = watcher()
      cli.restartApp()
      const crashed = spawnMock.mock.results.at(-1)?.value as ReturnType<typeof createChild>
      crashed.exitCode = 1
      spawnMock.mockClear()

      cli.restartApp()

      expect(crashed.kill).not.toHaveBeenCalled()
      expect(spawnMock).toHaveBeenCalledTimes(1)
    })

    it('spawns immediately when nothing is running yet', () => {
      watcher().restartApp()

      expect(spawnMock).toHaveBeenCalledTimes(1)
    })

    describe('when the application exits on its own', () => {
      type Child = ReturnType<typeof createChild>
      const launch = (cli: { restartApp: () => void }) => {
        cli.restartApp()
        return spawnMock.mock.results.at(-1)?.value as Child
      }
      const handler = (child: Child, method: 'on' | 'once', event: string) =>
        (child[method].mock.calls.find(([name]) => name === event)?.[1] ?? (() => {})) as (...args: unknown[]) => void
      const warned = (cli: unknown) => vi.mocked((cli as { logger: { warn: (text: string) => void } }).logger.warn).mock.calls.flat()

      const failed = (cli: unknown) => vi.mocked((cli as { logger: { error: (text: string) => void } }).logger.error).mock.calls.flat()

      // A login is fixed in the code, such as its intents, or in .env, and the session watches both
      it('keeps watching when the bot could not log in, says what starts it again, and runs the next change', () => {
        const cli = watcher()
        const child = launch(cli)

        handler(child, 'on', 'message')({ meocord: 'login-failed' })
        handler(child, 'once', 'exit')(1)
        child.exitCode = 1

        expect(exitSpy).not.toHaveBeenCalled()
        expect(failed(cli)).toContainEqual('The bot could not log in; watch mode starts it again on the next change, in src or .env.')
        expect(warned(cli)).toEqual([])
        spawnMock.mockClear()
        cli.restartApp()
        expect(spawnMock).toHaveBeenCalledTimes(1)
      })

      it('keeps watching after an exit a code change can fix, says so, and runs the next build', () => {
        const cli = watcher()
        const child = launch(cli)

        handler(child, 'once', 'exit')(1)
        child.exitCode = 1

        expect(exitSpy).not.toHaveBeenCalled()
        expect(warned(cli)).toContainEqual(expect.stringContaining('The application exited with code 1; waiting for changes'))
        spawnMock.mockClear()
        cli.restartApp()
        expect(spawnMock).toHaveBeenCalledTimes(1)
      })

      it('says it waits for changes when a retry logged in after a failed login', () => {
        const cli = watcher()
        const child = launch(cli)

        handler(child, 'on', 'message')({ meocord: 'login-failed' })
        handler(child, 'on', 'message')({ meocord: 'online' })
        handler(child, 'once', 'exit')(1)

        expect(exitSpy).not.toHaveBeenCalled()
        expect(warned(cli)).toContainEqual(expect.stringContaining('The application exited with code 1; waiting for changes'))
      })
    })

    describe('when watch mode fails to start', () => {
      function devCli({ bundler }: { bundler: () => Promise<unknown> }) {
        const cli = new MeoCordCLI() as unknown as {
          startDev: () => Promise<void>
          clearScreen: () => void
          relayStopSignals: () => void
          compileConfig: () => Promise<void>
          createBundler: () => Promise<unknown>
        }
        vi.spyOn(cli, 'clearScreen').mockImplementation(() => {})
        vi.spyOn(cli, 'relayStopSignals').mockImplementation(() => {})
        vi.spyOn(cli, 'compileConfig').mockResolvedValue(undefined)
        vi.spyOn(cli, 'createBundler').mockImplementation(bundler)
        return cli
      }

      // As `meocord build` does, so a script or process manager around it sees the failure
      it('exits 1 when the first build cannot start, such as from a config hook that throws', async () => {
        const cli = devCli({ bundler: async () => Promise.reject(new Error('hook broke')) })

        await cli.startDev()

        expect(exitSpy).toHaveBeenCalledWith(1)
        expect(spawnMock).not.toHaveBeenCalled()
      })

      // A bot that holds on to its stop signal, as one that ignores SIGTERM does, must not outlive the session
      it('stops the bot it started through its own stop, and exits 1 once it has, when it cannot watch the project', async () => {
        vi.useFakeTimers()
        try {
          vi.mocked(watch).mockImplementationOnce(() => {
            throw new Error('ENOSPC: System limit for number of file watchers reached')
          })
          const cli = devCli({
            bundler: async () => ({
              rsbuild: { initConfigs: async () => [], onAfterBuild: (callback: (params: object) => void) => callback({}), build: async () => ({ close: async () => {} }) },
            }),
          })
          const child = createChild() as ReturnType<typeof createChild> & { connected: boolean; send: ReturnType<typeof vi.fn> }
          child.connected = true
          child.send = vi.fn()
          spawnMock.mockReturnValueOnce(child as never)

          const started = cli.startDev()
          await vi.waitFor(() => expect(child.send).toHaveBeenCalledWith({ meocord: 'stop' }))
          expect(child.kill).not.toHaveBeenCalled()
          expect(exitSpy).not.toHaveBeenCalled()

          // Still running past its shutdownTimeout and the grace period, so it is killed
          await vi.advanceTimersByTimeAsync(DEFAULT_SHUTDOWN_TIMEOUT_MS + FORCE_STOP_GRACE_MS)
          expect(child.kill).toHaveBeenCalledWith('SIGKILL')
          expect(exitSpy).not.toHaveBeenCalled()

          const onExit = child.once.mock.calls.findLast(([event]) => event === 'exit')?.[1] as () => void
          child.exitCode = 137
          onExit()
          await started

          expect(exitSpy).toHaveBeenCalledWith(1)
        } finally {
          vi.useRealTimers()
        }
      })
    })

    describe('reloading from the files the bundler does not watch', () => {
      async function startWatching() {
        let listener: (event: string, filename: string | null) => void = () => {}
        vi.mocked(watch).mockImplementationOnce(((_dir: string, callback: typeof listener) => {
          listener = callback
          return { close: vi.fn() }
        }) as never)
        const closeBuild = vi.fn(async () => {})
        const cli = new MeoCordCLI() as unknown as {
          startDev: () => Promise<void>
          clearScreen: () => void
          relayStopSignals: () => void
          compileConfig: (options: { mode: 'production' | 'development'; exitOnFailure?: boolean }) => Promise<boolean>
          createBundler: () => Promise<unknown>
        }
        vi.spyOn(cli, 'clearScreen').mockImplementation(() => {})
        vi.spyOn(cli, 'relayStopSignals').mockImplementation(() => {})
        const compileConfig = vi.spyOn(cli, 'compileConfig').mockResolvedValue(true)
        const createBundler = vi.spyOn(cli, 'createBundler').mockImplementation(async () => ({
          rsbuild: { initConfigs: async () => [], onAfterBuild: (callback: (params: object) => void) => callback({}), build: async () => ({ close: closeBuild }) },
        }))
        await cli.startDev()
        const errors = vi.mocked((cli as unknown as { logger: { error: (text: string) => void } }).logger.error)
        return { change: (filename: string) => listener('change', filename), compileConfig, createBundler, closeBuild, errors }
      }

      // As with a failed login, the session and the bot it runs outlast it, and saving again retries
      it('keeps the running build and bot when a rebuild cannot start, such as from an rsbuild hook that throws', async () => {
        const unhandled = vi.fn()
        process.on('unhandledRejection', unhandled)
        try {
          const dev = await startWatching()
          const running = spawnMock.mock.results.at(-1)?.value as ReturnType<typeof createChild>
          dev.createBundler.mockRejectedValueOnce(new Error('hook broke'))

          dev.change('meocord.config.ts')
          await vi.waitFor(() => expect(dev.errors).toHaveBeenCalledWith(expect.stringContaining('Rebuilding failed: hook broke')))
          await new Promise(resolve => setTimeout(resolve, 50))

          expect(unhandled).not.toHaveBeenCalled()
          expect(exitSpy).not.toHaveBeenCalled()
          expect(dev.closeBuild).not.toHaveBeenCalled()
          expect(running.kill).not.toHaveBeenCalled()

          dev.change('meocord.config.ts')
          await vi.waitFor(() => expect(dev.createBundler).toHaveBeenCalledTimes(3))
          expect(dev.closeBuild).toHaveBeenCalledTimes(1)
        } finally {
          process.off('unhandledRejection', unhandled)
        }
      })

      it('rebuilds once from a changed tsconfig.json, however many events one save makes', async () => {
        const dev = await startWatching()

        dev.change('tsconfig.json')
        dev.change('tsconfig.json')

        await vi.waitFor(() => expect(dev.createBundler).toHaveBeenCalledTimes(2))
        expect(dev.closeBuild).toHaveBeenCalledTimes(1)
        expect(dev.compileConfig).toHaveBeenCalledTimes(1)
      })

      it('compiles the config again before rebuilding from a changed meocord.config.ts', async () => {
        const dev = await startWatching()

        dev.change('meocord.config.ts')

        await vi.waitFor(() => expect(dev.createBundler).toHaveBeenCalledTimes(2))
        expect(dev.compileConfig).toHaveBeenCalledTimes(2)
        expect(dev.compileConfig.mock.invocationCallOrder[1]).toBeLessThan(dev.createBundler.mock.invocationCallOrder[1])
      })

      // The bot reads .env as it starts, so the build it runs needs no rebuild
      it('restarts the application from a changed .env without rebuilding', async () => {
        const dev = await startWatching()
        const running = spawnMock.mock.results.at(-1)?.value as ReturnType<typeof createChild>

        dev.change('.env')

        await vi.waitFor(() => expect(running.kill).toHaveBeenCalled())
        expect(dev.createBundler).toHaveBeenCalledTimes(1)
        expect(dev.closeBuild).not.toHaveBeenCalled()
        expect(dev.compileConfig).toHaveBeenCalledTimes(1)
      })

      it.each(['package.json', 'constructor', 'toString'])('ignores %s, which it does not reload from', async file => {
        const dev = await startWatching()

        dev.change(file)
        await new Promise(resolve => setTimeout(resolve, 400))

        expect(dev.createBundler).toHaveBeenCalledTimes(1)
      })

      it('keeps the running build when the changed config does not compile, and reloads once it does', async () => {
        const dev = await startWatching()
        dev.compileConfig.mockResolvedValueOnce(false)

        dev.change('meocord.config.ts')
        await vi.waitFor(() => expect(dev.compileConfig).toHaveBeenCalledTimes(2))
        await new Promise(resolve => setTimeout(resolve, 50))
        expect(dev.compileConfig).toHaveBeenLastCalledWith({ mode: 'development', exitOnFailure: false })
        expect(dev.closeBuild).not.toHaveBeenCalled()
        expect(dev.createBundler).toHaveBeenCalledTimes(1)

        dev.change('meocord.config.ts')
        await vi.waitFor(() => expect(dev.createBundler).toHaveBeenCalledTimes(2))
        expect(dev.closeBuild).toHaveBeenCalledTimes(1)
      })
    })

      it('runs the application with a channel for it, and production without one', async () => {
        watcher().restartApp()
        expect(lastSpawn().options.stdio).toEqual(['inherit', 'inherit', 'inherit', 'ipc'])
        expect((lastSpawn().options.env as NodeJS.ProcessEnv).MEOCORD_DEV_RUNNER).toBe('1')

        await new MeoCordCLI().startProd()
        expect(lastSpawn().options.stdio).toBe('inherit')
        expect((lastSpawn().options.env as NodeJS.ProcessEnv).MEOCORD_DEV_RUNNER).toBeUndefined()
      })
  })
})

describe('namePathProblem', () => {
  it.each(['../ban', 'admin/../../ban', '/etc/ban', 'C:/ban', 'c:ban'])('refuses %s, which leaves the folder', name => {
    expect(namePathProblem(name, 'src/services/')).toContain('Names are paths inside src/services/')
  })

  it.each(['Ban', 'admin/ban', 'admin/ban-list', 'a..b'])('accepts %s', name => {
    expect(namePathProblem(name, 'src/services/')).toBeUndefined()
  })
})

// Generating never edits src/app.ts, so it says where each kind of class goes for it to take part
describe('nextStepFor', () => {
  it.each([
    ['controller', 'ticket', ControllerType.BUTTON, 'Next: add TicketButtonController to @MeoCord({ controllers }) in src/app.ts.'],
    ['controller', 'admin/ban', ControllerType.SLASH, 'Next: add AdminBanSlashController to @MeoCord({ controllers }) in src/app.ts.'],
    ['controller', 'pick', ControllerType.USER_SELECT_MENU, 'Next: add PickUserSelectMenuController to @MeoCord({ controllers }) in src/app.ts.'],
    ['observer', 'metrics', undefined, 'Next: add MetricsObserver to @MeoCord({ observers }) in src/app.ts.'],
  ] as const)('names the list a %s %s goes in', (component, name, type, next) => {
    expect(nextStepFor(component, name, type)).toBe(next)
  })

  // The command it completes already exists, so the generator leaves its builder to the user, and says what to add
  it('tells an autocomplete controller to give its command the option it completes', () => {
    expect(nextStepFor('controller', 'admin/search', ControllerType.AUTOCOMPLETE)).toBe(
      'Next: add AdminSearchAutocompleteController to @MeoCord({ controllers }) in src/app.ts, and declare the option it ' +
        "completes on /admin-search's builder: .addStringOption(option => option.setName('query').setDescription('What to " +
        "search for').setAutocomplete(true))",
    )
  })

  it.each([
    ['guard', 'UseGuard(AdminGuard)', 'guards'],
    ['interceptor', 'UseInterceptor(AdminInterceptor)', 'interceptors'],
    ['filter', 'UseFilter(AdminFilter)', 'filters'],
  ])('names the decorator that applies a %s, and the global list', (component, decorator, list) => {
    const next = nextStepFor(component, 'admin')

    expect(next).toContain(`@${decorator}`)
    expect(next).toContain(`@MeoCord({ ${list} })`)
  })

  it('says a service is bound when something injects it', () => {
    expect(nextStepFor('service', 'billing/invoice')).toContain('inject BillingInvoiceService')
  })
})
