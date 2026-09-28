import { vi } from 'vitest'

// Logger is constructed with `new`, so the implementation has to be a class or
// function — vitest 4 refuses to construct an arrow.
vi.mock('@src/common/index.js', () => ({
  Logger: vi.fn(
    class {
      log = vi.fn()
      error = vi.fn()
      warn = vi.fn()
      info = vi.fn()
      debug = vi.fn()
      verbose = vi.fn()
    },
  ),
}))

const { mockLoadConfig } = vi.hoisted(() => ({ mockLoadConfig: vi.fn() }))
vi.mock('@src/util/meocord-config-loader.util.js', () => ({
  loadMeoCordConfig: mockLoadConfig,
}))

const { MeoCordFactory } = await import('@src/core/meocord-factory.js')
const { MeoCordApp } = await import('@src/core/meocord.app.js')
const { MetadataKey } = await import('@src/enum/index.js')
const { ExecutionContext } = await import('@src/common/execution-context.js')
const { injectable } = await import('inversify')
const { createTranslator, Translator } = await import('@src/common/translator.js')
const { CooldownStore, MemoryCooldownStore } = await import('@src/common/cooldown-store.js')
const { RedisCooldownStore: SharedRedisStore } = await import('@src/common/redis-cooldown-store.js')
const { ShardedCooldownStore } = await import('@src/common/sharded-cooldown-store.js')
const { Command, Controller, Cooldown } = await import('@src/decorator/index.js')
const { CommandType } = await import('@src/enum/index.js')
const { runHandler } = await import('@src/core/handler-pipeline.js')
const { presenterFor } = await import('@src/common/response/presenter.js')

/** What start() runs before login: providers resolved, listed services made, the presenter bound. */
const runStartup = (app: unknown) => (Reflect.get(app as object, 'startup') as () => Promise<void>)()

describe('MeoCordFactory.create()', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('throws when the target has no @MeoCord() options metadata', () => {
    class NoMetadataApp {}
    expect(() => MeoCordFactory.create(NoMetadataApp)).toThrow('Target class is not decorated with @MeoCord().')
  })

  it('reports a refusal once, as its message, and exits 1 however the caller handles the throw', async () => {
    const { isExplainedError } = await import('@src/common/explained-error.js')
    const logger = (MeoCordFactory as unknown as { logger: { error: ReturnType<typeof vi.fn> } }).logger
    const exitCode = process.exitCode
    class NoMetadataApp {}

    let thrown: unknown
    try {
      MeoCordFactory.create(NoMetadataApp)
    } catch (error) {
      thrown = error
    }
    try {
      expect(process.exitCode).toBe(1)
    } finally {
      process.exitCode = exitCode
    }

    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(logger.error.mock.calls[0][0]).toMatch(/^Target class is not decorated with @MeoCord\(\)\./)
    expect(isExplainedError(thrown)).toBe(true)
  })

  it('throws when meocord config is missing', () => {
    mockLoadConfig.mockReturnValue(null)

    class MyApp {}
    Reflect.defineMetadata(MetadataKey.AppOptions, { controllers: [], clientOptions: { intents: [] } }, MyApp)

    expect(() => MeoCordFactory.create(MyApp)).toThrow('MeoCord config not found')
  })

  it('returns a MeoCordApp instance when config and options are valid', () => {
    mockLoadConfig.mockReturnValue({ discordToken: 'test-token' })

    class MyApp {}
    Reflect.defineMetadata(MetadataKey.AppOptions, { controllers: [], clientOptions: { intents: [] } }, MyApp)

    const result = MeoCordFactory.create(MyApp)
    expect(result).toBeInstanceOf(MeoCordApp)
  })

  it('runs the global guards of @MeoCord({ guards }) before a dispatched handler', async () => {
    mockLoadConfig.mockReturnValue({ discordToken: 'test-token' })
    const log: string[] = []

    class GlobalGuard {
      canActivate() {
        log.push('global')
        return true
      }
    }
    injectable()(GlobalGuard)
    class Handlers {
      async run(_event: object) {
        log.push('run')
      }
    }
    class MyApp {}
    Reflect.defineMetadata(
      MetadataKey.AppOptions,
      { controllers: [], clientOptions: { intents: [] }, guards: [GlobalGuard] },
      MyApp,
    )

    const app = MeoCordFactory.create(MyApp)
    await runHandler(Reflect.get(app, 'container'), new Handlers() as never, 'run', [{}])

    expect(log).toEqual(['global', 'run'])
  })

  it('refuses a global interceptor that injects ExecutionContext, since it is shared across calls', () => {
    mockLoadConfig.mockReturnValue({ discordToken: 'test-token' })

    class ContextInterceptor {
      constructor(readonly context: InstanceType<typeof ExecutionContext>) {}
      intercept() {}
    }
    Reflect.defineMetadata(MetadataKey.ParamTypes, [ExecutionContext], ContextInterceptor)
    class MyApp {}
    Reflect.defineMetadata(
      MetadataKey.AppOptions,
      { controllers: [], clientOptions: { intents: [] }, interceptors: [ContextInterceptor] },
      MyApp,
    )

    expect(() => MeoCordFactory.create(MyApp)).toThrow('ContextInterceptor is resolved once and shared')
  })

  it('makes the @MeoCord({ presenter }) the one respond() uses for the bot client, before login', async () => {
    mockLoadConfig.mockReturnValue({ discordToken: 'test-token' })

    class Presenter {
      loading() {
        return { text: 'loading' }
      }
      error() {
        return { text: 'error' }
      }
    }
    class MyApp {}
    Reflect.defineMetadata(
      MetadataKey.AppOptions,
      { controllers: [], clientOptions: { intents: [] }, presenter: Presenter },
      MyApp,
    )

    const app = MeoCordFactory.create(MyApp)
    await runStartup(app)
    const client = Reflect.get(app, 'discordClient') as object

    expect(presenterFor(client)).toBeInstanceOf(Presenter)
  })

  it('refuses a controller dependency that injects ExecutionContext, since it is shared across calls', () => {
    mockLoadConfig.mockReturnValue({ discordToken: 'test-token' })

    class ContextService {
      constructor(readonly context: InstanceType<typeof ExecutionContext>) {}
    }
    Reflect.defineMetadata(MetadataKey.ParamTypes, [ExecutionContext], ContextService)
    injectable()(ContextService)

    class UsesService {
      constructor(readonly service: ContextService) {}
    }
    Reflect.defineMetadata(MetadataKey.ParamTypes, [ContextService], UsesService)

    class MyApp {}
    Reflect.defineMetadata(
      MetadataKey.AppOptions,
      { controllers: [UsesService], clientOptions: { intents: [] } },
      MyApp,
    )

    expect(() => MeoCordFactory.create(MyApp)).toThrow(
      'ContextService is resolved once and shared, so it cannot inject ExecutionContext',
    )
  })

  // `meocord register` runs the bundle only to read the commands; a service that connects somewhere
  // in its constructor must not run.
  describe('in register-only mode', () => {
    beforeEach(() => {
      process.env.MEOCORD_REGISTER_ONLY = '1'
    })

    afterEach(() => {
      delete process.env.MEOCORD_REGISTER_ONLY
    })

    it('constructs no service and resolves no controller', () => {
      mockLoadConfig.mockReturnValue({ discordToken: 'test-token' })
      const constructed = vi.fn()

      class DatabaseService {
        constructor() {
          constructed()
        }
      }

      class MyApp {}
      Reflect.defineMetadata(
        MetadataKey.AppOptions,
        { controllers: [], services: [DatabaseService], clientOptions: { intents: [] } },
        MyApp,
      )

      expect(MeoCordFactory.create(MyApp)).toBeInstanceOf(MeoCordApp)
      expect(constructed).not.toHaveBeenCalled()
    })
  })

  describe('i18n', () => {
    const t = () => createTranslator({ default: 'en-US', locales: { 'en-US': { ping: 'Pong!' } } })

    class PingService {
      constructor(readonly translator: InstanceType<typeof Translator>) {}
    }
    Reflect.defineMetadata(MetadataKey.ParamTypes, [Translator], PingService)

    const appWith = (i18n?: unknown) => {
      class MyApp {}
      Reflect.defineMetadata(MetadataKey.AppOptions, { controllers: [], services: [PingService], clientOptions: { intents: [] }, i18n }, MyApp)
      return MyApp
    }

    it('injects the translator given to @MeoCord as Translator', () => {
      mockLoadConfig.mockReturnValue({ discordToken: 'test-token' })
      const translator = t()

      const app = MeoCordFactory.create(appWith(translator))

      expect((app as unknown as { container: { get(token: unknown): PingService } }).container.get(PingService).translator).toBe(translator)
    })

    it('says what to pass when a class injects Translator without one', () => {
      mockLoadConfig.mockReturnValue({ discordToken: 'test-token' })

      expect(() => MeoCordFactory.create(appWith())).toThrow('PingService injects Translator, but @MeoCord has no i18n')
    })
  })

  describe('the cooldown store', () => {
    class RedisClient {}
    class RedisCooldownStore extends CooldownStore {
      constructor(readonly redis: RedisClient) {
        super()
      }

      consume() {
        return Promise.resolve({ allowed: true, retryAfterMs: 0 })
      }
    }
    Reflect.defineMetadata(MetadataKey.ParamTypes, [RedisClient], RedisCooldownStore)

    @Controller()
    class DailyController {
      @Command('daily', CommandType.SLASH)
      @Cooldown({ seconds: 10 })
      async daily(..._args: any[]) {}
    }

    const appWith = (cooldownStore?: unknown) => {
      class MyApp {}
      Reflect.defineMetadata(MetadataKey.AppOptions, { controllers: [DailyController], clientOptions: { intents: [] }, cooldownStore }, MyApp)
      return MyApp
    }
    const storeOf = (app: unknown) => (app as { container: { get(token: unknown): unknown } }).container.get(CooldownStore)
    const warn = () => (MeoCordFactory as unknown as { logger: { warn: ReturnType<typeof vi.fn> } }).logger.warn

    beforeEach(() => mockLoadConfig.mockReturnValue({ discordToken: 'test-token' }))
    afterEach(() => {
      delete process.env.SHARDING_MANAGER
    })

    it('is in memory by default', () => {
      expect(storeOf(MeoCordFactory.create(appWith()))).toBeInstanceOf(MemoryCooldownStore)
    })

    it("is the app's own when given, resolved with its dependencies", () => {
      const store = storeOf(MeoCordFactory.create(appWith(RedisCooldownStore))) as RedisCooldownStore

      expect(store).toBeInstanceOf(RedisCooldownStore)
      expect(store.redis).toBeInstanceOf(RedisClient)
    })

    it('resolves RedisCooldownStore.using, which runs its script through the function it was given', async () => {
      const evaluate = vi.fn(() => Promise.resolve([0, 750, 0]))
      const store = storeOf(MeoCordFactory.create(appWith(SharedRedisStore.using(evaluate)))) as InstanceType<typeof CooldownStore>

      expect(store).toBeInstanceOf(SharedRedisStore)
      expect(await store.consume('key', { uses: 1, windowMs: 1_000 })).toEqual({ allowed: false, retryAfterMs: 750 })
      expect(evaluate).toHaveBeenCalledTimes(1)
    })

    it("warns a shard that in-memory 'user' and 'global' cooldowns count per shard", async () => {
      process.env.SHARDING_MANAGER = 'true'

      await runStartup(MeoCordFactory.create(appWith()))

      expect(warn()).toHaveBeenCalledWith(expect.stringContaining('DailyController.daily'))
    })

    it('does not warn a shard that counts in the shard manager', async () => {
      process.env.SHARDING_MANAGER = 'true'

      await runStartup(MeoCordFactory.create(appWith(ShardedCooldownStore)))

      expect(warn()).not.toHaveBeenCalledWith(expect.stringContaining('cooldowns'))
    })

    it('does not warn a shard with a shared store', async () => {
      process.env.SHARDING_MANAGER = 'true'

      await runStartup(MeoCordFactory.create(appWith(RedisCooldownStore)))

      expect(warn()).not.toHaveBeenCalledWith(expect.stringContaining('cooldowns'))
    })
  })
})
