import { vi } from 'vitest'
import { type Client } from 'discord.js'
import type * as AppModule from '@src/core/meocord.app.js'
import type * as FactoryModule from '@src/core/meocord-factory.js'
import type * as DecoratorModule from '@src/decorator/index.js'
import type * as CommonModule from '@src/common/index.js'
import { type OnReady, type OnShutdown, type Provider } from '@src/interface/index.js'

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
  const app: typeof AppModule = await import('@src/core/meocord.app.js')
  const factory: typeof FactoryModule = await import('@src/core/meocord-factory.js')
  const decorators: typeof DecoratorModule = await import('@src/decorator/index.js')
  const common: typeof CommonModule = await import('@src/common/index.js')
  return { discord, ...app, ...factory, ...decorators, ...common }
}
type Loaded = Awaited<ReturnType<typeof load>>

/** Builds an app from the factory with a client that logs in without a network. */
function create(loaded: Loaded, options: { controllers?: any[]; services?: any[]; providers?: Provider[]; cooldownStore?: any }) {
  const logins: Client[] = []
  vi.spyOn(loaded.discord.Client.prototype, 'login').mockImplementation(function (this: Client) {
    logins.push(this)
    return Promise.resolve('token')
  })
  vi.spyOn(loaded.discord.Client.prototype, 'destroy').mockResolvedValue(undefined)
  @loaded.MeoCord({
    controllers: options.controllers ?? [],
    services: options.services,
    providers: options.providers,
    cooldownStore: options.cooldownStore,
    clientOptions: { intents: [] },
  })
  class App {}
  const app = loaded.MeoCordFactory.create(App)
  const container = Reflect.get(app, 'container') as { get(token: unknown): any }
  return { app, container, logins }
}

async function becomeReady(client: Client): Promise<void> {
  const [listener] = client.listeners('clientReady')
  await listener(client)
}

describe('@MeoCord({ providers })', () => {
  beforeEach(() => {
    logged.error.length = 0
  })
  afterEach(() => {
    vi.restoreAllMocks()
    process.exitCode = undefined
  })

  it('injects a value by a string, a symbol or a typed token', async () => {
    const loaded = await load()
    const PREFIX = Symbol('prefix')
    const LIMITS = loaded.createToken<{ max: number }>('Limits')

    @loaded.Service()
    class Settings {
      constructor(
        @loaded.Inject('appName') readonly appName: string,
        @loaded.Inject(PREFIX) readonly prefix: string,
        @loaded.Inject(LIMITS) readonly limits: { max: number },
      ) {}
    }

    const { app, container } = create(loaded, {
      services: [Settings],
      providers: [
        { provide: 'appName', useValue: 'Meo' },
        { provide: PREFIX, useValue: '!' },
        { provide: LIMITS, useValue: { max: 3 } },
      ],
    })
    await app.start()

    expect(container.get(Settings)).toMatchObject({ appName: 'Meo', prefix: '!', limits: { max: 3 } })
  })

  it('provides a class in place of another, injected by the parameter type', async () => {
    const loaded = await load()
    abstract class Storage {
      abstract kind(): string
    }
    class MemoryStorage extends Storage {
      kind() {
        return 'memory'
      }
    }

    @loaded.Service()
    class Notes {
      constructor(readonly storage: Storage) {}
    }

    const { app, container } = create(loaded, { services: [Notes], providers: [{ provide: Storage, useClass: MemoryStorage }] })
    await app.start()

    expect(container.get(Notes).storage).toBeInstanceOf(MemoryStorage)
    expect(container.get(Storage)).toBe(container.get(Notes).storage)
  })

  it('binds a provided class once, in whichever order the providers are listed', async () => {
    for (const order of ['dependent first', 'dependency first'] as const) {
      const loaded = await load()

      @loaded.Service()
      class Greeting {
        text() {
          return 'Hello'
        }
      }
      @loaded.Service()
      class Status {
        constructor(readonly greeting: Greeting) {}
      }

      const providers: Provider[] = [
        { provide: Status, useClass: Status },
        { provide: Greeting, useClass: Greeting },
      ]
      if (order === 'dependency first') providers.reverse()
      const { app, container } = create(loaded, { providers })
      await app.start()

      expect(container.get(Status).greeting.text()).toBe('Hello')
      expect(container.get(Status).greeting).toBe(container.get(Greeting))
      vi.restoreAllMocks()
    }
  })

  it('still binds the class a provided class injects when only the injecting one is listed', async () => {
    const loaded = await load()

    @loaded.Service()
    class Greeting {
      text() {
        return 'Hello'
      }
    }
    @loaded.Service()
    class Status {
      constructor(readonly greeting: Greeting) {}
    }

    const { app, container } = create(loaded, { providers: [{ provide: Status, useClass: Status }] })
    await app.start()

    expect(container.get(Status).greeting.text()).toBe('Hello')
  })

  it('binds a provided class once when a factory listed before it injects it', async () => {
    const loaded = await load()

    @loaded.Service()
    class Greeting {
      text() {
        return 'Hello'
      }
    }

    const { app, container } = create(loaded, {
      providers: [
        { provide: 'message', useFactory: (greeting: Greeting) => `${greeting.text()}!`, inject: [Greeting] },
        { provide: Greeting, useClass: Greeting },
      ],
    })
    await app.start()

    expect(container.get('message')).toBe('Hello!')
  })

  it('calls a factory once with what it injects, and awaits one that returns a promise before login', async () => {
    const loaded = await load()
    const factory = vi.fn(async (url: string) => ({ url, connected: true }))
    const made: unknown[] = []

    @loaded.Service()
    class NotesStore {
      constructor(@loaded.Inject('database') readonly database: { url: string }) {
        made.push(database)
      }
    }

    const { app, container, logins } = create(loaded, {
      services: [NotesStore],
      providers: [
        { provide: 'url', useValue: 'postgres://db' },
        { provide: 'database', useFactory: factory, inject: ['url'] },
      ],
    })
    expect(factory).not.toHaveBeenCalled()

    await app.start()

    expect(factory).toHaveBeenCalledTimes(1)
    expect(factory).toHaveBeenCalledWith('postgres://db')
    expect(made).toEqual([{ url: 'postgres://db', connected: true }])
    expect(container.get('database')).toBe(made[0])
    expect(logins).toHaveLength(1)
  })

  it('resolves factories in dependency order, through the classes between them', async () => {
    const loaded = await load()
    const order: string[] = []

    @loaded.Service()
    class Pool {
      constructor(@loaded.Inject('config') readonly config: { size: number }) {}
    }

    const { app, container } = create(loaded, {
      providers: [
        {
          provide: 'repository',
          useFactory: (pool: Pool) => (order.push('repository'), { pool }),
          inject: [Pool],
        },
        {
          provide: 'config',
          useFactory: async () => (order.push('config'), { size: 5 }),
        },
      ],
    })
    await app.start()

    expect(order).toEqual(['config', 'repository'])
    expect(container.get('repository').pool.config).toEqual({ size: 5 })
  })

  it('runs the hooks of provided values in dependency order, and their shutdown in reverse', async () => {
    const loaded = await load()
    const calls: string[] = []
    const database: OnReady & OnShutdown = {
      onReady: () => void calls.push('database:ready'),
      onShutdown: () => void calls.push('database:shutdown'),
    }

    @loaded.Service()
    class Scheduler implements OnReady, OnShutdown {
      constructor(@loaded.Inject('database') readonly database: unknown) {}
      onReady() {
        calls.push('scheduler:ready')
      }
      onShutdown() {
        calls.push('scheduler:shutdown')
      }
    }

    const { app, logins } = create(loaded, { services: [Scheduler], providers: [{ provide: 'database', useValue: database }] })
    await app.start()
    await becomeReady(logins[0])
    await (Reflect.get(app, 'close') as () => Promise<boolean>)()

    expect(calls).toEqual(['database:ready', 'scheduler:ready', 'scheduler:shutdown', 'database:shutdown'])
  })

  it('fails startup before login when a factory throws, with the token named and the error explained', async () => {
    const loaded = await load()
    const { app, logins } = create(loaded, {
      providers: [{ provide: 'database', useFactory: async () => Promise.reject(new Error('connection refused')) }],
    })

    const failure = await app.start().catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe("The factory providing 'database' failed: connection refused")
    expect(loaded.isExplainedError(failure)).toBe(true)
    expect(logged.error).toContainEqual([
      "The factory providing 'database' failed: connection refused. The bot cannot start without it.",
    ])
    expect(process.exitCode).toBe(1)
    expect(logins).toHaveLength(0)
  })

  it('names a class that injects a token nothing provides', async () => {
    const loaded = await load()

    @loaded.Service()
    class NotesStore {
      constructor(@loaded.Inject('database') readonly database: unknown) {}
    }

    expect(() => create(loaded, { services: [NotesStore] })).toThrow(
      "NotesStore: it injects 'database', which nothing provides: add a provider for it to @MeoCord({ providers }).",
    )
  })

  it('names a factory that injects a token nothing provides', async () => {
    const loaded = await load()

    expect(() => create(loaded, { providers: [{ provide: 'repository', useFactory: () => ({}), inject: ['database'] }] })).toThrow(
      "'repository': its provider injects 'database', which nothing provides: add a provider for it to @MeoCord({ providers }).",
    )
  })

  it('refuses a factory that injects ExecutionContext, which a value made once would keep from its first call', async () => {
    const loaded = await load()

    expect(() =>
      create(loaded, { providers: [{ provide: 'audit', useFactory: (context: unknown) => ({ context }), inject: [loaded.ExecutionContext] }] }),
    ).toThrow(
      "App: @MeoCord({ providers }): the provider for 'audit' injects ExecutionContext, but its factory runs once and its " +
        "value is shared, so it would keep the first call's context for every later call. Inject ExecutionContext only into guards.",
    )
  })

  it('injects a class whose own source mentions [native code], as any other of the app', async () => {
    const loaded = await load()
    @loaded.Service()
    class FunctionInspector {
      isNative(fn: () => unknown): boolean {
        return Function.prototype.toString.call(fn).includes('[native code]')
      }
    }
    @loaded.Service()
    class UsesInspector {
      constructor(readonly inspector: FunctionInspector) {}
    }

    const { container } = create(loaded, { services: [UsesInspector] })

    expect(container.get(UsesInspector).inspector).toBeInstanceOf(FunctionInspector)
  })

  it('takes a namespaced built-in for one, and a class set on globalThis for an app class', async () => {
    @Reflect.metadata('meocord:probe', true)
    class Polyfilled {}
    Reflect.set(globalThis, 'Polyfilled', Polyfilled)
    try {
      const loaded = await load()
      const { isAppClassToken } = await import('@src/core/lifecycle-order.js')
      loaded.Service()(Polyfilled)
      @loaded.Service()
      class UsesPolyfilled {
        constructor(readonly polyfilled: Polyfilled) {}
      }

      const { container } = create(loaded, { services: [UsesPolyfilled] })

      expect(container.get(UsesPolyfilled).polyfilled).toBeInstanceOf(Polyfilled)
      expect([Intl.NumberFormat, WebAssembly.Module, Map, Object].map(isAppClassToken)).toEqual([false, false, false, false])
    } finally {
      Reflect.deleteProperty(globalThis, 'Polyfilled')
    }
  })

  it('names a cycle of providers that inject each other, rather than failing as one is made', async () => {
    const loaded = await load()
    @loaded.Service()
    class Ledger {
      constructor(@loaded.Inject('accounts') readonly accounts: unknown) {}
    }

    expect(() =>
      create(loaded, {
        providers: [
          { provide: 'a', useFactory: (b: unknown) => ({ b }), inject: ['b'] },
          { provide: 'b', useFactory: (a: unknown) => ({ a }), inject: ['a'] },
        ],
      }),
    ).toThrow(
      "'a' → 'b' → 'a': each is made before what injects it, so none of them can be made. Move what they share into a " +
        'provider of its own.',
    )
    expect(() =>
      create(loaded, {
        services: [Ledger],
        providers: [{ provide: 'accounts', useFactory: (ledger: unknown) => ({ ledger }), inject: [Ledger] }],
      }),
    ).toThrow("'accounts' → Ledger → 'accounts':")
  })

  // Refused where it is declared, naming the token and where, as the same mistake in a factory's inject is
  it('refuses a useClass provider whose class injects ExecutionContext, naming where and the token', async () => {
    const loaded = await load()
    @loaded.Service()
    class Audit {
      constructor(@loaded.Inject(loaded.ExecutionContext) readonly context: unknown) {}
    }

    expect(() => create(loaded, { providers: [{ provide: 'audit', useClass: Audit }] })).toThrow(
      "App: @MeoCord({ providers }): the provider for 'audit' uses Audit, which injects ExecutionContext, but it is made " +
        "once and shared, so it would keep the first call's context for every later call. Inject ExecutionContext only into guards.",
    )
  })

  // The token stands for the app's store, so a cycle through it is named, rather than failing as one is made
  it('names a cycle through the CooldownStore token by the store it stands for', async () => {
    const loaded = await load()
    @loaded.Service()
    class Helper {
      constructor(@loaded.Inject(loaded.CooldownStore) readonly store: unknown) {}
    }
    class CycleStore extends loaded.MemoryCooldownStore {
      constructor(@loaded.Inject(Helper) readonly helper: Helper) {
        super()
      }
    }

    expect(() => create(loaded, { services: [Helper], cooldownStore: CycleStore })).toThrow('CycleStore → Helper → CycleStore:')
  })

  it('refuses a provider without exactly one way to provide, one given twice, and one for a token MeoCord binds', async () => {
    const loaded = await load()

    expect(() => create(loaded, { providers: [{ provide: 'a' } as Provider] })).toThrow(
      "App: @MeoCord({ providers }): the provider for 'a' needs exactly one of useValue, useClass and useFactory.",
    )
    expect(() =>
      create(loaded, {
        providers: [
          { provide: 'a', useValue: 1 },
          { provide: 'a', useValue: 2 },
        ],
      }),
    ).toThrow("App: @MeoCord({ providers }): 'a' is provided twice.")
    expect(() => create(loaded, { providers: [{ provide: loaded.discord.Client, useValue: {} }] })).toThrow(
      'App: @MeoCord({ providers }) cannot provide Client, which MeoCord binds itself.',
    )
  })
})
