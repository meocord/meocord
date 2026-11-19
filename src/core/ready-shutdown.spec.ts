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
/** Runs inside Early's onReady, which settles before Pool's starts. */
let inEarly: () => void

@Service()
class Early {
  onReady() {
    order.push('Early.onReady')
    inEarly()
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

/** Uses Pool, with no onReady of its own, so it is ready as soon as it is made. */
@Service()
class PoolUser {
  constructor(readonly pool: Pool) {}
  onShutdown() {
    order.push('PoolUser.onShutdown')
  }
}

/** Starts an app logged in without a network, and fires its ready event without waiting, as discord.js emits it. */
async function startApp(): Promise<{ client: Client; ready: Promise<void> }> {
  const clients: Client[] = []
  vi.spyOn(Client.prototype, 'login').mockImplementation(function (this: Client) {
    clients.push(this)
    return Promise.resolve('token')
  })
  vi.spyOn(Client.prototype, 'destroy').mockImplementation(async () => void order.push('client.destroy'))

  @MeoCord({ controllers: [Ping], services: [Early, Pool, Later], clientOptions: { allowedMentions: { parse: [] }, intents: [] } })
  class App {}

  app = MeoCordFactory.create(App)
  await app.start()
  const client = clients[0]
  // Ready as discord.js makes it, with the application the commands register under
  Object.defineProperty(client, 'application', { value: { id: '100000000000000001' }, configurable: true })
  vi.spyOn(client.rest, 'get').mockResolvedValue([])
  vi.spyOn(client.rest, 'put').mockResolvedValue([])
  const ready = Promise.all(client.listeners('clientReady').map(listener => (listener as (c: Client) => Promise<void>)(client)))
  return { client, ready: ready.then(() => undefined) }
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0))

/** close()'s wait for the factory under way, short enough that it stops waiting before SLOW settles. */
const SLOW_FACTORY_TIMEOUT_MS = 50

/** A testing module with PLAIN, a value with no onReady, then SLOW, one with both hooks whose factory settles when told. */
function slowFactory(shutdownTimeout: number) {
  const slow = Promise.withResolvers<void>()
  const started = Promise.withResolvers<void>()
  const hook = (name: string) => () => void order.push(name)
  const module = MeoCordTestingModule.create({
    providers: [
      { provide: 'PLAIN', useFactory: () => ({ onShutdown: hook('PLAIN.onShutdown') }) },
      { provide: 'SLOW', useFactory: () => (started.resolve(), slow.promise.then(() => ({ onReady: hook('SLOW.onReady'), onShutdown: hook('SLOW.onShutdown') }))) },
    ],
    shutdownTimeout,
  } as never).compile()
  return { module, settle: () => slow.resolve(), started: started.promise }
}

beforeEach(() => {
  order.length = 0
  logged.warn.length = 0
  config.shutdownTimeout = 4_000
  gate = Promise.withResolvers<void>()
  inReady = () => undefined
  inEarly = () => undefined
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

  // The timer outlives Early's onReady, so its stop() is no onReady stopping the bot itself
  it("waits for an onReady when a timer an earlier onReady left stops the bot", async () => {
    let stopped: Promise<void> | undefined
    inEarly = () => void setTimeout(() => (stopped = app.stop()), 10)
    await startApp()
    await vi.waitFor(() => expect(stopped).toBeDefined())

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

  // As the bot's: a close stops the pass, so the hooks after the one running don't start
  it('waits for the onReady running, then shuts down, and starts no onReady after it', async () => {
    const module = compile()
    const initialised = module.init({ ready: true })
    await tick()

    const closed = module.close()
    await tick()
    gate.resolve()
    await Promise.all([initialised, closed])

    expect(order).toEqual(['Early.onReady', 'Pool.onReady start', 'Pool.onReady done', 'Pool.onShutdown', 'Early.onShutdown'])
  })

  // As the bot's: a unit whose onReady never settled gets no onShutdown
  it('stops waiting for an onReady that never settles, naming it, and gives it no onShutdown', async () => {
    vi.useFakeTimers()
    const module = compile()
    void module.init({ ready: true })
    await vi.advanceTimersByTimeAsync(0)

    const closed = module.close()
    await vi.advanceTimersByTimeAsync(3_000)
    await closed

    expect(order).toEqual(['Early.onReady', 'Pool.onReady start', 'Early.onShutdown'])
    expect(logged.warn).toEqual(['onReady in Pool is still running after 3000 ms; shutting down without waiting for it.'])
  })

  it('gives no onShutdown to a unit that depends on one whose onReady never settled', async () => {
    vi.useFakeTimers()
    const module = MeoCordTestingModule.create({ controllers: [UsesLater], providers: [{ provide: PoolUser, useClass: PoolUser }], shutdownTimeout: 4_000 }).compile()
    void module.init({ ready: true })
    await vi.advanceTimersByTimeAsync(0)
    module.get(PoolUser)

    const closed = module.close()
    await vi.advanceTimersByTimeAsync(3_000)
    await closed

    expect(order).toEqual(['Early.onReady', 'Pool.onReady start', 'Early.onShutdown'])
  })

  it('shuts down a unit whose onReady failed, as that onReady has settled', async () => {
    const module = compile()
    inReady = () => {
      throw new Error('pool down')
    }
    gate.resolve()
    await expect(module.init({ ready: true })).rejects.toThrow('pool down')

    await module.close()

    expect(order).toEqual(['Early.onReady', 'Pool.onReady start', 'Later.onReady', 'Later.onShutdown', 'Pool.onShutdown', 'Early.onShutdown'])
  })

  // As a bot stopped before its ready hooks: with init({ ready: true }) asked, a unit whose onReady never ran is not undone
  for (const ready of [true, false]) {
    it(`${ready ? 'with' : 'without'} init({ ready: true }), a close() while a factory resolves shuts down ${ready ? 'only what has no onReady' : 'every value made'}`, async () => {
      const { module, settle, started } = slowFactory(4_000)
      const initialised = module.init({ ready })
      await started

      const closed = module.close()
      settle()
      await Promise.all([initialised, closed])

      expect(order).toEqual(ready ? ['PLAIN.onShutdown'] : ['SLOW.onShutdown', 'PLAIN.onShutdown'])
    })

    it(`${ready ? 'with' : 'without'} init({ ready: true }), the value close() stopped waiting for ${ready ? 'gets no onShutdown, its onReady never having run' : 'is shut down as it arrives'}`, async () => {
      const { module, settle, started } = slowFactory(SLOW_FACTORY_TIMEOUT_MS)
      const initialised = module.init({ ready })
      await started

      await module.close()
      settle()
      await initialised

      expect(order).toEqual(ready ? ['PLAIN.onShutdown'] : ['PLAIN.onShutdown', 'SLOW.onShutdown'])
    })
  }

  // With no ready pass, no onReady ran to be undone: what the module made shuts down, as close() documents
  it('without init({ ready: true }), shuts down every unit it made', async () => {
    const module = compile()
    await module.init()
    module.get(Later)

    await module.close()

    expect(order).toEqual(['Later.onShutdown', 'Pool.onShutdown', 'Early.onShutdown'])
  })

  it('waits for the onReady hooks when a timer an earlier onReady left closes the module', async () => {
    const module = compile()
    let closed: Promise<void> | undefined
    inEarly = () => void setTimeout(() => (closed = module.close()), 10)
    const initialised = module.init({ ready: true })
    await vi.waitFor(() => expect(closed).toBeDefined())

    await tick()
    gate.resolve()
    await Promise.all([initialised, closed])

    expect(order).toEqual(['Early.onReady', 'Pool.onReady start', 'Pool.onReady done', 'Pool.onShutdown', 'Early.onShutdown'])
    expect(logged.warn).toEqual([])
  })

  it("doesn't wait for an onReady that closes the module itself", async () => {
    const module = compile()
    inReady = async () => {
      await module.close()
      order.push('closed from onReady')
    }
    gate.resolve()

    await module.init({ ready: true })

    // As the bot's: the pass ends at the close, and Pool, still in its onReady, gets no onShutdown
    expect(order).toEqual(['Early.onReady', 'Pool.onReady start', 'Early.onShutdown', 'closed from onReady', 'Pool.onReady done'])
    expect(logged.warn).toEqual([])
  })
})
