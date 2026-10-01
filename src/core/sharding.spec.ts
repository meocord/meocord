import { vi } from 'vitest'
import { type Client } from 'discord.js'
import type * as AppModule from '@src/core/meocord.app.js'
import type * as FactoryModule from '@src/core/meocord-factory.js'
import type * as DecoratorModule from '@src/decorator/index.js'
import type * as ShardManagerModule from '@src/core/shard-manager.js'
import type * as ShardContextModule from '@src/core/shard-context.js'
import { type MeoCordConfig, type OnReady, type ReadyInfo } from '@src/interface/index.js'
import { CommandType } from '@src/enum/index.js'

const { logged, config, platformChecked, channel } = vi.hoisted(() => ({
  channel: { closed: false },
  logged: { info: [] as string[], error: [] as string[] },
  config: { current: { discordToken: 'token' } as MeoCordConfig },
  platformChecked: { count: 0 },
}))

vi.mock('@src/common/index.js', async importOriginal => ({
  ...(await importOriginal<object>()),
  Logger: class {
    log = vi.fn()
    debug = vi.fn()
    warn = vi.fn()
    verbose = vi.fn()
    info = (...args: unknown[]) => logged.info.push(args.map(String).join(' '))
    error = (...args: unknown[]) => logged.error.push(args.map(String).join(' '))
  },
}))
vi.mock('@src/util/meocord-config-loader.util.js', () => ({ loadMeoCordConfig: () => config.current }))
// The test runner's own IPC reads process.connected, so a closed channel is stood in for here
vi.mock('@src/util/sharding-mode.util.js', async importOriginal => ({
  ...(await importOriginal<object>()),
  managerGone: () => channel.closed,
}))
vi.mock('@src/util/platform.util.js', () => ({
  assertBuiltForThisPlatform: () => {
    platformChecked.count++
  },
}))

/** Fresh modules per test, as shutdown state and signal listeners live at module level. */
async function load() {
  vi.resetModules()
  const discord = await import('discord.js')
  const app: typeof AppModule = await import('@src/core/meocord.app.js')
  const factory: typeof FactoryModule = await import('@src/core/meocord-factory.js')
  const decorators: typeof DecoratorModule = await import('@src/decorator/index.js')
  const manager: typeof ShardManagerModule = await import('@src/core/shard-manager.js')
  const context: typeof ShardContextModule = await import('@src/core/shard-context.js')
  const { isExplainedError } = await import('@src/common/explained-error.js')
  return { discord, ...app, ...factory, ...decorators, ...manager, ...context, isExplainedError }
}
type Loaded = Awaited<ReturnType<typeof load>>

function appClass(loaded: Loaded, options: { controllers?: any[]; services?: any[]; intents?: number[] } = {}) {
  @loaded.MeoCord({ controllers: options.controllers ?? [], services: options.services, clientOptions: { intents: options.intents ?? [] } })
  class App {}
  return App
}

/** Creates and starts the app with a client that logs in without a network. */
async function startApp(loaded: Loaded, options: { controllers?: any[]; services?: any[] } = {}) {
  const clients: Client[] = []
  vi.spyOn(loaded.discord.Client.prototype, 'login').mockImplementation(function (this: Client) {
    clients.push(this)
    return Promise.resolve('token')
  })
  vi.spyOn(loaded.discord.Client.prototype, 'destroy').mockResolvedValue(undefined)
  const app = loaded.MeoCordFactory.create(appClass(loaded, options))
  await app.start()
  return { app, client: clients[0] }
}

describe('sharding', () => {
  let exit: ReturnType<typeof vi.spyOn>
  let signals: Record<'SIGINT' | 'SIGTERM', NodeJS.SignalsListener[]>
  let ipc: { message: NodeJS.MessageListener[]; disconnect: (() => void)[] }

  beforeEach(() => {
    logged.info.length = 0
    logged.error.length = 0
    platformChecked.count = 0
    channel.closed = false
    config.current = { discordToken: 'token' }
    exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    signals = {
      SIGINT: process.listeners('SIGINT') as NodeJS.SignalsListener[],
      SIGTERM: process.listeners('SIGTERM') as NodeJS.SignalsListener[],
    }
    ipc = {
      message: process.listeners('message') as NodeJS.MessageListener[],
      disconnect: process.listeners('disconnect') as (() => void)[],
    }
  })

  afterEach(() => {
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      for (const listener of process.listeners(signal)) {
        if (!signals[signal].includes(listener as NodeJS.SignalsListener)) process.off(signal, listener)
      }
    }
    for (const listener of process.listeners('message')) {
      if (!ipc.message.includes(listener as NodeJS.MessageListener)) process.off('message', listener)
    }
    for (const listener of process.listeners('disconnect')) {
      if (!ipc.disconnect.includes(listener as () => void)) process.off('disconnect', listener)
    }
    Reflect.deleteProperty(process, 'send')
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  // One call in MeoCordFactory.create covers every way a bot runs; each is tested, so moving the call below one fails
  describe('two handlers of one command', () => {
    const duplicated = (loaded: Loaded) => {
      @loaded.Controller()
      class StatsController {
        @loaded.Command('stats', CommandType.SLASH)
        async stats() {}
      }
      @loaded.Controller()
      class AdminController {
        @loaded.Command('stats', CommandType.SLASH)
        async adminStats() {}
      }
      return appClass(loaded, { controllers: [StatsController, AdminController] })
    }

    it.each([
      ['as a bot', () => {}, { discordToken: 'token' }],
      ['under meocord register', () => vi.stubEnv('MEOCORD_REGISTER_ONLY', '1'), { discordToken: 'token' }],
      ['as the shard manager', () => {}, { discordToken: 'token', sharding: { mode: 'process' } }],
      ['as a spawned shard', () => vi.stubEnv('SHARDING_MANAGER', 'true'), { discordToken: 'token', sharding: { mode: 'process' } }],
    ] as const)('stop the bot %s, before anything registers or runs', async (_how, setUp, current) => {
      const loaded = await load()
      setUp()
      config.current = current as MeoCordConfig

      expect(() => loaded.MeoCordFactory.create(duplicated(loaded))).toThrow(
        'StatsController.stats: it and AdminController.adminStats both handle the slash command "stats"',
      )
    })
  })

  describe('entry modes', () => {
    // A build for another platform stops before the manager registers commands or spawns a shard that would fail
    it('returns the shard manager for process sharding once the platform is checked, binding nothing', async () => {
      const loaded = await load()
      config.current = { discordToken: 'token', sharding: { mode: 'process' } }
      const constructed = vi.fn()

      @loaded.Service()
      class Eager {
        constructor() {
          constructed()
        }
      }

      const app = loaded.MeoCordFactory.create(appClass(loaded, { services: [Eager] }))

      expect(app).toBeInstanceOf(loaded.ShardManager)
      expect(platformChecked.count).toBe(1)
      expect(constructed).not.toHaveBeenCalled()
    })

    it('runs a spawned shard as a bot, whatever the config says', async () => {
      const loaded = await load()
      vi.stubEnv('SHARDING_MANAGER', 'true')
      config.current = { discordToken: 'token', sharding: { mode: 'process' } }

      expect(loaded.MeoCordFactory.create(appClass(loaded))).toBeInstanceOf(loaded.MeoCordApp)
    })

    it('runs every shard in this process under development, and says so', async () => {
      const loaded = await load()
      vi.stubEnv('NODE_ENV', 'development')
      config.current = { discordToken: 'token', sharding: { mode: 'process', shards: 2 } }

      const { client } = await startApp(loaded)

      expect(client.options.shards).toEqual([0, 1])
      expect(logged.info.join('\n')).toContain("sharding.mode 'process' is off in development")
    })

    it('gives the client the shards of internal sharding', async () => {
      const loaded = await load()
      config.current = { discordToken: 'token', sharding: { shards: 3 } }

      const { client } = await startApp(loaded)

      expect(client.options.shards).toEqual([0, 1, 2])
      expect(client.options.shardCount).toBe(3)
    })

    it('refuses two classes with one name in a shard, since calls between shards find them by name', async () => {
      const loaded = await load()
      vi.stubEnv('SHARDING_MANAGER', 'true')
      config.current = { discordToken: 'token', sharding: { mode: 'process' } }

      const first = (() => {
        @loaded.Service()
        class Stats {}
        return Stats
      })()
      const second = (() => {
        @loaded.Service()
        class Stats {}
        return Stats
      })()

      expect(() => loaded.MeoCordFactory.create(appClass(loaded, { services: [first, second] }))).toThrow(
        'Stats: two classes have this name',
      )
      await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1))
    })
  })

  describe('a login Discord refuses for its intents, in one process', () => {
    beforeEach(() => {
      config.current = { discordToken: 'secret-token-value' }
    })

    const start = async (loaded: Loaded, intents: number[], rejection: Error) => {
      vi.spyOn(loaded.discord.Client.prototype, 'login').mockRejectedValue(rejection)
      const exitCode = process.exitCode
      try {
        await expect(loaded.MeoCordFactory.create(appClass(loaded, { intents })).start()).rejects.toBe(rejection)
        return process.exitCode
      } finally {
        process.exitCode = exitCode
      }
    }

    it('says which privileged intents the bot requests and where to enable them, marking the error as explained', async () => {
      const loaded = await load()
      const { GatewayIntentBits } = loaded.discord
      const refused = new Error('Used disallowed intents')

      const exitCode = await start(loaded, [GatewayIntentBits.Guilds, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers], refused)

      expect(logged.error).toEqual([
        'Discord refused the privileged intents the bot requests (GuildMembers, MessageContent). Enable them in the ' +
          'Developer Portal → your application → Bot → Privileged Gateway Intents, then start again. A verified bot in ' +
          "100 or more servers needs Discord's approval for them.",
      ])
      expect(logged.error.join('')).not.toContain('secret-token-value')
      expect(exitCode).toBe(1)
      expect(loaded.isExplainedError(refused)).toBe(true)
      expect(Object.keys(refused)).toEqual([])
    })

    it('explains intents Discord refuses as invalid', async () => {
      const loaded = await load()
      const refused = new Error('Used invalid intents')

      await start(loaded, [loaded.discord.GatewayIntentBits.Guilds], refused)

      expect(logged.error).toEqual([expect.stringMatching(/^Discord refused the intents the bot requests as invalid\. Check clientOptions\.intents/)])
      expect(loaded.isExplainedError(refused)).toBe(true)
    })

    it('leaves an error it does not explain unmarked, for main.ts to log', async () => {
      const loaded = await load()
      const unreachable = new Error('getaddrinfo ENOTFOUND discord.com')

      await start(loaded, [], unreachable)

      expect(loaded.isExplainedError(unreachable)).toBe(false)
      expect(logged.error).toEqual([])
    })
  })

  it('leaves the process to main.ts when its start fails, in one process', async () => {
    const loaded = await load()
    vi.spyOn(loaded.discord.Client.prototype, 'login').mockRejectedValue(new Error('getaddrinfo ENOTFOUND'))
    const exitCode = process.exitCode

    try {
      await expect(loaded.MeoCordFactory.create(appClass(loaded)).start()).rejects.toThrow('ENOTFOUND')
      await new Promise(resolve => setTimeout(resolve, 10))
    } finally {
      process.exitCode = exitCode
    }
    expect(exit).not.toHaveBeenCalled()
  })

  describe('a login Discord refuses for its token, in one process', () => {
    const invalidToken = () => Object.assign(new Error('An invalid token was provided.'), { code: 'TokenInvalid' })

    const start = async (loaded: Loaded, rejection: Error) => {
      vi.spyOn(loaded.discord.Client.prototype, 'login').mockRejectedValue(rejection)
      const exitCode = process.exitCode
      try {
        await expect(loaded.MeoCordFactory.create(appClass(loaded)).start()).rejects.toBe(rejection)
        return process.exitCode
      } finally {
        process.exitCode = exitCode
      }
    }

    it('says Discord refused the token and where to get a new one, marking the error as explained', async () => {
      const loaded = await load()
      config.current = { discordToken: 'secret-token-value' }
      const refused = invalidToken()

      const exitCode = await start(loaded, refused)

      expect(logged.error).toEqual([expect.stringMatching(/^Discord refused the bot token\. .*Reset Token/)])
      expect(logged.error.join('')).not.toContain('secret-token-value')
      expect(exitCode).toBe(1)
      expect(loaded.isExplainedError(refused)).toBe(true)
    })

    // discord.js refuses an empty token with the same code as one Discord refused
    it('says the token is missing when discordToken is empty', async () => {
      const loaded = await load()
      config.current = { discordToken: '' }
      const refused = invalidToken()

      await start(loaded, refused)

      expect(logged.error).toEqual([expect.stringMatching(/^Discord token is missing: meocord\.config\.ts sets discordToken/)])
      expect(loaded.isExplainedError(refused)).toBe(true)
    })
  })

  describe('in a shard', () => {
    beforeEach(() => {
      vi.stubEnv('SHARDING_MANAGER', 'true')
      config.current = { discordToken: 'token', sharding: { mode: 'process' } }
    })

    it('tells the manager, before failing, that its token is invalid', async () => {
      const loaded = await load()
      const sent: unknown[] = []
      Reflect.set(process, 'send', (message: unknown, _handle: unknown, _options: unknown, callback: () => void) => {
        sent.push(message)
        callback()
        return true
      })
      const invalid = Object.assign(new Error('An invalid token was provided.'), { code: 'TokenInvalid' })
      vi.spyOn(loaded.discord.Client.prototype, 'login').mockRejectedValue(invalid)
      const exitCode = process.exitCode

      try {
        await expect(loaded.MeoCordFactory.create(appClass(loaded)).start()).rejects.toBe(invalid)
        await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1))
      } finally {
        process.exitCode = exitCode
      }
      expect(sent).toEqual([{ meocord: 'fatal', code: 'TokenInvalid', message: expect.stringMatching(/^Discord refused the bot token\./) }])
      // The manager logs it for every shard; the shard itself does not
      expect(logged.error).toEqual([])
    })

    // discord.js passes on the gateway's close as a plain Error, with no code
    it.each([
      ['Used disallowed intents', 'DisallowedIntents', 'Discord refused the privileged intents the bot requests (MessageContent)'],
      ['Used invalid intents', 'InvalidIntents', 'Discord refused the intents the bot requests as invalid'],
    ])('tells the manager a shard cannot log in when the gateway says "%s", with the explanation', async (closed, code, explanation) => {
      const loaded = await load()
      const sent: { meocord: string; code: string; message: string }[] = []
      Reflect.set(process, 'send', (message: never, _handle: unknown, _options: unknown, callback: () => void) => {
        sent.push(message)
        callback()
        return true
      })
      vi.spyOn(loaded.discord.Client.prototype, 'login').mockRejectedValue(new Error(closed))
      const exitCode = process.exitCode

      try {
        await expect(
          loaded.MeoCordFactory.create(appClass(loaded, { intents: [loaded.discord.GatewayIntentBits.MessageContent] })).start(),
        ).rejects.toThrow(closed)
        await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1))
      } finally {
        process.exitCode = exitCode
      }
      expect(sent).toEqual([{ meocord: 'fatal', code, message: expect.stringContaining(explanation) }])
      // The manager logs it for every shard; the shard itself does not
      expect(logged.error).toEqual([])
    })

    it('reports nothing for a login error a restart can fix, and ends itself so its manager restarts it', async () => {
      const loaded = await load()
      const send = vi.fn()
      Reflect.set(process, 'send', send)
      vi.spyOn(loaded.discord.Client.prototype, 'login').mockRejectedValue(new Error('getaddrinfo ENOTFOUND'))
      const exitCode = process.exitCode

      try {
        await expect(loaded.MeoCordFactory.create(appClass(loaded)).start()).rejects.toThrow('ENOTFOUND')
        await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1))
      } finally {
        process.exitCode = exitCode
      }
      expect(send).not.toHaveBeenCalled()
    })

    it('leaves command registration to the manager', async () => {
      const loaded = await load()
      const register = vi.spyOn(loaded.MeoCordApp.prototype, 'registerCommands')
      const { client } = await startApp(loaded)

      const [listener] = client.listeners('clientReady')
      await listener(client)

      expect(register).not.toHaveBeenCalled()
    })

    it('marks primary only the shard holding shard 0', async () => {
      const loaded = await load()
      const seen: boolean[] = []

      @loaded.Service()
      class Scheduler implements OnReady {
        onReady(_client: Client<true>, { primary }: ReadyInfo) {
          seen.push(primary)
        }
      }

      const { client } = await startApp(loaded, { services: [Scheduler] })
      const [listener] = client.listeners('clientReady')
      Object.defineProperty(client, 'shard', { value: { ids: [1], count: 2 }, configurable: true })
      await listener(client)
      Object.defineProperty(client, 'shard', { value: { ids: [0], count: 2 }, configurable: true })
      await listener(client)

      expect(seen).toEqual([false, true])
    })

    it('shuts down when the manager asks, and treats a second request as a no-op', async () => {
      const loaded = await load()
      const { client } = await startApp(loaded)

      process.emit('message', { meocord: 'shutdown' }, undefined)
      process.emit('SIGINT')
      await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0))

      expect(client.destroy).toHaveBeenCalledTimes(1)
      expect(exit).not.toHaveBeenCalledWith(1)
    })

    // stop() means the same in every process: the bot, every shard of it, stops
    it('asks the manager to stop every shard when its app is stopped', async () => {
      const loaded = await load()
      const sent: unknown[] = []
      Reflect.set(process, 'send', (message: unknown, _handle: unknown, _options: unknown, callback: () => void) => {
        sent.push(message)
        callback()
        return true
      })
      const { app, client } = await startApp(loaded)

      await app.stop()

      expect(sent).toEqual([{ meocord: 'stop' }])
      expect(client.destroy).toHaveBeenCalledTimes(1)
    })

    it('shuts down when the manager goes away', async () => {
      const loaded = await load()
      await startApp(loaded)

      process.emit('disconnect')

      await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0))
    })

    it('ends itself when a provider factory fails, before logging in', async () => {
      const loaded = await load()
      const login = vi.spyOn(loaded.discord.Client.prototype, 'login').mockResolvedValue('token')
      @loaded.MeoCord({
        controllers: [],
        providers: [{ provide: 'database', useFactory: () => Promise.reject(new Error('connection refused')) }],
        clientOptions: { intents: [] },
      })
      class App {}
      const exitCode = process.exitCode

      try {
        await expect(loaded.MeoCordFactory.create(App).start()).rejects.toThrow('connection refused')
        await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1))
      } finally {
        process.exitCode = exitCode
      }
      expect(login).not.toHaveBeenCalled()
    })

    it('tells its manager of a refusal, which no restart fixes, and ends itself', async () => {
      const loaded = await load()
      const sent: unknown[] = []
      Reflect.set(process, 'send', (message: unknown, _handle: unknown, _options: unknown, callback: () => void) => {
        sent.push(message)
        callback()
        return true
      })
      const [first, second] = [0, 1].map(() => {
        @loaded.Service()
        class Stats {}
        return Stats
      })

      let refused: unknown
      try {
        loaded.MeoCordFactory.create(appClass(loaded, { services: [first, second] }))
      } catch (error) {
        refused = error
      }

      await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1))
      expect(sent).toEqual([{ meocord: 'fatal', code: 'Refused', message: expect.stringContaining('Stats: two classes have this name') }])
      // The manager logs it, once for every shard
      expect(loaded.isExplainedError(refused)).toBe(true)
      expect(logged.error).toEqual([])
    })

    // The refusal may go on uncaught, and a long reason takes a while to send; the process must last until it is sent
    it('holds the process until its manager has the reason for a refusal, whatever becomes of the error', async () => {
      const loaded = await load()
      let sent: (() => void) | undefined
      Reflect.set(process, 'send', (_message: unknown, _handle: unknown, _options: unknown, callback: () => void) => {
        sent = callback
        return true
      })
      const holding = () => process.listenerCount('uncaughtException') + process.listenerCount('unhandledRejection')
      const before = holding()
      const [first, second] = [0, 1].map(() => {
        @loaded.Service()
        class Stats {}
        return Stats
      })

      expect(() => loaded.MeoCordFactory.create(appClass(loaded, { services: [first, second] }))).toThrow('two classes have this name')
      await new Promise(resolve => setTimeout(resolve, 20))

      // An uncaught refusal would otherwise end the process now, with the message still on its way
      expect(holding()).toBe(before + 2)
      expect(exit).not.toHaveBeenCalled()
      sent!()
      await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1))
      expect(holding()).toBe(before)
    })

    it('listens to its manager while its providers are made, and stops before logging in', async () => {
      const loaded = await load()
      const login = vi.spyOn(loaded.discord.Client.prototype, 'login').mockResolvedValue('token')
      vi.spyOn(loaded.discord.Client.prototype, 'destroy').mockResolvedValue(undefined)
      let connect!: () => void
      @loaded.MeoCord({
        controllers: [],
        providers: [{ provide: 'database', useFactory: () => new Promise<void>(resolve => (connect = resolve)) }],
        clientOptions: { intents: [] },
      })
      class App {}

      const started = loaded.MeoCordFactory.create(App).start()
      await vi.waitFor(() => expect(connect).toBeTypeOf('function'))
      process.emit('message', { meocord: 'shutdown' }, undefined)
      await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0))
      connect()

      await expect(started).rejects.toThrow('The bot was stopped before it came online.')
      expect(login).not.toHaveBeenCalled()
    })

    it('stops before logging in when its manager is already gone', async () => {
      const loaded = await load()
      const login = vi.spyOn(loaded.discord.Client.prototype, 'login').mockResolvedValue('token')
      vi.spyOn(loaded.discord.Client.prototype, 'destroy').mockResolvedValue(undefined)
      channel.closed = true

      await expect(loaded.MeoCordFactory.create(appClass(loaded)).start()).rejects.toThrow('The bot was stopped before it came online.')
      expect(exit).toHaveBeenCalledWith(0)
      expect(login).not.toHaveBeenCalled()
    })

    it('ignores IPC messages that are not its own', async () => {
      const loaded = await load()
      await startApp(loaded)

      process.emit('message', { _eval: 'this.guilds.cache.size' }, undefined)
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(exit).not.toHaveBeenCalled()
    })
  })

  it('reaches a service through the ShardContext the factory binds', async () => {
    const loaded = await load()
    let shards: InstanceType<typeof loaded.ShardContext> | undefined

    const { inject } = await import('inversify')

    @loaded.Service()
    class Stats {
      constructor(@inject(loaded.ShardContext) context: InstanceType<typeof loaded.ShardContext>) {
        shards = context
      }
      count() {
        return 42
      }
    }

    await startApp(loaded, { services: [Stats] })

    expect(await shards!.call(Stats, 'count')).toEqual([{ shardIds: [0], ok: true, value: 42 }])
  })

  it('reaches a class a provider stands in for, by the class here and by its name from another shard', async () => {
    const loaded = await load()
    const { inject } = await import('inversify')
    let shards: InstanceType<typeof loaded.ShardContext> | undefined
    class Payments {
      charge() {
        return 'none'
      }
    }
    @loaded.Service()
    class StripePayments extends Payments {
      charge() {
        return 'stripe'
      }
    }
    @loaded.Service()
    class Billing {
      constructor(@inject(loaded.ShardContext) context: InstanceType<typeof loaded.ShardContext>) {
        shards = context
      }
    }
    const clients: Client[] = []
    vi.spyOn(loaded.discord.Client.prototype, 'login').mockImplementation(function (this: Client) {
      clients.push(this)
      return Promise.resolve('token')
    })
    @loaded.MeoCord({ controllers: [], services: [Billing], providers: [{ provide: Payments, useClass: StripePayments }], clientOptions: { intents: [] } })
    class App {}
    await loaded.MeoCordFactory.create(App).start()

    expect(await shards!.call(Payments, 'charge')).toEqual([{ shardIds: [0], ok: true, value: 'stripe' }])
    const runHere = Reflect.get(clients[0], loaded.SHARD_CALL_KEY) as (service: string, method: string, args: unknown[]) => Promise<unknown>
    expect(await runHere('Payments', 'charge', [])).toBe('stripe')
  })

  it('calls the very class it is given in one process, even when another class shares its name', async () => {
    const loaded = await load()
    let shards: InstanceType<typeof loaded.ShardContext> | undefined
    const { inject } = await import('inversify')

    const first = (() => {
      @loaded.Service()
      class Stats {
        constructor(@inject(loaded.ShardContext) context: InstanceType<typeof loaded.ShardContext>) {
          shards = context
        }
        which() {
          return 'first'
        }
      }
      return Stats
    })()
    const second = (() => {
      @loaded.Service()
      class Stats {
        which() {
          return 'second'
        }
      }
      return Stats
    })()

    await startApp(loaded, { services: [first, second] })

    expect(await shards!.call(first, 'which')).toEqual([{ shardIds: [0], ok: true, value: 'first' }])
  })
})
