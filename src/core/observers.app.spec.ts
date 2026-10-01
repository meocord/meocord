import { vi } from 'vitest'
import { type Client } from 'discord.js'
import type * as FactoryModule from '@src/core/meocord-factory.js'
import type * as DecoratorModule from '@src/decorator/index.js'
import type * as CommonModule from '@src/common/index.js'
import type * as TestingModule from '@src/testing/index.js'
import type * as EnumModule from '@src/enum/index.js'
import { type DispatchResult } from '@src/interface/index.js'

const { logged } = vi.hoisted(() => ({ logged: { error: [] as unknown[][] } }))

// Logger is constructed with `new`, so the implementation has to be a class.
vi.mock('@src/common/logger.js', async importOriginal => ({
  ...(await importOriginal<object>()),
  Logger: class {
    log = vi.fn()
    debug = vi.fn()
    info = vi.fn()
    verbose = vi.fn()
    warn = vi.fn()
    error = (...args: unknown[]) => logged.error.push(args)
  },
}))
vi.mock('@src/util/meocord-config-loader.util.js', () => ({ loadMeoCordConfig: () => ({ discordToken: 'test-token' }) }))
vi.mock('@src/util/platform.util.js', () => ({ assertBuiltForThisPlatform: () => {} }))

/** Fresh modules per test, as a new process would have. */
async function load() {
  vi.resetModules()
  const discord = await import('discord.js')
  const factory: typeof FactoryModule = await import('@src/core/meocord-factory.js')
  const decorators: typeof DecoratorModule = await import('@src/decorator/index.js')
  const common: typeof CommonModule = await import('@src/common/index.js')
  const testing: typeof TestingModule = await import('@src/testing/index.js')
  const enums: typeof EnumModule = await import('@src/enum/index.js')
  return { discord, ...factory, ...decorators, ...common, ...testing, ...enums }
}
type Loaded = Awaited<ReturnType<typeof load>>

/** Starts an app from the factory, with a client that logs in without a network, and returns its dispatch. */
async function startApp(loaded: Loaded, options: { controllers: any[]; observers: any[] }) {
  const clients: Client[] = []
  vi.spyOn(loaded.discord.Client.prototype, 'login').mockImplementation(function (this: Client) {
    clients.push(this)
    return Promise.resolve('token')
  })
  vi.spyOn(loaded.discord.Client.prototype, 'destroy').mockResolvedValue(undefined)

  @loaded.MeoCord({ controllers: options.controllers, observers: options.observers, clientOptions: { intents: [] } })
  class App {}

  const app = loaded.MeoCordFactory.create(App)
  await app.start()
  const [dispatch] = clients[0].listeners('interactionCreate') as ((interaction: unknown) => Promise<void>)[]
  return dispatch
}

describe('observers at runtime', () => {
  beforeEach(() => {
    logged.error.length = 0
  })
  afterEach(() => {
    vi.restoreAllMocks()
    process.exitCode = undefined
  })

  it('are not awaited: a slow observer never holds the call, and the answer goes out first', async () => {
    const loaded = await load()
    let release!: () => void
    const told: string[] = []

    @loaded.Observer()
    class SlowObserver {
      async onSettled(_context: unknown, { outcome }: DispatchResult) {
        await new Promise<void>(resolve => (release = resolve))
        told.push(`slow ${outcome}`)
      }
    }
    @loaded.Observer()
    class NextObserver {
      onSettled(_context: unknown, { outcome }: DispatchResult) {
        told.push(`next ${outcome}`)
      }
    }
    @loaded.Controller()
    class ShopController {
      @loaded.Command('buy', loaded.CommandType.SLASH)
      async buy(interaction: import('discord.js').ChatInputCommandInteraction) {
        await loaded.respond(interaction).send({ content: 'Bought.' })
      }
    }

    const dispatch = await startApp(loaded, { controllers: [ShopController], observers: [SlowObserver, NextObserver] })
    const interaction = loaded.createMockInteraction(loaded.discord.ChatInputCommandInteraction, {
      commandName: 'buy',
      options: loaded.createChatInputOptions({}),
    })

    await dispatch(interaction)

    // Answered, and the slow observer is still waiting: the call did not wait for it
    expect(interaction.reply).toHaveBeenCalledTimes(1)
    expect(told).toEqual([])

    // The later observer runs once the earlier one is done, in the order listed
    release()
    await vi.waitFor(() => expect(told).toEqual(['slow ran', 'next ran']))
  })

  it('log an observer that throws, run the rest, and leave the answer as it was', async () => {
    const loaded = await load()
    const told: string[] = []

    @loaded.Observer()
    class BrokenObserver {
      onSettled(): void {
        throw new Error('metrics backend down')
      }
    }
    @loaded.Observer()
    class AuditObserver {
      onSettled(_context: unknown, { outcome }: DispatchResult) {
        told.push(outcome)
      }
    }
    @loaded.Controller()
    class ShopController {
      @loaded.Command('buy', loaded.CommandType.SLASH)
      async buy(interaction: import('discord.js').ChatInputCommandInteraction) {
        await loaded.respond(interaction).send({ content: 'Bought.' })
      }
    }

    const dispatch = await startApp(loaded, { controllers: [ShopController], observers: [BrokenObserver, AuditObserver] })
    const interaction = loaded.createMockInteraction(loaded.discord.ChatInputCommandInteraction, {
      commandName: 'buy',
      options: loaded.createChatInputOptions({}),
    })

    await dispatch(interaction)
    await vi.waitFor(() => expect(told).toEqual(['ran']))

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: 'Bought.' }))
    expect(logged.error).toContainEqual(['Observer BrokenObserver threw while observing ShopController.buy:', expect.any(Error)])
  })

  it("report an interaction no handler matches as 'not-found', with no handler, answered by the fallback", async () => {
    const loaded = await load()
    const told: { handler: string | undefined; result: DispatchResult }[] = []

    const started: string[] = []

    @loaded.Observer()
    class AuditObserver {
      // An interaction no handler matches has no call to start
      onStart() {
        started.push('start')
      }

      onSettled(context: import('@src/common/index.js').ExecutionContext, result: DispatchResult) {
        told.push({ handler: context.getHandlerName(), result })
      }
    }
    @loaded.Controller()
    class ShopController {
      @loaded.Command('buy', loaded.CommandType.SLASH)
      async buy() {}
    }

    const dispatch = await startApp(loaded, { controllers: [ShopController], observers: [AuditObserver] })
    await dispatch(loaded.createMockInteraction(loaded.discord.ButtonInteraction, { customId: 'nothing/here' }))

    await vi.waitFor(() =>
      expect(told).toEqual([
        {
          handler: undefined,
          result: {
            outcome: 'not-found',
            startedAt: expect.any(Number),
            durationMs: expect.any(Number),
            error: expect.any(loaded.CommandNotFoundError),
            // The fallback's "Command not found!"
            response: 'replied',
            handled: true,
          },
        },
      ]),
    )
    expect(started).toEqual([])
  })

  it("report an autocomplete no handler claims as 'not-found', with no error", async () => {
    const loaded = await load()
    const told: DispatchResult[] = []

    @loaded.Observer()
    class AuditObserver {
      onSettled(_context: unknown, result: DispatchResult) {
        told.push(result)
      }
    }
    @loaded.Controller()
    class ShopController {
      @loaded.Command('buy', loaded.CommandType.SLASH)
      async buy() {}
    }

    const dispatch = await startApp(loaded, { controllers: [ShopController], observers: [AuditObserver] })
    await dispatch(
      loaded.createMockInteraction(loaded.discord.AutocompleteInteraction, {
        commandName: 'sell',
        options: loaded.createChatInputOptions({ focused: 'item', item: 'sw' }),
      }),
    )

    // Closed with an empty list, so it counts as answered
    await vi.waitFor(() =>
      expect(told).toEqual([
        { outcome: 'not-found', startedAt: expect.any(Number), durationMs: expect.any(Number), response: 'replied', handled: false },
      ]),
    )
  })

  it('mark an error the fallback answered as handled, and time the call through the fallback', async () => {
    const loaded = await load()
    const told: DispatchResult[] = []

    @loaded.Observer()
    class AuditObserver {
      onSettled(_context: unknown, result: DispatchResult) {
        told.push(result)
      }
    }
    @loaded.Guard()
    class StaffOnly {
      canActivate(): boolean {
        throw new loaded.GuardDeniedError('Staff only.')
      }
    }
    @loaded.Controller()
    class ShopController {
      @loaded.Command('restock', loaded.CommandType.SLASH)
      @loaded.UseGuard(StaffOnly)
      async restock() {}
    }

    const dispatch = await startApp(loaded, { controllers: [ShopController], observers: [AuditObserver] })
    const interaction = loaded.createMockInteraction(loaded.discord.ChatInputCommandInteraction, {
      commandName: 'restock',
      options: loaded.createChatInputOptions({}),
    })
    // The fallback's answer takes 30 ms, and the duration includes it
    interaction.reply.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 30)))

    await dispatch(interaction)

    await vi.waitFor(() => expect(told).toHaveLength(1))
    expect(told[0]).toMatchObject({ outcome: 'denied', error: expect.any(loaded.GuardDeniedError), handled: true })
    expect(told[0].durationMs).toBeGreaterThanOrEqual(25)
  })

  it('run their lifecycle hooks as services do: an exporter flushes on shutdown, before what it injects closes', async () => {
    const loaded = await load()
    const events: string[] = []

    @loaded.Service()
    class Exporter {
      readonly sent: string[] = []
      onShutdown() {
        events.push('exporter closed')
      }
    }

    @loaded.Observer()
    class BufferingObserver {
      private readonly buffer: string[] = []
      constructor(private readonly exporter: Exporter) {}

      onReady() {
        events.push('observer ready')
      }

      onSettled(_context: unknown, { outcome }: DispatchResult) {
        this.buffer.push(outcome)
      }

      onShutdown() {
        this.exporter.sent.push(...this.buffer.splice(0))
        events.push(`observer flushed ${this.exporter.sent.join(',')}`)
      }
    }
    @loaded.Controller()
    class ShopController {
      @loaded.Command('buy', loaded.CommandType.SLASH)
      async buy() {}
    }

    const clients: Client[] = []
    vi.spyOn(loaded.discord.Client.prototype, 'login').mockImplementation(function (this: Client) {
      clients.push(this)
      return Promise.resolve('token')
    })
    vi.spyOn(loaded.discord.Client.prototype, 'destroy').mockResolvedValue(undefined)
    @loaded.MeoCord({ controllers: [ShopController], observers: [BufferingObserver], clientOptions: { intents: [] } })
    class App {}
    const app = loaded.MeoCordFactory.create(App)
    await app.start()
    const [ready] = clients[0].listeners('clientReady')
    await ready(clients[0])
    const [dispatch] = clients[0].listeners('interactionCreate') as ((interaction: unknown) => Promise<void>)[]

    await dispatch(loaded.createMockInteraction(loaded.discord.ChatInputCommandInteraction, { commandName: 'buy', options: loaded.createChatInputOptions({}) }))
    await dispatch(loaded.createMockInteraction(loaded.discord.ButtonInteraction, { customId: 'nothing/here' }))
    await vi.waitFor(() => expect(events).toContain('observer ready'))
    await new Promise(resolve => setTimeout(resolve, 20))
    await (Reflect.get(app, 'close') as () => Promise<boolean>)()

    expect(events).toEqual(['observer ready', 'observer flushed ran,not-found', 'exporter closed'])
  })

  it("report a patterned message handler's call with its params, and no message no handler matches", async () => {
    const loaded = await load()
    const told: { handler: string | undefined; params: unknown; outcome: string }[] = []

    @loaded.Observer()
    class AuditObserver {
      onSettled(context: import('@src/common/index.js').ExecutionContext, { outcome }: DispatchResult) {
        told.push({ handler: context.getHandlerName(), params: context.getHandlerParams(), outcome })
      }
    }
    @loaded.Controller()
    class DiceController {
      @loaded.MessageHandler('roll {sides}')
      async roll() {}
    }

    const clients: Client[] = []
    vi.spyOn(loaded.discord.Client.prototype, 'login').mockImplementation(function (this: Client) {
      clients.push(this)
      return Promise.resolve('token')
    })
    vi.spyOn(loaded.discord.Client.prototype, 'destroy').mockResolvedValue(undefined)
    @loaded.MeoCord({
      controllers: [DiceController],
      observers: [AuditObserver],
      messages: { prefix: '!' },
      clientOptions: { intents: [] },
    })
    class App {}
    await loaded.MeoCordFactory.create(App).start()
    const [dispatch] = clients[0].listeners('messageCreate') as ((message: unknown) => Promise<void>)[]
    const message = (content: string) => Object.assign(loaded.createMockMessage({ content }), { author: { id: 'ada', bot: false } })

    await dispatch(message('!roll 20'))
    await dispatch(message('!hello there'))
    await dispatch(message('just talking'))

    await vi.waitFor(() => expect(told).toEqual([{ handler: 'roll', params: { sides: '20' }, outcome: 'ran' }]))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(told).toHaveLength(1)
  })

  it("report a message command's usage error as the user's invalid input, not a fault of the bot", async () => {
    const loaded = await load()
    const told: string[] = []

    @loaded.Observer()
    class AuditObserver {
      onSettled(context: import('@src/common/index.js').ExecutionContext, { outcome, error }: DispatchResult) {
        told.push(`${context.getHandlerName() ?? '-'}:${outcome}:${(error as Error | undefined)?.name ?? ''}`)
      }
    }
    @loaded.Controller()
    class ToolsController {
      @loaded.MessageHandler('roll {sides:int}')
      async roll() {}

      @loaded.MessageHandler('purge {count:int} {--bots}')
      async purge() {}

      @loaded.MessageHandler('ban {who}', { scope: 'guild' })
      async ban() {}

      @loaded.MessageHandler('config set {key} {value}')
      async set() {}

      @loaded.MessageHandler('config get {key}')
      async get() {}
    }

    const clients: Client[] = []
    vi.spyOn(loaded.discord.Client.prototype, 'login').mockImplementation(function (this: Client) {
      clients.push(this)
      return Promise.resolve('token')
    })
    vi.spyOn(loaded.discord.Client.prototype, 'destroy').mockResolvedValue(undefined)
    @loaded.MeoCord({
      controllers: [ToolsController],
      observers: [AuditObserver],
      messages: { prefix: '!', deleteUsageRepliesAfter: 0 },
      clientOptions: { intents: [] },
    })
    class App {}
    await loaded.MeoCordFactory.create(App).start()
    const [dispatch] = clients[0].listeners('messageCreate') as ((message: unknown) => Promise<void>)[]
    const message = (content: string, guild?: null) =>
      Object.assign(loaded.createMockMessage({ content, ...(guild === null && { guild: null }) }), { author: { id: 'ada', bot: false } })

    // A word of the wrong type, a param left out, a flag the command lacks, a server command in a DM, and a parent
    for (const sent of [message('!roll abc'), message('!roll'), message('!purge 5 --nope'), message('!ban ana', null), message('!config')]) {
      await dispatch(sent)
    }

    await vi.waitFor(() => expect(told).toHaveLength(5))
    expect(told).toEqual([
      'roll:invalid:MessageUsageError',
      'roll:invalid:MessageUsageError',
      'purge:invalid:MessageUsageError',
      'ban:invalid:MessageUsageError',
      '-:invalid:MessageUsageError',
    ])
  })
})

