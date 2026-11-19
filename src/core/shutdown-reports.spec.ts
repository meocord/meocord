import { inspect, stripVTControlCharacters } from 'node:util'
import { type ChatInputCommandInteraction, type Client } from 'discord.js'
import { vi } from 'vitest'
import type * as AppModule from '@src/core/meocord.app.js'
import type * as FactoryModule from '@src/core/meocord-factory.js'
import type * as DecoratorModule from '@src/decorator/index.js'
import type * as LoggerModule from '@src/common/logger.js'
import type * as CommonModule from '@src/common/index.js'
import type * as EnumModule from '@src/enum/index.js'
import type * as TestingModule from '@src/testing/index.js'
import { forgetProcessState } from '@src/core/process-state.js'

const { config } = vi.hoisted(() => ({ config: { discordToken: 'token' } as { discordToken: string; shutdownTimeout?: number } }))
vi.mock('@src/util/meocord-config-loader.util.js', () => ({ loadMeoCordConfig: () => config }))
vi.mock('@src/util/platform.util.js', () => ({ assertBuiltForThisPlatform: () => {} }))

/** A value whose inspection throws, as an application's hook may throw it. */
const uninspectable = () => ({
  [inspect.custom]: () => {
    throw new Error('inspect.custom')
  },
})

/** Fresh modules and a forgotten shutdown per test, as a new process has: the running apps and the shutdown are process-wide. */
async function load() {
  vi.resetModules()
  forgetProcessState()
  const discord = await import('discord.js')
  const app: typeof AppModule = await import('@src/core/meocord.app.js')
  const factory: typeof FactoryModule = await import('@src/core/meocord-factory.js')
  const decorators: typeof DecoratorModule = await import('@src/decorator/index.js')
  const logger: typeof LoggerModule = await import('@src/common/logger.js')
  const common: typeof CommonModule = await import('@src/common/index.js')
  const enums: typeof EnumModule = await import('@src/enum/index.js')
  const testing: typeof TestingModule = await import('@src/testing/index.js')
  return { discord, ...app, ...factory, ...decorators, ...logger, respond: common.respond, ...enums, ...testing }
}

/** Each line printed, without colour and timestamp, prefixed with the console method that printed it. */
let printed: string[]
const uncaught: unknown[] = []
const onUncaught = (error: unknown) => void uncaught.push(error)
const ran: string[] = []

beforeEach(() => {
  printed = []
  ran.length = 0
  uncaught.length = 0
  for (const method of ['log', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      const line = stripVTControlCharacters(args.map(String).join(' ')).replace(/^.*?UTC[+-]\d\d:\d\d /, '')
      printed.push(`${method} ${line}`)
    })
  }
  process.on('uncaughtException', onUncaught)
  process.on('unhandledRejection', onUncaught)
})

afterEach(() => {
  vi.useRealTimers()
  delete config.shutdownTimeout
  process.off('uncaughtException', onUncaught)
  process.off('unhandledRejection', onUncaught)
  vi.restoreAllMocks()
  forgetProcessState()
})

/**
 * Starts an app as a built bot does, login mocked, whose second service's `onShutdown` throws such a value, then
 * stops it as a signal's handler does, without waiting.
 */
async function stopBySignal(loaded: Awaited<ReturnType<typeof load>>) {
  const clients: Client[] = []
  vi.spyOn(loaded.discord.Client.prototype, 'login').mockImplementation(function (this: Client) {
    clients.push(this)
    return Promise.resolve('token')
  })
  const destroy = vi.spyOn(loaded.discord.Client.prototype, 'destroy').mockResolvedValue(undefined)
  const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)

  @loaded.Service()
  class First {
    onShutdown() {
      ran.push('First.onShutdown')
    }
  }
  @loaded.Service()
  class Second {
    constructor(readonly first: First) {}
    onShutdown() {
      ran.push('Second.onShutdown')
      throw uninspectable()
    }
  }
  Reflect.defineMetadata('design:paramtypes', [First], Second)
  @loaded.MeoCord({ controllers: [], services: [First, Second], clientOptions: { intents: [] } })
  class App {}

  await loaded.MeoCordFactory.create(App).start()
  const client = clients[0]!
  await (client.listeners('clientReady')[0] as (ready: Client) => Promise<void>)(client)

  void loaded.shutdownAndExit(false)
  await vi.waitFor(() => expect(exit).toHaveBeenCalled())
  for (let i = 0; i < 3; i++) await new Promise(resolve => setTimeout(resolve, 0))
  return { destroy, exit }
}

const errors = () => printed.filter(line => line.startsWith('error '))

describe('a stop by signal whose onShutdown hook throws a value whose inspection throws', () => {
  it('reports the hook, runs every hook, destroys the client and exits 0', async () => {
    const { destroy, exit } = await stopBySignal(await load())

    expect(uncaught).toEqual([])
    expect(ran).toEqual(['Second.onShutdown', 'First.onShutdown'])
    expect(errors()).toEqual(['error [ERROR] [MeoCordApp] onShutdown failed in Second: [value could not be inspected: inspect.custom]'])
    expect(destroy).toHaveBeenCalledOnce()
    expect(exit.mock.calls).toEqual([[0]])
  })

  it('still runs every hook, destroys the client and exits, 1, when reporting the hook throws', async () => {
    const loaded = await load()
    const error = loaded.Logger.prototype.error
    vi.spyOn(loaded.Logger.prototype, 'error').mockImplementation(function (this: LoggerModule.Logger, ...args: unknown[]) {
      if (String(args[0]).startsWith('onShutdown failed')) throw new Error('report broke')
      error.apply(this, args)
    })

    const { destroy, exit } = await stopBySignal(loaded)

    expect(uncaught).toEqual([])
    expect(ran).toEqual(['Second.onShutdown', 'First.onShutdown'])
    expect(destroy).toHaveBeenCalledOnce()
    expect(errors()).toEqual([
      expect.stringMatching(/^error \[ERROR\] \[MeoCordApp\] Error during shutdown: AggregateError: Reporting a failed onShutdown hook threw\./),
    ])
    expect(exit.mock.calls).toEqual([[1]])
  })
})

describe('a stop by signal that throws before it closes the client', () => {
  /** Makes the logger throw on each line whose text starts with one of `starts`, and print the rest. */
  function throwOn(loaded: Awaited<ReturnType<typeof load>>, ...starts: string[]) {
    for (const level of ['log', 'error'] as const) {
      const original = loaded.Logger.prototype[level]
      vi.spyOn(loaded.Logger.prototype, level).mockImplementation(function (this: LoggerModule.Logger, ...args: unknown[]) {
        if (starts.some(start => String(args[0]).startsWith(start))) throw new Error(`${level} broke`)
        original.apply(this, args)
      })
    }
  }

  it('reports what it threw and exits 1', async () => {
    const loaded = await load()
    throwOn(loaded, 'Shutting down bot')

    const { exit } = await stopBySignal(loaded)

    expect(uncaught).toEqual([])
    expect(errors()).toEqual([expect.stringMatching(/^error \[ERROR\] \[MeoCordApp\] Error during shutdown: Error: log broke\n/)])
    expect(exit.mock.calls).toEqual([[1]])
  })

  it('exits 1 even when reporting it throws too', async () => {
    const loaded = await load()
    throwOn(loaded, 'Shutting down bot', 'Error during shutdown')

    const { exit } = await stopBySignal(loaded)

    expect(exit.mock.calls).toEqual([[1]])
  })
})

describe('a stop whose report of a failed onShutdown hook throws while a theme lookup is in flight', () => {
  /** The shutdown's whole budget: the drain has 3 s of it, then the hooks run and the lookup is abandoned. */
  const SHUTDOWN_TIMEOUT_MS = 4000
  const GUILD = '100000000000000001'
  /** Longer than the drain, so the stop, not the resolver's timeout, is what ends the lookup. */
  const THEME_TIMEOUT_MS = 5000

  it('runs every hook, abandons the lookup, and reports what the report threw once', async () => {
    const loaded = await load()
    config.shutdownTimeout = SHUTDOWN_TIMEOUT_MS
    const error = loaded.Logger.prototype.error
    vi.spyOn(loaded.Logger.prototype, 'error').mockImplementation(function (this: LoggerModule.Logger, ...args: unknown[]) {
      if (String(args[0]).startsWith('onShutdown failed')) throw new Error('report broke')
      error.apply(this, args)
    })
    const clients: Client[] = []
    vi.spyOn(loaded.discord.Client.prototype, 'login').mockImplementation(function (this: Client) {
      clients.push(this)
      return Promise.resolve('token')
    })
    const destroy = vi.spyOn(loaded.discord.Client.prototype, 'destroy').mockResolvedValue(undefined)
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)

    @loaded.Service()
    class First {
      onShutdown() {
        ran.push('First.onShutdown')
      }
    }
    @loaded.Service()
    class Second {
      constructor(readonly first: First) {}
      onShutdown() {
        ran.push('Second.onShutdown')
        throw uninspectable()
      }
    }
    Reflect.defineMetadata('design:paramtypes', [First], Second)
    @loaded.Controller()
    class Calls {
      @loaded.Defer()
      @loaded.Command('eager', loaded.CommandType.SLASH)
      async eager(interaction: ChatInputCommandInteraction) {
        await loaded.respond(interaction).send({ embeds: [{ description: 'pong' }] })
      }
    }
    // A server theme resolver that never answers, so the deferred call's lookup is in flight when the stop begins
    @loaded.MeoCord({ controllers: [Calls], services: [First, Second], clientOptions: { intents: [] }, themeFor: { guild: () => new Promise(() => undefined) }, themeForTimeoutMs: THEME_TIMEOUT_MS })
    class App {}

    const app = loaded.MeoCordFactory.create(App)
    await app.start()
    const client = clients[0]!
    Object.defineProperty(client, 'application', { value: { id: '100000000000000002' }, configurable: true })
    vi.spyOn(client.rest, 'get').mockResolvedValue([])
    vi.spyOn(client.rest, 'put').mockResolvedValue([])
    for (const listener of client.listeners('clientReady')) await (listener as (c: Client) => Promise<void>)(client)

    vi.useFakeTimers()
    const interaction = loaded.createMockInteraction(loaded.discord.ChatInputCommandInteraction, {
      commandName: 'eager',
      guildId: GUILD,
      options: loaded.createChatInputOptions({}),
    } as never)
    const [dispatch] = client.listeners('interactionCreate') as ((interaction: unknown) => Promise<void>)[]
    const handled = dispatch(interaction)
    await vi.advanceTimersByTimeAsync(100)

    const stopping = app.stop()
    await vi.advanceTimersByTimeAsync(SHUTDOWN_TIMEOUT_MS)
    await stopping
    const atStop = [...printed]
    const armed = vi.getTimerCount()
    await vi.advanceTimersByTimeAsync(2 * SHUTDOWN_TIMEOUT_MS)
    await handled

    expect(uncaught).toEqual([])
    expect(ran).toEqual(['Second.onShutdown', 'First.onShutdown'])
    expect(destroy).toHaveBeenCalledOnce()
    expect(armed).toBe(0)
    expect(printed).toEqual(atStop)
    expect(errors()).toEqual([
      expect.stringMatching(/^error \[ERROR\] \[MeoCordApp\] Error during shutdown: AggregateError: Reporting a failed onShutdown hook threw\./),
    ])
  })
})
