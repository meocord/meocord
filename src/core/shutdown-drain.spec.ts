import { vi } from 'vitest'
import { ChatInputCommandInteraction, Client, GatewayIntentBits, type Guild } from 'discord.js'

const { logged, config } = vi.hoisted(() => ({
  logged: { warn: [] as string[] },
  config: { discordToken: 'token', shutdownTimeout: 4_000 } as { discordToken: string; shutdownTimeout: number },
}))

vi.mock('@src/common/index.js', async importOriginal => ({
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

import { Command, Controller, MeoCord, On, Service } from '@src/decorator/index.js'
import { MeoCordFactory } from '@src/core/meocord-factory.js'
import { hooksReserveMs } from '@src/core/lifecycle-hooks.js'
import { MemoryCooldownStore } from '@src/common/cooldown-store.js'
import { CommandType } from '@src/enum/index.js'
import { type MeoCordApplication } from '@src/interface/index.js'
import { createChatInputOptions, createMockInteraction } from '@src/testing/index.js'

const order: string[] = []
let app: MeoCordApplication
/** What the `hang` and `slow` commands and the `guildCreate` handler wait for, released by a test. */
let gate: PromiseWithResolvers<void>
/** Runs inside a hook, as each test sets it. */
let duringShutdown: () => Promise<void> | void

@Controller()
class Owner {
  @Command('shutdown', CommandType.SLASH)
  async shutdown() {
    order.push('handler: stopping')
    await app.stop()
    order.push('handler: stopped')
  }

  @Command('hang', CommandType.SLASH)
  async hang() {
    await gate.promise
  }

  @Command('slow', CommandType.SLASH)
  async slow() {
    await new Promise(resolve => setTimeout(resolve, 100))
    order.push('slow: done')
  }
}

@Service()
class Greeter {
  @On('guildCreate')
  async welcome(_guild: Guild) {
    await gate.promise
    order.push('guildCreate: done')
  }

  @On('error')
  failed(error: Error) {
    order.push(`error: ${error.message}`)
  }
}

@Service()
class Db {
  onReady() {}
  async onShutdown() {
    order.push('Db.onShutdown')
    await duringShutdown()
  }
}

@Service()
class Store extends MemoryCooldownStore {
  onShutdown() {
    order.push('store.onShutdown')
  }
}

/** Starts an app logged in without a network, its ready hooks run, with or without a cooldown store whose hook runs. */
async function startApp({ store = false } = {}): Promise<Client> {
  const clients: Client[] = []
  vi.spyOn(Client.prototype, 'login').mockImplementation(function (this: Client) {
    clients.push(this)
    return Promise.resolve('token')
  })
  vi.spyOn(Client.prototype, 'destroy').mockImplementation(async () => void order.push('client.destroy'))

  @MeoCord({ controllers: [Owner], services: [Greeter, Db], cooldownStore: store ? Store : undefined, clientOptions: { intents: [GatewayIntentBits.Guilds] } })
  class App {}

  app = MeoCordFactory.create(App)
  await app.start()
  const client = clients[0]
  for (const listener of client.listeners('clientReady')) await (listener as (c: Client) => Promise<void>)(client)
  return client
}

/** Dispatches `/name` as the gateway would, without waiting for it. */
function command(client: Client, name: string): Promise<void> {
  const [dispatch] = client.listeners('interactionCreate') as ((interaction: unknown) => Promise<void>)[]
  return dispatch(createMockInteraction(ChatInputCommandInteraction, { commandName: name, options: createChatInputOptions({}) }))
}

describe('shutdown drains the calls under way', () => {
  beforeEach(() => {
    order.length = 0
    logged.warn.length = 0
    config.shutdownTimeout = 4_000
    gate = Promise.withResolvers<void>()
    duringShutdown = () => undefined
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    process.removeAllListeners('SIGINT')
    process.removeAllListeners('SIGTERM')
  })

  // lifecycle-hooks.md documents `await app.stop()` in an owner-only shutdown command
  it("doesn't wait for the call that asked to stop, so the hooks run before the client is destroyed", async () => {
    config.shutdownTimeout = 400
    const client = await startApp({ store: true })
    const started = Date.now()

    await command(client, 'shutdown')

    expect(Date.now() - started).toBeLessThan(300)
    expect(order).toEqual(['handler: stopping', 'Db.onShutdown', 'store.onShutdown', 'client.destroy', 'handler: stopped'])
    expect(logged.warn).toEqual([])
  })

  it('dispatches no call once the hooks start, whatever the cooldown store has', async () => {
    const client = await startApp()
    duringShutdown = async () => {
      order.push(`interaction listeners: ${client.listenerCount('interactionCreate')}`)
      client.emit('interactionCreate', createMockInteraction(ChatInputCommandInteraction, { commandName: 'slow', options: createChatInputOptions({}) }))
      await new Promise(resolve => setTimeout(resolve, 150))
    }

    await app.stop()

    expect(order).toEqual(['Db.onShutdown', 'interaction listeners: 0', 'client.destroy'])
  })

  it("keeps an @On('error') handler until the client is destroyed", async () => {
    const client = await startApp({ store: true })
    duringShutdown = () => void client.emit('error', new Error('gateway hiccup'))

    await app.stop()

    // The handler runs through the pipeline, so it may finish after the next hook starts; it still precedes destroy()
    expect(order).toContain('error: gateway hiccup')
    expect(order.at(-1)).toBe('client.destroy')
  })

  it('waits for an @On handler already running', async () => {
    const client = await startApp()
    client.emit('guildCreate', {} as Guild)

    const stopped = app.stop()
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(order).toEqual([])
    gate.resolve()
    await stopped

    expect(order).toEqual(['guildCreate: done', 'Db.onShutdown', 'client.destroy'])
  })

  it('lets the hooks start as soon as the last call settles', async () => {
    vi.useFakeTimers()
    const client = await startApp()
    duringShutdown = () => void order.push(`hooks at ${Date.now() - started}`)
    void command(client, 'slow')
    const started = Date.now()

    const stopped = app.stop()
    await vi.advanceTimersByTimeAsync(100)
    await stopped

    expect(order).toEqual(['slow: done', 'Db.onShutdown', 'hooks at 100', 'client.destroy'])
  })

  // shutdownTimeout bounds the whole shutdown: the drain leaves the hooks a quarter of it, at least 1 s
  it('stops waiting for a call that hangs in time for the hooks to finish, naming the call', async () => {
    vi.useFakeTimers()
    const client = await startApp()
    const started = Date.now()
    duringShutdown = async () => {
      order.push(`hooks at ${Date.now() - started}`)
      await new Promise(resolve => setTimeout(resolve, 500))
      order.push('hooks done')
    }
    void command(client, 'hang')

    const stopped = app.stop()
    await vi.advanceTimersByTimeAsync(3_500)
    await stopped

    expect(order).toEqual(['Db.onShutdown', 'hooks at 3000', 'hooks done', 'client.destroy'])
    expect(logged.warn).toEqual([
      'Calls still running after 3000 ms: interaction "/hang"; running the onShutdown hooks in the 1000 ms left.',
    ])
  })
})

describe('a stop during startup', () => {
  const SLOW = Symbol('SLOW')
  let factory: PromiseWithResolvers<object>

  @Service()
  class Late {
    constructor() {
      order.push('Late constructed')
    }
  }

  @MeoCord({
    controllers: [],
    services: [Late],
    providers: [{ provide: SLOW, useFactory: () => factory.promise }],
    clientOptions: { intents: [] },
  })
  class SlowApp {}

  beforeEach(() => {
    order.length = 0
    logged.warn.length = 0
    config.shutdownTimeout = 1_000
    factory = Promise.withResolvers<object>()
    vi.spyOn(Client.prototype, 'login').mockResolvedValue('token')
    vi.spyOn(Client.prototype, 'destroy').mockImplementation(async () => void order.push('client.destroy'))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    process.removeAllListeners('SIGINT')
    process.removeAllListeners('SIGTERM')
  })

  it('settles once the startup has, which makes nothing after the stop', async () => {
    const slow = MeoCordFactory.create(SlowApp)
    const starting = slow.start()
    void starting.catch(() => undefined)
    await new Promise(resolve => setTimeout(resolve, 10))

    const stopped = slow.stop().then(() => void order.push('stop() resolved'))
    await new Promise(resolve => setTimeout(resolve, 10))
    order.push('factory settles')
    factory.resolve({})
    await stopped

    await expect(starting).rejects.toThrow('The bot was stopped before it came online.')
    expect(order).toEqual(['factory settles', 'client.destroy', 'stop() resolved'])
  })

  it('waits at most shutdownTimeout for a factory that never settles, naming it', async () => {
    vi.useFakeTimers()
    const slow = MeoCordFactory.create(SlowApp)
    void slow.start().catch(() => undefined)
    await vi.advanceTimersByTimeAsync(0)

    const stopped = slow.stop()
    await vi.advanceTimersByTimeAsync(1_000)
    await stopped

    expect(logged.warn).toEqual(['The startup still waits for the factory providing Symbol(SLOW) after 1000 ms; shutting down without it.'])
    factory.resolve({})
    await vi.advanceTimersByTimeAsync(0)
    expect(order).toEqual(['client.destroy'])
  })
})

describe('hooksReserveMs', () => {
  it.each([
    [10_000, 2_500],
    [4_000, 1_000],
    [2_000, 1_000],
    [400, 200],
    [0, 0],
  ])('leaves the hooks of a %i ms shutdownTimeout %i ms', (timeout, reserve) => {
    expect(hooksReserveMs(timeout)).toBe(reserve)
  })
})
