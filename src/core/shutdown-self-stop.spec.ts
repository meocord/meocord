import { vi } from 'vitest'
import { type Client } from 'discord.js'
import type * as AppModule from '@src/core/meocord.app.js'
import type * as FactoryModule from '@src/core/meocord-factory.js'
import type * as DecoratorModule from '@src/decorator/index.js'
import type * as TestingModule from '@src/testing/index.js'
import { forgetProcessState } from '@src/core/process-state.js'
import { CommandType } from '@src/enum/index.js'

const { log, config, logging } = vi.hoisted(() => ({
  log: [] as string[],
  config: { discordToken: 'token', shutdownTimeout: 1000 } as { discordToken: string; shutdownTimeout: number },
  /** The lines whose logging throws: the close's first, then its report of that, so the close itself rejects. */
  logging: { throwsOn: [] as string[] },
}))

vi.mock('@src/common/index.js', async importOriginal => ({
  ...(await importOriginal<object>()),
  Logger: class {
    log = (...args: unknown[]) => {
      if (logging.throwsOn.some(line => String(args[0]).startsWith(line))) throw new Error('log broke')
    }
    debug = vi.fn()
    info = vi.fn()
    verbose = vi.fn()
    warn = (...args: unknown[]) => void log.push(`warn: ${args.map(String).join(' ')}`)
    error = (...args: unknown[]) => {
      if (logging.throwsOn.some(line => String(args[0]).startsWith(line))) throw new Error('log broke')
      log.push(`error: ${args.map(String).join(' ')}`)
    }
  },
}))
vi.mock('@src/util/meocord-config-loader.util.js', () => ({ loadMeoCordConfig: () => config }))
vi.mock('@src/util/platform.util.js', () => ({ assertBuiltForThisPlatform: () => {} }))

/** Fresh modules and a forgotten shutdown per test, as a new process has: the running apps and the shutdown are process-wide. */
async function load() {
  vi.resetModules()
  forgetProcessState()
  const discord = await import('discord.js')
  const app: typeof AppModule = await import('@src/core/meocord.app.js')
  const factory: typeof FactoryModule = await import('@src/core/meocord-factory.js')
  const decorators: typeof DecoratorModule = await import('@src/decorator/index.js')
  const testing: typeof TestingModule = await import('@src/testing/index.js')
  vi.spyOn(discord.Client.prototype, 'login').mockResolvedValue('token')
  vi.spyOn(discord.Client.prototype, 'destroy').mockImplementation(async () => void log.push('client destroyed'))
  return { discord, ...app, ...factory, ...decorators, ...testing }
}

type Loaded = Awaited<ReturnType<typeof load>>

/** An app the tests stop, set once it is made, which the hooks reach. */
const target: { app?: { stop(): Promise<void> } } = {}

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/** Logs in an app of `services` and runs its ready listeners, so a stop runs their onShutdown hooks. */
async function online(loaded: Loaded, services: (new (...args: any[]) => unknown)[]) {
  @loaded.MeoCord({ controllers: [], services, clientOptions: { allowedMentions: { parse: [] }, intents: [] } } as never)
  class App {}
  const app = loaded.MeoCordFactory.create(App)
  target.app = app
  await app.start()
  const client = (app as unknown as { bot: Client }).bot
  for (const listener of client.listeners('clientReady')) await (listener as (c: Client) => Promise<void>)(client)
  // What startup warned about is not what these tests read
  log.length = 0
  return app
}

/**
 * `First`, and `SelfWait`, which injects it and so shuts down before it, its onShutdown doing `stops` with the app's
 * stop. `First` closes a timer's turn after it begins, so a stop that waited for nothing would resolve before it.
 */
function services(loaded: Loaded, stops: (stop: () => Promise<void>) => Promise<unknown>) {
  @loaded.Service()
  class First {
    async onShutdown() {
      await delay(0)
      log.push('First closed')
    }
  }
  @loaded.Service()
  class SelfWait {
    constructor(readonly first: First) {}
    async onShutdown() {
      await stops(() => target.app!.stop())
      log.push('SelfWait closed')
    }
  }
  Reflect.defineMetadata('design:paramtypes', [First], SelfWait)
  return [First, SelfWait]
}

describe('an onShutdown hook that stops the app it shuts down', () => {
  const exitCode = process.exitCode

  beforeEach(() => {
    log.length = 0
    config.shutdownTimeout = 1000
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => void log.push(`process.exit(${code})`)) as never)
  })
  afterEach(() => {
    logging.throwsOn = []
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.removeAllListeners(signal)
    process.exitCode = exitCode ?? 0
    vi.restoreAllMocks()
  })

  it.each([
    ['after an await', async (stop: () => Promise<void>) => (await delay(0), await stop())],
    ['before any await', (stop: () => Promise<void>) => stop()],
    ['inside a function it calls', (stop: () => Promise<void>) => Promise.resolve().then(() => stop())],
  ])('goes on at once when it awaits stop() %s, and the hooks after it run before the stop resolves', async (_when, stops) => {
    const loaded = await load()
    const app = await online(loaded, services(loaded, stop => stops(stop).then(() => log.push('its stop() resolved'))))

    await app.stop().then(() => log.push('stop resolved'))

    expect(log).toEqual(['its stop() resolved', 'SelfWait closed', 'First closed', 'client destroyed', 'stop resolved'])
  })

  it('runs the hooks after it before the process exits, when a signal stops the app', async () => {
    const loaded = await load()
    await online(loaded, services(loaded, stop => stop()))

    process.emit('SIGINT')
    await vi.waitFor(() => expect(log).toContain('process.exit(0)'))

    expect(log).toEqual(['SelfWait closed', 'First closed', 'client destroyed', 'process.exit(0)'])
  })

  it.each([
    ['after an await', true],
    ['before any await', false],
  ])("goes on at once in a failed start's shutdown when it awaits stop() %s, and the stop resolves after it", async (_when, awaitFirst) => {
    const loaded = await load()
    @loaded.MeoCord({
      controllers: [],
      providers: [
        { provide: 'FIRST', useFactory: async () => ({ onShutdown: () => void log.push('FIRST closed') }) },
        {
          provide: 'SELF',
          inject: ['FIRST'],
          useFactory: async () => ({
            onShutdown: async () => {
              if (awaitFirst) await delay(0)
              await target.app!.stop()
              log.push('SELF closed')
            },
          }),
        },
        {
          provide: 'SLOW',
          inject: ['SELF'],
          useFactory: async () => {
            throw new Error('connection refused')
          },
        },
      ],
      clientOptions: { allowedMentions: { parse: [] }, intents: [] },
    } as never)
    class App {}
    const app = loaded.MeoCordFactory.create(App)
    target.app = app

    await app.start().catch((error: Error) => log.push(`start rejected: ${error.message}`))
    // The stop the hook began is the one under way: this joins it
    await app.stop().then(() => log.push('stop resolved'))

    expect(log).toEqual([
      "error: The factory providing 'SLOW' failed: connection refused. The bot cannot start without it.",
      'SELF closed',
      'FIRST closed',
      "start rejected: The factory providing 'SLOW' failed: connection refused",
      'client destroyed',
      'stop resolved',
    ])
  })

  it.each([
    ['the client fails to close', 'destroy'],
    ['the close and its report throw', 'log'],
  ])("exits 1, with nothing unhandled, when the stop a failed start's hook began is the only one and %s", async (_how, fails) => {
    const loaded = await load()
    if (fails === 'destroy') vi.spyOn(loaded.discord.Client.prototype, 'destroy').mockRejectedValue(new Error('gateway stuck'))
    else logging.throwsOn = ['Shutting down bot', 'Error during shutdown']
    process.exitCode = 0
    @loaded.MeoCord({
      controllers: [],
      providers: [
        { provide: 'SELF', useFactory: async () => ({ onShutdown: () => target.app!.stop() }) },
        {
          provide: 'SLOW',
          inject: ['SELF'],
          useFactory: async () => {
            throw new Error('connection refused')
          },
        },
      ],
      clientOptions: { allowedMentions: { parse: [] }, intents: [] },
    } as never)
    class App {}
    const app = loaded.MeoCordFactory.create(App)
    target.app = app

    await app.start().catch(() => undefined)

    await vi.waitFor(() => expect(process.exitCode).toBe(1))
  })

  it('waits for the shutdown when work the hook left behind calls stop() after the hook returned', async () => {
    const loaded = await load()
    let left: Promise<unknown> | undefined
    const app = await online(
      loaded,
      services(loaded, async stop => {
        // Called once the hook has returned, while First's onShutdown runs
        setTimeout(() => (left = stop().then(() => log.push('its stop() resolved'))), 0)
      }),
    )

    await app.stop().then(() => log.push('stop resolved'))
    await left

    expect(log).toEqual(['SelfWait closed', 'First closed', 'client destroyed', 'stop resolved', 'its stop() resolved'])
  })

  it('goes on at once when work the hook started calls stop() while the hook still runs', async () => {
    const loaded = await load()
    let started: Promise<unknown> | undefined
    const app = await online(
      loaded,
      services(loaded, async stop => {
        // Not awaited, and the hook runs on for 100 ms after the work's stop()
        started = (async () => {
          await delay(5)
          await stop()
          log.push('its stop() resolved')
        })()
        await delay(100)
      }),
    )

    await app.stop().then(() => log.push('stop resolved'))
    await started

    expect(log).toEqual(['its stop() resolved', 'SelfWait closed', 'First closed', 'client destroyed', 'stop resolved'])
  })

  it("waits for another app's whole stop", async () => {
    const loaded = await load()
    @loaded.Service()
    class Other {
      async onShutdown() {
        await delay(10)
        log.push('Other closed')
      }
    }
    @loaded.MeoCord({ controllers: [], services: [Other], clientOptions: { allowedMentions: { parse: [] }, intents: [] } } as never)
    class OtherApp {}
    const other = loaded.MeoCordFactory.create(OtherApp)
    await other.start()
    const otherClient = (other as unknown as { bot: Client }).bot
    for (const listener of otherClient.listeners('clientReady')) await (listener as (c: Client) => Promise<void>)(otherClient)

    @loaded.Service()
    class StopsOther {
      async onShutdown() {
        await other.stop()
        log.push('StopsOther closed')
      }
    }
    const app = await online(loaded, [StopsOther])

    await app.stop().then(() => log.push('stop resolved'))

    expect(log).toEqual(['Other closed', 'client destroyed', 'StopsOther closed', 'client destroyed', 'stop resolved'])
  })

  it('still waits for a hook running when stop() is awaited from outside', async () => {
    const loaded = await load()
    const app = await online(loaded, services(loaded, async () => undefined))

    const first = app.stop().then(() => log.push('stop resolved'))
    await delay(0)
    await app.stop().then(() => log.push('second stop resolved'))
    await first

    expect(log).toEqual(['SelfWait closed', 'First closed', 'client destroyed', 'stop resolved', 'second stop resolved'])
  })
})

describe("an onShutdown hook that closes the testing module it shuts down", () => {
  beforeEach(() => {
    log.length = 0
  })

  it.each([
    ['after an await', true],
    ['before any await', false],
  ])('goes on at once when it awaits close() %s, and the hooks after it run before the close resolves', async (_when, awaitFirst) => {
    const loaded = await load()
    const box: { module?: { close(): Promise<void> } } = {}
    @loaded.Service()
    class First {
      async onShutdown() {
        await delay(0)
        log.push('First closed')
      }
    }
    @loaded.Service()
    class SelfWait {
      constructor(readonly first: First) {}
      async onShutdown() {
        if (awaitFirst) await delay(0)
        await box.module!.close()
        log.push('SelfWait closed')
      }
    }
    Reflect.defineMetadata('design:paramtypes', [First], SelfWait)
    @loaded.Controller()
    class Calls {
      constructor(readonly selfWait: SelfWait) {}
    }
    Reflect.defineMetadata('design:paramtypes', [SelfWait], Calls)
    const module = loaded.MeoCordTestingModule.create({ controllers: [Calls], shutdownTimeout: 1000 }).compile()
    box.module = module
    await module.init()
    module.get(SelfWait)

    await module.close().then(() => log.push('close resolved'))

    expect(log).toEqual(['SelfWait closed', 'First closed', 'close resolved'])
  })

  it('waits for the close when work the hook left behind calls close() after the hook returned', async () => {
    const loaded = await load()
    const box: { module?: { close(): Promise<void> } } = {}
    let left: Promise<unknown> | undefined
    @loaded.Service()
    class First {
      async onShutdown() {
        await delay(0)
        log.push('First closed')
      }
    }
    @loaded.Service()
    class SelfWait {
      constructor(readonly first: First) {}
      onShutdown() {
        // Called once the hook has returned, while First's onShutdown runs
        setTimeout(() => (left = box.module!.close().then(() => log.push('its close() resolved'))), 0)
        log.push('SelfWait closed')
      }
    }
    Reflect.defineMetadata('design:paramtypes', [First], SelfWait)
    @loaded.Controller()
    class Calls {
      constructor(readonly selfWait: SelfWait) {}
    }
    Reflect.defineMetadata('design:paramtypes', [SelfWait], Calls)
    const module = loaded.MeoCordTestingModule.create({ controllers: [Calls], shutdownTimeout: 1000 }).compile()
    box.module = module
    await module.init()
    module.get(SelfWait)

    await module.close().then(() => log.push('close resolved'))
    await left

    expect(log).toEqual(['SelfWait closed', 'First closed', 'close resolved', 'its close() resolved'])
  })
})

describe('a call that closes the testing module it runs in', () => {
  beforeEach(() => {
    log.length = 0
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // With a cooldown store to close, the close drains the calls; the call awaiting it is left out, as stop() leaves it
  it('goes on at once, the store closing after it, with no wait for itself', async () => {
    const loaded = await load()
    const { MemoryCooldownStore } = await import('@src/common/index.js')
    // The testing module logs through the logger itself, which this file's mock of @src/common leaves as it is
    const { Logger } = await import('@src/common/logger.js')
    vi.spyOn(Logger.prototype, 'warn').mockImplementation((...args: unknown[]) => void log.push(`warn: ${String(args[0])}`))
    const box: { module?: { close(): Promise<void> } } = {}
    class Store extends MemoryCooldownStore {
      onShutdown() {
        log.push('store closed')
      }
    }
    @loaded.Controller()
    class Admin {
      @loaded.Cooldown({ seconds: 5 })
      @loaded.Command('shutdown', CommandType.SLASH)
      async shutdown() {
        log.push('handler closes')
        await box.module!.close()
        log.push("handler's close resolved")
      }
    }
    @loaded.MeoCord({ controllers: [Admin], cooldownStore: Store, clientOptions: { intents: [] } } as never)
    class App {}
    const module = await loaded.MeoCordTestingModule.fromApp(App, { shutdownTimeout: 400 }).compile().init()
    box.module = module

    const { ran } = await module.dispatch(loaded.createMockInteraction(loaded.discord.ChatInputCommandInteraction, { commandName: 'shutdown' }))

    expect(ran).toBe(true)
    // A close that waited for its own caller would log the drain's warning before the store closes
    expect(log).toEqual(['handler closes', 'store closed', "handler's close resolved"])
  })
})
