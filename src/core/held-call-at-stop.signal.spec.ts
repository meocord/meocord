// Real timers throughout: a fake timer fires outside the call's AsyncLocalStorage context, which the gate reads
import { vi } from 'vitest'
import { type ChatInputCommandInteraction, type Client } from 'discord.js'
import type * as AppModule from '@src/core/meocord.app.js'
import type * as FactoryModule from '@src/core/meocord-factory.js'
import type * as DecoratorModule from '@src/decorator/index.js'
import type * as EnumModule from '@src/enum/index.js'
import type * as TestingModule from '@src/testing/index.js'
import type * as StrictModule from '@src/testing/strict-mocks.js'
import { forgetProcessState } from '@src/core/process-state.js'
import { WARM_UP_TIMEOUT_MS } from '@src/spec-timeouts.js'

// A signal's shutdown exits as soon as the client is closed, so a dropped call's deferred reply is deleted before it

const { logged, config } = vi.hoisted(() => ({
  logged: [] as string[],
  config: { discordToken: 'token', shutdownTimeout: 400 },
}))

vi.mock('@src/common/index.js', async importOriginal => ({
  ...(await importOriginal<object>()),
  Logger: class {
    log = vi.fn()
    debug = vi.fn()
    info = vi.fn()
    verbose = vi.fn()
    warn = (...args: unknown[]) => logged.push(String(args[0]))
    error = (...args: unknown[]) => logged.push(String(args[0]))
  },
}))
vi.mock('@src/util/meocord-config-loader.util.js', () => ({ loadMeoCordConfig: () => config }))
vi.mock('@src/util/platform.util.js', () => ({ assertBuiltForThisPlatform: () => {} }))

const STOP_MESSAGE = 'The bot stopped before this call started.'
/** How long the deferred reply's deletion takes: well within the 100 ms the stop gives it at this shutdownTimeout. */
const DELETE_MS = 20

/** Fresh modules and a forgotten process state per test, as a new process has: the signal handlers are process-wide. */
async function load() {
  vi.resetModules()
  forgetProcessState()
  const discord = await import('discord.js')
  const factory: typeof FactoryModule = await import('@src/core/meocord-factory.js')
  const app: typeof AppModule = await import('@src/core/meocord.app.js')
  const decorators: typeof DecoratorModule = await import('@src/decorator/index.js')
  const enums: typeof EnumModule = await import('@src/enum/index.js')
  const testing: typeof TestingModule = await import('@src/testing/index.js')
  const strict: typeof StrictModule = await import('@src/testing/strict-mocks.js')
  return { discord, ...factory, ...app, ...decorators, ...enums, ...testing, ...strict }
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

describe.each([
  ['default mode', false],
  ['strict mode', true],
])("a call held at the gate when a signal stops the bot, in %s", (_mode, strict) => {
  /** The signal listeners there were before the row, which it leaves in place. */
  let before: Set<unknown>

  beforeAll(() => load(), WARM_UP_TIMEOUT_MS)
  beforeEach(() => {
    logged.length = 0
    before = new Set([...process.listeners('SIGINT'), ...process.listeners('SIGTERM')])
  })
  afterEach(() => {
    vi.restoreAllMocks()
    for (const name of ['SIGINT', 'SIGTERM'] as const) {
      for (const listener of process.listeners(name)) if (!before.has(listener)) process.off(name, listener as never)
    }
    forgetProcessState()
  })

  it("has its eager @Defer's deferred reply deleted before the client is destroyed and the process exits", async () => {
    const loaded = await load()
    loaded.forgetStrictMocks()
    if (strict) loaded.useStrictMocks()
    const events: string[] = []
    const warm = Promise.withResolvers<void>()
    vi.spyOn(process, 'exit').mockImplementation(((code: number) => void events.push(`process.exit(${code})`)) as never)
    const clients: Client[] = []
    vi.spyOn(loaded.discord.Client.prototype, 'login').mockImplementation(function (this: Client) {
      clients.push(this)
      return Promise.resolve('token')
    })
    vi.spyOn(loaded.discord.Client.prototype, 'destroy').mockImplementation(async () => void events.push('client.destroy'))

    @loaded.Service()
    class Cache {
      async onReady() {
        await warm.promise
      }
    }
    /** Ready as soon as it is made, so the stop's hooks always shut it down: the mark of when they ran. */
    @loaded.Service()
    class Ledger {
      onShutdown() {
        events.push('Ledger.onShutdown')
      }
    }
    @loaded.Controller()
    class Slow {
      constructor(readonly cache: Cache) {}
      @loaded.Defer()
      @loaded.Command('slow', loaded.CommandType.SLASH)
      slow() {
        events.push('slow runs')
      }
    }
    Reflect.defineMetadata('design:paramtypes', [Cache], Slow)
    @loaded.MeoCord({ controllers: [Slow], services: [Ledger, Cache], waitForReady: true, clientOptions: { allowedMentions: { parse: [] }, intents: [] } })
    class App {}

    await loaded.MeoCordFactory.create(App).start()
    const client = clients.at(-1)!
    void (client.listeners('clientReady')[0] as (client: Client) => Promise<void>)(client)
    const held = loaded.createMockInteraction(loaded.discord.ChatInputCommandInteraction, { commandName: 'slow', client } as never) as ChatInputCommandInteraction
    vi.mocked(held.deleteReply).mockImplementation(async () => {
      await sleep(DELETE_MS)
      events.push('deleteReply')
      return undefined as never
    })
    for (const listener of client.listeners('interactionCreate')) void (listener as (interaction: unknown) => unknown)(held)
    await sleep(50)

    process.emit('SIGTERM')
    await vi.waitFor(() => expect(events.at(-1)).toMatch(/^process\.exit/), { timeout: 2_000 })

    expect(events).toEqual(['deleteReply', 'Ledger.onShutdown', 'client.destroy', 'process.exit(0)'])
    expect(loaded.getResponse(held).calls.map(call => call.method)).toEqual(['deferReply', 'deleteReply'])
    expect(logged).toContain('Calls dropped before they started, as the stop came while they waited: interaction "/slow" for onReady in Cache.')
    expect(logged.join('\n')).not.toContain(STOP_MESSAGE)
    warm.resolve()
  })
})
