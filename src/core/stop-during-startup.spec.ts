import { vi } from 'vitest'
import { type Client } from 'discord.js'
import type * as AppModule from '@src/core/meocord.app.js'
import type * as FactoryModule from '@src/core/meocord-factory.js'
import type * as DecoratorModule from '@src/decorator/index.js'
import { forgetProcessState } from '@src/core/process-state.js'

vi.mock('@src/common/index.js', async importOriginal => ({
  ...(await importOriginal<object>()),
  Logger: class {
    log = vi.fn()
    debug = vi.fn()
    info = vi.fn()
    verbose = vi.fn()
    warn = vi.fn()
    error = vi.fn()
  },
}))
vi.mock('@src/util/meocord-config-loader.util.js', () => ({ loadMeoCordConfig: () => ({ discordToken: 'token' }) }))
vi.mock('@src/util/platform.util.js', () => ({ assertBuiltForThisPlatform: () => {} }))

/** Fresh modules and a forgotten shutdown per test, as a new process has: the running apps and the shutdown are process-wide. */
async function load() {
  vi.resetModules()
  forgetProcessState()
  const discord = await import('discord.js')
  const app: typeof AppModule = await import('@src/core/meocord.app.js')
  const factory: typeof FactoryModule = await import('@src/core/meocord-factory.js')
  const decorators: typeof DecoratorModule = await import('@src/decorator/index.js')
  return { discord, ...app, ...factory, ...decorators }
}

type Loaded = Awaited<ReturnType<typeof load>>

/** Logs each client in as `logins` says for its attempt, at once by default. */
function gateway(loaded: Loaded, logins: (() => Promise<string>)[] = []) {
  const clients: Client[] = []
  vi.spyOn(loaded.discord.Client.prototype, 'login').mockImplementation(function (this: Client) {
    clients.push(this)
    return (logins[clients.length - 1] ?? (() => Promise.resolve('token')))()
  })
  vi.spyOn(loaded.discord.Client.prototype, 'destroy').mockResolvedValue(undefined)
  return clients
}

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

describe('a stop while the bot starts', () => {
  const exitCode = process.exitCode
  const log: string[] = []
  let signalListeners: NodeJS.SignalsListener[]

  // The first import transforms the modules, which a cold run would otherwise count against the first case
  beforeAll(() => load())

  beforeEach(() => {
    log.length = 0
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    signalListeners = process.listeners('SIGINT') as NodeJS.SignalsListener[]
  })
  afterEach(() => {
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      for (const listener of process.listeners(signal)) {
        if (!signalListeners.includes(listener as NodeJS.SignalsListener)) process.off(signal, listener)
      }
    }
    process.exitCode = exitCode
    vi.restoreAllMocks()
  })

  /** A provided value that says when it is made and closed, as a connection pool's would. */
  const pool = (name: string, made: () => Promise<void> = async () => {}) => ({
    provide: name,
    useFactory: async () => {
      await made()
      log.push(`${name} opened`)
      return { onShutdown: () => void log.push(`${name} closed`) }
    },
  })

  it("closes the values the startup made, the pending factory's once it settles, when a stop comes during a factory", async () => {
    const loaded = await load()
    gateway(loaded)
    @loaded.MeoCord({ controllers: [], providers: [pool('POOL'), pool('SLOW', () => delay(300))], clientOptions: { intents: [] } })
    class App {}
    const app = loaded.MeoCordFactory.create(App)
    const starting = app.start().catch((error: Error) => log.push(`start rejected: ${error.message}`))

    await delay(100)
    await app.stop()
    await starting

    expect(log).toEqual(['POOL opened', 'SLOW opened', 'SLOW closed', 'POOL closed', 'start rejected: The bot was stopped before it came online.'])
  })

  it('closes what the startup made after the classes that inject it, when a Ctrl+C comes during the login', async () => {
    const loaded = await load()
    let loggingIn!: () => void
    const reachedLogin = new Promise<void>(resolve => (loggingIn = resolve))
    gateway(loaded, [
      () => {
        loggingIn()
        return new Promise<string>(() => {})
      },
    ])
    @loaded.Service()
    class Repository {
      constructor(@loaded.Inject('POOL') readonly pool: object) {}
      onShutdown() {
        log.push('Repository closed')
      }
    }
    @loaded.MeoCord({ controllers: [], services: [Repository], providers: [pool('POOL')], clientOptions: { intents: [] } })
    class App {}
    const starting = loaded.MeoCordFactory.create(App).start().catch(() => undefined)
    await reachedLogin

    process.emit('SIGINT')
    await starting
    await vi.waitFor(() => expect(process.exit).toHaveBeenCalled())

    expect(log).toEqual(['POOL opened', 'Repository closed', 'POOL closed'])
  })

  it('closes a value the ready hooks had not reached, and the class whose onReady it waited for, when a stop comes during it', async () => {
    const loaded = await load()
    const clients = gateway(loaded)
    const warming = Promise.withResolvers<void>()
    @loaded.Service()
    class Warmup {
      onReady() {
        log.push('Warmup ready')
        return warming.promise
      }
      onShutdown() {
        log.push('Warmup closed')
      }
    }
    @loaded.MeoCord({
      controllers: [],
      services: [Warmup],
      providers: [{ provide: 'POOL', inject: [Warmup], useFactory: () => ({ onShutdown: () => void log.push('POOL closed') }) }],
      clientOptions: { intents: [] },
    })
    class App {}
    const app = loaded.MeoCordFactory.create(App)
    await app.start()
    const ready = clients[0].listeners('clientReady')[0](clients[0])
    await vi.waitFor(() => expect(log).toEqual(['Warmup ready']))

    const stopped = app.stop()
    warming.resolve()
    await Promise.all([stopped, ready])

    expect(log).toEqual(['Warmup ready', 'POOL closed', 'Warmup closed'])
  })
})

// The order is the code's, not the runtime's promise timing: each onShutdown takes a timer's turn to close
describe('a start a stop ends', () => {
  const exitCode = process.exitCode
  const log: string[] = []

  beforeEach(() => {
    log.length = 0
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
  })
  afterEach(() => {
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.removeAllListeners(signal)
    process.exitCode = exitCode
    vi.restoreAllMocks()
  })

  /** A provided value that says when it is made and when its onShutdown begins and ends, a timer's turn apart. */
  const pool = (name: string, made: () => Promise<void> = async () => {}, closing = 0) => ({
    provide: name,
    useFactory: async () => {
      await made()
      log.push(`${name} opened`)
      return {
        onShutdown: async () => {
          log.push(`${name} closing`)
          await delay(closing)
          log.push(`${name} closed`)
        },
      }
    },
  })

  /** Starts an app of `providers`, stops it once `stopWhen` settles, and logs when the start and the stop settle. */
  async function startThenStop(loaded: Loaded, providers: object[], stopWhen: Promise<void>) {
    @loaded.MeoCord({ controllers: [], providers, clientOptions: { intents: [] } } as never)
    class App {}
    const app = loaded.MeoCordFactory.create(App)
    const starting = app.start().then(
      () => log.push('start resolved'),
      (error: Error) => log.push(`start rejected: ${error.message}`),
    )
    await stopWhen
    const stopping = app.stop().then(() => log.push('stop resolved'))
    await Promise.all([starting, stopping])
  }

  it('rejects the start once the onShutdown hooks of what it made have run, without waiting for the client, and the stop resolves after it, when the stop comes during a factory', async () => {
    const loaded = await load()
    gateway(loaded)
    vi.spyOn(loaded.discord.Client.prototype, 'destroy').mockImplementation(async () => {
      await delay(20)
      log.push('client destroyed')
    })

    await startThenStop(loaded, [pool('POOL'), pool('SLOW', () => delay(100))], delay(30))

    expect(log).toEqual([
      'POOL opened',
      'SLOW opened',
      'SLOW closing',
      'SLOW closed',
      'POOL closing',
      'POOL closed',
      'start rejected: The bot was stopped before it came online.',
      'client destroyed',
      'stop resolved',
    ])
  })

  it('rejects the start once the onShutdown hooks of what it made have run, and the stop resolves after it, when the stop comes during the login', async () => {
    const loaded = await load()
    const reachedLogin = Promise.withResolvers<void>()
    gateway(loaded, [
      () => {
        reachedLogin.resolve()
        return new Promise<string>(() => {})
      },
    ])

    await startThenStop(loaded, [pool('POOL')], reachedLogin.promise)

    expect(log).toEqual(['POOL opened', 'POOL closing', 'POOL closed', 'start rejected: The bot was stopped before it came online.', 'stop resolved'])
  })

  it('rejects with the factory error once the onShutdown hooks have run, and the stop resolves after it, when the factory the stop waits for fails', async () => {
    const loaded = await load()
    gateway(loaded)
    const failing = async () => {
      await delay(100)
      throw new Error('connection refused')
    }

    await startThenStop(loaded, [pool('POOL'), pool('SLOW', failing)], delay(30))

    expect(log).toEqual([
      'POOL opened',
      'POOL closing',
      'POOL closed',
      "start rejected: The factory providing 'SLOW' failed: connection refused",
      'stop resolved',
    ])
  })

  it('rejects the start before the stop settles, when the stop fails before the onShutdown hooks run', async () => {
    const loaded = await load()
    gateway(loaded)
    vi.spyOn(loaded.discord.Client.prototype, 'removeAllListeners').mockImplementation(() => {
      throw new Error('stuck')
    })
    @loaded.MeoCord({ controllers: [], providers: [pool('POOL'), pool('SLOW', () => delay(100))], clientOptions: { intents: [] } })
    class App {}
    const app = loaded.MeoCordFactory.create(App)
    const starting = app.start().catch((error: Error) => log.push(`start rejected: ${error.message}`))
    await delay(30)
    // Whether the stop then resolves or rejects is the stop's own matter
    const settled = () => void log.push('stop settled')
    const stopping = app.stop().then(settled, settled)
    await Promise.all([starting, stopping])

    expect(log).toEqual(['POOL opened', 'SLOW opened', 'start rejected: The bot was stopped before it came online.', 'stop settled'])
  })

  it('rejects a failed start once its own shutdown is done, and the stop that joins it resolves after it', async () => {
    const loaded = await load()
    gateway(loaded)
    const failing = async () => {
      await delay(50)
      throw new Error('connection refused')
    }

    // The stop comes while the failed start is still closing POOL
    await startThenStop(loaded, [pool('POOL', undefined, 100), pool('SLOW', failing)], delay(90))

    expect(log).toEqual([
      'POOL opened',
      'POOL closing',
      'POOL closed',
      "start rejected: The factory providing 'SLOW' failed: connection refused",
      'stop resolved',
    ])
  })
  describe('with nothing between the stop and what ends the start', () => {
    /** Starts an app of `providers`, logging when the start settles, and the app to stop. */
    function startApp(loaded: Loaded, providers: object[]) {
      @loaded.MeoCord({ controllers: [], providers, clientOptions: { intents: [] } } as never)
      class App {}
      const app = loaded.MeoCordFactory.create(App)
      const starting = app.start().then(
        () => log.push('start resolved'),
        (error: Error) => log.push(`start rejected: ${error.message}`),
      )
      return { app, starting }
    }

    /** A provided value whose factory waits for `made`, which says when the factory is reached. */
    const held = (made: PromiseWithResolvers<void>, reached: PromiseWithResolvers<void>) => ({
      provide: 'SLOW',
      useFactory: async () => {
        reached.resolve()
        await made.promise
        return {}
      },
    })

    it.each([
      ['finishes', 'The bot was stopped before it came online.'],
      ['fails', "The factory providing 'SLOW' failed: connection refused"],
    ])('rejects the start before the stop resolves, when the factory the stop waits for %s as the stop begins', async (how, message) => {
      const loaded = await load()
      gateway(loaded)
      const made = Promise.withResolvers<void>()
      const reached = Promise.withResolvers<void>()
      const { app, starting } = startApp(loaded, [held(made, reached)])
      await reached.promise

      const stopping = app.stop().then(() => log.push('stop resolved'))
      if (how === 'finishes') made.resolve()
      else made.reject(new Error('connection refused'))
      await Promise.all([starting, stopping])

      expect(log).toEqual([`start rejected: ${message}`, 'stop resolved'])
    })

    it('rejects the start before the stop resolves, when the stop ends the login', async () => {
      const loaded = await load()
      const reachedLogin = Promise.withResolvers<void>()
      gateway(loaded, [
        () => {
          reachedLogin.resolve()
          return new Promise<string>(() => {})
        },
      ])
      const { app, starting } = startApp(loaded, [])
      await reachedLogin.promise

      const stopping = app.stop().then(() => log.push('stop resolved'))
      await Promise.all([starting, stopping])

      expect(log).toEqual(['start rejected: The bot was stopped before it came online.', 'stop resolved'])
    })

    it('rejects the start before the stop settles, when the stop fails before the onShutdown hooks run', async () => {
      const loaded = await load()
      gateway(loaded)
      vi.spyOn(loaded.discord.Client.prototype, 'removeAllListeners').mockImplementation(() => {
        throw new Error('stuck')
      })
      const made = Promise.withResolvers<void>()
      const reached = Promise.withResolvers<void>()
      const { app, starting } = startApp(loaded, [held(made, reached)])
      await reached.promise

      const settled = () => void log.push('stop settled')
      const stopping = app.stop().then(settled, settled)
      made.resolve()
      await Promise.all([starting, stopping])

      expect(log).toEqual(['start rejected: The bot was stopped before it came online.', 'stop settled'])
    })

    it.each([
      ['the login', 'The bot was stopped before it came online.'],
      ['a factory that fails', "The factory providing 'SLOW' failed: connection refused"],
      ['a failed start', "The factory providing 'SLOW' failed: connection refused"],
    ])('rejects the start %s leaves, and settles the stop, when the stop fails as it runs the onShutdown hooks', async (what, message) => {
      const loaded = await load()
      const reachedLogin = Promise.withResolvers<void>()
      gateway(loaded, [
        () => {
          reachedLogin.resolve()
          return what === 'the login' ? new Promise<string>(() => {}) : Promise.resolve('token')
        },
      ])
      // The stop's drain removes the listeners as the hooks begin, and fails there; a login the stop ends first lets
      // the stop remove them once on its own
      const removed = vi.spyOn(loaded.discord.Client.prototype, 'removeAllListeners')
      const removals = what === 'the login' ? 1 : 0
      removed.mockImplementation(function (this: Client) {
        if (removed.mock.calls.length > removals) throw new Error('stuck')
        return this
      })
      const settled = () => void log.push('stop settled')
      let stopping: Promise<unknown> | undefined
      /** The app an onShutdown hook stops, once it is made. */
      const target: { app?: { stop(): Promise<void> } } = {}
      const made = Promise.withResolvers<void>()
      const reached = Promise.withResolvers<void>()
      const providers =
        what === 'the login'
          ? []
          : what === 'a factory that fails'
            ? [held(made, reached)]
            : [
                { provide: 'POOL', useFactory: async () => ({ onShutdown: () => void (stopping = target.app!.stop().then(settled, settled)) }) },
                {
                  provide: 'SLOW',
                  inject: ['POOL'],
                  useFactory: async () => {
                    throw new Error('connection refused')
                  },
                },
              ]
      const started = startApp(loaded, providers)
      target.app = started.app
      if (what === 'the login') {
        await reachedLogin.promise
        stopping = started.app.stop().then(settled, settled)
      } else if (what === 'a factory that fails') {
        await reached.promise
        stopping = started.app.stop().then(settled, settled)
        made.reject(new Error('connection refused'))
      }
      await started.starting
      await stopping

      // A failed start's stop comes from its own onShutdown hook, for which stop() goes on at once
      expect(log).toEqual(what === 'a failed start' ? ['stop settled', `start rejected: ${message}`] : [`start rejected: ${message}`, 'stop settled'])
    })

    /** Settles after `count` microtasks. */
    const ticks = async (count: number) => {
      for (let i = 0; i < count; i++) await undefined
    }
    /** Microtask counts that span the turns between a failure and the failed start's catch. */
    const GAP_TICKS = [0, 1, 2, 3, 4, 5, 6, 8]

    it.each(GAP_TICKS)('rejects a start that fails in a factory before a stop that comes %i microtasks after the failure resolves', async count => {
      const loaded = await load()
      gateway(loaded)
      const target: { app?: { stop(): Promise<void> } } = {}
      let stopping: Promise<unknown> | undefined
      const started = startApp(loaded, [
        {
          provide: 'SLOW',
          useFactory: async () => {
            void ticks(count).then(() => (stopping = target.app!.stop().then(() => log.push('stop resolved'))))
            throw new Error('connection refused')
          },
        },
      ])
      target.app = started.app
      await started.starting
      await stopping

      expect(log).toEqual(["start rejected: The factory providing 'SLOW' failed: connection refused", 'stop resolved'])
    })

    it.each(GAP_TICKS)('rejects a start whose login fails before a stop that comes %i microtasks after the failure resolves', async count => {
      const loaded = await load()
      const target: { app?: { stop(): Promise<void> } } = {}
      let stopping: Promise<unknown> | undefined
      gateway(loaded, [
        () => {
          void ticks(count).then(() => (stopping = target.app!.stop().then(() => log.push('stop resolved'))))
          return Promise.reject(new Error('gateway unreachable (stand-in)'))
        },
      ])
      const started = startApp(loaded, [])
      target.app = started.app
      await started.starting
      await stopping

      expect(log).toEqual(['start rejected: gateway unreachable (stand-in)', 'stop resolved'])
    })

    it("closes a failed start's values before what the app gave them, when a stop its shutdown calls joins it", async () => {
      const loaded = await load()
      gateway(loaded)
      const target: { app?: { stop(): Promise<void> } } = {}
      let stopping: Promise<unknown> | undefined
      const started = startApp(loaded, [
        { provide: 'POOL', useValue: { onShutdown: () => void log.push('POOL closed') } },
        {
          provide: 'CACHE',
          inject: ['POOL'],
          useFactory: async () => ({
            // Stops the app as the failed start's shutdown begins, then closes a timer's turn later
            onShutdown: async () => {
              stopping = target.app!.stop().then(() => log.push('stop resolved'))
              await delay(0)
              log.push('CACHE closed')
            },
          }),
        },
        {
          provide: 'SLOW',
          inject: ['CACHE'],
          useFactory: async () => {
            throw new Error('connection refused')
          },
        },
      ])
      target.app = started.app
      await started.starting
      await stopping

      // The hook's stop() goes on at once; the close it began joins the failed start's shutdown
      expect(log).toEqual(['stop resolved', 'CACHE closed', 'POOL closed', "start rejected: The factory providing 'SLOW' failed: connection refused"])
    })

    it('rejects a failed start once its shutdown is done, when a hook of it stops the app as it begins', async () => {
      const loaded = await load()
      gateway(loaded)
      let stopping: Promise<unknown> | undefined
      /** The app an onShutdown hook stops, once it is made. */
      const target: { app?: { stop(): Promise<void> } } = {}
      const { app: made, starting } = startApp(loaded, [
        // Stops the app from inside the failed start's shutdown, so the stop joins it with nothing between
        { provide: 'POOL', useFactory: async () => ({ onShutdown: () => void (stopping = target.app!.stop().then(() => log.push('stop resolved'))) }) },
        {
          provide: 'SLOW',
          inject: ['POOL'],
          useFactory: async () => {
            throw new Error('connection refused')
          },
        },
      ])
      target.app = made
      await starting
      await stopping

      // The hook's stop() goes on at once, as the shutdown it asks for is the one running the hook
      expect(log).toEqual(['stop resolved', "start rejected: The factory providing 'SLOW' failed: connection refused"])
    })
  })
})

describe('a start that fails', () => {
  const exitCode = process.exitCode
  const log: string[] = []
  let signalListeners: NodeJS.SignalsListener[]

  beforeEach(() => {
    log.length = 0
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    signalListeners = process.listeners('SIGINT') as NodeJS.SignalsListener[]
  })
  afterEach(() => {
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      for (const listener of process.listeners(signal)) {
        if (!signalListeners.includes(listener as NodeJS.SignalsListener)) process.off(signal, listener)
      }
    }
    process.exitCode = exitCode
    vi.restoreAllMocks()
  })

  /** An app whose pool is numbered as it is made, and whose cache's factory fails on the attempts listed. */
  function appWithPool(loaded: Loaded, cacheFailsOn: number[]) {
    let pools = 0
    let caches = 0
    @loaded.MeoCord({
      controllers: [],
      providers: [
        {
          provide: 'POOL',
          useFactory: async () => {
            const n = ++pools
            log.push(`pool ${n} opened`)
            return { onShutdown: () => void log.push(`pool ${n} closed`) }
          },
        },
        {
          provide: 'CACHE',
          inject: ['POOL'],
          useFactory: async () => {
            if (cacheFailsOn.includes(++caches)) throw new Error('cache unreachable')
            return {}
          },
        },
      ],
      clientOptions: { intents: [] },
    })
    class App {}
    return loaded.MeoCordFactory.create(App)
  }

  it("closes what a failed factory's start made, and a retry that comes online makes it afresh", async () => {
    const loaded = await load()
    gateway(loaded)
    const app = appWithPool(loaded, [1])

    await expect(app.start()).rejects.toThrow('cache unreachable')
    expect(log).toEqual(['pool 1 opened', 'pool 1 closed'])
    await app.start()
    await app.stop()

    expect(log).toEqual(['pool 1 opened', 'pool 1 closed', 'pool 2 opened', 'pool 2 closed'])
  })

  it('leaves a value the app gave as it is open, for the retry, and closes it once when the bot stops', async () => {
    const loaded = await load()
    gateway(loaded)
    let caches = 0
    const given = { closed: 0, onShutdown: () => void given.closed++ }
    @loaded.MeoCord({
      controllers: [],
      providers: [
        { provide: 'POOL', useValue: given },
        {
          provide: 'CACHE',
          inject: ['POOL'],
          useFactory: async () => {
            if (++caches === 1) throw new Error('cache unreachable')
            return {}
          },
        },
      ],
      clientOptions: { intents: [] },
    })
    class App {}
    const app = loaded.MeoCordFactory.create(App)

    await expect(app.start()).rejects.toThrow('cache unreachable')
    expect(given.closed).toBe(0)
    await app.start()
    await app.stop()

    expect(given.closed).toBe(1)
  })

  it.each([
    ['a factory', [] as (() => Promise<string>)[], [1]],
    ['the login', [() => Promise.reject(new Error('gateway unreachable (stand-in)'))], []],
  ])('closes a value the app gave once at a stop after %s failed, with no retry', async (_what, logins, cacheFailsOn) => {
    const loaded = await load()
    gateway(loaded, logins)
    let caches = 0
    const given = { closed: 0, onShutdown: () => void given.closed++ }
    @loaded.MeoCord({
      controllers: [],
      providers: [
        { provide: 'POOL', useValue: given },
        {
          provide: 'CACHE',
          inject: ['POOL'],
          useFactory: async () => {
            if (cacheFailsOn.includes(++caches)) throw new Error('cache unreachable')
            return {}
          },
        },
      ],
      clientOptions: { intents: [] },
    })
    class App {}
    const app = loaded.MeoCordFactory.create(App)

    await expect(app.start()).rejects.toThrow()
    expect(given.closed).toBe(0)
    await app.stop()

    expect(given.closed).toBe(1)
  })

  it("runs each class's onReady and onShutdown once after a failed login and a retry that comes online", async () => {
    const loaded = await load()
    const clients = gateway(loaded, [() => Promise.reject(new Error('gateway unreachable (stand-in)'))])
    let made = 0
    @loaded.Service()
    class Scheduler {
      readonly n = ++made
      onReady() {
        log.push(`scheduler ${this.n} ready`)
      }
      onShutdown() {
        log.push(`scheduler ${this.n} closed`)
      }
    }
    @loaded.MeoCord({ controllers: [], services: [Scheduler], clientOptions: { intents: [] } })
    class App {}
    const app = loaded.MeoCordFactory.create(App)

    await expect(app.start()).rejects.toThrow('gateway unreachable')
    await app.start()
    for (const listener of clients[0].listeners('clientReady')) await listener(clients[0])
    await app.stop()

    expect(log).toEqual(['scheduler 2 ready', 'scheduler 2 closed'])
  })

  it("closes what a failed login's start made, and a retry that comes online makes it afresh", async () => {
    const loaded = await load()
    gateway(loaded, [() => Promise.reject(new Error('gateway unreachable (stand-in)'))])
    const app = appWithPool(loaded, [])

    await expect(app.start()).rejects.toThrow('gateway unreachable')
    expect(log).toEqual(['pool 1 opened', 'pool 1 closed'])
    await app.start()
    await app.stop()

    expect(log).toEqual(['pool 1 opened', 'pool 1 closed', 'pool 2 opened', 'pool 2 closed'])
  })
})
