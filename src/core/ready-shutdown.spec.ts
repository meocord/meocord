import { vi } from 'vitest'
import { Client } from 'discord.js'

const { logged, config } = vi.hoisted(() => ({
  logged: { warn: [] as string[] },
  config: { discordToken: 'token', shutdownTimeout: 4_000 } as { discordToken: string; shutdownTimeout: number },
}))

vi.mock('@src/common/logger.js', async importOriginal => ({
  ...(await importOriginal<object>()),
  Logger: class {
    log = vi.fn()
    debug = vi.fn()
    info = vi.fn()
    verbose = vi.fn()
    error = vi.fn()
    warn = (...args: unknown[]) => logged.warn.push(args.map(String).join(' '))
  },
}))
vi.mock('@src/util/meocord-config-loader.util.js', () => ({ loadMeoCordConfig: () => config }))
vi.mock('@src/util/platform.util.js', () => ({ assertBuiltForThisPlatform: () => {} }))

import { Controller, MeoCord, Service } from '@src/decorator/index.js'
import { MeoCordFactory } from '@src/core/meocord-factory.js'
import { shutdownAndExit } from '@src/core/meocord.app.js'
import { type MeoCordApplication } from '@src/interface/index.js'
import { MeoCordTestingModule } from '@src/testing/index.js'

const order: string[] = []
let app: MeoCordApplication
/** What Pool's onReady waits for, released by a test, or never. */
let gate: PromiseWithResolvers<void>
/** Runs inside Pool's onReady before it waits, as each test sets it. */
let inReady: () => Promise<void> | void

@Service()
class Early {
  onReady() {
    order.push('Early.onReady')
  }
  onShutdown() {
    order.push('Early.onShutdown')
  }
}

/** Opens a connection in onReady, slowly, and closes it in onShutdown. */
@Service()
class Pool {
  constructor(readonly early: Early) {}
  async onReady() {
    order.push('Pool.onReady start')
    await inReady()
    await gate.promise
    order.push('Pool.onReady done')
  }
  onShutdown() {
    order.push('Pool.onShutdown')
  }
}

@Service()
class Later {
  constructor(readonly pool: Pool) {}
  onReady() {
    order.push('Later.onReady')
  }
  onShutdown() {
    order.push('Later.onShutdown')
  }
}

@Controller()
class Ping {}

/** What a testing module builds from, reaching every service. */
@Controller()
class UsesLater {
  constructor(readonly later: Later) {}
}

/** Starts an app logged in without a network, and fires its ready event without waiting, as discord.js emits it. */
async function startApp(): Promise<{ client: Client; ready: Promise<void> }> {
  const clients: Client[] = []
  vi.spyOn(Client.prototype, 'login').mockImplementation(function (this: Client) {
    clients.push(this)
    return Promise.resolve('token')
  })
  vi.spyOn(Client.prototype, 'destroy').mockImplementation(async () => void order.push('client.destroy'))

  @MeoCord({ controllers: [Ping], services: [Early, Pool, Later], clientOptions: { intents: [] } })
  class App {}

  app = MeoCordFactory.create(App)
  await app.start()
  const client = clients[0]
  const ready = Promise.all(client.listeners('clientReady').map(listener => (listener as (c: Client) => Promise<void>)(client)))
  return { client, ready: ready.then(() => undefined) }
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0))

beforeEach(() => {
  order.length = 0
  logged.warn.length = 0
  config.shutdownTimeout = 4_000
  gate = Promise.withResolvers<void>()
  inReady = () => undefined
  vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  process.removeAllListeners('SIGINT')
  process.removeAllListeners('SIGTERM')
})

describe('a bot stopped while an onReady runs', () => {
  // A signal shuts the process's apps down through shutdownAndExit, once per process, so this file sends one
  it.each(['stop()', 'a signal'])('waits for it through %s, then shuts it down, and starts no onReady after it', async how => {
    await startApp()
    await tick()

    const stopped = how === 'stop()' ? app.stop() : shutdownAndExit(false)
    await tick()
    gate.resolve()
    await stopped

    expect(order).toEqual([
      'Early.onReady',
      'Pool.onReady start',
      'Pool.onReady done',
      'Pool.onShutdown',
      'Early.onShutdown',
      'client.destroy',
    ])
    expect(logged.warn).toEqual([])
  })

  // shutdownTimeout bounds the whole shutdown: the wait leaves the hooks a quarter of it, at least 1 s
  it('stops waiting for one that never settles in time for the hooks, naming it', async () => {
    vi.useFakeTimers()
    await startApp()
    await vi.advanceTimersByTimeAsync(0)

    const stopped = app.stop()
    await vi.advanceTimersByTimeAsync(3_000)
    await stopped

    expect(order).toEqual(['Early.onReady', 'Pool.onReady start', 'Early.onShutdown', 'client.destroy'])
    expect(logged.warn).toEqual(['onReady in Pool is still running after 3000 ms; shutting down without waiting for it.'])
  })

  it("doesn't wait for an onReady that stops the bot itself", async () => {
    config.shutdownTimeout = 400
    inReady = async () => {
      await app.stop()
      order.push('stopped from onReady')
    }
    const started = Date.now()
    await startApp()

    await vi.waitFor(() => expect(order).toContain('stopped from onReady'))

    expect(Date.now() - started).toBeLessThan(150)
    expect(order).toEqual(['Early.onReady', 'Pool.onReady start', 'Early.onShutdown', 'client.destroy', 'stopped from onReady'])
    expect(logged.warn).toEqual([])
  })

  it('adds no wait and no warning when no onReady is running', async () => {
    vi.useFakeTimers()
    gate.resolve()
    const { ready } = await startApp()
    await ready

    let settled = false
    void app.stop().then(() => (settled = true))
    await vi.advanceTimersByTimeAsync(0)

    expect(settled).toBe(true)
    expect(logged.warn).toEqual([])
  })
})

describe("a testing module's close() during init({ ready: true })", () => {
  const compile = () => MeoCordTestingModule.create({ controllers: [UsesLater], shutdownTimeout: 4_000 }).compile()

  it('waits for the onReady hooks, then shuts each down once', async () => {
    const module = compile()
    const initialised = module.init({ ready: true })
    await tick()

    const closed = module.close()
    await tick()
    gate.resolve()
    await Promise.all([initialised, closed])

    expect(order).toEqual([
      'Early.onReady',
      'Pool.onReady start',
      'Pool.onReady done',
      'Later.onReady',
      'Later.onShutdown',
      'Pool.onShutdown',
      'Early.onShutdown',
    ])
  })

  // A test module shuts down what it constructed, so the unit still in onReady is shut down too
  it('stops waiting for an onReady that never settles, naming it, and shuts down what it constructed', async () => {
    vi.useFakeTimers()
    const module = compile()
    void module.init({ ready: true })
    await vi.advanceTimersByTimeAsync(0)

    const closed = module.close()
    await vi.advanceTimersByTimeAsync(3_000)
    await closed

    expect(order).toEqual(['Early.onReady', 'Pool.onReady start', 'Pool.onShutdown', 'Early.onShutdown'])
    expect(logged.warn).toEqual(['onReady in Pool is still running after 3000 ms; shutting down without waiting for it.'])
  })

  it("doesn't wait for an onReady that closes the module itself", async () => {
    const module = compile()
    inReady = async () => {
      await module.close()
      order.push('closed from onReady')
    }
    gate.resolve()

    await module.init({ ready: true })

    expect(order).toEqual([
      'Early.onReady',
      'Pool.onReady start',
      'Pool.onShutdown',
      'Early.onShutdown',
      'closed from onReady',
      'Pool.onReady done',
      'Later.onReady',
    ])
    expect(logged.warn).toEqual([])
  })
})
