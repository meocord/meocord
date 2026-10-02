import 'reflect-metadata'
import { COOLDOWN_POLICY, cooldownPolicyFrom } from '@src/core/cooldown-runner.js'
import { Container, type ServiceIdentifier } from 'inversify'
import { Client } from 'discord.js'
import { Logger } from '@src/common/index.js'
import { MeoCordApp } from '@src/core/meocord.app.js'
import { compiledConfigMessage, loadMeoCordConfig } from '@src/util/meocord-config-loader.util.js'
import { bunDevelopmentValues, bunDevelopmentWarning } from '@src/util/inherited-env.util.js'
import { assertBuiltForThisPlatform } from '@src/util/platform.util.js'
import { isRegisterOnly } from '@src/util/registration-mode.util.js'
import { ExecutionContext } from '@src/common/execution-context.js'
import { missingTranslatorError, Translator } from '@src/common/translator.js'
import { CooldownStore, MemoryCooldownStore } from '@src/common/cooldown-store.js'
import { handlerCooldowns } from '@src/core/cooldown-runner.js'
import { getCommandMap, getMessageHandlers } from '@src/decorator/controller.decorator.js'
import { injectedTokens, singletonContextError } from '@src/core/guard-runner.js'
import { appStages, bindAppPresenter, bindGlobalStages, classDecorators, prepareHandlerStages } from '@src/core/handler-pipeline.js'
import { appObservers, bindObservers } from '@src/core/observer-runner.js'
import { makeInjectable } from '@src/util/injectable.util.js'
import { isAppClassToken, type LifecycleUnit } from '@src/core/lifecycle-order.js'
import {
  assertProvided,
  assertTypedParameters,
  reachableClasses,
  bindProvider,
  bindsOwnToken,
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
import {
  assertDistinctCommands,
  warnHandlersOffControllers,
  warnInheritedRoutes,
  warnOverlappingPatterns,
  warnUnregisteredCommands,
} from '@src/core/command-conflicts.js'
import { SHARD_CALL_KEY, type ShardCallHandler, shardCallHandler, ShardContext } from '@src/core/shard-context.js'
import {
  clientOptionsWithSharding,
  isShardProcess,
  processShardingEnabled,
  shardingRole,
} from '@src/util/sharding-mode.util.js'
import { type MeoCordConfig } from '@src/interface/index.js'
import { registerClientTheme } from '@src/core/theme-runtime.js'
import { themeResolverClass } from '@src/core/theme-resolvers.js'
import { registerClientTranslator } from '@src/common/meocord-text.js'
import { describeRefusal, isRefusal, refuse } from '@src/util/refusal.util.js'
import { endFailedShard } from '@src/core/shard-exit.js'
import { isBuiltApplication } from '@src/util/bundle-entry.util.js'
import { META } from '@src/util/metadata-keys.js'

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
   * Creates the application for an app class, reading its token and config from the compiled config beside the bundle,
   * `meocord.config.mjs`, wherever the bot is started from.
   *
   * With process sharding it returns the manager that runs one process per shard; otherwise the bot itself.
   *
   * @param target - The class `@MeoCord` decorates.
   * @returns The application, which `start()` logs in.
   * @throws Error when the class has no `@MeoCord`, when the compiled config is missing beside the bundle or fails to
   *   load, naming the file and the reason, with what to do about it, when a provider cannot
   *   be bound, such as one for a token MeoCord binds itself, when two handlers take one command, or two builder
   *   classes build one, naming both, and for any other mistake it refuses as the app loads, such as two component
   *   patterns that match the same customIds. In a built application it is logged first, with where in the source it
   *   comes from, so `isExplainedError()` tells a caller not to log it again; in a shard of process sharding, the
   *   manager logs it.
   */
  static create(target: ServiceIdentifier): MeoCordApplication {
    try {
      return this.createApplication(target)
    } catch (error) {
      // A shard ends, so its manager restarts it, or stops every shard for a refusal, which it logs
      if (isShardProcess()) endFailedShard(error)
      // Reported here in a built application, so it reads the same whether main.ts catches it or not; main.ts, or the
      // report of an uncaught refusal, exits 1. A test or script gets the error as it is.
      else if (isBuiltApplication() && isRefusal(error) && !isExplainedError(error)) {
        this.logger.error(describeRefusal(error, process.cwd()))
        markExplained(error)
      }
      throw error
    }
  }

  private static createApplication(target: ServiceIdentifier): MeoCordApplication {
    const options = Reflect.getMetadata(META.appOptions, target)

    if (!options) {
      throw refuse(new Error(`${typeof target === 'function' ? target.name : String(target)}: not decorated with @MeoCord(), so there is no app to create.`))
    }

    const meocordConfig = loadMeoCordConfig()
    if (!meocordConfig) {
      throw refuse(new Error(compiledConfigMessage()))
    }

    // Before any of the three ways a bot runs, so none registers or dispatches a command only one handler could take
    assertDistinctCommands(options.controllers)
    const providers = providerMap(options.providers ?? [], '@MeoCord({ providers })')
    // A themeFor class is bound on its own, as the cooldown store is, and resolved like a service
    const themeResolver = themeResolverClass(options.themeFor)
    // The app's classes and every class they inject, which the container binds
    const roots = [
      ...options.controllers,
      ...(options.services ?? []),
      ...(themeResolver ? [themeResolver] : []),
      ...(options.cooldownStore ? [options.cooldownStore] : []),
      ...appObservers(target as object),
    ]
    // A shard's manager runs the same checks, so a sharded bot warns once
    if (!isShardProcess()) {
      warnUnregisteredCommands(options.controllers)
      warnInheritedRoutes(options.controllers)
      warnOverlappingPatterns(options.controllers)
      warnHandlersOffControllers(options.controllers, reachableClasses(roots, providers))
      const developmentEnv = bunDevelopmentValues()
      if (developmentEnv.keys.length > 0) {
        this.logger.warn(bunDevelopmentWarning(developmentEnv))
      }
    }

    // `meocord register` reads the commands from the controllers' prototypes and sends them over REST,
    // so nothing is bound or constructed, and nothing that needs the platform's native addons runs.
    if (isRegisterOnly()) {
      return new MeoCordApp(options.controllers, new Container(), new Client(options.clientOptions), meocordConfig.discordToken)
    }

    // Before anything is resolved: a controller or service is what first loads a native addon, and one built for another
    // platform would otherwise fail there with a linker error. A manager checks too, before it registers or spawns.
    assertBuiltForThisPlatform()

    // A process-sharding manager only spawns shards, so it binds, constructs and connects nothing itself.
    if (shardingRole(meocordConfig) === 'manager') {
      return new ShardManager({
        controllerClasses: options.controllers,
        token: meocordConfig.discordToken,
        config: meocordConfig,
      })
    }

    // Before binding, where inversify would otherwise fail first with an error about compiler options
    // Its stage classes too, which the container resolves only at their first call
    const stages = appStages(target as object)
    const decorators = classDecorators(options.controllers, stages)
    assertTypedParameters(reachableClasses([...roots, ...decorators.keys()], providers), decorators)
    const container = new Container()
    bindGlobalStages(container, stages)

    // Bind the Discord client as a constant value
    const discordClient = new Client(clientOptionsWithSharding(this.effectiveConfig(meocordConfig), options.clientOptions))
    container.bind(Client).toConstantValue(discordClient)
    if (options.i18n) {
      container.bind(Translator).toConstantValue(options.i18n)
      bindsOwnToken(container, Translator)
    }

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
    bindsOwnToken(container, HandlerRegistry)
    bindsOwnToken(container, ShardContext)

    container.bind(COOLDOWN_POLICY).toConstantValue(cooldownPolicyFrom(options))
    // A store of the app's own is resolved like a service, so it can inject its client
    if (options.cooldownStore) {
      bindDependencies(container, options.cooldownStore, providers)
      container.bind(CooldownStore).toService(options.cooldownStore)
    } else {
      container.bind(CooldownStore).toConstantValue(new MemoryCooldownStore())
    }
    // A class that injects the token depends on the app's store, the one unit whose hooks run
    bindsOwnToken(container, CooldownStore, options.cooldownStore)

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
    if (themeResolver) bindDependencies(container, themeResolver, providers)
    // Observers are services too: bound here so their lifecycle hooks run in dependency order
    const observers = appObservers(target as object)
    for (const observer of observers) bindDependencies(container, observer, providers)
    // Providers first, then the services, the controllers and the observers, each after what it depends on. The app's
    // own classes, which a class injecting CooldownStore does not make of the store
    const order = resolutionOrder(
      container,
      providers,
      [...providers.keys(), ...(options.services ?? []), ...(themeResolver ? [themeResolver] : []), ...options.controllers, ...observers],
      { followOwnTokens: false },
    )
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
    // The store first, after only what it injects: it is ready before anything a call reaches, and shuts down last
    const store = options.cooldownStore
    const lifecycle: LifecycleUnit[] = (store ? resolutionOrder(container, providers, [store, ...order]) : order).map(token => ({
      token,
      name: tokenName(token),
      dependencies: tokenDependencies(container, providers, token),
      ...(token === store && { cooldownStore: true }),
    }))

    // What ShardContext.call reaches: the app's classes, and the classes its providers stand in for
    const callable = [...new Set([...appClasses, ...[...providers.keys()].filter(isAppClassToken)])]
    // From another shard a call names its class, so with process sharding every name it can reach is one class's
    if (meocordConfig.sharding?.mode === 'process') {
      const names = new Set<string>()
      for (const cls of callable) {
        if (names.has(cls.name)) {
          throw refuse(new Error(
            `${cls.name}: two classes have this name; with process sharding, ShardContext.call finds a class in another ` +
              'shard by its name, so give each controller, service and provided class a distinct name.',
          ))
        }
        names.add(cls.name)
      }
    }
    Reflect.set(discordClient, SHARD_CALL_KEY, shardCallHandler(container, () => callable, 'this app'))

    // Stamp each class with the container so @UseGuard can resolve guards on a direct call
    for (const cls of appClasses) {
      Reflect.defineMetadata(META.container, container, cls)
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
