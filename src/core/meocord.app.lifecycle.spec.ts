import { vi } from 'vitest'
import { REPEAT_SIGNAL_WINDOW_MS } from '@src/util/stop-request.util.js'
import { DEFAULT_SHUTDOWN_TIMEOUT_MS } from '@src/util/shutdown-timeout.util.js'
import { type Client } from 'discord.js'
import type * as AppModule from '@src/core/meocord.app.js'
import type * as FactoryModule from '@src/core/meocord-factory.js'
import type * as DecoratorModule from '@src/decorator/index.js'
import { type OnReady, type OnShutdown, type ReadyInfo } from '@src/interface/index.js'
import { type FakeDiscord, startFakeDiscord } from '../../scripts/lib/fake-discord.js'

const { logged, config } = vi.hoisted(() => ({
  logged: { log: [] as unknown[][], error: [] as unknown[][], warn: [] as unknown[][] },
  config: { discordToken: 'test-token' } as { discordToken: string; shutdownTimeout?: number },
}))

// Logger is constructed with `new`, so the implementation has to be a class.
vi.mock('@src/common/index.js', async importOriginal => ({
  ...(await importOriginal<object>()),
  Logger: class {
    log = (...args: unknown[]) => logged.log.push(args)
    debug = vi.fn()
    info = vi.fn()
    verbose = vi.fn()
    error = (...args: unknown[]) => logged.error.push(args)
    warn = (...args: unknown[]) => logged.warn.push(args)
  },
}))

vi.mock('@src/util/meocord-config-loader.util.js', () => ({
  loadMeoCordConfig: () => config,
}))

vi.mock('@src/util/platform.util.js', () => ({ assertBuiltForThisPlatform: () => {} }))

/**
 * Fresh modules per test: shutdown state and the signal listeners live at module level, as they do
 * in a real process, so each test starts from a process that has shut nothing down yet.
 */
async function load() {
  vi.resetModules()
  const discord = await import('discord.js')
  const app: typeof AppModule = await import('@src/core/meocord.app.js')
  const factory: typeof FactoryModule = await import('@src/core/meocord-factory.js')
  const decorators: typeof DecoratorModule = await import('@src/decorator/index.js')
  const { inject } = await import('inversify')
  // From its own module, which the factory imports too: the mocked index can hand back an earlier load's classes
  const { CooldownStore, MemoryCooldownStore } = await import('@src/common/cooldown-store.js')
  const { CommandType } = await import('@src/enum/index.js')
  const { createMockInteraction, getResponse } = await import('@src/testing/index.js')
  return { discord, inject, CooldownStore, MemoryCooldownStore, CommandType, createMockInteraction, getResponse, ...app, ...factory, ...decorators }
}

type Loaded = Awaited<ReturnType<typeof load>>

/** Starts an app built by the factory, with a client that logs in without a network. */
async function startApp(
  loaded: Loaded,
  options: {
    controllers: any[]
    services?: any[]
    cooldownStore?: any
    cooldownStoreTimeoutMs?: number
    cooldownStoreFailure?: 'deny' | 'allow'
    themeFor?: any
  },
) {
  const clients: Client[] = []
  vi.spyOn(loaded.discord.Client.prototype, 'login').mockImplementation(function (this: Client) {
    clients.push(this)
    return Promise.resolve('token')
  })
  vi.spyOn(loaded.discord.Client.prototype, 'destroy').mockResolvedValue(undefined)

  @loaded.MeoCord({
    controllers: options.controllers,
    services: options.services,
    cooldownStore: options.cooldownStore,
    cooldownStoreTimeoutMs: options.cooldownStoreTimeoutMs,
    cooldownStoreFailure: options.cooldownStoreFailure,
    themeFor: options.themeFor,
    clientOptions: { intents: [] },
  })
  class App {}

  const app = loaded.MeoCordFactory.create(App)
  await app.start()
  return { app, client: clients[0] }
}

/** Gives the client an application, so it registers its commands when ready, and has the REST call that does it answer with `put`. */
function registerThrough(client: Client, put: () => Promise<unknown>) {
  Object.defineProperty(client, 'application', { value: { id: '100000000000000001' }, configurable: true })
  return vi.spyOn(client.rest, 'put').mockImplementation(put)
}

/** Emits clientReady and waits for the listener, which runs the hooks and registration, to settle. */
async function becomeReady(client: Client): Promise<void> {
  const [listener] = client.listeners('clientReady')
  await listener(client)
}

describe('lifecycle hooks', () => {
  let exit: ReturnType<typeof vi.spyOn>
  let signalListeners: Record<'SIGINT' | 'SIGTERM', NodeJS.SignalsListener[]>

  beforeEach(() => {
    logged.log.length = 0
    logged.error.length = 0
    logged.warn.length = 0
    delete config.shutdownTimeout
    exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    signalListeners = {
      SIGINT: process.listeners('SIGINT') as NodeJS.SignalsListener[],
      SIGTERM: process.listeners('SIGTERM') as NodeJS.SignalsListener[],
    }
  })

  afterEach(() => {
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      for (const listener of process.listeners(signal)) {
        if (!signalListeners[signal].includes(listener as NodeJS.SignalsListener)) process.off(signal, listener)
      }
    }
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('onReady', () => {
    it('runs on controllers, listed services and their dependencies, with the client and primary', async () => {
      const loaded = await load()
      const calls: [string, Client, ReadyInfo][] = []

      @loaded.Service()
      class UnusedDependency implements OnReady {
        onReady(client: Client<true>, info: ReadyInfo) {
          calls.push(['dependency', client, info])
        }
      }

      @loaded.Service()
      class Scheduler implements OnReady {
        constructor(readonly dependency: UnusedDependency) {}
        onReady(client: Client<true>, info: ReadyInfo) {
          calls.push(['service', client, info])
        }
      }

      @loaded.Controller()
      class PingController implements OnReady {
        onReady(client: Client<true>, info: ReadyInfo) {
          calls.push(['controller', client, info])
        }
      }

      const { client } = await startApp(loaded, { controllers: [PingController], services: [Scheduler] })
      expect(calls).toEqual([])

      await becomeReady(client)

      expect(calls.map(([who]) => who)).toEqual(['dependency', 'service', 'controller'])
      for (const [, readyClient, info] of calls) {
        expect(readyClient).toBe(client)
        expect(info).toEqual({ primary: true })
      }
    })

    it('logs a hook that throws and still runs the others', async () => {
      const loaded = await load()
      const ran: string[] = []

      @loaded.Service()
      class Broken implements OnReady {
        onReady() {
          throw new Error('boom')
        }
      }

      @loaded.Service()
      class Healthy implements OnReady {
        async onReady() {
          ran.push('healthy')
        }
      }

      const { client } = await startApp(loaded, { controllers: [], services: [Broken, Healthy] })
      await becomeReady(client)

      expect(ran).toEqual(['healthy'])
      expect(logged.error).toContainEqual(['onReady failed in Broken:', new Error('boom')])
    })

    it('runs one at a time, each class after the ones it injects, ties in declaration order', async () => {
      const loaded = await load()
      const order: string[] = []
      const hook = (name: string) => async () => {
        order.push(`${name}:start`)
        await Promise.resolve()
        order.push(`${name}:end`)
      }

      @loaded.Service()
      class DatabaseService implements OnReady {
        onReady = hook('database')
      }

      @loaded.Service()
      class ReminderScheduler implements OnReady {
        constructor(readonly database: DatabaseService) {}
        onReady = hook('scheduler')
      }

      @loaded.Service()
      class MetricsService implements OnReady {
        onReady = hook('metrics')
      }

      @loaded.Controller()
      class RemindController implements OnReady {
        constructor(readonly scheduler: ReminderScheduler) {}
        onReady = hook('controller')
      }

      const { client } = await startApp(loaded, {
        controllers: [RemindController],
        services: [ReminderScheduler, MetricsService],
      })
      await becomeReady(client)

      expect(order).toEqual([
        'database:start',
        'database:end',
        'scheduler:start',
        'scheduler:end',
        'metrics:start',
        'metrics:end',
        'controller:start',
        'controller:end',
      ])
    })

    it('orders by an @inject token when the parameter is typed as an interface', async () => {
      const loaded = await load()
      const order: string[] = []

      interface Database {
        query(): void
      }

      @loaded.Service()
      class DatabaseService implements Database, OnReady {
        query() {}
        onReady() {
          order.push('database')
        }
      }

      @loaded.Service()
      class ReminderScheduler implements OnReady {
        constructor(@loaded.inject(DatabaseService) readonly database: Database) {}
        onReady() {
          order.push('scheduler')
        }
      }

      // Listed after the scheduler, so only the injected token can put it first
      const { client } = await startApp(loaded, { controllers: [], services: [ReminderScheduler, DatabaseService] })
      await becomeReady(client)

      expect(order).toEqual(['database', 'scheduler'])
    })

    it('still runs a hook whose dependency failed, and says so', async () => {
      const loaded = await load()
      const ran: string[] = []

      @loaded.Service()
      class DatabaseService implements OnReady {
        onReady() {
          throw new Error('connection refused')
        }
      }

      @loaded.Service()
      class ReminderScheduler implements OnReady {
        constructor(readonly database: DatabaseService) {}
        onReady() {
          ran.push('scheduler')
        }
      }

      @loaded.Controller()
      class RemindController implements OnReady {
        constructor(readonly scheduler: ReminderScheduler) {}
        onReady() {
          ran.push('controller')
        }
      }

      const { client } = await startApp(loaded, { controllers: [RemindController], services: [ReminderScheduler] })
      await becomeReady(client)

      expect(ran).toEqual(['scheduler', 'controller'])
      expect(logged.error).toContainEqual(['onReady failed in DatabaseService:', new Error('connection refused')])
      const warnings = logged.warn.flat().join('\n')
      expect(warnings).toContain('Running onReady in ReminderScheduler although it depends on DatabaseService')
      expect(warnings).toContain('Running onReady in RemindController although it depends on DatabaseService')
    })

    it('warns about a hook that runs too long, naming it, and lets it finish', async () => {
      const loaded = await load()
      const ran: string[] = []

      @loaded.Service()
      class SlowCache implements OnReady {
        onReady() {
          return new Promise<void>(resolve => setTimeout(resolve, loaded.SLOW_READY_HOOK_MS + 5_000))
        }
      }

      @loaded.Service()
      class Later implements OnReady {
        onReady() {
          ran.push('later')
        }
      }

      const { client } = await startApp(loaded, { controllers: [], services: [SlowCache, Later] })
      vi.useFakeTimers()

      const ready = becomeReady(client)
      await vi.advanceTimersByTimeAsync(loaded.SLOW_READY_HOOK_MS)
      expect(logged.warn.flat().join(' ')).toContain('onReady in SlowCache has run for over')
      expect(ran).toEqual([])

      await vi.advanceTimersByTimeAsync(5_000)
      await ready
      expect(ran).toEqual(['later'])
    })

    it('runs without waiting for command registration, which never finishes here', async () => {
      const loaded = await load()
      const ready = Promise.withResolvers<void>()

      @loaded.Service()
      class Scheduler implements OnReady {
        onReady() {
          ready.resolve()
        }
      }

      const { client } = await startApp(loaded, { controllers: [], services: [Scheduler] })
      const put = registerThrough(client, () => new Promise(() => {}))

      void becomeReady(client)
      await ready.promise
      expect(put).toHaveBeenCalled()
    })

    it('still runs when command registration fails', async () => {
      const loaded = await load()
      let ready = false

      @loaded.Service()
      class Scheduler implements OnReady {
        onReady() {
          ready = true
        }
      }

      const { client } = await startApp(loaded, { controllers: [], services: [Scheduler] })
      const put = registerThrough(client, () => Promise.reject(new Error('registration failed')))

      await becomeReady(client)

      expect(put).toHaveBeenCalled()
      expect(ready).toBe(true)
    })
  })

  describe('shutdown', () => {
    it('runs onShutdown in reverse of the startup order, then destroys the client, then exits 0', async () => {
      const loaded = await load()
      const order: string[] = []

      @loaded.Service()
      class Scheduler implements OnShutdown {
        async onShutdown() {
          order.push('service')
        }
      }

      @loaded.Controller()
      class PingController implements OnShutdown {
        onShutdown() {
          order.push('controller')
        }
      }

      const { client } = await startApp(loaded, { controllers: [PingController], services: [Scheduler] })
      vi.mocked(client.destroy).mockImplementation(async () => {
        order.push('destroy')
      })
      await becomeReady(client)

      await loaded.shutdownAndExit(false)

      expect(order).toEqual(['controller', 'service', 'destroy'])
      expect(exit).toHaveBeenCalledWith(0)
    })

    // The close under way is the signal's to wait for, not a reason to exit at once
    it('lets a signal during app.stop() wait for the hooks still running, then exit', async () => {
      const loaded = await load()
      const events: string[] = []
      @loaded.Service()
      class Slow implements OnShutdown {
        async onShutdown() {
          await new Promise(resolve => setTimeout(resolve, 50))
          events.push('hook done')
        }
      }
      exit.mockImplementation((() => void events.push('exit')) as never)
      const { app, client } = await startApp(loaded, { controllers: [], services: [Slow] })
      await becomeReady(client)

      const stopped = app.stop()
      process.emit('SIGINT')
      await stopped
      await vi.waitFor(() => expect(events).toContain('exit'))

      expect(events).toEqual(['hook done', 'exit'])
    })

    it('runs on SIGINT and SIGTERM', async () => {
      for (const signal of ['SIGINT', 'SIGTERM'] as const) {
        const loaded = await load()
        let stopped = false

        @loaded.Service()
        class Scheduler implements OnShutdown {
          onShutdown() {
            stopped = true
          }
        }

        const { client } = await startApp(loaded, { controllers: [], services: [Scheduler] })
        await becomeReady(client)

        process.emit(signal)

        await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0))
        expect(stopped).toBe(true)
        exit.mockClear()
      }
    })

    // How meocord start --dev restarts the app on every platform: on Windows a signal ends it without its hooks
    it('runs on a stop from meocord start --dev', async () => {
      let devRunnerStop: (() => void) | undefined
      vi.doMock('@src/util/dev-runner.util.js', async importOriginal => ({
        ...(await importOriginal<object>()),
        onDevRunnerStop: (stop: () => void) => (devRunnerStop = stop),
      }))
      try {
        const loaded = await load()
        let stopped = false

        @loaded.Service()
        class Scheduler implements OnShutdown {
          onShutdown() {
            stopped = true
          }
        }

        const { client } = await startApp(loaded, { controllers: [], services: [Scheduler] })
        await becomeReady(client)

        devRunnerStop?.()

        await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0))
        expect(stopped).toBe(true)
      } finally {
        vi.doUnmock('@src/util/dev-runner.util.js')
      }
    })

    it('logs a hook that throws and still exits 0', async () => {
      const loaded = await load()

      @loaded.Service()
      class Broken implements OnShutdown {
        onShutdown() {
          throw new Error('flush failed')
        }
      }

      const { client } = await startApp(loaded, { controllers: [], services: [Broken] })
      await becomeReady(client)

      await loaded.shutdownAndExit(false)

      expect(logged.error).toContainEqual(['onShutdown failed in Broken:', new Error('flush failed')])
      expect(client.destroy).toHaveBeenCalled()
      expect(exit).toHaveBeenCalledWith(0)
    })

    it('stops waiting for hooks after the timeout and shuts down anyway', async () => {
      const loaded = await load()

      @loaded.Service()
      class Hanging implements OnShutdown {
        onShutdown() {
          return new Promise<void>(() => {})
        }
      }

      const { client } = await startApp(loaded, { controllers: [], services: [Hanging] })
      await becomeReady(client)
      vi.useFakeTimers()

      const done = loaded.shutdownAndExit(false)
      await vi.advanceTimersByTimeAsync(DEFAULT_SHUTDOWN_TIMEOUT_MS)
      await done

      expect(logged.warn.flat().join(' ')).toContain('did not finish')
      expect(client.destroy).toHaveBeenCalled()
      expect(exit).toHaveBeenCalledWith(0)
    })

    it('limits the whole sequence by the configured shutdownTimeout', async () => {
      const loaded = await load()
      config.shutdownTimeout = 500
      const stopped: string[] = []
      const stop = (name: string) => () =>
        new Promise<void>(resolve =>
          setTimeout(() => {
            stopped.push(name)
            resolve()
          }, 400),
        )

      @loaded.Service()
      class First implements OnShutdown {
        onShutdown = stop('first')
      }

      @loaded.Service()
      class Second implements OnShutdown {
        onShutdown = stop('second')
      }

      const { client } = await startApp(loaded, { controllers: [], services: [First, Second] })
      await becomeReady(client)
      vi.useFakeTimers()

      const done = loaded.shutdownAndExit(false)
      await vi.advanceTimersByTimeAsync(500)
      await done

      // Each hook takes 400 ms, within the limit alone; together they pass it
      expect(stopped).toEqual(['second'])
      expect(logged.warn.flat().join(' ')).toContain('did not finish within 500 ms')
      expect(client.destroy).toHaveBeenCalled()
      expect(exit).toHaveBeenCalledWith(0)
    })

    // `node dist/main.js` loads the config without the CLI's check, so the bot reads it through the same check
    it('waits the default for a shutdownTimeout the check refuses, and says so', async () => {
      const loaded = await load()
      config.shutdownTimeout = 2 ** 31

      @loaded.Service()
      class Stuck implements OnShutdown {
        onShutdown() {
          return new Promise<void>(() => {})
        }
      }

      const { client } = await startApp(loaded, { controllers: [], services: [Stuck] })
      await becomeReady(client)
      vi.useFakeTimers()
      const done = loaded.shutdownAndExit(false)
      await vi.advanceTimersByTimeAsync(DEFAULT_SHUTDOWN_TIMEOUT_MS)
      await done

      expect(logged.warn.flat()).toEqual([
        'shutdownTimeout must be a number of milliseconds 0 or more, at most 2147478647 (got 2147483648); shutdown waits the default 10000 ms.',
        `onShutdown hooks did not finish within ${DEFAULT_SHUTDOWN_TIMEOUT_MS} ms; shutting down anyway.`,
      ])
    })

    it('on a signal mid-ready, shuts down only classes whose onReady finished, and starts no more', async () => {
      const loaded = await load()
      const stopped: string[] = []
      const slowBegan = Promise.withResolvers<void>()
      const finishSlow = Promise.withResolvers<void>()

      @loaded.Service()
      class Cache implements OnReady, OnShutdown {
        onReady() {}
        onShutdown() {
          stopped.push('Cache')
        }
      }

      @loaded.Service()
      class Metrics implements OnShutdown {
        onShutdown() {
          stopped.push('Metrics')
        }
      }

      @loaded.Service()
      class Scheduler implements OnReady, OnShutdown {
        onReady() {
          slowBegan.resolve()
          return finishSlow.promise
        }
        onShutdown() {
          stopped.push('Scheduler')
        }
      }

      @loaded.Service()
      class Later implements OnReady, OnShutdown {
        onReady() {
          stopped.push('Later started')
        }
        onShutdown() {
          stopped.push('Later')
        }
      }

      const { client } = await startApp(loaded, { controllers: [], services: [Cache, Metrics, Scheduler, Later] })
      const ready = becomeReady(client)
      await slowBegan.promise

      await loaded.shutdownAndExit(false)
      finishSlow.resolve()
      await ready

      expect(stopped).toEqual(['Metrics', 'Cache'])
      expect(client.destroy).toHaveBeenCalled()
      expect(exit).toHaveBeenCalledWith(0)
    })

    it('runs no onShutdown when onReady never ran', async () => {
      const loaded = await load()
      let stopped = false

      @loaded.Service()
      class Scheduler implements OnShutdown {
        onShutdown() {
          stopped = true
        }
      }

      const { client } = await startApp(loaded, { controllers: [], services: [Scheduler] })

      await loaded.shutdownAndExit(false)

      expect(stopped).toBe(false)
      expect(client.destroy).toHaveBeenCalled()
      expect(exit).toHaveBeenCalledWith(0)
    })

    it('leaves an app whose login failed out of shutdown, and exits with the code the failed login set', async () => {
      const loaded = await load()
      vi.spyOn(loaded.discord.Client.prototype, 'login').mockRejectedValue(new Error('invalid token'))
      const destroy = vi.spyOn(loaded.discord.Client.prototype, 'destroy').mockResolvedValue(undefined)
      const exitCode = process.exitCode

      @loaded.MeoCord({ controllers: [], clientOptions: { intents: [] } })
      class App {}

      try {
        await expect(loaded.MeoCordFactory.create(App).start()).rejects.toThrow('invalid token')
        await loaded.shutdownAndExit(false)
      } finally {
        process.exitCode = exitCode
      }

      expect(destroy).not.toHaveBeenCalled()
      // A supervisor reads a clean exit as a clean stop, though the bot never came online
      expect(exit).toHaveBeenCalledWith(1)
    })

    it('exits 1 when the client fails to close', async () => {
      const loaded = await load()
      const { client } = await startApp(loaded, { controllers: [] })
      vi.mocked(client.destroy).mockRejectedValue(new Error('socket stuck'))

      await loaded.shutdownAndExit(false)

      expect(exit).toHaveBeenCalledWith(1)
    })

    describe('while shutdown is running', () => {
      async function hangingApp() {
        const loaded = await load()

        @loaded.Service()
        class Hanging implements OnShutdown {
          onShutdown() {
            return new Promise<void>(() => {})
          }
        }

        const { client } = await startApp(loaded, { controllers: [], services: [Hanging] })
        await becomeReady(client)
        return loaded
      }

      it('forces exit 1 on a signal repeated after the window', async () => {
        const loaded = await hangingApp()
        const now = vi.spyOn(Date, 'now').mockReturnValue(0)

        void loaded.shutdownAndExit(false)
        now.mockReturnValue(REPEAT_SIGNAL_WINDOW_MS)
        await loaded.shutdownAndExit(false)

        expect(exit).toHaveBeenCalledWith(1)
      })

      // The dev runner's stop, to restart the bot, is not the user's: their first Ctrl+C during it joins that shutdown
      it('joins a stop meocord start --dev asked for on the first signal, and forces exit 1 only on a repeat', async () => {
        let devRunnerStop: (() => void) | undefined
        vi.doMock('@src/util/dev-runner.util.js', async importOriginal => ({
          ...(await importOriginal<object>()),
          onDevRunnerStop: (stop: () => void) => (devRunnerStop = stop),
        }))
        try {
          const loaded = await hangingApp()
          const now = vi.spyOn(Date, 'now').mockReturnValue(0)

          devRunnerStop?.()
          now.mockReturnValue(REPEAT_SIGNAL_WINDOW_MS)
          void loaded.shutdownAndExit(false)
          await new Promise(resolve => setTimeout(resolve, 10))
          expect(exit).not.toHaveBeenCalled()

          now.mockReturnValue(2 * REPEAT_SIGNAL_WINDOW_MS)
          await loaded.shutdownAndExit(false)
          expect(exit).toHaveBeenCalledWith(1)
        } finally {
          vi.doUnmock('@src/util/dev-runner.util.js')
        }
      })

      // One Ctrl+C reaches the bot from the terminal and again from the CLI that runs it
      it('takes a copy of the signal within the window as the same request', async () => {
        const loaded = await hangingApp()
        const now = vi.spyOn(Date, 'now').mockReturnValue(0)

        void loaded.shutdownAndExit(false)
        now.mockReturnValue(REPEAT_SIGNAL_WINDOW_MS - 1)
        await loaded.shutdownAndExit(false)

        expect(exit).not.toHaveBeenCalled()
      })
    })
  })

  // A real client against a gateway that answers IDENTIFY late: discord.js's destroy() never settles in that window
  describe('a stop while the bot is logging in', () => {
    let fake: FakeDiscord

    beforeEach(async () => {
      fake = await startFakeDiscord({ readyDelayMs: 500 })
    })

    // Each test's client closes once its login completes; until it does, a client cut off by the close would reconnect,
    // and a later test's gateway on the same port, as Windows hands out, would take its session
    afterEach(async () => {
      await fake.waitFor('closed')
      await fake.close()
    })

    async function stoppedWhileLoggingIn() {
      const loaded = await load()
      const readyHooks: string[] = []

      @loaded.Service()
      class Scheduler implements OnReady {
        onReady() {
          readyHooks.push('scheduler')
        }
      }

      @loaded.MeoCord({ controllers: [], services: [Scheduler], clientOptions: { intents: [], rest: { api: fake.api } } })
      class App {}

      const login = vi.spyOn(loaded.discord.Client.prototype, 'login')
      const destroy = vi.spyOn(loaded.discord.Client.prototype, 'destroy')
      const outcome = loaded.MeoCordFactory.create(App)
        .start()
        .then(
          () => 'online',
          (error: Error) => error.message,
        )
      await fake.waitFor('identified')
      await loaded.shutdownAndExit(false)
      return { outcome, client: login.mock.contexts[0], destroy, readyHooks }
    }

    it('ends the start at once and exits 0, before the gateway is ready', async () => {
      const { outcome } = await stoppedWhileLoggingIn()

      expect(exit).toHaveBeenCalledWith(0)
      expect(await outcome).toBe('The bot was stopped before it came online.')
      expect(fake.events).not.toContain('ready')
    })

    it('says it shut down, as a stop once online does', async () => {
      await stoppedWhileLoggingIn()

      expect(logged.log.map(([message]) => message)).toEqual(
        expect.arrayContaining([
          'Shutting down bot...',
          'The bot was still logging in, so it stops without coming online',
          'Bot has shut down',
        ]),
      )
    })

    it('closes the client once its login completes, over its one gateway session, with no ready hook run', async () => {
      const { client, destroy, readyHooks } = await stoppedWhileLoggingIn()
      expect(destroy).not.toHaveBeenCalled()

      await fake.waitFor('closed')

      // The spy is on the prototype every client shares, so the check names the one this app made
      expect(destroy.mock.contexts).toEqual([client])
      expect(fake.events).toEqual(['connected', 'identified', 'ready', 'closed'])
      expect(readyHooks).toEqual([])
    })
  })

  describe('at the edges', () => {
    it('logs an onReady that throws something other than an Error, and runs the rest', async () => {
      const loaded = await load()
      const ran: string[] = []

      @loaded.Service()
      class Odd implements OnReady {
        onReady() {
          throw 'not an error'
        }
      }

      @loaded.Service()
      class After implements OnReady {
        onReady() {
          ran.push('after')
        }
      }

      const { client } = await startApp(loaded, { controllers: [], services: [Odd, After] })
      await becomeReady(client)

      expect(ran).toEqual(['after'])
      expect(logged.error.some(entry => entry.includes('not an error'))).toBe(true)
    })

    it('runs the hooks of a service two controllers inject once each', async () => {
      const loaded = await load()
      const calls: string[] = []

      @loaded.Service()
      class Shared implements OnReady, OnShutdown {
        onReady() {
          calls.push('ready')
        }
        onShutdown() {
          calls.push('shutdown')
        }
      }

      @loaded.Controller()
      class First {
        constructor(readonly shared: Shared) {}
      }

      @loaded.Controller()
      class Second {
        constructor(readonly shared: Shared) {}
      }

      const { client } = await startApp(loaded, { controllers: [First, Second] })
      await becomeReady(client)
      await loaded.shutdownAndExit(false)

      expect(calls).toEqual(['ready', 'shutdown'])
    })

    it('shuts down a class that has onShutdown but no onReady', async () => {
      const loaded = await load()
      let stopped = false

      @loaded.Service()
      class Flusher implements OnShutdown {
        onShutdown() {
          stopped = true
        }
      }

      const { client } = await startApp(loaded, { controllers: [], services: [Flusher] })
      await becomeReady(client)
      await loaded.shutdownAndExit(false)

      expect(stopped).toBe(true)
      expect(exit).toHaveBeenCalledWith(0)
    })

    it('waits for no hook with a shutdownTimeout of 0, and still destroys the client', async () => {
      vi.useFakeTimers()
      config.shutdownTimeout = 0
      const loaded = await load()

      @loaded.Service()
      class Hanging implements OnShutdown {
        onShutdown() {
          return new Promise<void>(() => {})
        }
      }

      const { client } = await startApp(loaded, { controllers: [], services: [Hanging] })
      await becomeReady(client)
      const done = loaded.shutdownAndExit(false)
      await vi.advanceTimersByTimeAsync(0)
      await done

      expect(client.destroy).toHaveBeenCalled()
      expect(logged.warn.some(entry => String(entry[0]).includes('within 0 ms'))).toBe(true)
      expect(exit).toHaveBeenCalledWith(0)
    })

    it('exits 0 on a signal when no app was started', async () => {
      const loaded = await load()

      await loaded.shutdownAndExit(false)

      expect(exit).toHaveBeenCalledWith(0)
    })
  })

  it('adds one pair of signal listeners however many apps start', async () => {
    const loaded = await load()
    const before = process.listenerCount('SIGINT')

    for (let i = 0; i < 12; i++) await startApp(loaded, { controllers: [] })

    expect(process.listenerCount('SIGINT')).toBe(before + 1)
    expect(process.listenerCount('SIGTERM')).toBe(signalListeners.SIGTERM.length + 1)
  })

  // MeoCord asks the store on every call with a cooldown, so it opens before the first and closes after the last
  describe('of a themeFor class', () => {
    it('runs onReady after the service it injects and onShutdown before it, and answers a call through that service', async () => {
      const loaded = await load()
      const events: string[] = []

      @loaded.Service()
      class Prefs implements OnReady, OnShutdown {
        onReady() {
          events.push('prefs ready')
        }
        onShutdown() {
          events.push('prefs shutdown')
        }
        colour(): `#${string}` {
          return '#0000D1'
        }
      }

      @loaded.Service()
      class PrefsThemes implements OnReady, OnShutdown {
        constructor(readonly prefs: Prefs) {}
        onReady() {
          events.push('themes ready')
        }
        onShutdown() {
          events.push('themes shutdown')
        }
        user() {
          events.push(`themes asked for ${this.prefs.colour()}`)
          return { colors: { primary: this.prefs.colour() } }
        }
      }
      Reflect.defineMetadata('design:paramtypes', [Prefs], PrefsThemes)

      @loaded.Controller()
      class Daily {
        @loaded.Command('daily', loaded.CommandType.SLASH)
        claim() {
          events.push('call runs')
        }
      }

      const { client } = await startApp(loaded, { controllers: [Daily], themeFor: PrefsThemes })
      await becomeReady(client)
      const interaction = loaded.createMockInteraction(loaded.discord.ChatInputCommandInteraction, { commandName: 'daily' })
      await Promise.all(client.listeners('interactionCreate').map(listener => listener(interaction)))
      await loaded.shutdownAndExit(false)

      expect(events).toEqual(['prefs ready', 'themes ready', 'themes asked for #0000D1', 'call runs', 'themes shutdown', 'prefs shutdown'])
    })
  })

  describe('of a cooldownStore class', () => {
    /** A store that records its hooks and calls in `events`, whose onReady resolves `began`, then waits for `connect`. */
    function storeWith(loaded: Loaded, events: string[], connect: Promise<void> = Promise.resolve(), began?: PromiseWithResolvers<void>) {
      return class AppStore extends loaded.MemoryCooldownStore implements OnReady, OnShutdown {
        async onReady() {
          events.push('store ready begins')
          began?.resolve()
          await connect
          events.push('store ready')
        }
        onShutdown() {
          events.push('store shutdown')
        }
        override consumeMany(...args: Parameters<InstanceType<typeof loaded.MemoryCooldownStore>['consumeMany']>) {
          events.push('store asked')
          return super.consumeMany(...args)
        }
      }
    }

    /** A controller whose slash command counts a cooldown, resolves `began` once it runs, then waits for `finish`. */
    function dailyController(loaded: Loaded, events: string[], finish: Promise<void> = Promise.resolve(), began?: PromiseWithResolvers<void>) {
      @loaded.Controller()
      class Daily {
        @loaded.Command('daily', loaded.CommandType.SLASH)
        @loaded.Cooldown({ seconds: 60 })
        async claim() {
          events.push('call runs')
          began?.resolve()
          await finish
          events.push('call done')
        }
      }
      return Daily
    }

    const slash = (loaded: Loaded) => loaded.createMockInteraction(loaded.discord.ChatInputCommandInteraction, { commandName: 'daily' })
    const call = (client: Client, interaction: unknown) =>
      Promise.all(client.listeners('interactionCreate').map(listener => listener(interaction)))

    it('runs its onReady before the services and its onShutdown after them', async () => {
      const loaded = await load()
      const events: string[] = []

      @loaded.Service()
      class Rewards implements OnReady, OnShutdown {
        onReady() {
          events.push('service ready')
        }
        onShutdown() {
          events.push('service shutdown')
        }
      }

      const { client } = await startApp(loaded, { controllers: [], services: [Rewards], cooldownStore: storeWith(loaded, events) })
      await becomeReady(client)
      await loaded.shutdownAndExit(false)

      expect(events).toEqual(['store ready begins', 'store ready', 'service ready', 'service shutdown', 'store shutdown'])
    })

    it('holds a call that comes while its onReady runs until the store is ready', async () => {
      const loaded = await load()
      const events: string[] = []
      const connect = Promise.withResolvers<void>()
      const began = Promise.withResolvers<void>()

      const { client } = await startApp(loaded, {
        controllers: [dailyController(loaded, events)],
        cooldownStore: storeWith(loaded, events, connect.promise, began),
      })
      const ready = becomeReady(client)
      await began.promise
      const handled = call(client, slash(loaded))
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(events).toEqual(['store ready begins'])

      connect.resolve()
      await Promise.all([ready, handled])

      expect(events).toEqual(['store ready begins', 'store ready', 'store asked', 'call runs', 'call done'])
    })

    // A store that takes longer to get ready than the timeout is one that does not answer, so the app's policy decides
    it.each([
      ['deny', 'refuses it with the store-down answer', [], true],
      ['allow', 'runs it uncounted', ['call runs', 'call done'], false],
    ] as const)("gives a call that outwaits its onReady the store-failure policy: '%s' %s", async (failure, _what, ran, told) => {
      const loaded = await load()
      const events: string[] = []
      const connect = Promise.withResolvers<void>()
      const began = Promise.withResolvers<void>()

      const { client } = await startApp(loaded, {
        controllers: [dailyController(loaded, events)],
        cooldownStore: storeWith(loaded, events, connect.promise, began),
        cooldownStoreTimeoutMs: 20,
        cooldownStoreFailure: failure,
      })
      const ready = becomeReady(client)
      await began.promise
      const interaction = slash(loaded)
      await call(client, interaction)

      expect(events).toEqual(['store ready begins', ...ran])
      expect(JSON.stringify(loaded.getResponse(interaction).calls).includes("Cooldowns can't be checked right now")).toBe(told)
      connect.resolve()
      await ready
    })

    it('runs its onShutdown once the calls under way have finished, and takes no new one', async () => {
      const loaded = await load()
      const events: string[] = []
      const finish = Promise.withResolvers<void>()
      const running = Promise.withResolvers<void>()

      const { client } = await startApp(loaded, {
        controllers: [dailyController(loaded, events, finish.promise, running)],
        cooldownStore: storeWith(loaded, events),
      })
      await becomeReady(client)
      const handled = call(client, slash(loaded))
      await running.promise

      const stopped = loaded.shutdownAndExit(false)
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(events).not.toContain('store shutdown')
      expect(client.listenerCount('interactionCreate')).toBe(0)

      finish.resolve()
      await Promise.all([handled, stopped])

      expect(events.slice(-2)).toEqual(['call done', 'store shutdown'])
    })

    // A class still starting when shutdown begins is skipped, as for a stop mid-ready, even if it finishes during the wait
    it('skips the onShutdown of a class whose onReady finishes while the calls under way are waited for', async () => {
      const loaded = await load()
      const events: string[] = []
      const finish = Promise.withResolvers<void>()
      const running = Promise.withResolvers<void>()
      const slowBegan = Promise.withResolvers<void>()
      const finishSlow = Promise.withResolvers<void>()

      @loaded.Service()
      class Scheduler implements OnReady, OnShutdown {
        onReady() {
          slowBegan.resolve()
          return finishSlow.promise
        }
        onShutdown() {
          events.push('scheduler shutdown')
        }
      }

      const { client } = await startApp(loaded, {
        controllers: [dailyController(loaded, events, finish.promise, running)],
        services: [Scheduler],
        cooldownStore: storeWith(loaded, events),
      })
      const ready = becomeReady(client)
      await slowBegan.promise
      const handled = call(client, slash(loaded))
      await running.promise

      const stopped = loaded.shutdownAndExit(false)
      finishSlow.resolve()
      await ready
      finish.resolve()
      await Promise.all([handled, stopped])

      expect(events).not.toContain('scheduler shutdown')
      expect(events.at(-1)).toBe('store shutdown')
    })

    // What the store injects is the store's to use until it stops, so it shuts down after the store and the last call
    it('runs the onShutdown of what it injects after its own, once the calls under way have finished', async () => {
      const loaded = await load()
      const events: string[] = []
      const finish = Promise.withResolvers<void>()
      const running = Promise.withResolvers<void>()

      @loaded.Service()
      class Queries implements OnShutdown {
        onShutdown() {
          events.push('queries shutdown')
        }
      }
      class QueryStore extends loaded.MemoryCooldownStore implements OnShutdown {
        constructor(@loaded.inject(Queries) readonly queries: Queries) {
          super()
        }
        onShutdown() {
          events.push('store shutdown')
        }
      }

      const { client } = await startApp(loaded, {
        controllers: [dailyController(loaded, events, finish.promise, running)],
        cooldownStore: QueryStore,
      })
      await becomeReady(client)
      const handled = call(client, slash(loaded))
      await running.promise

      const stopped = loaded.shutdownAndExit(false)
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(events).toEqual(['call runs'])

      finish.resolve()
      await Promise.all([handled, stopped])

      expect(events).toEqual(['call runs', 'call done', 'store shutdown', 'queries shutdown'])
    })

    // The store's side reaches through everything it injects, and takes a unit a service shares with it
    it.each([
      ['a chain of what it injects', 'chain', ['Other', 'store', 'A', 'B']],
      ['what it shares with a service', 'shared', ['S', 'store', 'Q']],
    ] as const)('shuts %s down after the store', async (_case, shape, expected) => {
      const loaded = await load()
      const events: string[] = []

      @loaded.Service()
      class B implements OnShutdown {
        onShutdown() {
          events.push('B')
        }
      }
      @loaded.Service()
      class A implements OnShutdown {
        constructor(@loaded.inject(B) readonly b: B) {}
        onShutdown() {
          events.push('A')
        }
      }
      @loaded.Service()
      class Other implements OnShutdown {
        onShutdown() {
          events.push('Other')
        }
      }
      @loaded.Service()
      class Q implements OnShutdown {
        onShutdown() {
          events.push('Q')
        }
      }
      @loaded.Service()
      class S implements OnShutdown {
        constructor(@loaded.inject(Q) readonly q: Q) {}
        onShutdown() {
          events.push('S')
        }
      }
      const injected = shape === 'chain' ? A : Q
      class SideStore extends loaded.MemoryCooldownStore implements OnShutdown {
        constructor(@loaded.inject(injected) readonly dependency: unknown) {
          super()
        }
        onShutdown() {
          events.push('store')
        }
      }

      const { client } = await startApp(loaded, { controllers: [], services: shape === 'chain' ? [Other] : [S], cooldownStore: SideStore })
      await becomeReady(client)
      await loaded.shutdownAndExit(false)

      expect(events).toEqual(expected)
    })

    // Injected by its token, the store is the one unit, whose hooks run once, last, after the calls under way
    it('runs its hooks once when a service injects CooldownStore, and shuts it down after the calls under way', async () => {
      const loaded = await load()
      const events: string[] = []
      const finish = Promise.withResolvers<void>()
      const running = Promise.withResolvers<void>()

      @loaded.Service()
      class Bonuses implements OnReady, OnShutdown {
        constructor(@loaded.inject(loaded.CooldownStore) readonly store: unknown) {}
        onReady() {
          events.push('service ready')
        }
        onShutdown() {
          events.push('service shutdown')
        }
      }

      const AppStore = storeWith(loaded, events)
      const { app, client } = await startApp(loaded, {
        controllers: [dailyController(loaded, events, finish.promise, running)],
        services: [Bonuses],
        cooldownStore: AppStore,
      })
      const container = Reflect.get(app, 'container') as { get(token: unknown): unknown }
      await becomeReady(client)
      const handled = call(client, slash(loaded))
      await running.promise
      const stopped = loaded.shutdownAndExit(false)
      await new Promise(resolve => setTimeout(resolve, 20))
      finish.resolve()
      await Promise.all([handled, stopped])

      expect((container.get(Bonuses) as Bonuses).store).toBeInstanceOf(AppStore)

      expect(events).toEqual([
        'store ready begins',
        'store ready',
        'service ready',
        'store asked',
        'call runs',
        'call done',
        'service shutdown',
        'store shutdown',
      ])
    })

    // An answer that comes after its call stopped waiting still writes to the store, so the store closes after it
    it('runs its onShutdown once a store answer its call stopped waiting for has come', async () => {
      const loaded = await load()
      const events: string[] = []
      const answer = Promise.withResolvers<void>()
      class SlowStore extends loaded.MemoryCooldownStore implements OnShutdown {
        onShutdown() {
          events.push('store shutdown')
        }
        override async consumeMany(...args: Parameters<InstanceType<typeof loaded.MemoryCooldownStore>['consumeMany']>) {
          await answer.promise
          events.push('store answered')
          return super.consumeMany(...args)
        }
      }

      const { client } = await startApp(loaded, {
        controllers: [dailyController(loaded, events)],
        cooldownStore: SlowStore,
        cooldownStoreTimeoutMs: 20,
      })
      await becomeReady(client)
      await call(client, slash(loaded))

      const stopped = loaded.shutdownAndExit(false)
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(events).not.toContain('store shutdown')

      answer.resolve()
      await stopped

      expect(events.slice(-2)).toEqual(['store answered', 'store shutdown'])
    })

    // Under 'deny' the late answer's count is given back, and that release is a store call of its own
    it('runs its onShutdown once a call it counted after the timeout has been given back', async () => {
      const loaded = await load()
      const events: string[] = []
      const answer = Promise.withResolvers<void>()
      class SlowStore extends loaded.MemoryCooldownStore implements OnShutdown {
        onShutdown() {
          events.push('store shutdown')
        }
        override async consumeMany(...args: Parameters<InstanceType<typeof loaded.MemoryCooldownStore>['consumeMany']>) {
          await answer.promise
          events.push('store answered')
          const verdict = await super.consumeMany(...args)
          const release = verdict.release!
          return Object.defineProperty(verdict, 'release', {
            value: async () => {
              await new Promise(resolve => setTimeout(resolve, 20))
              await release()
              events.push('store released')
            },
          })
        }
      }

      const { client } = await startApp(loaded, {
        controllers: [dailyController(loaded, events)],
        cooldownStore: SlowStore,
        cooldownStoreTimeoutMs: 20,
      })
      await becomeReady(client)
      await call(client, slash(loaded))

      const stopped = loaded.shutdownAndExit(false)
      await new Promise(resolve => setTimeout(resolve, 20))
      answer.resolve()
      await stopped

      expect(events.slice(-3)).toEqual(['store answered', 'store released', 'store shutdown'])
    })
  })
})
