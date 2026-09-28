import 'reflect-metadata'
import { COOLDOWN_POLICY, type CooldownPolicy, DEFAULT_COOLDOWN_STORE_TIMEOUT_MS } from '@src/core/cooldown-runner.js'
import { Container, type ServiceIdentifier } from 'inversify'
import { Client } from 'discord.js'
import { Logger } from '@src/common/index.js'
import { MeoCordApp } from '@src/core/meocord.app.js'
import { loadMeoCordConfig } from '@src/util/meocord-config-loader.util.js'
import { assertBuiltForThisPlatform } from '@src/util/platform.util.js'
import { MetadataKey } from '@src/enum/index.js'
import { isRegisterOnly } from '@src/util/registration-mode.util.js'
import { ExecutionContext } from '@src/common/execution-context.js'
import { missingTranslatorError, Translator } from '@src/common/translator.js'
import { CooldownStore, MemoryCooldownStore } from '@src/common/cooldown-store.js'
import { handlerCooldowns } from '@src/core/cooldown-runner.js'
import { getCommandMap, getMessageHandlers } from '@src/decorator/controller.decorator.js'
import { injectedTokens, singletonContextError } from '@src/core/guard-runner.js'
import { appStages, bindAppPresenter, bindGlobalStages, prepareHandlerStages } from '@src/core/handler-pipeline.js'
import { appObservers, bindObservers } from '@src/core/observer-runner.js'
import { makeInjectable } from '@src/util/injectable.util.js'
import { isAppClassToken, type LifecycleUnit } from '@src/core/lifecycle-order.js'
import {
  assertProvided,
  assertTypedParameters,
  reachableClasses,
  bindProvider,
  isClassProvider,
  providerMap,
  type ProviderMap,
  resolutionOrder,
  resolveProviders,
  tokenDependencies,
  tokenName,
} from '@src/core/providers.js'
import { isExplainedError, markExplained } from '@src/common/explained-error.js'
import { HandlerRegistry } from '@src/core/handler-registry.js'
import { type MeoCordApplication } from '@src/interface/index.js'
import { ShardManager } from '@src/core/shard-manager.js'
import { assertDistinctCommands } from '@src/core/command-conflicts.js'
import { SHARD_CALL_KEY, type ShardCallHandler, ShardContext } from '@src/core/shard-context.js'
import {
  clientOptionsWithSharding,
  isShardProcess,
  processShardingEnabled,
  shardingRole,
} from '@src/util/sharding-mode.util.js'
import { type MeoCordConfig } from '@src/interface/index.js'
import { claimAmbientAppTheme, registerClientTheme } from '@src/core/theme-runtime.js'
import { registerClientTranslator } from '@src/common/meocord-text.js'
import { describeRefusal, isRefusal, refuse } from '@src/util/refusal.util.js'
import { isBuiltApplication } from '@src/util/bundle-entry.util.js'

/**
 * Recursively binds a class and all its constructor dependencies to the container in singleton scope.
 */
function bindDependencies(container: Container, cls: any, providers: ProviderMap): void {
  // A provided class is bound by its own provider, wherever in the list that provider comes
  if (container.isBound(cls) || providers.has(cls)) return
  if (injectedTokens(cls).includes(ExecutionContext)) throw refuse(singletonContextError(cls))

  makeInjectable(cls)

  container.bind(cls).toSelf().inSingletonScope()

  // By constructor type or @inject token; an interface-typed parameter records Object, which is skipped
  for (const dep of injectedTokens(cls)) {
    if (dep === Translator && !container.isBound(Translator)) throw refuse(missingTranslatorError(cls))
    if (isAppClassToken(dep)) bindDependencies(container, dep, providers)
  }
}

/**
 * Tells a process-sharded app that its in-memory cooldowns count per shard: a user's calls, and all
 * calls, reach different shards, so `'user'` and `'global'` limits are looser than they read.
 */
function warnPerShardCooldowns(controllers: readonly (new (...args: any[]) => unknown)[], logger: Logger): void {
  const loose = controllers.flatMap(controller => {
    const prototype = controller.prototype as object
    const methods = Object.values(getCommandMap(prototype) ?? {})
      .flat()
      .map(command => command.methodName)
    return [...new Set([...methods, ...getMessageHandlers(prototype).map(handler => handler.method)])]
      .filter(method => handlerCooldowns(prototype, method).some(({ per }) => per === 'user' || per === 'global'))
      .map(method => `${controller.name}.${method}`)
  })
  if (loose.length === 0) return

  logger.warn(
    `Each shard counts 'user' and 'global' cooldowns in its own memory, so they allow more calls than they ` +
      `say: ${loose.join(', ')}. Bind a shared store with @MeoCord({ cooldownStore }): ShardedCooldownStore counts in the shard manager, RedisCooldownStore on Redis.`,
  )
}

/**
 * Creates the application from the class `@MeoCord` decorates, ready to start.
 *
 * Call it once, in `main.ts`, and `start()` what it returns. Tests build a module with `MeoCordTestingModule`
 * instead, which reads the same decorators without a client or a config file.
 *
 * @example
 * ```ts
 * @MeoCord({ controllers: [], clientOptions: { intents: [GatewayIntentBits.Guilds] } })
 * class App {}
 *
 * const app = MeoCordFactory.create(App)
 * await app.start()
 * ```
 *
 * @group Controllers
 * @see {@link MeoCordApplication}
 * @see {@link MeoCord}
 */
export class MeoCordFactory {
  private static logger = new Logger()

  /**
   * The config a single process runs with. Under `meocord start --dev` without `sharding.development`,
   * process sharding falls back to running every shard in this process, so the watcher restarts one
   * process and leaves no shards behind.
   */
  private static effectiveConfig(config: MeoCordConfig): MeoCordConfig {
    if (config.sharding?.mode !== 'process' || isShardProcess() || processShardingEnabled(config)) return config
    this.logger.info(
      "sharding.mode 'process' is off in development, so every shard runs in this process; set " +
        'sharding.development: true to run them in separate processes.',
    )
    return { ...config, sharding: { ...config.sharding, mode: 'internal' } }
  }

  /**
   * Creates the application for an app class, reading `dist/meocord.config.mjs` for its token and config.
   *
   * With process sharding it returns the manager that runs one process per shard; otherwise the bot itself.
   *
   * @param target - The class `@MeoCord` decorates.
   * @returns The application, which `start()` logs in.
   * @throws Error when the class has no `@MeoCord`, when the built config is missing, when a provider cannot
   *   be bound, such as one for a token MeoCord binds itself, or when two handlers take one command, or two builder
   *   classes build one, naming both. In a built application it is logged first, as one line, so
   *   `isExplainedError()` tells a caller not to log it again.
   */
  static create(target: ServiceIdentifier): MeoCordApplication {
    try {
      return this.createApplication(target)
    } catch (error) {
      // Reported here in a built application, so it reads the same whether main.ts catches it or not; main.ts, or the
      // report of an uncaught refusal, exits 1. A test or script gets the error as it is.
      if (isBuiltApplication() && isRefusal(error) && !isExplainedError(error)) {
        this.logger.error(describeRefusal(error, process.cwd()))
        markExplained(error)
      }
      throw error
    }
  }

  private static createApplication(target: ServiceIdentifier): MeoCordApplication {
    const options = Reflect.getMetadata(MetadataKey.AppOptions, target)

    if (!options) {
      throw refuse(new Error(`${typeof target === 'function' ? target.name : String(target)}: not decorated with @MeoCord(), so there is no app to create.`))
    }

    const meocordConfig = loadMeoCordConfig()
    if (!meocordConfig) {
      throw refuse(new Error('MeoCord config not found: dist/meocord.config.mjs is missing or failed to load. Run `meocord build`.'))
    }

    // Before any of the three ways a bot runs, so none registers or dispatches a command only one handler could take
    assertDistinctCommands(options.controllers)

    // `meocord register` reads the commands from the controllers' prototypes and sends them over REST,
    // so nothing is bound or constructed, and nothing that needs the platform's native addons runs.
    if (isRegisterOnly()) {
      return new MeoCordApp(options.controllers, new Container(), new Client(options.clientOptions), meocordConfig.discordToken)
    }

    // A process-sharding manager only spawns shards, so it binds, constructs and connects nothing itself.
    if (shardingRole(meocordConfig) === 'manager') {
      return new ShardManager({
        controllerClasses: options.controllers,
        token: meocordConfig.discordToken,
        config: meocordConfig,
      })
    }

    // Before anything is resolved: a controller or service is what first loads a native addon, and
    // one built for another platform would otherwise fail there with a linker error.
    assertBuiltForThisPlatform()

    const providers = providerMap(options.providers ?? [], '@MeoCord({ providers })')
    // Before binding, where inversify would otherwise fail first with an error about compiler options
    const roots = [
      ...options.controllers,
      ...(options.services ?? []),
      ...(options.cooldownStore ? [options.cooldownStore] : []),
      ...appObservers(target as object),
    ]
    assertTypedParameters(reachableClasses(roots, providers))
    const container = new Container()
    bindGlobalStages(container, appStages(target as object))

    // Bind the Discord client as a constant value
    const discordClient = new Client(clientOptionsWithSharding(this.effectiveConfig(meocordConfig), options.clientOptions))
    container.bind(Client).toConstantValue(discordClient)
    if (options.i18n) container.bind(Translator).toConstantValue(options.i18n)

    // Bound before the app's classes, so a class that injects it gets this instance; filled once they are bound
    const appClasses: (new (...args: any[]) => unknown)[] = []
    container.bind(HandlerRegistry).toConstantValue(new HandlerRegistry(appClasses, options.messages, () => options.i18n))
    container
      .bind(ShardContext)
      .toConstantValue(
        new ShardContext(discordClient, (service, method, args) =>
          (Reflect.get(discordClient, SHARD_CALL_KEY) as ShardCallHandler)(service, method, args),
        ),
      )

    container.bind(COOLDOWN_POLICY).toConstantValue({
      failure: options.cooldownStoreFailure ?? 'deny',
      timeoutMs: options.cooldownStoreTimeoutMs ?? DEFAULT_COOLDOWN_STORE_TIMEOUT_MS,
    } satisfies CooldownPolicy)
    // A store of the app's own is resolved like a service, so it can inject its client
    if (options.cooldownStore) {
      bindDependencies(container, options.cooldownStore, providers)
      container.bind(CooldownStore).toService(options.cooldownStore)
    } else {
      container.bind(CooldownStore).toConstantValue(new MemoryCooldownStore())
    }

    // After MeoCord's own tokens, which a provider may not replace, and before the app's classes, so
    // a class token that is provided is not also bound as itself
    for (const [token, provider] of providers) {
      if (container.isBound(token as ServiceIdentifier)) {
        throw refuse(new Error(`${(target as { name?: string }).name}: @MeoCord({ providers }) cannot provide ${tokenName(token)}, which MeoCord binds itself.`))
      }
      bindProvider(container, provider, cls => bindDependencies(container, cls, providers))
    }

    // Bind all controllers and their transitive dependencies
    for (const ctrl of options.controllers as any[]) {
      bindDependencies(container, ctrl, providers)
    }
    for (const svc of (options.services ?? []) as any[]) {
      bindDependencies(container, svc, providers)
    }
    // Observers are services too: bound here so their lifecycle hooks run in dependency order
    const observers = appObservers(target as object)
    for (const observer of observers) bindDependencies(container, observer, providers)
    // Providers first, then the services, then the controllers, each after what it depends on
    const order = resolutionOrder(container, providers, [
      ...providers.keys(),
      ...(options.services ?? []),
      ...options.controllers,
      ...observers,
    ])
    appClasses.push(
      ...order.filter((token): token is new (...args: any[]) => unknown => {
        const provider = providers.get(token)
        return isAppClassToken(token) && (!provider || (isClassProvider(provider) && provider.useClass === token))
      }),
    )
    assertProvided(
      container,
      providers,
      [...appClasses, ...(options.cooldownStore ? [options.cooldownStore] : [])],
      '@MeoCord({ providers })',
    )
    const lifecycle: LifecycleUnit[] = order.map(token => ({
      token,
      name: tokenName(token),
      dependencies: tokenDependencies(container, providers, token),
    }))

    // ShardContext.call reaches a service in another shard by its class name
    const byName = new Map<string, new (...args: any[]) => unknown>()
    for (const cls of appClasses) {
      if (byName.has(cls.name) && meocordConfig.sharding?.mode === 'process') {
        throw refuse(new Error(
          `${cls.name}: two classes have this name; with process sharding, ShardContext.call finds a service in ` +
            `another shard by its name, so give each controller and service a distinct name.`,
        ))
      }
      byName.set(cls.name, cls)
    }
    const runHere: ShardCallHandler = async (service, method, args) => {
      // A call made here names its class; only one from another shard needs finding by name
      const cls = typeof service === 'function' ? appClasses.find(appClass => appClass === service) : byName.get(service)
      const name = typeof service === 'function' ? service.name : service
      if (!cls) throw new Error(`${name} is not a controller or service of this app.`)
      const instance = container.get(cls) as Record<string, (...args: unknown[]) => unknown>
      if (typeof instance[method] !== 'function') throw new Error(`${name}.${method} is not a method.`)
      return instance[method](...args)
    }
    Reflect.set(discordClient, SHARD_CALL_KEY, runHere)

    // Stamp each class with the container so @UseGuard can resolve guards on a direct call
    for (const cls of appClasses) {
      Reflect.defineMetadata(MetadataKey.Container, container, cls)
    }

    prepareHandlerStages(container, appClasses)
    bindObservers(container, observers)

    // Run by start() before it logs in: what may inject a provided value is resolved once every factory
    // has made its value, including those that return a promise
    const logger = this.logger
    const startup = async () => {
      try {
        await resolveProviders(container, providers, order)
      } catch (error) {
        logger.error(`${(error as Error).message}. The bot cannot start without it.`)
        logger.debug('Provider failure:', (error as Error).cause)
        markExplained(error)
        throw error
      }
      // The listed services are made now, so constructors that attach listeners or connect run before login
      for (const svc of (options.services ?? []) as any[]) {
        container.get(svc)
      }
      if (shardingRole(meocordConfig) === 'shard' && container.get(CooldownStore) instanceof MemoryCooldownStore) {
        warnPerShardCooldowns(options.controllers, logger)
      }
      bindAppPresenter(container, target as object, discordClient)
      // A bot runs one app, whose theme code outside any call then reads
      claimAmbientAppTheme(container)
      registerClientTheme(discordClient, container)
      registerClientTranslator(discordClient, options.i18n)
    }

    return new MeoCordApp(
      options.controllers,
      container,
      discordClient,
      meocordConfig.discordToken,
      options.activities,
      appClasses,
      meocordConfig.shutdownTimeout,
      startup,
      lifecycle,
      options.messages,
      // In development only, unless the app says otherwise
      options.warnUnanswered ?? process.env.NODE_ENV === 'development',
    )
  }
}
