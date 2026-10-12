import { vi } from 'vitest'
import { type Client } from 'discord.js'
import type * as AppModule from '@src/core/meocord.app.js'
import type * as FactoryModule from '@src/core/meocord-factory.js'
import type * as DecoratorModule from '@src/decorator/index.js'
import { forgetProcessState } from '@src/core/meocord.app.js'

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

/** Logs in at once, or holds the login open, as a slow gateway does; `destroy` closes the client cleanly unless told. */
function gateway(loaded: Loaded, login: 'at once' | 'held' = 'at once') {
  const clients: Client[] = []
  let loggingIn!: () => void
  const reachedLogin = new Promise<void>(resolve => (loggingIn = resolve))
  vi.spyOn(loaded.discord.Client.prototype, 'login').mockImplementation(function (this: Client) {
    clients.push(this)
    loggingIn()
    return login === 'held' ? new Promise<string>(() => {}) : Promise.resolve('token')
  })
  const destroy = vi.spyOn(loaded.discord.Client.prototype, 'destroy').mockResolvedValue(undefined)
  return { clients, destroy, reachedLogin }
}

/** A factory the test settles: `made` gives its value, `failed` rejects it. */
function heldFactory() {
  const held = Promise.withResolvers<object>()
  let asked!: () => void
  const reached = new Promise<void>(resolve => (asked = resolve))
  const useFactory = () => {
    asked()
    return held.promise
  }
  return { useFactory, reached, made: () => held.resolve({}), failed: () => held.reject(new Error('cache unreachable')) }
}

function create(loaded: Loaded, options: { providers?: any[]; services?: any[] } = {}) {
  @loaded.MeoCord({ controllers: [], ...options, clientOptions: { intents: [] } })
  class App {}
  return loaded.MeoCordFactory.create(App)
}

/** Starts the app as main.ts in an app generated before this release does: any rejection sets the exit code to 1. */
function startAsGeneratedMain(app: { start(): Promise<void> }): Promise<void> {
  return app.start().catch(() => {
    process.exitCode = 1
  })
}

describe('the exit code of a stop', () => {
  const exitCode = process.exitCode
  let exit: ReturnType<typeof vi.spyOn>
  let signalListeners: NodeJS.SignalsListener[]

  // The first import transforms the modules, which a cold run would otherwise count against the first case
  beforeAll(() => load())

  beforeEach(() => {
    process.exitCode = undefined
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

  const exitedWith = async () => {
    await vi.waitFor(() => expect(exit).toHaveBeenCalled())
    return exit.mock.calls.map(([code]) => code)
  }

  it('is 0 for a Ctrl+C during the login', async () => {
    const loaded = await load()
    const { reachedLogin } = gateway(loaded, 'held')
    const started = startAsGeneratedMain(create(loaded))
    await reachedLogin

    process.emit('SIGINT')
    await started

    expect(await exitedWith()).toEqual([0])
  })

  it("is 0 for a Ctrl+C while a provider's factory is pending", async () => {
    const loaded = await load()
    gateway(loaded)
    const factory = heldFactory()
    const started = startAsGeneratedMain(create(loaded, { providers: [{ provide: 'CACHE', useFactory: factory.useFactory }] }))
    await factory.reached

    process.emit('SIGINT')
    factory.made()
    await started

    expect(await exitedWith()).toEqual([0])
  })

  it('is 0 for a Ctrl+C while the onReady hooks run', async () => {
    const loaded = await load()
    const { clients } = gateway(loaded)
    const ready = Promise.withResolvers<void>()
    @loaded.Service()
    class Warmup {
      onReady() {
        return ready.promise
      }
    }
    await startAsGeneratedMain(create(loaded, { services: [Warmup] }))
    const [listener] = clients[0].listeners('clientReady')
    const readyPass = listener(clients[0])

    process.emit('SIGINT')
    ready.resolve()
    await readyPass

    expect(await exitedWith()).toEqual([0])
  })

  it('keeps a code set before it began', async () => {
    const loaded = await load()
    gateway(loaded)
    await startAsGeneratedMain(create(loaded))
    process.exitCode = 1

    process.emit('SIGINT')

    expect(await exitedWith()).toEqual([1])
  })

  it('is 1 when a client fails to close', async () => {
    const loaded = await load()
    const { clients, destroy } = gateway(loaded)
    await startAsGeneratedMain(create(loaded))
    await clients[0].listeners('clientReady')[0](clients[0])
    destroy.mockRejectedValue(new Error('socket hang up'))

    process.emit('SIGINT')

    expect(await exitedWith()).toEqual([1])
  })

  it("is 1 when a provider's factory fails while the shutdown waits for it", async () => {
    const loaded = await load()
    gateway(loaded)
    const factory = heldFactory()
    const started = startAsGeneratedMain(create(loaded, { providers: [{ provide: 'CACHE', useFactory: factory.useFactory }] }))
    await factory.reached

    process.emit('SIGINT')
    factory.failed()
    await started

    expect(await exitedWith()).toEqual([1])
  })
})
