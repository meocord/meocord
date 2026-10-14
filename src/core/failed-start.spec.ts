import { vi } from 'vitest'
import { type Client } from 'discord.js'
import type * as AppModule from '@src/core/meocord.app.js'
import type * as FactoryModule from '@src/core/meocord-factory.js'
import type * as DecoratorModule from '@src/decorator/index.js'
import { forgetProcessState } from '@src/core/process-state.js'
import { WARM_UP_TIMEOUT_MS } from '@src/spec-timeouts.js'

const { logged } = vi.hoisted(() => ({ logged: { log: [] as unknown[][], error: [] as unknown[][] } }))

vi.mock('@src/common/index.js', async importOriginal => ({
  ...(await importOriginal<object>()),
  Logger: class {
    log = (...args: unknown[]) => logged.log.push(args)
    debug = vi.fn()
    info = vi.fn()
    verbose = vi.fn()
    warn = vi.fn()
    error = (...args: unknown[]) => logged.error.push(args)
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

/** Logs each client in as `logins` says for its attempt, counting the clients destroyed. */
function gateway(loaded: Loaded, logins: (() => Promise<string>)[]) {
  const clients: Client[] = []
  vi.spyOn(loaded.discord.Client.prototype, 'login').mockImplementation(function (this: Client) {
    clients.push(this)
    return (logins[clients.length - 1] ?? (() => Promise.resolve('token')))()
  })
  const destroy = vi.spyOn(loaded.discord.Client.prototype, 'destroy').mockResolvedValue(undefined)
  return { clients, destroy }
}

/** An app whose provider's factory fails on the attempts listed, and gives a value otherwise. */
function appWithFactory(loaded: Loaded, failOn: number[]) {
  let attempts = 0
  @loaded.MeoCord({
    controllers: [],
    providers: [
      {
        provide: 'CACHE',
        useFactory: async () => {
          if (failOn.includes(++attempts)) throw new Error('cache unreachable')
          return {}
        },
      },
    ],
    clientOptions: { intents: [] },
  })
  class FactoryApp {}
  return loaded.MeoCordFactory.create(FactoryApp)
}

function onlineApp(loaded: Loaded) {
  @loaded.MeoCord({ controllers: [], clientOptions: { intents: [] } })
  class OnlineApp {}
  return loaded.MeoCordFactory.create(OnlineApp)
}

const shutdownLines = () => logged.log.flat().filter(line => line === 'Shutting down bot...' || line === 'Bot has shut down')

describe('a start that failed', () => {
  const exitCode = process.exitCode
  let exit: ReturnType<typeof vi.spyOn>
  let signalListeners: NodeJS.SignalsListener[]

  // The first import transforms the modules, which a cold run would otherwise count against the first case
  beforeAll(() => load(), WARM_UP_TIMEOUT_MS)

  beforeEach(() => {
    logged.log.length = 0
    logged.error.length = 0
    exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
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

  it("is not shut down by a later signal when a provider's factory failed", async () => {
    const loaded = await load()
    const { destroy } = gateway(loaded, [])
    const app = appWithFactory(loaded, [1])
    await expect(app.start()).rejects.toThrow('cache unreachable')

    process.emit('SIGINT')
    await vi.waitFor(() => expect(exit).toHaveBeenCalled())

    expect(shutdownLines()).toEqual([])
    expect(destroy).not.toHaveBeenCalled()
  })

  it('leaves a signal to shut down only the app that is online', async () => {
    const loaded = await load()
    const { destroy } = gateway(loaded, [])
    const failed = appWithFactory(loaded, [1])
    await expect(failed.start()).rejects.toThrow('cache unreachable')
    await onlineApp(loaded).start()

    process.emit('SIGINT')
    await vi.waitFor(() => expect(exit).toHaveBeenCalled())

    expect(shutdownLines()).toEqual(['Shutting down bot...', 'Bot has shut down'])
    expect(destroy).toHaveBeenCalledOnce()
  })

  it("stops a retry after a provider's factory failed, when a signal comes during its login", async () => {
    const loaded = await load()
    let loggingIn!: () => void
    const reachedLogin = new Promise<void>(resolve => (loggingIn = resolve))
    gateway(loaded, [
      () => {
        loggingIn()
        return new Promise<string>(() => {})
      },
    ])
    const app = appWithFactory(loaded, [1])
    await expect(app.start()).rejects.toThrow('cache unreachable')

    const retry = app.start()
    await reachedLogin
    process.emit('SIGINT')

    await expect(retry).rejects.toThrow('The bot was stopped before it came online.')
    await vi.waitFor(() => expect(exit).toHaveBeenCalled())
    expect(shutdownLines()).toEqual(['Shutting down bot...', 'Bot has shut down'])
  })

  it('stays among the running apps when a stop ended it, until its close settles', async () => {
    const loaded = await load()
    const { destroy } = gateway(loaded, [])
    let closed!: () => void
    destroy.mockReturnValue(new Promise<void>(resolve => (closed = resolve)))
    let made!: () => void
    @loaded.MeoCord({
      controllers: [],
      providers: [{ provide: 'CACHE', useFactory: () => new Promise(resolve => (made = () => resolve({}))) }],
      clientOptions: { intents: [] },
    })
    class SlowApp {}
    const app = loaded.MeoCordFactory.create(SlowApp)
    const start = app.start()
    await vi.waitFor(() => expect(made).toBeTypeOf('function'))

    const stopped = app.stop()
    made()
    await expect(start).rejects.toThrow('The bot was stopped before it came online.')
    await vi.waitFor(() => expect(destroy).toHaveBeenCalled())
    process.emit('SIGINT')
    await new Promise(resolve => setTimeout(resolve, 20))

    expect(exit).not.toHaveBeenCalled()
    closed()
    await stopped
    await vi.waitFor(() => expect(exit).toHaveBeenCalled())
  })

  it('is not shut down by a later signal when its login failed', async () => {
    const loaded = await load()
    const { destroy } = gateway(loaded, [() => Promise.reject(new Error('gateway unreachable (stand-in)'))])
    await expect(onlineApp(loaded).start()).rejects.toThrow('gateway unreachable')

    process.emit('SIGINT')
    await vi.waitFor(() => expect(exit).toHaveBeenCalled())

    expect(shutdownLines()).toEqual([])
    expect(destroy).not.toHaveBeenCalled()
  })
})
