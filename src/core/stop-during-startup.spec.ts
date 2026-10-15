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
