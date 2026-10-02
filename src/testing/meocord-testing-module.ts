import 'reflect-metadata'
import { Container, type ServiceIdentifier } from 'inversify'
import {
  claimCooldownNotice,
  claimStoreDownNotice,
  COOLDOWN_POLICY,
  cooldownPolicyFrom,
  type CooldownStoreFailure,
} from '@src/core/cooldown-runner.js'
import {
  BaseInteraction,
  Client,
  type ClientEvents,
  type Interaction,
  Message,
  type MessageReaction,
  type PartialMessageReaction,
  type PartialUser,
  type User,
} from 'discord.js'
import { ReactionHandlerAction } from '@src/enum/index.js'
import { CooldownStore, MemoryCooldownStore } from '@src/common/cooldown-store.js'
import { ExecutionContext } from '@src/common/execution-context.js'
import { missingTranslatorError, Translator } from '@src/common/translator.js'
import { injectedTokens, singletonContextError } from '@src/core/guard-runner.js'
import {
  appPresenterOf,
  appStages,
  bindAppPresenter,
  bindGlobalStages,
  classDecorators,
  type GlobalStages,
  prepareHandlerStages,
  type RunOptions,
  runHandler,
} from '@src/core/handler-pipeline.js'
import { setPresenter } from '@src/common/response/presenter.js'
import { commandMismatch, componentRouteFor, handlerInput } from '@src/core/handler-input.js'
import { buildComponentRoutes, type ComponentRoute } from '@src/core/component-routes.js'
import { hasCustomId } from '@src/util/interaction.util.js'
import {
  type DispatchObserver,
  type ExceptionFilter,
  type GuardInterface,
  type InterceptorInterface,
  type MessageCommandOptions,
  type ThemeOverride,
  type ThemeResolver,
  type ThemeResolvers,
} from '@src/interface/index.js'
import { ThemeCache, type ThemeResolverClass, themeResolverClass } from '@src/core/theme-resolvers.js'
import { claimAmbientAppTheme, registerClientTheme, releaseAmbientAppTheme } from '@src/core/theme-runtime.js'
import { registerClientTranslator } from '@src/common/meocord-text.js'
import { copyLayer, mergeTheme, type ResolvedTheme } from '@src/core/theme-scope.js'
import { assertValidTheme, themeForProblem } from '@src/core/theme-validation.js'
import { buildMessageRoutes, messageParamsFor } from '@src/core/message-routes.js'
import {
  assertDistinctCommands,
  warnHandlersOffControllers,
  warnInheritedRoutes,
  warnOverlappingPatterns,
  warnUnregisteredCommands,
} from '@src/core/command-conflicts.js'
import { messageCommandHooks } from '@src/core/message-params.js'
import { appObservers, assertObservers, bindObservers } from '@src/core/observer-runner.js'
import { makeInjectable } from '@src/util/injectable.util.js'
import { HandlerRegistry } from '@src/core/handler-registry.js'
import { adviseInPlaceOfInjecting } from '@src/core/meocord-classes.js'
import { shardCallHandler, ShardContext } from '@src/core/shard-context.js'
import { isAppClassToken, type LifecycleUnit } from '@src/core/lifecycle-order.js'
import { callsSettled, type LifecycleEntry, lifecycleEntry, runReadyHooks, runShutdownSequence } from '@src/core/lifecycle-hooks.js'
import { createMockClient } from './mock-interaction.js'
import { Dispatcher, type DispatchRecorder } from '@src/core/dispatcher.js'
import { createFallback, isUserOutcome } from '@src/core/fallback.js'
import { Logger } from '@src/common/logger.js'
import { DEFAULT_SHUTDOWN_TIMEOUT_MS, shutdownTimeoutProblem } from '@src/util/shutdown-timeout.util.js'
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
import { type Provider, type ProviderToken } from '@src/interface/provider.interface.js'
import { getEventHandlers } from '@src/decorator/event.decorator.js'
import { META } from '@src/util/metadata-keys.js'

/**
 * What a testing module is built from: the classes a test needs, and the app whose global stages apply.
 *
 * @group Testing
 * @category Module
 * @see {@link MeoCordTestingModule}
 */
export interface TestingModuleOptions {
  /** The controllers the module builds, with every class they inject. */
  controllers?: (new (...args: any[]) => any)[]
  /** Providers for what those classes inject, in any shape `@MeoCord({ providers })` takes. */
  providers?: Provider[]

  /**
   * The `@MeoCord` app class, whose global guards, interceptors and filters run with each handler's own, and whose
   * translator, presenter, message options, theme, cooldown store and policy, and observers the module uses. A
   * `CooldownStore` in `providers` takes the store's place. Its controllers, services and providers are not
   * registered: list the ones a test needs, or build the whole app with {@link MeoCordTestingModule.fromApp}.
   */
  app?: new (...args: any[]) => unknown

  /**
   * `@Observer` classes told about each call `invoke`, `dispatch` and `emit` make, after the `app`'s own. The
   * module waits for them before a call resolves, so a test sees what they were told.
   */
  observers?: (new (...args: any[]) => DispatchObserver)[]

  /**
   * How long `close()` waits, in milliseconds, for the calls under way, the cooldown store's operations and the
   * `onShutdown` hooks, as `shutdownTimeout` in `meocord.config.ts` bounds the bot's shutdown: from 0 to 2147478647,
   * and 10000 unless set. A test whose fake store never answers, or whose `onShutdown` never settles, sets it short.
   */
  shutdownTimeout?: number
}

/**
 * What a test changes of the app {@link MeoCordTestingModule.fromApp} builds.
 *
 * @group Testing
 * @category Module
 * @see {@link MeoCordTestingModule.fromApp}
 */
export interface FromAppOptions {
  /** Providers that replace the app's own by token, or add what it lacks, such as the Discord `Client`. */
  providers?: Provider[]
  /** Controllers built beside the app's, such as one only a test uses. */
  controllers?: (new (...args: any[]) => any)[]
  /** `@Observer` classes told about each call, after the app's own. */
  observers?: (new (...args: any[]) => DispatchObserver)[]
  /** How long `close()` waits for the `onShutdown` hooks; see {@link TestingModuleOptions.shutdownTimeout}. */
  shutdownTimeout?: number
}

/** What `fromApp` takes from the app beyond what `app` gives: its providers and services. */
interface AppWiring {
  providers: Provider[]
  services: (new (...args: any[]) => unknown)[]
}

/**
 * The names of a class's instance methods, as {@link TestingModule.invoke} takes them.
 *
 * @group Testing
 * @category Module
 */
export type HandlerName<C extends new (...args: any[]) => unknown> = {
  [K in keyof InstanceType<C>]: InstanceType<C>[K] extends (...args: any[]) => unknown ? K : never
}[keyof InstanceType<C>] &
  string

/**
 * The handler's arguments, or its first alone, an interaction or a message, whose params `invoke` then builds as
 * dispatch does.
 * A handler that declares no parameters still takes what dispatch passes, such as the interaction.
 */
type HandlerArgs<C extends new (...args: any[]) => unknown, M extends HandlerName<C>> =
  InstanceType<C>[M] extends (...args: infer A) => unknown
    ? A extends []
      ? [] | [first: unknown, params?: unknown]
      : A extends [infer First, unknown, ...unknown[]]
        ? A | [First]
        : A
    : never

/**
 * How a call made with {@link TestingModule.invoke} ended.
 *
 * @group Testing
 * @category Module
 */
export interface InvocationResult {
  /** Whether the handler ran; `false` when a guard denied the call or an interceptor skipped it. */
  ran: boolean

  /** The error a filter handled, when the call failed and a `@UseFilter` or global filter caught it. */
  error?: unknown
}

/**
 * How {@link TestingModule.init} prepares the module.
 *
 * @group Testing
 * @category Module
 */
export interface TestingModuleInitOptions {
  /**
   * Also runs every `onReady` hook, once, in dependency order, as the bot does once it is online. `true` hands each
   * hook a mock client from `createMockClient` and `{ primary: true }`; an object sets either.
   *
   * @defaultValue `false`
   */
  ready?: boolean | { client?: Client<true>; primary?: boolean }
}

/**
 * One handler {@link TestingModule.dispatch} ran, and how its call ended.
 *
 * @group Testing
 * @category Module
 */
export interface DispatchedHandler {
  /** The handler's controller. */
  controller: new (...args: any[]) => unknown
  /** The handler method's name. */
  method: string
  /** Whether the handler itself ran; `false` when a guard denied it or its input was refused. */
  ran: boolean
  /** The error its call ended with, handled by a filter or answered by the fallback. */
  error?: unknown
}

/**
 * What {@link TestingModule.dispatch} did with an interaction, a message or a reaction.
 *
 * @group Testing
 * @category Module
 */
export interface DispatchedCall extends InvocationResult {
  /** Whether any handler ran. */
  ran: boolean
  /**
   * The first error a handler's call ended with, or an error the built-in fallback answered as the
   * user's own outcome, such as a `CommandNotFoundError`.
   */
  error?: unknown
  /** Every handler dispatch reached, in the order it ran them; empty when none takes the input. */
  handlers: DispatchedHandler[]
}

/**
 * How an event sent with {@link TestingModule.emit} was handled.
 *
 * @group Testing
 * @category Module
 */
export interface EmitResult {
  /** How many `@On` and `@Once` handlers ran; a handler a guard denied is not counted. */
  ran: number
}

/**
 * A compiled testing module, which runs handlers as the bot does and resolves the classes it built.
 *
 * Use `invoke` to run a handler you name, `dispatch` to send an input through the bot's routing, and `emit` for a
 * gateway event. {@link getResponse} then reports what a handler sent.
 *
 * @remarks
 * Each compiled module has its own container: its own services, cooldown counts and theme cache. `init({ ready:
 * true })` and `close()` run the lifecycle hooks, as the bot does when it starts and stops.
 *
 * @example
 * ```ts
 * import { expect } from 'vitest'
 *
 * @Controller()
 * class TicketController {
 *   @Command('ticket/{id}/close', CommandType.BUTTON)
 *   async close(interaction: ButtonInteraction, { id }: { id: string }) {
 *     await respond(interaction).send(`Ticket ${id} closed.`)
 *   }
 * }
 * const module = MeoCordTestingModule.create({ controllers: [TicketController] }).compile()
 * const { handlers } = await module.dispatch(createMockInteraction(ButtonInteraction, { customId: 'ticket/7/close' }))
 * expect(handlers).toEqual([{ controller: TicketController, method: 'close', ran: true }])
 * ```
 *
 * @group Testing
 * @category Module
 * @see {@link MeoCordTestingModule}
 * @see {@link getResponse}
 * @see {@link https://meocord.dev/docs/4.1/invoke-and-dispatch | Invoke and dispatch}
 */
export class TestingModule {
  constructor(
    private readonly container: Container,
    private readonly controllers: readonly (new (...args: any[]) => unknown)[] = [],
    private readonly eventClasses: readonly (new (...args: any[]) => unknown)[] = [],
    private readonly providers: ProviderMap = new Map(),
    private readonly order: readonly unknown[] = [],
    private readonly messageOptions: MessageCommandOptions = {},
    private readonly lifecycle: readonly LifecycleUnit[] = [],
    /** The lifecycle units the container has constructed, which `close()` shuts down. */
    private readonly constructed: ReadonlySet<unknown> = new Set(),
    /** The `app`'s `warnUnanswered`, which dispatch follows as the bot does. */
    private readonly appWarnUnanswered?: boolean,
    /** The app's listed services, made at `init()` as the bot makes them before it logs in. */
    private readonly services: readonly (new (...args: any[]) => unknown)[] = [],
    /** How long `close()` waits for the `onShutdown` hooks, as the bot's `shutdownTimeout` does. */
    private readonly shutdownTimeout: number = DEFAULT_SHUTDOWN_TIMEOUT_MS,
  ) {}

  private resolving?: Promise<void>
  private readying?: Promise<void>
  private closing?: Promise<void>

  /**
   * Resolves the module's `useFactory` providers, awaiting those that return a promise, in dependency
   * order. `invoke`, `dispatch` and `emit` call it first; call it yourself before `get` resolves anything that
   * depends on an asynchronous factory. Calling it again does nothing more.
   *
   * With `{ ready: true }`, it then runs every `onReady` hook once, as the bot does once it is online:
   * one at a time, each class after the classes and providers it injects, the observers' last. Every
   * hook runs even when one fails. Pair it with {@link close}, which runs the `onShutdown` hooks.
   *
   * Ready, the module's app theme is also the one `useTheme()` reads outside any call, as a bot's is once
   * it is online, unless another module or app in the process was ready first: that one keeps it, and
   * this module's theme reaches its own calls only. {@link close} gives it up; nothing takes it over.
   *
   * @param options - `ready` to also run the `onReady` hooks, with the client and `primary` to pass them.
   * @returns The module, once every factory has made its value and every `onReady` hook asked for has
   *   run. Rejects with the error of a factory or a hook that failed, or an `AggregateError` of the
   *   hooks when several did.
   *
   * @example
   * ```ts
   * const module = await MeoCordTestingModule.create({
   *   controllers: [NotesController],
   *   providers: [{ provide: DATABASE, useFactory: async () => createTestDatabase() }],
   * })
   *   .compile()
   *   .init({ ready: true })
   *
   * expect(module.get(NotesStore).loaded).toBe(true)
   * await module.close()
   * ```
   */
  async init(options: TestingModuleInitOptions = {}): Promise<this> {
    this.resolving ??= resolveProviders(this.container, this.providers, this.order).then(() => {
      for (const service of this.services) this.container.get(service)
    })
    await this.resolving
    if (options.ready) {
      const { client = createMockClient() as unknown as Client<true>, primary = true } = options.ready === true ? {} : options.ready
      this.readying ??= this.runReady(client, primary)
      await this.readying
    }
    return this
  }

  /**
   * Runs the `onShutdown` hooks of every class and provided value the module has constructed, once, as
   * the bot does when it stops: one at a time, in reverse, so a class stops before the classes and
   * providers it uses. A factory's value, such as a connection pool `init()` made, is closed after
   * everything that injects it, whether or not `init({ ready: true })` ran. Nothing is constructed
   * just to be shut down. Every hook runs even when one fails. Calling it again does nothing more.
   *
   * It first gives up the theme read outside calls, if `init({ ready: true })` made it this module's;
   * reads outside calls then return MeoCord's defaults until another module or app is ready.
   *
   * The cooldown store and what it injects shut down last, in the same sequence as the bot's. When any of them has an
   * `onShutdown`, the calls `invoke`, `dispatch` and `emit` have under way finish first, then the store operations
   * they started, so the store's last writes still reach it. The module stops waiting for the whole sequence after
   * its `shutdownTimeout`, 10 seconds unless set, and logs that it did. Give a test whose fake store never answers, or
   * whose `onShutdown` never settles, a short `shutdownTimeout`.
   *
   * @returns Once every hook has run. Rejects with the error of a hook that failed, or an
   *   `AggregateError` naming each when several did.
   *
   * @example
   * ```ts
   * const module = await MeoCordTestingModule.create({ providers: [{ provide: POOL, useFactory: createPool }] })
   *   .compile()
   *   .init()
   *
   * await module.close()
   *
   * expect(module.get(POOL).ended).toBe(true)
   * ```
   */
  async close(): Promise<void> {
    this.closing ??= (async () => {
      // A close during init waits for the hooks it started, so it shuts down whatever they constructed
      await this.readying?.catch(() => undefined)
      const entries: LifecycleEntry[] = this.lifecycle
        .filter(unit => this.constructed.has(unit.token))
        // Already made, so this returns the instance; a provided value may be anything, null included
        .map(unit => lifecycleEntry(unit, (this.container.get(unit.token as ServiceIdentifier) as LifecycleEntry['instance'] | null) ?? {}))
      const failures: { name: string; error: unknown }[] = []
      await runShutdownSequence(this.container, entries, {
        drainCalls: () => callsSettled(this.calls),
        timeoutMs: this.shutdownTimeout,
        hookFailed: (name, error) => failures.push({ name, error }),
        warn: message => new Logger('TestingModule').warn(message),
      })
      // After the hooks, as a bot shutting down does; a module that never had it leaves another's alone
      releaseAmbientAppTheme(this.container)
      throwFailures('onShutdown', failures)
    })()
    await this.closing
  }

  private async runReady(client: Client<true>, primary: boolean): Promise<void> {
    // As the bot claims it before it comes online, so onReady reads the app's theme
    claimAmbientAppTheme(this.container)
    const failures: { name: string; error: unknown }[] = []
    const failed = (unit: LifecycleUnit, error: unknown) => failures.push({ name: unit.name, error })
    // No warning for a hook whose dependency failed: the test sees the dependency's own error
    // What close() shuts down is what was constructed, so the entries the runner records are not kept
    await runReadyHooks(this.container, this.lifecycle, client, { primary }, [], { resolveFailed: failed, hookFailed: failed })
    throwFailures('onReady', failures)
  }

  /**
   * The module's {@link ThemeCache}: the instance its classes inject, holding what `themeFor`, or
   * `overrideThemeFor`, looked up in this module's calls. Clear a result to have the next call look it up
   * again. Each module has its own.
   *
   * @example
   * ```ts
   * const guild = vi.fn(() => ({ colors: { primary: '#26A042' as const } }))
   * const module = MeoCordTestingModule.create({ app: App, controllers: [ShopController] }).overrideThemeFor({ guild }).compile()
   *
   * await module.dispatch(interaction)
   * module.themeCache.invalidateGuild(interaction.guildId!)
   * await module.dispatch(interaction)
   *
   * expect(guild).toHaveBeenCalledTimes(2)
   * ```
   */
  get themeCache(): ThemeCache {
    return this.container.get(ThemeCache)
  }

  /** The `@Once` handlers that have already handled their event, as a client forgets its once listeners. */
  private readonly firedOnce = new Set<string>()

  /**
   * Resolves an instance from the module, as the bot would inject it.
   *
   * @param token - A controller, a provided token, or another bound class.
   * @returns The instance, with its dependencies and overrides applied.
   * @throws When the instance depends on a factory that returns a promise and `init()` has not run.
   */
  get<T>(token: ProviderToken<T> | ServiceIdentifier<T>): T {
    try {
      return this.container.get<T>(token as ServiceIdentifier<T>)
    } catch (error) {
      if (!/asynchronous/i.test(String((error as Error)?.message))) throw error
      throw new Error(
        `${tokenName(token)} depends on a factory that returns a promise: await module.init() before get().`,
        { cause: error },
      )
    }
  }

  /**
   * Runs a handler through the same pipeline dispatch runs: `@Defer`'s acknowledgement, the global
   * guards of the module's `app`, then the handler's own, in order and once each; then the
   * interceptors, the app's first, around validation, pipes, cooldowns and the handler; all inside the
   * handler's exception filters. Guards resolve
   * from this module, so `overrideGuard` stubs apply and guards that inject `ExecutionContext` receive
   * it. `overrideInterceptor` and `overrideFilter` stubs apply the same way.
   *
   * Calling the controller method directly runs its guards but no interceptors, validation or
   * filters; `invoke` is the way to test everything dispatch runs around a handler.
   *
   * `invoke` tests one handler you name, and an error no filter handles rejects the call. That
   * includes the errors the bot answers the user with: a guard's `GuardDeniedError`, a `UserError` and
   * a `CooldownError` reject `invoke`, where `dispatch` resolves `{ ran, error }` and sends the answer.
   * To test what the bot does with an input, which handler it reaches and what the user is sent, use
   * {@link dispatch}.
   *
   * @param controller - A controller of the module: one given to `create`, or one of the app `fromApp` built it from.
   * @param methodName - The handler method's name.
   * @param args - The arguments dispatch would pass: the interaction, message or reaction, then the
   *   handler's params. With an interaction alone, the params are built as dispatch builds them: a
   *   command's or an autocomplete's options, or the handler's customId params with a modal's fields or
   *   a select menu's choices.
   *   An interaction's customId or command name must be one dispatch routes to the handler, ranking
   *   every handler of the module as the bot does; a mock built without one is not checked. With a message alone, a patterned `@MessageHandler` gets the
   *   params its pattern captures from the content, after the prefix of the module's `app`, with typed
   *   params resolved as dispatch resolves them, from the message's guild caches first; a message
   *   without content gets `{}`. A word that is not a value of its type, and a prefixed message that names
   *   the command but leaves out a param, go through the handler's filters as a `MessageUsageError`, as
   *   dispatch answers them.
   * @returns Whether the handler ran, and the error a filter handled, if any. Rejects with an error no
   *   filter handles, or with the error a filter throws: the built-in fallback, which answers such
   *   errors in the bot, does not run here. Rejects before running anything with an interaction or a
   *   message the handler's route does not match, naming both.
   *
   * @example
   * ```ts
   * const module = MeoCordTestingModule.create({ controllers: [ModerationController] }).compile()
   * const interaction = createMockInteraction(ChatInputCommandInteraction)
   *
   * // A guard that returns false
   * const { ran } = await module.invoke(ModerationController, 'ban', interaction)
   *
   * expect(ran).toBe(false)
   * expect(interaction.reply).not.toHaveBeenCalled()
   *
   * // A guard that throws GuardDeniedError, or a handler that throws UserError
   * await expect(module.invoke(ModerationController, 'kick', interaction)).rejects.toThrow(GuardDeniedError)
   *
   * // dispatch answers it as the bot does, and resolves with the outcome
   * const outcome = await module.dispatch(createMockInteraction(ChatInputCommandInteraction, { commandName: 'kick' }))
   * expect(outcome.ran).toBe(false)
   * expect(outcome.error).toBeInstanceOf(GuardDeniedError)
   * ```
   */
  async invoke<C extends new (...args: any[]) => unknown, M extends HandlerName<C>>(
    controller: C,
    methodName: M,
    ...args: HandlerArgs<C, M>
  ): Promise<InvocationResult> {
    await this.init()
    if (!this.controllers.includes(controller)) {
      throw new Error(`${controller.name} is not a controller of this testing module. Add it to \`controllers\`.`)
    }

    const instance = this.container.get(controller) as Record<string, (...args: unknown[]) => unknown>
    if (typeof instance[methodName] !== 'function') throw new Error(`${controller.name}.${methodName} is not a method.`)
    const [first] = args as unknown[]
    const interaction = first instanceof BaseInteraction ? (first as Interaction) : undefined
    // The handler dispatch gives the customId to, among every handler of the module
    const component = interaction && hasCustomId(interaction) ? componentRouteFor(this.componentRoutes(), controller, methodName, interaction) : undefined
    const mismatch = component && 'mismatch' in component ? component.mismatch : interaction && commandMismatch(controller, methodName, interaction)
    if (mismatch) throw new Error(mismatch)
    let hooks: Pick<RunOptions, 'parseArgs' | 'fetchArgs'> = {}
    let callArgs =
      args.length === 1 && interaction
        ? [interaction, handlerInput(interaction, component && 'params' in component ? component.params : {}).params]
        : (args as unknown[])
    if (args.length === 1 && first instanceof Message) {
      const input = await messageParamsFor(controller, methodName, first, this.messageOptions, this.controllers)
      if (input && 'mismatch' in input) throw new Error(input.mismatch)
      if (input) callArgs = [first, input.params]
      if (input && 'route' in input && input.route) {
        const { route, params, start = '', given } = input
        hooks = messageCommandHooks(route, params, first, start, given, this.messageOptions.types)
      }
    }
    const presenter = appPresenterOf(this.container)
    // A message command's errors are drawn by the app's presenter too, as an interaction's are
    const client = first instanceof BaseInteraction || first instanceof Message ? first.client : undefined
    if (presenter && client) setPresenter(client, presenter)
    this.registerClient(first)
    const { ran, error } = await this.track(runHandler(this.container, instance, methodName, callArgs, { awaitObservers: true, ...hooks }))
    return error === undefined ? { ran } : { ran, error }
  }

  /** The calls under way, each removed once it settles: what `close()` lets finish before the cooldown store stops. */
  private readonly calls = new Set<Promise<unknown>>()

  /** Counts `call` as under way until it settles. */
  private track<T>(call: Promise<T>): Promise<T> {
    this.calls.add(call)
    void call.then(
      () => this.calls.delete(call),
      () => this.calls.delete(call),
    )
    return call
  }

  /**
   * Makes this module the app of the input's client, as the bot is of its own, so `respond()` outside any call,
   * as in a collector's callback on that client, answers in this module's theme.
   */
  private registerClient(input: unknown): void {
    const client = (input as { client?: unknown } | undefined)?.client
    if (!client || typeof client !== 'object') return
    registerClientTheme(client, this.container)
    registerClientTranslator(client, this.container.isBound(Translator) ? this.container.get(Translator) : undefined)
  }

  private builtComponentRoutes?: ComponentRoute[]

  /** The module's component routes, ranked as dispatch ranks them; throws, as the bot would, for two of one shape. */
  private componentRoutes(): ComponentRoute[] {
    return (this.builtComponentRoutes ??= buildComponentRoutes(this.controllers))
  }

  private dispatcher?: Dispatcher

  /** The dispatcher the bot would build from this module's controllers and `app`. */
  private dispatcherOf(): Dispatcher {
    if (this.dispatcher) return this.dispatcher
    const logger = new Logger('TestingModule')
    const warnUnanswered = this.appWarnUnanswered ?? process.env.NODE_ENV === 'development'
    this.dispatcher = new Dispatcher({
      container: this.container,
      controllerClasses: this.controllers,
      messageOptions: this.messageOptions,
      logger,
      // Strict: an answer MeoCord fails to build rejects the dispatch, where a bot logs it and carries on
      fallback: createFallback(logger, () => this.messageOptions, {
        strict: true,
        cooldownNotice: refusal => claimCooldownNotice(this.container, refusal),
        storeDownNotice: who => claimStoreDownNotice(this.container, who),
      }),
      // A mock's client is the one bot every mock client is, so a mention of it starts a command
      botUserId: event => {
        const id = event.client?.user?.id
        return typeof id === 'string' ? id : undefined
      },
      warnUnanswered,
      awaitObservers: true,
    })
    return this.dispatcher
  }

  /**
   * Sends an interaction, a message or a reaction through the bot's own dispatch: routed over the module's
   * controllers and its `app`'s message options exactly as the bot routes it, then run through the full
   * pipeline of each handler it reaches. What the user is sent is sent to the mock, as the bot sends it:
   * the handler's answer, a usage reply, or the built-in fallback's answer to an error no filter handles.
   * Inputs the bot skips, such as a message from a bot, reach nothing. The module waits for its observers.
   *
   * `dispatch` tests what the bot does with an input: which handler it reaches, with what params, and what
   * the user sees. To test one handler you name, whatever would route to it, use {@link invoke}.
   *
   * @param input - An interaction or a message; or a reaction, with the user who reacted and whether they
   *   added it, `ReactionHandlerAction.ADD` unless given.
   * @returns Every handler reached, in the order it ran, whether any ran, and the first error a call ended
   *   with. An error the fallback answers as the user's own outcome resolves: a usage reply, an unknown
   *   command, or a guard's, a cooldown's, a validation's or a `UserError`'s refusal, as the fallback
   *   answers each for an interaction or a message. Any other error no filter handles rejects the call once
   *   the fallback has answered and every handler has run: with that error, or an `AggregateError` when
   *   several were left unhandled.
   *
   * @example
   * ```ts
   * const module = MeoCordTestingModule.create({ app: App, controllers: [CardController] }).compile()
   * const interaction = createMockInteraction(ButtonInteraction, { customId: 'card/summary/7' })
   *
   * const { handlers } = await module.dispatch(interaction)
   *
   * expect(handlers).toEqual([{ controller: CardController, method: 'summary', ran: true }])
   * ```
   */
  dispatch(input: Interaction | Message): Promise<DispatchedCall>
  dispatch(
    reaction: MessageReaction | PartialMessageReaction,
    options: { user: User | PartialUser; action?: ReactionHandlerAction },
  ): Promise<DispatchedCall>
  async dispatch(
    input: Interaction | Message | MessageReaction | PartialMessageReaction,
    options?: { user: User | PartialUser; action?: ReactionHandlerAction },
  ): Promise<DispatchedCall> {
    await this.init()
    this.registerClient(input)
    const dispatcher = this.dispatcherOf()
    const handlers: DispatchedHandler[] = []
    const unhandled: unknown[] = []
    const record: DispatchRecorder = {
      settled: (controller, method, { ran, error }) => handlers.push({ controller, method, ran, ...(error !== undefined && { error }) }),
      unhandled: error => unhandled.push(error),
    }

    if (options) {
      await this.track(dispatcher.reaction(input as MessageReaction, { user: options.user, action: options.action ?? ReactionHandlerAction.ADD }, record))
    } else if (input instanceof BaseInteraction) {
      const presenter = appPresenterOf(this.container)
      if (presenter) setPresenter(input.client, presenter)
      await this.track(dispatcher.interaction(input as Interaction, record))
    } else if (input instanceof Message) {
      const presenter = appPresenterOf(this.container)
      if (presenter) setPresenter(input.client, presenter)
      await this.track(dispatcher.message(input, record))
    } else {
      throw new TypeError('dispatch takes an interaction, a message, or a reaction with { user }.')
    }

    // What the fallback answers as the user's own outcome, such as a usage reply or a refusal, is an outcome to assert on
    const failures = unhandled.filter(error => !isUserOutcome(error, options ? undefined : input))
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, `${failures.length} errors were left to the fallback.`)
    const error = handlers.find(handler => handler.error !== undefined)?.error ?? unhandled[0]
    return { ran: handlers.some(handler => handler.ran), handlers, ...(error !== undefined && { error }) }
  }

  /**
   * Emits a client event to the module's `@On` and `@Once` handlers, through the same pipeline the app
   * runs them in: the global guards of the module's `app`, then each handler's own. Handlers on the
   * module's controllers, class providers and their dependencies all receive it. A `@Once` handler
   * handles only the first event, as it would on a client.
   *
   * @param event - The client event, such as `'guildMemberAdd'`.
   * @param args - The event's arguments, typed from discord.js's `ClientEvents`.
   * @returns How many handlers ran. Rejects once every handler has settled if any threw: with that
   *   error when one handler failed, or an `AggregateError` of them when several did.
   *
   * @example
   * ```ts
   * const module = MeoCordTestingModule.create({ controllers: [WelcomeController] }).compile()
   * const member = createMock<GuildMember>()
   *
   * const { ran } = await module.emit('guildMemberAdd', member)
   *
   * expect(ran).toBe(1)
   * ```
   */
  async emit<E extends keyof ClientEvents>(event: E, ...args: ClientEvents[E]): Promise<EmitResult> {
    await this.init()
    const calls: Promise<boolean>[] = []
    for (const cls of this.eventClasses) {
      for (const handler of getEventHandlers(cls.prototype)) {
        if (handler.event !== event) continue
        if (handler.once) {
          const key = `${cls.name}.${handler.method}:${event}`
          if (this.firedOnce.has(key)) continue
          this.firedOnce.add(key)
        }
        // Resolved inside the call, so a class that cannot be resolved fails as its handler would
        const run = async () => {
          const instance = this.container.get(cls) as Record<string, (...args: unknown[]) => unknown>
          const { ran } = await runHandler(this.container, instance, handler.method, args, { type: 'event', awaitObservers: true })
          return ran
        }
        calls.push(this.track(run()))
      }
    }

    const results = await Promise.allSettled(calls)
    const errors = results.flatMap(result => (result.status === 'rejected' ? [result.reason as unknown] : []))
    if (errors.length === 1) throw errors[0]
    if (errors.length > 1) throw new AggregateError(errors, `${errors.length} handlers of "${event}" threw.`)
    return { ran: results.filter(result => result.status === 'fulfilled' && result.value).length }
  }
}

/** Rejects with the one hook's error, or an `AggregateError` naming each when several failed. */
function throwFailures(hook: 'onReady' | 'onShutdown', failures: readonly { name: string; error: unknown }[]): void {
  if (failures.length === 1) throw failures[0].error
  if (failures.length > 1) {
    throw new AggregateError(
      failures.map(({ error }) => error),
      `${failures.length} ${hook} hooks threw: ${failures.map(({ name }) => name).join(', ')}.`,
    )
  }
}

/** The app's `messages` options, when the testing module is given an app. */
function messagesOf(app: object | undefined): MessageCommandOptions | undefined {
  return app && (Reflect.getMetadata(META.appOptions, app) as { messages?: MessageCommandOptions } | undefined)?.messages
}

/**
 * Builds a testing module, with stand-ins for the providers, stages and theme a test replaces.
 *
 * Use its `override*` methods before `compile()` to replace what a handler depends on, then run the handler with the
 * {@link TestingModule} it returns.
 *
 * @example
 * ```ts
 * @Controller()
 * class ProfileController {
 *   constructor(private readonly profiles: ProfileService) {}
 *   @Command('profile', CommandType.SLASH)
 *   @UseGuard(StaffGuard)
 *   async profile(interaction: ChatInputCommandInteraction) {
 *     await respond(interaction).send({ embeds: [await this.profiles.render(interaction.user.id)] })
 *   }
 * }
 * const module = MeoCordTestingModule.create({ controllers: [ProfileController] })
 *   .overrideProvider(ProfileService).useValue({ render: async () => new EmbedBuilder().setTitle('Ada') })
 *   .overrideGuard(StaffGuard).useValue({ canActivate: () => true })
 *   .compile()
 * ```
 *
 * @group Testing
 * @category Module
 * @see {@link MeoCordTestingModule}
 * @see {@link https://meocord.dev/docs/4.1/testing | The testing module}
 */
export class TestingModuleBuilder {
  private readonly overrides = new Map<unknown, Provider>()
  private readonly guardOverrides = new Map<new (...args: any[]) => GuardInterface, Partial<GuardInterface>>()
  private readonly filterOverrides = new Map<new (...args: any[]) => ExceptionFilter<any>, Partial<ExceptionFilter<any>>>()
  private readonly interceptorOverrides = new Map<
    new (...args: any[]) => InterceptorInterface,
    Partial<InterceptorInterface>
  >()

  /** The layer `overrideTheme` gives, over the app's `@MeoCord({ theme })`. */
  private themeOverride?: ThemeOverride
  /** The resolvers `overrideThemeFor` gives, in place of the app's `@MeoCord({ themeFor })`. */
  private themeForOverride?: { resolvers: ThemeResolvers | ThemeResolverClass | undefined }

  constructor(
    private readonly options: TestingModuleOptions,
    private readonly wiring?: AppWiring,
  ) {}

  /**
   * Replaces a provider with a test double.
   *
   * The double needs only the members the test uses; misspelled member names are still rejected.
   *
   * @param token - The provider to replace.
   * @example
   * ```ts
   * builder.overrideProvider(UserService).useValue({ findUser: vi.fn() })
   * ```
   */
  overrideProvider<T>(token: ProviderToken<T> | ServiceIdentifier<T>): { useValue: (value: Partial<T>) => TestingModuleBuilder } {
    return {
      useValue: (value: Partial<T>) => {
        this.overrides.set(token, { provide: token, useValue: value })
        return this
      },
    }
  }

  /**
   * Replaces a guard with a stub wherever it applies, globally or on a controller or handler.
   *
   * @param guard - The guard class to replace.
   * @example
   * ```ts
   * builder.overrideGuard(RateLimitGuard).useValue({ canActivate: () => true })
   * ```
   */
  overrideGuard(guard: new (...args: any[]) => GuardInterface): {
    useValue: (stub: Partial<GuardInterface>) => TestingModuleBuilder
  } {
    return {
      useValue: (stub: Partial<GuardInterface>) => {
        this.guardOverrides.set(guard, stub)
        return this
      },
    }
  }

  /**
   * Replaces an interceptor with a stub wherever it applies, globally or on a controller or handler.
   * The stub's `intercept` receives the context and `next`; call `next.handle()` to run the handler.
   *
   * @param interceptor - The interceptor class to replace.
   * @example
   * ```ts
   * builder.overrideInterceptor(TimingInterceptor).useValue({ intercept: (_context, next) => next.handle() })
   * ```
   */
  overrideInterceptor(interceptor: new (...args: any[]) => InterceptorInterface): {
    useValue: (stub: Partial<InterceptorInterface>) => TestingModuleBuilder
  } {
    return {
      useValue: (stub: Partial<InterceptorInterface>) => {
        this.interceptorOverrides.set(interceptor, stub)
        return this
      },
    }
  }

  /**
   * Replaces an exception filter with a stub wherever it applies. The filter's `@Catch` still decides
   * which errors reach the stub.
   *
   * @param filter - The filter class to replace.
   * @example
   * ```ts
   * builder.overrideFilter(RateLimitedFilter).useValue({ catch: vi.fn() })
   * ```
   */
  overrideFilter(filter: new (...args: any[]) => ExceptionFilter<any>): {
    useValue: (stub: Partial<ExceptionFilter<any>>) => TestingModuleBuilder
  } {
    return {
      useValue: (stub: Partial<ExceptionFilter<any>>) => {
        this.filterOverrides.set(filter, stub)
        return this
      },
    }
  }

  /**
   * Changes part of the app's `@MeoCord({ theme })` for this module, or gives a module without an app a
   * theme. It goes over the app's theme, so it names only the tokens it changes; each `@UseTheme`, and what
   * `themeFor` looks up, still goes over it.
   *
   * @param theme - The tokens to change, checked as `@MeoCord({ theme })` checks them, and copied.
   * @throws Error naming each token that is not valid.
   * @example
   * ```ts
   * const module = MeoCordTestingModule.create({ app: App, controllers: [ShopController] })
   *   .overrideTheme({ colors: { primary: '#E3606D' } })
   *   .compile()
   * ```
   */
  overrideTheme(theme: ThemeOverride): TestingModuleBuilder {
    assertValidTheme(theme, 'overrideTheme')
    this.themeOverride = copyLayer(theme)
    return this
  }

  /**
   * Replaces the app's `@MeoCord({ themeFor })` for this module, or removes it with `undefined`. The app's
   * `themeCache` and `themeForTimeoutMs` still apply, and the results are cached in {@link TestingModule.themeCache},
   * as the bot caches them. A mock resolver shows each lookup. A class implementing {@link ThemeResolver} is bound as
   * the app binds one, so `overrideProvider` replaces it or what it injects.
   *
   * @param resolvers - The server's and the user's resolvers, a class implementing `ThemeResolver`, or `undefined`
   *   for none.
   * @throws TypeError when a resolver is not a function, or is neither `guild` nor `user`, or a class has neither
   *   method.
   * @example
   * ```ts
   * const guild = vi.fn(() => ({ colors: { primary: '#26A042' as const } }))
   * const module = MeoCordTestingModule.create({ app: App, controllers: [ShopController] }).overrideThemeFor({ guild }).compile()
   * ```
   */
  overrideThemeFor(resolvers: ThemeResolvers | (new (...args: any[]) => ThemeResolver) | undefined): TestingModuleBuilder {
    const problem = resolvers === undefined ? undefined : themeForProblem(resolvers, 'overrideThemeFor', 'a class implementing ThemeResolver, or undefined for none.')
    if (problem) throw new TypeError(problem)
    this.themeForOverride = { resolvers: typeof resolvers === 'function' ? resolvers : resolvers && { ...resolvers } }
    return this
  }

  /** The app's global stages, with the theme overrides over them; `undefined` for a module with neither. */
  private globalStages(): GlobalStages | undefined {
    const stages = this.options.app && appStages(this.options.app)
    if (!this.themeOverride && !this.themeForOverride) return stages
    const { theme: appTheme, themeFor, ...rest } = stages ?? { guards: [], interceptors: [], filters: [] }
    // Merged as a scope's layer is; the app's layer is MeoCord's copy, so freezing it touches nothing of the app's
    const theme = this.themeOverride ? (appTheme ? (mergeTheme(appTheme as ResolvedTheme, this.themeOverride) as ThemeOverride) : this.themeOverride) : appTheme
    const resolvers = this.themeForOverride ? this.themeForOverride.resolvers : themeFor?.resolvers
    return {
      ...rest,
      ...(theme !== undefined && { theme }),
      ...(resolvers !== undefined && { themeFor: { ...themeFor, resolvers } }),
    }
  }

  /**
   * Binds the controllers, providers and overrides into a module ready to resolve and run handlers.
   *
   * It runs the bot's startup checks on commands and autocomplete handlers, except a command no builder registers,
   * since a handler declared with a `CommandType` and no builder is how a test fixture is written. A subcommand path
   * its command's builder does not register, a customId pattern given as a command name, a builder that registers
   * another name, and component patterns that can match the same customId are named, as the bot names them.
   *
   * @returns The compiled module.
   */
  compile(): TestingModule {
    // The bound the bot's config gives it, with the same words
    const shutdownTimeout = this.options.shutdownTimeout === undefined ? undefined : shutdownTimeoutProblem(this.options.shutdownTimeout)
    if (shutdownTimeout) throw new TypeError(`shutdownTimeout ${shutdownTimeout}.`)
    const container = new Container()
    const stages = this.globalStages()
    if (stages) bindGlobalStages(container, stages)

    // Bound first, as in the app, so a class that injects it gets this instance
    const appClasses: (new (...args: any[]) => unknown)[] = []
    const translator = () => (container.isBound(Translator) ? container.get(Translator) : undefined)
    container.bind(HandlerRegistry).toConstantValue(new HandlerRegistry(appClasses, messagesOf(this.options.app), translator))
    // A testing module runs as one process, so a cross-shard call runs once, here
    container.bind(ShardContext).toConstantValue(
      new ShardContext(
        undefined,
        shardCallHandler(container, () => [...appClasses, ...[...providers.keys()].filter(isAppClassToken)], 'this testing module'),
      ),
    )
    bindsOwnToken(container, HandlerRegistry)
    bindsOwnToken(container, ShardContext)

    // Checked as the app checks its own: the app's providers in their order, then the test's, which replace them
    // by token, then the overrides, which win
    const providers = providerMap(this.wiring?.providers ?? [], '@MeoCord({ providers })')
    for (const [token, provider] of providerMap(this.options.providers ?? [], "the testing module's providers")) providers.set(token, provider)
    for (const [token, override] of this.overrides) providers.set(token, override)
    const services = this.wiring?.services ?? []
    const appOptions = this.options.app
      ? (Reflect.getMetadata(META.appOptions, this.options.app) as
          | { cooldownStore?: new (...args: any[]) => CooldownStore; cooldownStoreFailure?: CooldownStoreFailure; cooldownStoreTimeoutMs?: number }
          | undefined)
      : undefined
    // The app's own store, as the bot binds it, whether the module is given the app or built from it; none when the
    // test provides the CooldownStore, so nothing builds the app's or asks for what it injects
    const store = providers.has(CooldownStore) ? undefined : appOptions?.cooldownStore
    // The themeFor class this module runs, the app's or overrideThemeFor's, bound on its own as the app binds it
    const themeResolver = themeResolverClass(stages?.themeFor?.resolvers)
    const roots = [
      ...(this.options.controllers ?? []),
      ...services,
      ...(themeResolver ? [themeResolver] : []),
      ...(store ? [store] : []),
      ...(this.options.app ? appObservers(this.options.app) : []),
      ...(this.options.observers ?? []),
    ]
    const reachable = reachableClasses(roots, providers)
    // Its stage classes too, as the app checks them, except those an override stands in for
    const decorators = classDecorators(this.options.controllers ?? [], stages)
    for (const stub of [...this.guardOverrides.keys(), ...this.interceptorOverrides.keys(), ...this.filterOverrides.keys()]) decorators.delete(stub)
    assertTypedParameters(reachableClasses([...roots, ...decorators.keys()], providers), decorators)
    // The bot binds the Client it logs in with; a test gives its own, and is told so where one is needed
    const needClient = reachable.filter(cls => injectedTokens(cls).includes(Client))
    if (needClient.length > 0 && !providers.has(Client)) {
      container.bind(Client).toDynamicValue(() => {
        throw new Error(
          `${needClient.map(cls => cls.name).join(', ')} ${needClient.length === 1 ? 'injects' : 'inject'} the Discord Client, ` +
            'which a testing module does not make: give one in its providers, such as ' +
            '{ provide: Client, useValue: createMockClient() }.',
        )
      })
    }

    // Bind guard overrides — prevents inversify from auto-wiring guard dependencies
    for (const [guardClass, stub] of this.guardOverrides) {
      container.bind(guardClass).toConstantValue(stub as GuardInterface)
    }

    for (const [filterClass, stub] of this.filterOverrides) {
      container.bind(filterClass).toConstantValue(stub as ExceptionFilter)
    }

    for (const [interceptorClass, stub] of this.interceptorOverrides) {
      container.bind(interceptorClass).toConstantValue(stub as InterceptorInterface)
    }

    // The app's cooldown policy, so a test of a failing store sees what the bot would do
    if (appOptions && !container.isBound(COOLDOWN_POLICY)) container.bind(COOLDOWN_POLICY).toConstantValue(cooldownPolicyFrom(appOptions))

    // The app's translator, unless a provider stands in for it
    const i18n = this.options.app && (Reflect.getMetadata(META.appOptions, this.options.app) as { i18n?: Translator })?.i18n
    if (i18n && !providers.has(Translator)) {
      container.bind(Translator).toConstantValue(i18n)
      bindsOwnToken(container, Translator)
    }

    // Recursively bind controllers and their dependencies, skipping already-bound tokens
    const bindClass = (cls: new (...args: any[]) => any) => {
      // A provided class is bound by its own provider, wherever in the list that provider comes
      if (container.isBound(cls) || providers.has(cls)) return
      if (injectedTokens(cls).includes(ExecutionContext)) throw singletonContextError(cls)

      makeInjectable(cls)
      container.bind(cls).toSelf().inSingletonScope()

      // By constructor type or @inject token, as the app binds them
      for (const dep of injectedTokens(cls)) {
        if (dep === Translator && !container.isBound(Translator)) throw missingTranslatorError(cls)
        if (isAppClassToken(dep)) bindClass(dep)
      }
    }

    // The app's own store, resolved like a service, unless the test provides the CooldownStore itself; bound first, as the
    // app binds it, so a class that injects the token gets the store
    if (!providers.has(CooldownStore)) {
      if (store) {
        bindClass(store)
        container.bind(CooldownStore).toService(store)
      } else {
        container.bind(CooldownStore).toConstantValue(new MemoryCooldownStore())
      }
      bindsOwnToken(container, CooldownStore, store)
    }

    // Before the controllers, so a class token that is provided is not also bound as itself
    for (const provider of providers.values()) bindProvider(container, provider, bindClass)

    for (const ctrl of this.options.controllers ?? []) {
      bindClass(ctrl)
      // Stamp container on controller class so @UseGuard works in tests too
      Reflect.defineMetadata(META.container, container, ctrl)
    }
    for (const service of services) bindClass(service)
    if (themeResolver) bindClass(themeResolver)

    // The classes whose @On and @Once handlers emit reaches: class providers bound as themselves, the
    // controllers, and what they inject; factories resolve in the same order
    const order = resolutionOrder(container, providers, [...providers.keys(), ...services, ...(themeResolver ? [themeResolver] : []), ...(this.options.controllers ?? [])], {
      followOwnTokens: false,
    })
    appClasses.push(
      ...order.filter((token): token is new (...args: any[]) => unknown => {
        const provider = providers.get(token)
        return isAppClassToken(token) && (!provider || (isClassProvider(provider) && provider.useClass === token))
      }),
    )
    assertProvided(container, providers, [...appClasses, ...(store ? [store] : [])], "the testing module's providers")
    for (const cls of appClasses) Reflect.defineMetadata(META.container, container, cls)
    prepareHandlerStages(container, appClasses)
    const messages = messagesOf(this.options.app)
    // As the app would at startup, refuses a message pattern that cannot be read or two that match the same messages
    buildMessageRoutes(this.options.controllers ?? [], messages)
    // As the app does when it is created, so a test sees the refusal the bot would give
    assertDistinctCommands(this.options.controllers ?? [])
    // A handler with no builder is how a fixture is written, so only what is always a mistake is named
    warnUnregisteredCommands(this.options.controllers ?? [], { missingBuilders: false })
    warnInheritedRoutes(this.options.controllers ?? [])
    warnOverlappingPatterns(this.options.controllers ?? [])
    warnHandlersOffControllers(this.options.controllers ?? [], appClasses)
    if (this.options.app) bindAppPresenter(container, this.options.app)
    const observers = [...(this.options.app ? appObservers(this.options.app) : []), ...(this.options.observers ?? [])]
    assertObservers("the testing module's observers", observers)
    bindObservers(container, observers)
    // The store calls ask: the test's own when it provides CooldownStore, else the app's
    const boundStore = store ?? (providers.has(CooldownStore) ? CooldownStore : undefined)
    // The order the app runs lifecycle hooks in: its cooldown store, then providers, controllers and observers, each
    // after what it injects
    const lifecycle: LifecycleUnit[] = resolutionOrder(container, providers, [
      ...(boundStore ? [boundStore] : []),
      ...providers.keys(),
      ...services,
      ...(themeResolver ? [themeResolver] : []),
      ...(this.options.controllers ?? []),
      ...observers,
    ]).map(token => ({
      token,
      name: tokenName(token),
      dependencies: tokenDependencies(container, providers, token),
      ...(token === boundStore && { cooldownStore: true }),
    }))
    // Recorded as the container makes each one, so close() shuts down exactly what exists
    const constructed = new Set<unknown>()
    for (const { token } of lifecycle) {
      container.onActivation(token as ServiceIdentifier, (_context, instance) => {
        constructed.add(token)
        return instance
      })
    }

    const warnUnanswered = this.options.app && (Reflect.getMetadata(META.appOptions, this.options.app) as { warnUnanswered?: boolean })?.warnUnanswered

    return new TestingModule(
      container,
      [...(this.options.controllers ?? [])],
      appClasses,
      providers,
      order,
      messages,
      lifecycle,
      constructed,
      warnUnanswered,
      services,
      this.options.shutdownTimeout ?? DEFAULT_SHUTDOWN_TIMEOUT_MS,
    )
  }
}

/**
 * Builds testing modules: the classes a test needs, in a container of their own, with no Discord connection.
 *
 * Use it for a controller, or anything MeoCord resolves for you: a service with injected dependencies, a guard, an
 * interceptor, a presenter. A service that takes plain values needs no module; build it with `new`.
 *
 * @example
 * ```ts
 * import { expect } from 'vitest'
 *
 * @Controller()
 * class PingController {
 *   @Command('ping', CommandType.SLASH)
 *   async ping(interaction: ChatInputCommandInteraction) {
 *     await respond(interaction).send('pong')
 *   }
 * }
 * const module = MeoCordTestingModule.create({ controllers: [PingController] }).compile()
 * const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName: 'ping' })
 * await module.invoke(PingController, 'ping', interaction)
 * expect(getResponse(interaction).calls[0].method).toBe('reply')
 * ```
 *
 * @group Testing
 * @category Module
 * @see {@link TestingModuleBuilder}
 * @see {@link TestingModule}
 * @see {@link https://meocord.dev/docs/4.1/testing | The testing module}
 */
export class MeoCordTestingModule {
  /**
   * Starts building a testing module from the classes a test needs.
   *
   * @param options - The controllers, providers, observers and app the module is built from.
   * @returns The builder, to override what the test replaces before `compile()`.
   */
  static create(options: TestingModuleOptions): TestingModuleBuilder {
    return new TestingModuleBuilder(options)
  }

  /**
   * Starts building a testing module from a whole `@MeoCord` app, wired as the bot wires it.
   *
   * Use it to test the app as it runs: every controller, service, provider and the cooldown store come from its
   * `@MeoCord({...})`, with its stages, translator, presenter, message options, theme and observers, as
   * {@link TestingModuleOptions.app} gives them. A test replaces what it must, by token, before anything is made.
   *
   * @remarks
   * `compile()` runs no factory; `init()` runs each one the module provides, as the bot does before it logs in, so
   * a factory the test replaces never runs, and one it keeps runs at `init()`. The app's listed services are made
   * at `init()` too.
   * The module makes no Discord `Client`: a class that injects one needs it in `providers`.
   *
   * @param app - The class `@MeoCord` decorates.
   * @param options - Providers that replace the app's by token, extra controllers, and observers.
   * @returns The builder, whose `override*` methods still apply, for `compile()`.
   * @throws TypeError when `app` is not a `@MeoCord` class.
   *
   * @example
   * ```ts
   * import { expect } from 'vitest'
   *
   * const DATABASE = createToken<{ query(sql: string): Promise<unknown[]> }>('Database')
   * @Service()
   * class Notes {
   *   constructor(@Inject(DATABASE) private readonly db: { query(sql: string): Promise<unknown[]> }) {}
   *   list() {
   *     return this.db.query('select * from notes')
   *   }
   * }
   * @Controller()
   * class NotesController {
   *   constructor(private readonly notes: Notes) {}
   *   @Command('notes', CommandType.SLASH)
   *   async show(interaction: ChatInputCommandInteraction) {
   *     await respond(interaction).send(`${(await this.notes.list()).length} notes`)
   *   }
   * }
   * @MeoCord({
   *   controllers: [NotesController],
   *   providers: [{ provide: DATABASE, useFactory: async () => ({ query: async () => [] }) }],
   *   clientOptions: { intents: [] },
   * })
   * class App {}
   *
   * // The app's own wiring, with an in-memory database in place of the real one
   * const module = await MeoCordTestingModule.fromApp(App, {
   *   providers: [{ provide: DATABASE, useValue: { query: async () => [{ id: 1 }] } }],
   * })
   *   .compile()
   *   .init()
   * const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName: 'notes' })
   * await module.dispatch(interaction)
   * expect(getResponse(interaction).calls[0].payload).toMatchObject({ content: '1 notes' })
   * ```
   */
  static fromApp(app: new (...args: any[]) => unknown, options: FromAppOptions = {}): TestingModuleBuilder {
    const appOptions = Reflect.getMetadata(META.appOptions, app) as
      | {
          controllers: (new (...args: any[]) => any)[]
          services?: (new (...args: any[]) => unknown)[]
          providers?: Provider[]
        }
      | undefined
    if (!appOptions) throw new TypeError(`${app?.name ?? String(app)} is not a @MeoCord app: fromApp takes the class @MeoCord decorates.`)
    const controllers = [...new Set([...appOptions.controllers, ...(options.controllers ?? [])])]
    return new TestingModuleBuilder(
      { app, controllers, providers: options.providers, observers: options.observers, shutdownTimeout: options.shutdownTimeout },
      { providers: appOptions.providers ?? [], services: appOptions.services ?? [] },
    )
  }
}

// Built by MeoCordTestingModule, never injected; registered here, as meocord/core does not load the testing module
adviseInPlaceOfInjecting(TestingModuleBuilder, 'build it with MeoCordTestingModule.create(…) or MeoCordTestingModule.fromApp(…)')
adviseInPlaceOfInjecting(TestingModule, 'make it with MeoCordTestingModule.create(…).compile()')
