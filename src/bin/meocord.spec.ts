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

vi.mock('@src/util/meocord-source-config.util.js', async importOriginal => {
  const actual = await importOriginal<typeof import('@src/util/meocord-source-config.util.js')>()
  return { ...actual, loadMeoCordCliConfig: vi.fn(actual.loadMeoCordCliConfig) }
})

import { spawn } from 'node:child_process'
import { existsSync, watch } from 'node:fs'
import { FORCE_STOP_GRACE_MS, MeoCordCLI } from '@src/bin/meocord.js'
import { REPEAT_SIGNAL_WINDOW_MS } from '@src/util/stop-request.util.js'
import { DEFAULT_SHUTDOWN_TIMEOUT_MS } from '@src/util/shutdown-timeout.util.js'
import { namePathProblem, nextStepFor } from '@src/bin/generator.js'
import { ControllerType } from '@src/enum/controller.enum.js'
import { RUNTIME_OVERRIDE_ENV } from '@src/util/runtime.util.js'
import { loadMeoCordCliConfig } from '@src/util/meocord-source-config.util.js'

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
      vi.mocked(loadMeoCordCliConfig).mockReturnValueOnce({ discordToken: 't', sourceMappedStacks: false })

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

      // Docker, pm2 and systemd signal the CLI alone; the bot would otherwise keep running
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

  // Someone who typed `bun` expects a bun process. Pinning the binary the CLI happens to
  // be executing would hand them node, because the bin's shebang defers to it.
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

    it('asks for a build, and spawns nothing, when there is no bundle', async () => {
      vi.mocked(existsSync).mockReturnValue(false)
      spawnMock.mockClear()

      await new MeoCordCLI().register()

      expect(exitSpy).toHaveBeenCalledWith(1)
      expect(spawnMock).not.toHaveBeenCalled()
    })
  })

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

  // Watching and production reach the bundle through the same command, so a runtime
  // that works in development cannot silently differ from the one that ships.
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
        rsbuild: { onAfterBuild: () => {}, build: async () => ({ close: async () => {} }) },
      })
      await cli.startDev()
    }

    // In a log, a CI run or a process manager, an escape code is noise, and some viewers clear on it
    it('writes no escape code as a production start begins, in a terminal or not', async () => {
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

    it('runs the application exactly as production does', async () => {
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
      it('starts one application, from the latest build, once the previous one exits', () => {
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
          rsbuild: { onAfterBuild: (callback: () => void) => (afterBuild = callback), build: async () => ({ close: async () => {} }) },
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

    describe('when the running application does not exit', () => {
      afterEach(() => vi.useRealTimers())

      function restartOnce(shutdownTimeout?: number) {
        vi.useFakeTimers()
        vi.mocked(loadMeoCordCliConfig).mockReturnValue(shutdownTimeout === undefined ? undefined : ({ shutdownTimeout } as never))
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

      // Discord refused the login, so no change to the code can bring the bot online: watching on would hide it
      it('ends the watch session with its code when the bot could not log in', () => {
        const cli = watcher()
        const child = launch(cli)

        handler(child, 'on', 'message')({ meocord: 'login-failed' })
        handler(child, 'once', 'exit')(1)

        expect(exitSpy).toHaveBeenCalledWith(1)
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

      it('keeps watching when a retry logged in after a failed login', () => {
        const cli = watcher()
        const child = launch(cli)

        handler(child, 'on', 'message')({ meocord: 'login-failed' })
        handler(child, 'on', 'message')({ meocord: 'online' })
        handler(child, 'once', 'exit')(1)

        expect(exitSpy).not.toHaveBeenCalled()
      })

      it("ends the session through startDev's own ending, which closes the watchers before exiting", async () => {
        const fsWatcher = { close: vi.fn() }
        vi.mocked(watch).mockReturnValueOnce(fsWatcher as never)
        const closeBuild = vi.fn(async () => {})
        let afterBuild = () => {}
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
          rsbuild: { onAfterBuild: (callback: () => void) => (afterBuild = callback), build: async () => ({ close: closeBuild }) },
        })

        await cli.startDev()
        afterBuild()
        const child = spawnMock.mock.results.at(-1)?.value as Child
        handler(child, 'on', 'message')({ meocord: 'login-failed' })
        handler(child, 'once', 'exit')(1)

        await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(1))
        expect(fsWatcher.close).toHaveBeenCalled()
        expect(closeBuild.mock.invocationCallOrder[0]).toBeLessThan(exitSpy.mock.invocationCallOrder[0])
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
          compileConfig: (options?: { exitOnFailure?: boolean }) => Promise<boolean>
          createBundler: () => Promise<unknown>
        }
        vi.spyOn(cli, 'clearScreen').mockImplementation(() => {})
        vi.spyOn(cli, 'relayStopSignals').mockImplementation(() => {})
        const compileConfig = vi.spyOn(cli, 'compileConfig').mockResolvedValue(true)
        const createBundler = vi.spyOn(cli, 'createBundler').mockImplementation(async () => ({
          rsbuild: { onAfterBuild: (callback: () => void) => callback(), build: async () => ({ close: closeBuild }) },
        }))
        await cli.startDev()
        return { change: (filename: string) => listener('change', filename), compileConfig, createBundler, closeBuild }
      }

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
        expect(dev.compileConfig).toHaveBeenLastCalledWith({ exitOnFailure: false })
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
