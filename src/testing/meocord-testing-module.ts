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
  ApplicationCommandType,
  BaseInteraction,
  Client,
  type ClientEvents,
  Events,
  type Interaction,
  Message,
  type MessageReaction,
  type PartialMessageReaction,
  type PartialUser,
  ReactionType,
  type User,
} from 'discord.js'
import { ReactionHandlerAction } from '@src/enum/index.js'
import { CooldownStore, MemoryCooldownStore } from '@src/common/cooldown-store.js'
import { ExecutionContext, inferContextType } from '@src/common/execution-context.js'
import { Translator } from '@src/common/translator.js'
import { injectedTokens, prepareDirectCalls, singletonContextError } from '@src/core/guard-runner.js'
import {
  appPresenterOf,
  appStages,
  bindAppPresenter,
  bindGlobalStages,
  type GlobalStages,
  globalStagesOf,
  type HandlerOutcome,
  prepareAppPresenter,
  prepareHandlerStages,
  prepareThemes,
  type RunOptions,
  runHandler,
} from '@src/core/handler-pipeline.js'
import { clientPresenter, setPresenter } from '@src/common/response/presenter.js'
import { autocompleteMismatch, commandMismatch, componentRouteFor, handlerInput } from '@src/core/handler-input.js'
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
import {
  appTheme,
  claimAmbientAppTheme,
  prepareLateThemes,
  registerClientTheme,
  releaseAmbientAppTheme,
  stopThemeLookups,
} from '@src/core/theme-runtime.js'
import { registerClientTranslator } from '@src/common/meocord-text.js'
import { provideCommandIds } from '@src/core/command-ids.js'
import { SNOWFLAKE, testingCommandIds } from '@src/testing/testing-command-ids.js'
import { copyLayer, defaultTheme, mergeTheme, type ResolvedTheme } from '@src/core/theme-scope.js'
import { assertValidTheme, themeForProblem } from '@src/core/theme-validation.js'
import { buildMessageRoutes, messageParamsFor } from '@src/core/message-routes.js'
import {
  assertDistinctCommands,
  warnContextMenuParams,
  warnHandlersOffControllers,
  warnInheritedRoutes,
  warnOverlappingPatterns,
  warnUnregisteredCommands,
} from '@src/core/command-conflicts.js'
import { messageCommandHooks } from '@src/core/message-params.js'
import { appObservers, assertObservers, bindObservers } from '@src/core/observer-runner.js'
import { HandlerRegistry, listEventSources } from '@src/core/handler-registry.js'
import { type EventSource, eventSources } from '@src/core/event-sources.js'
import { adviseInPlaceOfInjecting, boundBeforeProviders, meocordClasses } from '@src/core/meocord-classes.js'
import { assertStartupClasses, lateGuardCheck, perCallEventWarnings, stageDependencies, startupClasses } from '@src/core/startup-roots.js'
import { assertStartupChecked, markStartupChecked } from '@src/core/startup-checked.js'
import { makeInjectable } from '@src/util/injectable.util.js'
import { shardCallHandler, ShardContext } from '@src/core/shard-context.js'
import { isAppClassToken, type LifecycleUnit } from '@src/core/lifecycle-order.js'
import {
  type LifecycleEntry,
  lifecycleEntry,
  inShutdownHookOf,
  ReadyPass,
  runReadyHooks,
  runShutdownSequence,
  shutDownLateValue,
  SLOW_READY_HOOK_MS,
  slowReadyWarning,
  within,
} from '@src/core/lifecycle-hooks.js'
import { closeReadyGate } from '@src/core/ready-gate.js'
import { RunningCalls } from '@src/core/running-calls.js'
import { applyDispatchedReaction, createMockClient, isMockClient, noteReactionDispatch } from '@src/testing/mock-interaction.js'

// Taken as the module loads, before a test fakes the timers, so the wait after a client's listeners holds
const realSetImmediate = globalThis.setImmediate
import { Dispatcher, type DispatchRecorder } from '@src/core/dispatcher.js'
import { createEventFallback, createFallback, type Fallback, type FallbackOptions, isUserOutcome } from '@src/core/fallback.js'
import { GuardDeniedError, UserError } from '@src/common/errors.js'
import { Logger } from '@src/common/logger.js'
import { isExplainedError, markExplained } from '@src/common/explained-error.js'
import { collectStartupErrors, declaredErrorsOf, isRefusal, logStartupErrors, startupError, stopOnStartupErrors } from '@src/util/refusal.util.js'
import { DEFAULT_SHUTDOWN_TIMEOUT_MS, shutdownTimeoutProblem } from '@src/util/shutdown-timeout.util.js'
import { describeValue, isConstructor, withArticle } from '@src/util/value.util.js'
import {
  assertProvided,
  appProviderRefusal,
  assertProvidedServices,
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
import { getHandlerRoutes, getReactionHandlers } from '@src/decorator/controller.decorator.js'
import { type EventHandlerMetadata, getEventHandlers } from '@src/decorator/event.decorator.js'
import { strictMocks } from '@src/testing/strict-mocks.js'
import { notAClass } from '@src/testing/routing.js'
import { warnOnce } from '@src/common/deprecation.js'
import { META } from '@src/util/metadata-keys.js'

type Listener = (...args: unknown[]) => unknown

/** A client's `event` listeners, read past its mock functions, so a test's record of them holds only its own calls. */
const listenersOf = (client: Client, event: string): Listener[] => Client.prototype.rawListeners.call(client, event) as Listener[]

/**
 * Calls `listeners` with `args` as an emitter's `emit` calls them: in order, a `once` listener only once, and none
 * after one that throws. Waits for what each returns, then one turn of the event loop, so a collector's `collect`
 * callback has started; resolves to what they threw or rejected with.
 */
async function deliverToListeners(client: Client, listeners: readonly Listener[], args: readonly unknown[]): Promise<unknown[]> {
  const failures: unknown[] = []
  const settling: Promise<void>[] = []
  for (const listener of listeners) {
    try {
      const result = listener.call(client, ...args)
      if (result instanceof Promise) settling.push(result.then(() => undefined, (error: unknown) => void failures.push(error)))
    } catch (error) {
      failures.push(error)
      break
    }
  }
  await Promise.all(settling)
  await new Promise(resolve => realSetImmediate(resolve))
  return failures
}

/**
 * Under strict mocks, for a client `createMockClient` made, the delivery of a dispatched message or reaction to the
 * client's `event` listeners, as the gateway emits it after MeoCord's own listener: to those attached before routing
 * starts, so a collector a handler starts misses the message that started it. Undefined otherwise.
 */
function gatewayDelivery(clientOf: () => Client, event: string): ((args: readonly unknown[]) => Promise<unknown[]>) | undefined {
  // Read only under strict mocks, where a mock's client is no placeholder
  if (!strictMocks()) return undefined
  const client = clientOf()
  if (!isMockClient(client)) return undefined
  const listeners = listenersOf(client, event)
  return args => deliverToListeners(client, listeners, args)
}

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

  /**
   * Has `emit` answer an error no filter handles as the bot's event fallback does: a guard's `GuardDeniedError` skips
   * the event, and a `UserError` is answered as a reply to the newest message among the event's arguments, drawn with
   * the `app`'s presenter and `replyEmoji`. Neither rejects `emit`; any other error still does. Unset, `emit` rejects
   * with both, and warns once that the next major version (5.0) answers them as the bot does; `false` keeps the
   * rejection without the warning. It applies to `emit` alone: `invoke` of an `@On` or `@Once` handler doesn't take it.
   *
   * @see {@link https://github.com/meocord/meocord/issues/964 | meocord#964}
   */
  eventFallback?: boolean
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
  /** Has `emit` answer a denial and a `UserError` as the bot does; see {@link TestingModuleOptions.eventFallback}. */
  eventFallback?: boolean
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
  /**
   * How many `@On` and `@Once` handlers ran; a handler a guard denied is not counted. A guard that throws
   * `GuardDeniedError` rejects `emit` instead, unless the module has `eventFallback: true`, which skips the event as
   * the bot does.
   */
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
 * @see {@link https://meocord.dev/docs/4.2/invoke-and-dispatch | Invoke and dispatch}
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
    /** The `app`, whose presenter `init()` makes after the providers, as the bot does. */
    private readonly app?: object,
    /** Whether `emit` answers a denial and a `UserError` with the bot's event fallback; unset, it rejects and warns. */
    private readonly eventFallback?: boolean,
    /** The units in the bot's hook order, which strict mocks run them in. */
    private readonly botLifecycle?: readonly LifecycleUnit[],
  ) {}

  /**
   * The units in the order a hook runs in: the bot's under strict mocks. Without them, the module's own, with one
   * warning a run when the units `runs` the hook for come in another order than in the bot.
   */
  private hookOrder(runs: (unit: LifecycleUnit) => boolean): readonly LifecycleUnit[] {
    const botLifecycle = this.botLifecycle ?? this.lifecycle
    if (strictMocks()) return botLifecycle
    const here = this.lifecycle.filter(runs)
    const bot = botLifecycle.filter(runs)
    const moved = here.find((unit, index) => unit.token !== bot[index]?.token)
    if (moved) {
      warnOnce(
        new Logger('TestingModule'),
        `${moved.name}'s lifecycle hooks run in another order here than in the bot, which runs those of a class only a ` +
          "stage or the presenter injects after the controllers' and observers'. useStrictMocks() runs them in the bot's " +
          'order here; in the next major version (5.0) the testing module does without the call ' +
          '(https://github.com/meocord/meocord/issues/441).',
      )
    }
    return this.lifecycle
  }

  /** Whether `unit` has `hook`: read from its instance once made, else from its class. */
  private hasHook(unit: LifecycleUnit, hook: 'onReady' | 'onShutdown'): boolean {
    const target = this.constructed.has(unit.token)
      ? (this.container.get(unit.token as ServiceIdentifier) as Record<string, unknown> | null)
      : (unit.token as { prototype?: Record<string, unknown> }).prototype
    return typeof target?.[hook] === 'function'
  }

  private resolving?: Promise<void>
  /** Whether `close()` was called while `init()` resolved the providers, after which `init()` makes nothing more. */
  private closedDuringInit = false
  /** The factory `init()` awaits, by its token, for a `close()` that stops waiting for it to name and shut down. */
  private pendingFactory?: unknown
  /** The factory `close()` stopped waiting for, whose value is shut down once it arrives and `close()` is done. */
  private outlastedFactory?: unknown
  /** The units `close()` shut down, so a value it shut down is not shut down again as it arrives. */
  private readonly shutDown = new Set<unknown>()
  /** The instances whose `@On` and `@Once` handlers `emit` runs, read at `init()`. */
  private sources?: readonly EventSource[]
  private readying?: Promise<void>
  private closing?: Promise<void>
  /** The `onReady` hooks' pass, which `close()` waits for, less one whose `onReady` called `close()`. */
  private readonly readyPass = new ReadyPass()

  /**
   * Resolves the module's `useFactory` providers, awaiting those that return a promise, in dependency
   * order. `invoke`, `dispatch` and `emit` call it first; call it yourself before `get` resolves anything that
   * depends on an asynchronous factory. Calling it again does nothing more.
   *
   * With `{ ready: true }`, it then runs every `onReady` hook once, as the bot does once it is online:
   * one at a time, each class after the classes and providers it injects, the observers' last, then, under
   * `useStrictMocks()`, a class only a stage or the presenter injects, as in the bot. Every hook runs even when one
   * fails. Pair it with {@link close}, which runs the `onShutdown` hooks. With
   * `@MeoCord({ waitForReady: true })`, a `dispatch`, `invoke` or `emit` made while they run waits for the hooks of
   * the classes it uses, as the bot's calls do.
   *
   * Ready, the module's app theme is also the one `useTheme()` reads outside any call, as a bot's is once
   * it is online, unless another module or app in the process was ready first: that one keeps it, and
   * this module's theme reaches its own calls only. {@link close} gives it up; nothing takes it over.
   *
   * A {@link close} while it makes the providers ends it, as a stop ends a bot's start: the factory under way finishes,
   * and nothing after it is made, no other factory and no listed service, and no `onReady` hook runs. It resolves all
   * the same. A factory that settles after `close()` stopped waiting for it has its value shut down once it arrives
   * and `close()` is done, and `init()` resolves after that.
   *
   * @param options - `ready` to also run the `onReady` hooks, with the client and `primary` to pass them.
   * @returns The module, once every factory has made its value and every `onReady` hook asked for has
   *   run. Rejects with the error of a factory or a hook that failed, or an `AggregateError` of the
   *   hooks when several did.
   *
   * @example
   * ```ts
   * import { expect } from 'vitest'
   *
   * const DATABASE = createToken<{ connected: boolean }>('Database')
   * @Service()
   * class NotesStore {
   *   loaded = false
   *   constructor(@Inject(DATABASE) private readonly db: { connected: boolean }) {}
   *   onReady() {
   *     this.loaded = this.db.connected
   *   }
   * }
   * const module = await MeoCordTestingModule.create({
   *   providers: [
   *     { provide: NotesStore, useClass: NotesStore },
   *     { provide: DATABASE, useFactory: async () => ({ connected: true }) },
   *   ],
   * })
   *   .compile()
   *   .init({ ready: true })
   *
   * expect(module.get(NotesStore).loaded).toBe(true)
   * await module.close()
   * ```
   */
  async init(options: TestingModuleInitOptions = {}): Promise<this> {
    this.resolving ??= resolveProviders(this.container, this.providers, this.order, {
      stopped: () => this.closedDuringInit,
      pending: token => (this.pendingFactory = token),
    }).then(async () => {
      // A close() meanwhile: nothing more is made, and a value it stopped waiting for is shut down once close() is done
      if (this.closedDuringInit) return this.shutDownLate()
      // As the bot reads them, once every provided value is made and before the services that could list them
      this.sources ??= eventSources(this.container, this.providers, this.lifecycle, this.eventClasses, text =>
        new Logger('TestingModule').warn(text),
      )
      listEventSources(this.container.get(HandlerRegistry), this.sources)
      prepareLateThemes(this.container, this.sources.map(({ cls }) => cls))
      for (const service of this.services) {
        if (this.closedDuringInit) return
        this.container.get(service)
      }
      // After the providers and listed services, as the bot makes it, so a provided value it injects is made
      if (this.app && !this.closedDuringInit) bindAppPresenter(this.container, this.app)
    })
    await this.resolving
    if (options.ready && !this.closedDuringInit) {
      const { client = createMockClient(), primary = true } = options.ready === true ? {} : options.ready
      this.readying ??= this.readyPass.run(() => this.runReady(client, primary))
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
   * A stopped bot runs nothing more. Once `close()` is called, a module still runs what `dispatch`, `invoke` and `emit`
   * are given, against services shut down, or shutting down, and warns once that it is closed, so a `close()` in the
   * wrong place shows. A `get()` afterwards returns what was shut down silently; one that makes an instance only then
   * warns, naming it, since nothing shuts that down.
   *
   * The cooldown store and what it injects shut down last, in the same sequence as the bot's. When any of them has an
   * `onShutdown`, the calls `invoke`, `dispatch` and `emit` have under way finish first, then the store operations
   * they started, so the store's last writes still reach it. The module stops waiting for the whole sequence after
   * its `shutdownTimeout`, 10 seconds unless set, and logs that it did. Give a test whose fake store never answers, or
   * whose `onShutdown` never settles, a short `shutdownTimeout`.
   *
   * A `close()` while `init()` makes the providers waits for the factory under way at most `shutdownTimeout`; past it,
   * it warns, naming the factory, and shuts down without it. `init()` makes nothing after that factory. A value the
   * factory returns later is shut down once it arrives and `close()` is done, by its own `onShutdown`, within
   * `shutdownTimeout`, and a failure of it is logged. What it injects is shut down already, so its `onShutdown` may find
   * that closed.
   *
   * A `close()` while `init({ ready: true })` runs the `onReady` hooks waits for them first, within the same
   * `shutdownTimeout`. An `onReady` still running once only the hooks' share of it is left is named in a warning, and
   * its class is shut down all the same, as everything the module constructed is. One that calls `close()` itself isn't
   * waited for. A `close()` called while an `onShutdown` hook of this close runs, by the hook or by work it started,
   * awaited or not, gets a promise that resolves at once: the close it asks for is the one running the hook. One called
   * after the hook has returned waits for the whole close.
   *
   * @returns Once every hook has run. Rejects with the error of a hook that failed, or an
   *   `AggregateError` naming each when several did.
   *
   * @example
   * ```ts
   * import { expect } from 'vitest'
   *
   * const POOL = createToken<object>('Pool')
   * const closed: string[] = []
   * @Service()
   * class Notes {
   *   constructor(@Inject(POOL) readonly pool: object) {}
   *   onShutdown() {
   *     closed.push('notes')
   *   }
   * }
   * const module = await MeoCordTestingModule.create({
   *   providers: [{ provide: Notes, useClass: Notes }, { provide: POOL, useFactory: async () => ({ onShutdown: () => closed.push('pool') }) }],
   * })
   *   .compile()
   *   .init()
   * module.get(Notes)
   *
   * await module.close()
   *
   * expect(closed).toEqual(['notes', 'pool'])
   * ```
   */
  async close(): Promise<void> {
    // An onReady awaiting close() would otherwise hold up the close that waits for it
    this.readyPass.excuseCurrent()
    this.closing ??= (async () => {
      // A close during init waits for the factory under way, at most shutdownTimeout, and the sequence for its onReady
      // hooks, so it shuts down whatever they constructed; init makes nothing after that factory
      if (this.resolving) {
        this.closedDuringInit = true
        if ((await within(this.resolving, this.shutdownTimeout)) === 'outlasted') {
          this.outlastedFactory = this.pendingFactory
          const what = this.pendingFactory === undefined ? 'its providers' : `the factory providing ${tokenName(this.pendingFactory)}`
          new Logger('TestingModule').warn(`init() still waits for ${what} after ${this.shutdownTimeout} ms; close() shuts down without it.`)
        }
      }
      const entries = (): LifecycleEntry[] =>
        this.hookOrder(unit => this.constructed.has(unit.token) && this.hasHook(unit, 'onShutdown'))
          .filter(unit => this.constructed.has(unit.token))
          // Already made, so this returns the instance; a provided value may be anything, null included
          .map(unit => {
            this.shutDown.add(unit.token)
            return lifecycleEntry(unit, (this.container.get(unit.token as ServiceIdentifier) as LifecycleEntry['instance'] | null) ?? {})
          })
      const failures: { name: string; error: unknown }[] = []
      await runShutdownSequence(this.container, entries, {
        drainCalls: () => this.calls.settled(),
        readyPass: this.readyPass,
        // Off the calls the drain waits for; the module names none, so no line lists them
        droppedCall: call => void this.calls.drop(call),
        timeoutMs: this.shutdownTimeout,
        hookFailed: (name, error) => failures.push({ name, error }),
        warn: message => new Logger('TestingModule').warn(message),
      }).finally(() => stopThemeLookups(this.container))
      // After the hooks, as a bot shutting down does; a module that never had it leaves another's alone
      releaseAmbientAppTheme(this.container)
      throwFailures('onShutdown', failures)
    })()
    // An onShutdown of this module's own close would wait for itself: the close goes on once the hook returns, and
    // reports its failures to the close() awaited from outside
    if (inShutdownHookOf(this.container)) return
    await this.closing
  }

  /**
   * Shuts down the value of the factory `close()` stopped waiting for, once it arrives and `close()` is done, unless
   * `close()` shut it down: its `onShutdown` only, within `shutdownTimeout`, a failure of it logged.
   */
  private async shutDownLate(): Promise<void> {
    const token = this.outlastedFactory
    if (token === undefined || !this.constructed.has(token) || this.shutDown.has(token)) return
    const unit = this.lifecycle.find(candidate => candidate.token === token)
    if (!unit) return
    this.shutDown.add(token)
    // After close()'s own hooks, as the bot shuts it down after the stop's; its failure is close()'s to report
    await this.closing?.catch(() => undefined)
    const logger = new Logger('TestingModule')
    const instance = (this.container.get(token as ServiceIdentifier) as LifecycleEntry['instance'] | null) ?? {}
    await shutDownLateValue(this.container, lifecycleEntry(unit, instance), {
      timeoutMs: this.shutdownTimeout,
      hookFailed: (name, error) => logger.error(`onShutdown failed in ${name}:`, error),
      warn: message => logger.warn(message),
    })
  }

  private warnedClosed = false

  /** Warns once, after `close()`, that a call runs against services already shut down. */
  private warnIfClosed(): void {
    if (this.closing === undefined || this.warnedClosed) return
    this.warnedClosed = true
    new Logger('TestingModule').warn(
      'This testing module is closed, and its services are shut down, or shutting down, so dispatch, invoke and emit run ' +
        'against that state. Close it after the last call, in afterEach.',
    )
  }

  private async runReady(client: Client<true>, primary: boolean): Promise<void> {
    // As the bot claims it before it comes online, so onReady reads the app's theme
    claimAmbientAppTheme(this.container)
    const failures: { name: string; error: unknown }[] = []
    const failed = (unit: LifecycleUnit, error: unknown) => failures.push({ name: unit.name, error })
    const warn = (message: string) => new Logger('TestingModule').warn(message)
    const units = this.hookOrder(unit => this.hasHook(unit, 'onReady'))
    // With waitForReady, a call made while these hooks run waits for those of the classes it uses, as the bot's does
    const stages = globalStagesOf(this.container)
    const gate = stages.waitForReady === true ? closeReadyGate(this.container, units, warn, themeResolverClass(stages.themeFor?.resolvers), () => this.calls.current()) : undefined
    try {
      // No warning for a hook whose dependency failed: the test sees the dependency's own error
      await runReadyHooks(
        this.container,
        units,
        client,
        { primary },
        { resolveFailed: failed, hookFailed: failed, slow: (unit, waiting) => warn(slowReadyWarning(unit, SLOW_READY_HOOK_MS, waiting, gate !== undefined)) },
        // A test's fake clock can pass the time inside a hook, so the warning waits to be asked for
        {
          runOnReady: this.readyPass.runOnReady,
          trackSlow: this.readyPass.trackSlow,
          made: unit => (this.constructed.has(unit.token) ? (this.container.get(unit.token as ServiceIdentifier) as object) : undefined),
          slowAfterMs: globalStagesOf(this.container).warnSlow === true ? SLOW_READY_HOOK_MS : undefined,
          ...(gate && { settled: (unit: LifecycleUnit) => gate.settled(unit) }),
        },
      )
    } finally {
      gate?.finish()
    }
    throwFailures('onReady', failures)
  }

  /**
   * The module's {@link ThemeCache}: the instance its classes inject, holding what `themeFor`, or
   * `overrideThemeFor`, looked up in this module's calls. Clear a result to have the next call look it up
   * again. Each module has its own.
   *
   * @example
   * ```ts
   * import { expect, vi } from 'vitest'
   *
   * @Controller()
   * class ShopController {
   *   @Command('buy', CommandType.BUTTON)
   *   async buy(interaction: ButtonInteraction) {
   *     await respond(interaction).send(`Paid, in ${useTheme().colors.primary}.`)
   *   }
   * }
   * const guild = vi.fn(() => ({ colors: { primary: '#26A042' as const } }))
   * const module = MeoCordTestingModule.create({ controllers: [ShopController] }).overrideThemeFor({ guild }).compile()
   * const press = () => createMockInteraction(ButtonInteraction, { customId: 'buy', guildId: '123456789012345678' })
   *
   * await module.dispatch(press())
   * module.themeCache.invalidateGuild('123456789012345678')
   * await module.dispatch(press())
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
   * After {@link close}, it returns what `close()` shut down without a word, so a test can read how it ended. One it
   * makes only then, such as a listed service an `init()` that `close()` ended did not make, is shut down by nothing;
   * when it has an `onShutdown`, the first `get()` that makes it warns, naming it.
   *
   * @param token - A controller, a provided token, or another bound class.
   * @returns The instance, with its dependencies and overrides applied.
   * @throws When the instance depends on a factory that returns a promise and `init()` has not made its value: it has
   *   not run, or a `close()` ended it first.
   */
  get<T>(token: ProviderToken<T> | ServiceIdentifier<T>): T {
    // Not made when close() ran, so a value made now is one nothing shuts down
    const madeAfterClose = this.closing !== undefined && !this.constructed.has(token)
    try {
      const instance = this.container.get<T>(token as ServiceIdentifier<T>)
      const unit = madeAfterClose && this.constructed.has(token) ? this.lifecycle.find(each => each.token === token) : undefined
      // Only a value with an onShutdown misses one
      if (unit && this.hasHook(unit, 'onShutdown')) {
        const name = tokenName(token)
        new Logger('TestingModule').warn(
          `get(${name}) after close() makes ${name} now; the testing module is closed, so nothing shuts it down. ` +
            'Close it after the last call, in afterEach.',
        )
      }
      return instance
    } catch (error) {
      if (!/asynchronous/i.test(String((error as Error)?.message))) throw error
      // An init() that close() ended was awaited all the same, and stopped before it made this value
      const why = this.closedDuringInit
        ? 'close() ended init() before it made that factory\'s value.'
        : 'await module.init() before get().'
      throw new Error(`${tokenName(token)} depends on a factory that returns a promise: ${why}`, { cause: error })
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
   *   every handler of the module as the bot does; a mock built without one is not checked. An autocomplete is
   *   checked by its command path and its focused option: one dispatch gives to another `@Autocomplete` handler,
   *   or to none, is refused under `useStrictMocks()`, and otherwise warned about once and run.
   *   With a message alone, a patterned `@MessageHandler` gets the params its pattern captures from the content,
   *   after the prefix of the module's `app`, with typed params resolved as dispatch resolves them, from the
   *   message's guild caches first. A message whose `content` isn't a string, as a mock's without
   *   `useStrictMocks()`, gets `{}`. Under strict mocks a message has empty `content`, and a patterned handler
   *   rejects it, as dispatch runs no handler for a message with no text: give the mock the `content` the handler
   *   takes. A word that is not a value of its type, and a prefixed message that names the command but leaves out
   *   a param, go through the handler's filters as a `MessageUsageError`, as dispatch answers them.
   *   An `@On` or `@Once` handler no route reaches runs as {@link emit} runs it, as an event with the arguments given,
   *   under `useStrictMocks()`; without strict mocks it runs as its first argument's type, and `invoke` warns once
   *   where that differs.
   * @returns Whether the handler ran, and the error a filter handled, if any. Rejects with an error no
   *   filter handles, or with the error a filter throws: the built-in fallback, which answers such
   *   errors in the bot, does not run here. Rejects before running anything with an interaction or a
   *   message the handler's route does not match, naming both, and under `useStrictMocks()` with such an
   *   autocomplete. Given fewer arguments than the handler
   *   declares, with a first that is neither an interaction nor a message, such as a reaction without its
   *   `ReactionEvent`, it rejects under `useStrictMocks()`, and otherwise warns once and runs the handler.
   *
   * @example
   * ```ts
   * import { expect } from 'vitest'
   *
   * @Guard()
   * class ModeratorGuard implements GuardInterface {
   *   canActivate() {
   *     return false
   *   }
   * }
   * @Guard()
   * class OwnerGuard implements GuardInterface {
   *   canActivate(): boolean {
   *     throw new GuardDeniedError('Only the server owner can kick.')
   *   }
   * }
   * @Controller()
   * class ModerationController {
   *   @Command('ban', CommandType.SLASH)
   *   @UseGuard(ModeratorGuard)
   *   async ban(interaction: ChatInputCommandInteraction) {
   *     await respond(interaction).send('Banned.')
   *   }
   *
   *   @Command('kick', CommandType.SLASH)
   *   @UseGuard(OwnerGuard)
   *   async kick(interaction: ChatInputCommandInteraction) {
   *     await respond(interaction).send('Kicked.')
   *   }
   * }
   * const module = MeoCordTestingModule.create({ controllers: [ModerationController] }).compile()
   * const interaction = createMockInteraction(ChatInputCommandInteraction)
   *
   * // A guard that returns false
   * const { ran } = await module.invoke(ModerationController, 'ban', interaction)
   *
   * expect(ran).toBe(false)
   * expect(interaction.reply).not.toHaveBeenCalled()
   * // In a module whose app sets @MeoCord({ answerDenied: true }), that false rejects with GuardDeniedError instead, as below
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
    this.warnIfClosed()
    await this.init()
    if (!this.controllers.includes(controller)) {
      throw new Error(`${controller.name} is not a controller of this testing module. Add it to \`controllers\`.`)
    }

    const instance = this.container.get(controller) as Record<string, (...args: unknown[]) => unknown>
    if (typeof instance[methodName] !== 'function') throw new Error(`${controller.name}.${methodName} is not a method.`)
    const [first] = args as unknown[]
    const event = eventHandlerOf(controller, methodName)
    // As emit and the bot run it; without strict mocks it runs as before, as a test that passes that way could fail
    if (event && strictMocks()) {
      this.checkArgumentCount(controller, methodName, instance[methodName], first, args.length)
      this.registerEventClients(args as unknown[])
      const { ran, error } = await this.track(() => this.runEventHandler(instance, methodName, args as unknown[]))
      return error === undefined ? { ran } : { ran, error }
    }
    const interaction = first instanceof BaseInteraction ? (first as Interaction) : undefined
    // The handler dispatch gives the customId to, among every handler of the module
    const component = interaction && hasCustomId(interaction) ? componentRouteFor(this.componentRoutes(), controller, methodName, interaction) : undefined
    const mismatch = component && 'mismatch' in component ? component.mismatch : interaction && commandMismatch(this.controllers, controller, methodName, interaction)
    if (mismatch) throw new Error(mismatch)
    if (interaction) this.checkAutocompleteRoute(controller, methodName, interaction)
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
    this.checkArgumentCount(controller, methodName, instance[methodName], first, callArgs.length)
    if (event) this.warnEventRun(controller, methodName, event, first, callArgs.length !== args.length)
    this.registerClient(first)
    const { ran, error } = await this.track(() => runHandler(this.container, instance, methodName, callArgs, { awaitObservers: true, ...hooks }))
    return error === undefined ? { ran } : { ran, error }
  }

  /** The handlers already warned about for being given fewer arguments than they take, so each is named once. */
  private readonly warnedArgumentCounts = new Set<string>()

  /** The `@On` and `@Once` handlers already warned about for running other than as an event, so each is named once. */
  private readonly warnedEventRuns = new Set<string>()

  /**
   * Warns once, without strict mocks, that `invoke` runs an event handler other than as the bot does: as the type its
   * first argument gives, or with params it added. Only `invoke` warns, on the test's own call.
   */
  private warnEventRun(
    controller: new (...args: any[]) => unknown,
    methodName: string,
    event: EventHandlerMetadata,
    first: unknown,
    paramsAdded: boolean,
  ): void {
    const type = inferContextType(first)
    // invoke adds params only for an interaction or a message, whose type is never 'event'
    if (type === 'event') return
    const key = `${controller.name}.${methodName}`
    if (this.warnedEventRuns.has(key)) return
    this.warnedEventRuns.add(key)
    const call = `${withArticle(type)} call${paramsAdded ? ' with its params added' : ''}`
    new Logger('TestingModule').warn(
      `invoke runs ${key}, an @${event.once ? 'Once' : 'On'}('${event.event}') handler, as ${call}; the bot runs it as ` +
        'an event with its arguments as given, and useStrictMocks() runs it so.',
    )
  }

  /** Runs an `@On` or `@Once` handler as the bot and `emit` do: as an event, with its arguments as given. */
  private runEventHandler(
    instance: Record<string, (...args: unknown[]) => unknown>,
    method: string,
    args: unknown[],
    fallback?: Fallback,
  ): Promise<HandlerOutcome> {
    return runHandler(this.container, instance, method, args, { type: 'event', awaitObservers: true, fallback })
  }

  /** The autocomplete mismatches already warned about without strict mocks, so each handler and route warns once. */
  private readonly warnedAutocompleteRoutes = new Set<string>()

  /**
   * Refuses under strict mocks, and otherwise warns once, an autocomplete dispatch gives to another handler or to none.
   * Without strict mocks the handler still runs, since a test that passes that way would fail.
   */
  private checkAutocompleteRoute(controller: new (...args: any[]) => unknown, methodName: string, interaction: Interaction): void {
    const mismatch = autocompleteMismatch(this.controllers, controller, methodName, interaction)
    if (!mismatch) return
    if (strictMocks()) throw new Error(mismatch)
    if (this.warnedAutocompleteRoutes.has(mismatch)) return
    this.warnedAutocompleteRoutes.add(mismatch)
    new Logger('TestingModule').warn(`${mismatch} Under useStrictMocks(), invoke rejects it.`)
  }

  /**
   * Refuses under `useStrictMocks()`, or warns once otherwise, a call that gives a handler fewer arguments than it
   * declares when `invoke` builds none for it, as for a reaction given without its `ReactionEvent`.
   */
  private checkArgumentCount(controller: new (...args: any[]) => unknown, methodName: string, method: (...args: unknown[]) => unknown, first: unknown, given: number): void {
    if (first instanceof BaseInteraction || first instanceof Message || method.length <= given) return
    const reaction = getReactionHandlers(controller.prototype).some(handler => handler.method === methodName)
    const problem =
      `${controller.name}.${methodName} takes ${method.length} arguments, and invoke was given ${given}: ` +
      (reaction ? 'pass its ReactionEvent after the reaction, as { user, action }.' : 'pass each argument it takes.')
    if (strictMocks()) throw new Error(problem)
    const key = `${controller.name}.${methodName}`
    if (this.warnedArgumentCounts.has(key)) return
    this.warnedArgumentCounts.add(key)
    new Logger('TestingModule').warn(problem)
  }

  /**
   * The calls under way, each until it settles: what `close()` lets finish before the cooldown store stops, a call the
   * ready gate dropped at the close left out, as the bot's are.
   */
  private readonly calls = new RunningCalls()

  /** Runs `start` as a call under way until it settles. */
  private track<T>(start: () => Promise<T>): Promise<T> {
    return this.calls.run('', start)
  }

  /**
   * Makes this module the app of the input's client, as the bot is of its own: its answers are drawn by this
   * module's presenter, in its theme and language, `respond()` outside any call included, as in a collector's callback
   * on that client. A module without a presenter clears the client's under strict mocks, so the default draws; default
   * mode leaves another module's in place and warns once.
   */
  private registerClient(input: unknown): void {
    const client = (input as { client?: unknown } | undefined)?.client
    if (!client || typeof client !== 'object') return
    const presenter = appPresenterOf(this.container)
    if (presenter || strictMocks()) setPresenter(client, presenter)
    else if (clientPresenter(client)) {
      warnOnce(
        new Logger('TestingModule'),
        "A module without a presenter here answers with the presenter another module set on the same client; under " +
          "useStrictMocks() this module's own presenter, or the default, is used.",
      )
    }
    registerClientTheme(client, this.container)
    registerClientTranslator(client, this.container.isBound(Translator) ? this.container.get(Translator) : undefined)
  }

  /**
   * Makes this module the app of each event argument's client, as the bot is of its own, under strict mocks or with
   * `eventFallback: true`; default mode leaves the clients as they are and warns once where this module would draw
   * answers otherwise.
   */
  private registerEventClients(args: readonly unknown[]): void {
    const withClient = args.filter(arg => typeof (arg as { client?: unknown } | null)?.client === 'object')
    if (withClient.length === 0) return
    // The event fallback answers with the app's presenter, as the bot's does
    if (strictMocks() || this.eventFallback === true) {
      for (const arg of withClient) this.registerClient(arg)
      return
    }
    const ownTheme = appTheme(this.container) !== defaultTheme()
    if (!appPresenterOf(this.container) && !this.container.isBound(Translator) && !ownTheme) return
    warnOnce(
      new Logger('TestingModule'),
      "emit() here leaves the client's presenter, theme and translator as they were, where the bot draws the answers to " +
        "an event with its app's; in the next major version (5.0) emit sets the module's on the client. Call " +
        'useStrictMocks() to have it set them now.',
    )
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
    const notices: FallbackOptions = {
      cooldownNotice: refusal => claimCooldownNotice(this.container, refusal),
      storeDownNotice: who => claimStoreDownNotice(this.container, who),
    }
    // Strict mocks log an answer MeoCord fails to build and end the call in that fault, as a bot does; default mode
    // rethrows it from the fallback, so observers hear the call's own outcome, and an interaction's again as an error
    const answer = createFallback(logger, () => this.messageOptions, notices)
    const rethrowing = createFallback(logger, () => this.messageOptions, { ...notices, strict: true })
    const fallback: Fallback = async (error, context) => {
      if (strictMocks()) return answer(error, context)
      try {
        return await rethrowing(error, context)
      } catch (failure) {
        warnOnce(
          logger,
          "dispatch() here reports a call whose answer MeoCord couldn't build with the call's own outcome, and an " +
            "interaction's a second time as an error; under useStrictMocks() the call is reported once, as 'error'.",
        )
        throw failure
      }
    }
    this.dispatcher = new Dispatcher({
      container: this.container,
      controllerClasses: this.controllers,
      messageOptions: this.messageOptions,
      logger,
      // A test's fake clock can pass a slow warning's time inside a handler, so they wait to be asked for
      warnSlow: globalStagesOf(this.container).warnSlow === true,
      // The bot closes it; default mode keeps what a passing test sees, an untouched interaction, and says so once
      leaveUnansweredAutocompleteOpen: () => {
        if (strictMocks()) return false
        warnOnce(
          logger,
          "dispatch() here leaves open the menu of an autocomplete its handler returned from without answering; the bot " +
            'closes it with no choices, as useStrictMocks() does here. In the next major version (5.0) the testing module ' +
            'closes it without the call (https://github.com/meocord/meocord/issues/441).',
        )
        return true
      },
      fallback,
      // A mock's client is the one bot every mock client is, so a mention of it starts a command
      botUserId: event => {
        const id = event.client?.user?.id
        return typeof id === 'string' ? id : undefined
      },
      warnUnanswered,
      awaitObservers: true,
      unroutedGrace: interaction => this.unroutedGrace(interaction),
    })
    return this.dispatcher
  }

  /** What the listeners an unrouted component was delivered to threw or rejected with, by interaction. */
  private readonly listenerFailures = new WeakMap<object, unknown[]>()

  /**
   * Under strict mocks, for a client `createMockClient` made, delivers a component or modal no route takes to the
   * client's `interactionCreate` listeners, as the gateway delivers it after MeoCord's, by {@link deliverToListeners};
   * an answer that waits on a timer of its own is not waited for. Otherwise the bot's wait applies.
   */
  private unroutedGrace(interaction: Interaction): Promise<void> | undefined {
    const { client } = interaction
    if (!strictMocks() || !isMockClient(client)) return undefined
    return deliverToListeners(client, listenersOf(client, 'interactionCreate'), [interaction]).then(failures => {
      if (failures.length > 0) this.listenerFailures.set(interaction, failures)
    })
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
   * Under `useStrictMocks()`, a component or modal no route takes, on a client from `createMockClient` with
   * `interactionCreate` listeners, such as a collector's, is delivered to those listeners after MeoCord's dispatch,
   * in the order they were attached, as the gateway delivers it; MeoCord answers that no handler matched only if none
   * of them answered. Dispatch waits for what each listener returns, then one turn of the event loop, never the bot's
   * 1.5 seconds; an answer a listener sends only after a timer of its own isn't waited for. A component a route takes
   * is not delivered to them, unlike on a bot. Dispatch alone delivers it: calling `client.emit('interactionCreate')`
   * as well delivers it twice. What a listener throws or rejects with rejects `dispatch` once MeoCord has answered.
   *
   * Under `useStrictMocks()`, on a client from `createMockClient`, a message or a reaction reaches its client's
   * `messageCreate`, `messageReactionAdd` or `messageReactionRemove` listeners too, routed or not, with discord.js's
   * arguments, as the gateway delivers it: those attached before routing starts, once the route has run to its first
   * `await`, so a collector a handler starts takes the next message, not the one that started it. Dispatch alone
   * delivers it: calling `client.emit` with the same event as well delivers it twice, and `emit` applies nothing to a
   * reaction. A dispatched reaction is a normal one, never a burst: its listeners get
   * `{ type: ReactionType.Normal, burst: false }`.
   *
   * A reaction is applied to its message first, as the gateway applies it, by discord.js's own code. An add caches it
   * on `message.reactions` and counts the user into its `users`, `count` and `countDetails`. Where its message doesn't
   * cache it, the add starts it from none, `users` and `me` too, unless its state is the test's: a `count`,
   * `countDetails`, `me` or users the test gave before its first dispatch, or a `count` or `countDetails` set after
   * one. The add then counts on from what is there, `count` and `countDetails` apart, as discord.js keeps them. A
   * remove takes the user out of `users`, and out of the count unless the user is the bot and `me` is set, as
   * discord.js leaves that to the bot's own REST call; once neither users nor count are left the reaction leaves
   * `message.reactions`. A remove of a reaction its message doesn't cache is delivered and changes nothing: a real
   * client without `Partials.Reaction` emits nothing for it, and `dispatch` delivers it all the same, so a test doesn't
   * show that a bot needs the partial. A partial reaction, its `count` null, is delivered as it is. A reaction on a
   * real `Client`, its own or its message's, is routed as any other, the bot's own told apart by `user.bot` since the
   * client has no user before login, and nothing is applied or delivered. Dispatch waits for the listeners as for a
   * component, and what one throws or rejects with rejects it.
   *
   * @param input - An interaction or a message; or a reaction, with the user who reacted and whether they
   *   added it, `ReactionHandlerAction.ADD` unless given.
   * @returns Every handler reached, in the order it ran, whether any ran, and the first error a call ended
   *   with. An error the fallback answers as the user's own outcome resolves: a usage reply, an unknown
   *   command, or a guard's, a cooldown's, a validation's or a `UserError`'s refusal, as the fallback
   *   answers each for an interaction or a message. Any other error no filter handles, and what a client's listener
   *   the input was delivered to threw, rejects the call once the fallback has answered and every handler has run:
   *   with that error, or an `AggregateError` when there are several.
   *
   * @example
   * ```ts
   * import { expect } from 'vitest'
   *
   * @Controller()
   * class CardController {
   *   @Command('card/summary/{id}', CommandType.BUTTON)
   *   async summary(interaction: ButtonInteraction, { id }: { id: string }) {
   *     await respond(interaction).send(`Card ${id}`)
   *   }
   * }
   * const module = MeoCordTestingModule.create({ controllers: [CardController] }).compile()
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
    this.warnIfClosed()
    await this.init()
    this.registerClient(input)
    const dispatcher = this.dispatcherOf()
    const handlers: DispatchedHandler[] = []
    const unhandled: unknown[] = []
    // The fault each error's answer failed with, which the call ends in in that error's place
    const unanswered = new Map<unknown, unknown>()
    const record: DispatchRecorder = {
      settled: (controller, method, { ran, error }) => handlers.push({ controller, method, ran, ...(error !== undefined && { error }) }),
      unhandled: error => unhandled.push(error),
      unanswered: (error, failure) => unanswered.set(error, failure),
    }

    // What the client's listeners threw, as a bot's client would raise it
    let thrownByListeners: unknown[] = []
    if (options) {
      noteReactionDispatch(input)
      const reaction = input as MessageReaction | PartialMessageReaction
      const action = options.action ?? ReactionHandlerAction.ADD
      const added = action === ReactionHandlerAction.ADD
      const delivery = gatewayDelivery(() => reaction.client, added ? Events.MessageReactionAdd : Events.MessageReactionRemove)
      if (delivery) applyDispatchedReaction(reaction, options.user, added)
      const routing = this.track(() => dispatcher.reaction(input as MessageReaction, { user: options.user, action }, record))
      if (delivery) thrownByListeners = await delivery([reaction, options.user, { type: ReactionType.Normal, burst: false }])
      await routing
    } else if (input instanceof BaseInteraction) {
      await this.track(() => dispatcher.interaction(input as Interaction, record))
      thrownByListeners = this.listenerFailures.get(input) ?? []
      this.listenerFailures.delete(input)
    } else if (input instanceof Message) {
      const delivery = gatewayDelivery(() => input.client, Events.MessageCreate)
      const routing = this.track(() => dispatcher.message(input, record))
      if (delivery) thrownByListeners = await delivery([input])
      await routing
    } else {
      throw new TypeError('dispatch takes an interaction, a message, or a reaction with { user }.')
    }

    // What the fallback answers as the user's own outcome, such as a usage reply or a refusal, is an outcome to assert on,
    // unless its answer failed to build, which is the call's fault, as on a bot
    const failures = unhandled.flatMap(error =>
      unanswered.has(error) ? [unanswered.get(error)] : isUserOutcome(error, options ? undefined : input) ? [] : [error],
    )
    failures.push(...thrownByListeners)
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) {
      const by = thrownByListeners.length > 0 ? "left to the fallback or thrown by the client's listeners" : 'left to the fallback'
      throw new AggregateError(failures, `${failures.length} errors were ${by}.`)
    }
    const error = handlers.find(handler => handler.error !== undefined)?.error ?? unhandled[0]
    return { ran: handlers.some(handler => handler.ran), handlers, ...(error !== undefined && { error }) }
  }

  /**
   * Emits a client event to the module's `@On` and `@Once` handlers, through the pipeline the app runs
   * them in: the global guards of the module's `app`, then each handler's own.
   * As on the bot, every instance the module runs lifecycle hooks on, the cooldown store aside, receives
   * it: the controllers and services, what they and the stages inject, and each provided class or value.
   * A `@Once` handler handles only the first event, as it would on a client.
   *
   * On a bot, a guard's `GuardDeniedError` is logged and the event skipped, and a handler's `UserError` is
   * logged and, when the event carries a message, answered as a reply to it. With `eventFallback: true` the
   * module does the same, with the bot's own event fallback. Without it both reject `emit` as any error
   * does, so a test checks them with `rejects`, and a warning says once that 5.0 answers them as the bot does.
   *
   * @param event - The client event, such as `'guildMemberAdd'`.
   * @param args - The event's arguments, typed from discord.js's `ClientEvents`.
   * @returns How many handlers ran. Rejects once every handler has settled if any threw, a guard's
   *   `GuardDeniedError` and a handler's `UserError` included unless the module has `eventFallback: true`:
   *   with that error when one handler failed, or an `AggregateError` of them when several did.
   *
   * @example
   * ```ts
   * import { expect } from 'vitest'
   *
   * @Controller()
   * class WelcomeController {
   *   @On('guildMemberAdd')
   *   async greet(member: GuildMember) {
   *     await member.send('Welcome!')
   *   }
   * }
   * const module = MeoCordTestingModule.create({ controllers: [WelcomeController] }).compile()
   * const member = createMock<GuildMember>()
   *
   * const { ran } = await module.emit('guildMemberAdd', member)
   *
   * expect(ran).toBe(1)
   * ```
   */
  async emit<E extends keyof ClientEvents>(event: E, ...args: ClientEvents[E]): Promise<EmitResult> {
    this.warnIfClosed()
    await this.init()
    this.registerEventClients(args)
    const calls: Promise<boolean>[] = []
    for (const [index, source] of (this.sources ?? []).entries()) {
      for (const handler of source.handlers) {
        if (handler.event !== event) continue
        if (handler.once) {
          const key = `${index}.${handler.method}:${event}`
          if (this.firedOnce.has(key)) continue
          this.firedOnce.add(key)
        }
        const fallback = this.eventFallback === true ? this.eventFallbackOf(source, handler.method, event) : undefined
        // Resolved inside the call, so a class that cannot be resolved fails as its handler would
        const run = async () => {
          const instance = source.resolve()
          if (!instance) return false
          const { ran } = await this.runEventHandler(instance, handler.method, args, fallback)
          return ran
        }
        calls.push(this.track(run))
      }
    }

    const results = await Promise.allSettled(calls)
    const errors = results.flatMap(result => (result.status === 'rejected' ? [result.reason as unknown] : []))
    if (this.eventFallback === undefined && errors.some(error => error instanceof GuardDeniedError || error instanceof UserError)) {
      warnOnce(
        new Logger('TestingModule'),
        "emit() rejects here with a GuardDeniedError or a UserError, which the bot's event fallback answers: it skips " +
          'a denied event, and replies to the message of an event a UserError refused. In the next major version (5.0) ' +
          'emit answers them as the bot does (https://github.com/meocord/meocord/issues/964). Set eventFallback: true to ' +
          'have it do so now, or eventFallback: false to keep the rejection.',
      )
    }
    if (errors.length === 1) throw errors[0]
    if (errors.length > 1) throw new AggregateError(errors, `${errors.length} handlers of "${event}" threw.`)
    return { ran: results.filter(result => result.status === 'fulfilled' && result.value).length }
  }

  /**
   * The bot's event fallback for one handler, answering with the app's `replyEmoji`. Any other error rejects `emit`,
   * and so does a reply MeoCord fails to draw, as the bot ends that call in the fault.
   */
  private eventFallbackOf(source: EventSource, method: string, event: string): Fallback {
    const rethrow = (error: unknown) => {
      throw error
    }
    return createEventFallback(new Logger('TestingModule'), `event "${event}" in ${source.cls.name}.${method}`, this.messageOptions.replyEmoji, rethrow, {
      strict: true,
    })
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

/** A method's `@On` or `@Once` handler, when no route also reaches it: a route's input decides how that one runs. */
function eventHandlerOf(controller: new (...args: any[]) => unknown, methodName: string): EventHandlerMetadata | undefined {
  if (getHandlerRoutes(controller.prototype).some(route => route.method === methodName)) return undefined
  return getEventHandlers(controller.prototype).find(handler => handler.method === methodName)
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
 * @see {@link https://meocord.dev/docs/4.2/testing | The testing module}
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
  /** The IDs `overrideCommandId` gives, by command name. */
  private readonly commandIds = new Map<string, string>()

  constructor(
    private readonly options: TestingModuleOptions,
    private readonly wiring?: AppWiring,
  ) {}

  /**
   * Replaces a provider with a test double.
   *
   * The double needs only the members the test uses; misspelled member names are still rejected. A token MeoCord binds
   * itself, such as `ShardContext` or `HandlerRegistry`, takes the double in place of MeoCord's own, so a test can stub
   * cross-shard calls.
   *
   * @param token - The provider to replace.
   * @example
   * ```ts
   * import { vi } from 'vitest'
   *
   * @Controller()
   * class ProfileController {
   *   constructor(private readonly profiles: ProfileService) {}
   *
   *   @Command('profile', CommandType.SLASH)
   *   async profile(interaction: ChatInputCommandInteraction) {
   *     await respond(interaction).send({ embeds: [await this.profiles.render(interaction.user.id)] })
   *   }
   * }
   * const builder = MeoCordTestingModule.create({ controllers: [ProfileController] })
   * builder.overrideProvider(ProfileService).useValue({ render: vi.fn() })
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
   * It stands in for the guard wherever the guard is bound, a provider of the same token included, and wins over an
   * `overrideProvider` of it. The stub needs a `canActivate`, its own or its prototype's: `compile()` refuses one without
   * it under `useStrictMocks()`, and otherwise warns.
   *
   * @param guard - The guard class to replace.
   * @example
   * ```ts
   * @Controller()
   * class ShopController {
   *   @Command('refund', CommandType.SLASH)
   *   @UseGuard(StaffGuard)
   *   async refund(interaction: ChatInputCommandInteraction) {
   *     await respond(interaction).send('Refunded.')
   *   }
   * }
   * const builder = MeoCordTestingModule.create({ controllers: [ShopController] })
   * builder.overrideGuard(StaffGuard).useValue({ canActivate: () => true })
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
   * It stands in for the interceptor wherever it is bound, a provider of the same token included, and wins over an
   * `overrideProvider` of it. A stub without `intercept` is refused by `compile()` under `useStrictMocks()`, and
   * otherwise warned about.
   *
   * @param interceptor - The interceptor class to replace.
   * @example
   * ```ts
   * @Controller()
   * class ShopController {
   *   @Command('refund', CommandType.SLASH)
   *   @UseInterceptor(TimingInterceptor)
   *   async refund(interaction: ChatInputCommandInteraction) {
   *     await respond(interaction).send('Refunded.')
   *   }
   * }
   * const builder = MeoCordTestingModule.create({ controllers: [ShopController] })
   * builder.overrideInterceptor(TimingInterceptor).useValue({ intercept: (_context: ExecutionContext, next: CallHandler) => next.handle() })
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
   * It stands in for the filter wherever it is bound, a provider of the same token included, and wins over an
   * `overrideProvider` of it. A stub without `catch` is refused by `compile()` under `useStrictMocks()`, and otherwise
   * warned about.
   *
   * @param filter - The filter class to replace.
   * @example
   * ```ts
   * import { vi } from 'vitest'
   *
   * @Controller()
   * class ShopController {
   *   @Command('refund', CommandType.SLASH)
   *   @UseFilter(CooldownFilter)
   *   async refund(interaction: ChatInputCommandInteraction) {
   *     await respond(interaction).send('Refunded.')
   *   }
   * }
   * const builder = MeoCordTestingModule.create({ controllers: [ShopController] })
   * builder.overrideFilter(CooldownFilter).useValue({ catch: vi.fn() })
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
   * @Controller()
   * class ShopController {
   *   @Command('buy', CommandType.BUTTON)
   *   async buy(interaction: ButtonInteraction) {
   *     await respond(interaction).send(`Paid, in ${useTheme().colors.primary}.`)
   *   }
   * }
   * const module = MeoCordTestingModule.create({ controllers: [ShopController] })
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
   * import { vi } from 'vitest'
   *
   * @Controller()
   * class ShopController {
   *   @Command('buy', CommandType.BUTTON)
   *   async buy(interaction: ButtonInteraction) {
   *     await respond(interaction).send(`Paid, in ${useTheme().colors.primary}.`)
   *   }
   * }
   * const guild = vi.fn(() => ({ colors: { primary: '#26A042' as const } }))
   * const module = MeoCordTestingModule.create({ controllers: [ShopController] }).overrideThemeFor({ guild }).compile()
   * ```
   */
  overrideThemeFor(resolvers: ThemeResolvers | (new (...args: any[]) => ThemeResolver) | undefined): TestingModuleBuilder {
    const problem = resolvers === undefined ? undefined : themeForProblem(resolvers, 'overrideThemeFor', 'a class implementing ThemeResolver, or undefined for none.')
    if (problem) throw new TypeError(problem)
    this.themeForOverride = { resolvers: typeof resolvers === 'function' ? resolvers : resolvers && { ...resolvers } }
    return this
  }

  /**
   * Sets the ID `commandMention` gives a slash command of this module's controllers, so a test can assert a mention's
   * exact text. Without it, a command's ID is fixed and snowflake-shaped, the same for its name in every run.
   *
   * @param name - The slash command's name, as its builder registers it; its subcommands share its ID.
   * @param id - The ID, shaped as a Discord snowflake: 17 to 20 digits.
   * @returns The builder, for chaining.
   * @throws TypeError when the ID is not snowflake-shaped.
   * @throws RangeError when no controller of this module declares a slash command of that name.
   * @example
   * ```ts
   * @CommandBuilder(CommandType.SLASH)
   * class SettingsBuilder {
   *   build(name: string) {
   *     return new SlashCommandBuilder().setName(name).setDescription('Change the settings')
   *   }
   * }
   * @Controller()
   * class SettingsController {
   *   @Command('settings', SettingsBuilder)
   *   async settings(interaction: ChatInputCommandInteraction) {
   *     await respond(interaction).send(`Saved. Change them again with ${await commandMention('settings', interaction)}.`)
   *   }
   * }
   * const module = MeoCordTestingModule.create({ controllers: [SettingsController] })
   *   .overrideCommandId('settings', '123456789012345678')
   *   .compile()
   * ```
   */
  overrideCommandId(name: string, id: string): TestingModuleBuilder {
    if (typeof id !== 'string' || !SNOWFLAKE.test(id)) {
      throw new TypeError(`overrideCommandId('${name}') takes an ID of 17 to 20 digits, as Discord gives a command; got ${JSON.stringify(id)}.`)
    }
    const declared = testingCommandIds(this.options.controllers ?? [], this.commandIds).declared()
    if (!declared.some(command => command.name === name && (command.body.type ?? ApplicationCommandType.ChatInput) === ApplicationCommandType.ChatInput)) {
      throw new RangeError(`overrideCommandId('${name}'): no controller of this module declares a slash command of that name.`)
    }
    this.commandIds.set(name, id)
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
   * Each check reports every startup error it finds, and the first is thrown, unchanged; when there are several, each
   * is logged first, with the file it comes from. After {@link reportAllStartupErrors}, the errors decorators kept on
   * the classes the module runs are among them.
   *
   * @returns The compiled module.
   * @throws Error for the first startup error the checks find.
   */
  compile(): TestingModule {
    // The bound the bot's config gives it, with the same words
    const shutdownTimeout = this.options.shutdownTimeout === undefined ? undefined : shutdownTimeoutProblem(this.options.shutdownTimeout)
    if (shutdownTimeout) throw new TypeError(`shutdownTimeout ${shutdownTimeout}.`)
    // With startupErrors: 'all', what the decorators kept on the classes this module runs
    const declared = declaredErrorsOf([
      ...(this.options.app ? [this.options.app] : []),
      ...(this.options.controllers ?? []),
      ...(this.wiring?.services ?? []),
      ...(this.options.observers ?? []),
    ])
    // Every error each check finds is reported, as the bot reports them, and the first is thrown
    try {
      return collectStartupErrors(() => {
        declared.forEach(startupError)
        const container = new Container()
        // A command mention in a call the module runs answers from these controllers, with no request
        provideCommandIds(container, testingCommandIds(this.options.controllers ?? [], new Map(this.commandIds)))
        const stages = this.globalStages()
        if (stages) bindGlobalStages(container, stages)

        // Bound first, as in the app, so a class that injects it gets this instance
        const appClasses: (new (...args: any[]) => unknown)[] = []
        const translator = () => (container.isBound(Translator) ? container.get(Translator) : undefined)
        container
          .bind(HandlerRegistry)
          .toConstantValue(new HandlerRegistry(appClasses, messagesOf(this.options.app), translator, this.options.controllers ?? []))
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
        // The app's own providers checked as the bot checks them. A token the module binds itself above fails at its
        // first call, so it is refused; another the bot binds before its providers is refused under strict mocks, and
        // runs here in default mode with a warning
        const i18n = this.options.app && (Reflect.getMetadata(META.appOptions, this.options.app) as { i18n?: Translator })?.i18n
        const botBinds = boundBeforeProviders(i18n !== undefined)
        for (const token of providers.keys()) {
          const refusal = appProviderRefusal(`${this.options.app?.name}`, token, own => botBinds.includes(own), new Logger('TestingModule'))
          if (!refusal) continue
          if (container.isBound(token as ServiceIdentifier) || strictMocks()) startupError(refusal)
          else warnOnce(new Logger('TestingModule'), `${refusal.message} The testing module runs it; under useStrictMocks() compile() refuses it, as the bot does.`)
        }
        for (const [token, provider] of providerMap(this.options.providers ?? [], "the testing module's providers")) providers.set(token, provider)
        for (const [token, override] of this.overrides) providers.set(token, override)
        // A stage override stands in for its class wherever the class is bound. A stage also provided takes the stub in
        // place of its provider, one binding per token, and runs lifecycle hooks as that provider would; any other is
        // bound on its own below, as the bot never makes a lifecycle unit of it. A stub that can't run is named here
        const stageStubs = new Map<new (...args: any[]) => unknown, object>()
        for (const [method, overrides, kind] of [
          ['canActivate', this.guardOverrides, 'overrideGuard'],
          ['intercept', this.interceptorOverrides, 'overrideInterceptor'],
          ['catch', this.filterOverrides, 'overrideFilter'],
        ] as const) {
          for (const [stage, stub] of overrides as Map<new (...args: any[]) => unknown, object>) {
            if (providers.has(stage)) providers.set(stage, { provide: stage, useValue: stub })
            else stageStubs.set(stage, stub)
            if (typeof (stub as Record<string, unknown>)[method] === 'function') continue
            const problem = `${kind}(${stage.name}).useValue(…) has no ${method} method.`
            if (strictMocks()) startupError(new Error(problem))
            else warnOnce(new Logger('TestingModule'), `${problem} A call that reaches ${stage.name} fails; useStrictMocks() refuses it here.`)
          }
        }
        // Each pass of checks ends before the next step that is no check, so a module with one error stops where it always did
        stopOnStartupErrors()
        // What the walk below takes as classes, reported with what the walk finds; an entry refused here is left out of it
        const services = this.wiring?.services ?? []
        if (this.options.app) assertProvidedServices(this.options.app.name, services, providers, "@MeoCord({ providers }) or the testing module's providers")
        for (const controller of this.options.controllers ?? []) {
          if (!isConstructor(controller)) startupError(new Error(`the testing module's controllers takes classes, not ${describeValue(controller)}.`))
        }
        const observers = [...(this.options.app ? appObservers(this.options.app) : []), ...(this.options.observers ?? [])]
        assertObservers("the testing module's observers", observers)
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
        // Every class the module runs, as the app finds them, except stage classes an override stands in for
        const appPresenterClass = this.options.app && (Reflect.getMetadata(META.appOptions, this.options.app) as { presenter?: unknown })?.presenter
        const startup = startupClasses({
          controllers: (this.options.controllers ?? []).filter(isConstructor),
          services,
          providers,
          stages,
          presenter: appPresenterClass,
          cooldownStore: store,
          themeFor: stages?.themeFor?.resolvers,
          observers,
          stubs: [...this.guardOverrides.keys(), ...this.interceptorOverrides.keys(), ...this.filterOverrides.keys()],
        })
        const hasTranslator = i18n !== undefined || providers.has(Translator)
        assertStartupClasses(startup, { translator: hasTranslator })
        // Those of the stages, guards and other classes they reach
        declaredErrorsOf(startup.classes).forEach(startupError)
        stopOnStartupErrors()
        markStartupChecked(container, [...startup.classes, ...meocordClasses()], lateGuardCheck(providers, hasTranslator))
        // The bot binds the Client it logs in with; a test gives its own, and is told so where one is needed
        const needClient = startup.classes.filter(cls => injectedTokens(cls).includes(Client))
        if (needClient.length > 0 && !providers.has(Client)) {
          container.bind(Client).toDynamicValue(() => {
            throw new Error(
              `${needClient.map(cls => cls.name).join(', ')} ${needClient.length === 1 ? 'injects' : 'inject'} the Discord Client, ` +
                'which a testing module does not make: give one in its providers, such as ' +
                '{ provide: Client, useValue: createMockClient() }.',
            )
          })
        }

        // A stage override nothing provides, bound before the classes so none of them binds the stage itself
        for (const [stage, stub] of stageStubs) container.bind(stage).toConstantValue(stub)

        // The app's cooldown policy, so a test of a failing store sees what the bot would do
        if (appOptions && !container.isBound(COOLDOWN_POLICY)) container.bind(COOLDOWN_POLICY).toConstantValue(cooldownPolicyFrom(appOptions))

        // The app's translator, unless a provider stands in for it
        if (i18n && !providers.has(Translator)) {
          container.bind(Translator).toConstantValue(i18n)
          bindsOwnToken(container, Translator)
        }

        // Recursively bind controllers and their dependencies, skipping already-bound tokens
        const bindClass = (cls: new (...args: any[]) => any) => {
          // A provided class is bound by its own provider, wherever in the list that provider comes
          if (container.isBound(cls) || providers.has(cls)) return
          if (injectedTokens(cls).includes(ExecutionContext)) return startupError(singletonContextError(cls))
          assertStartupChecked(container, cls)

          makeInjectable(cls)
          container.bind(cls).toSelf().inSingletonScope()

          // By constructor type or @inject token, as the app binds them
          for (const dep of injectedTokens(cls)) {
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

        // Before the controllers, so a class token that is provided is not also bound as itself. A test's provider of a
        // token the module bound above, as HandlerRegistry or ShardContext, stands in for that binding
        for (const provider of providers.values()) {
          if (container.isBound(provider.provide as ServiceIdentifier)) container.unbind(provider.provide as ServiceIdentifier)
          bindProvider(container, provider, bindClass)
        }

        for (const ctrl of this.options.controllers ?? []) bindClass(ctrl)
        for (const service of services) bindClass(service)
        if (themeResolver) bindClass(themeResolver)
        // What follows walks what these bound, so a class refused here is not reported again as missing
        stopOnStartupErrors()

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
        assertProvided(container, providers, startup.classes, "the testing module's providers")
        prepareHandlerStages(container, appClasses)
        const messages = messagesOf(this.options.app)
        // As the app would at startup, refuses a message pattern that cannot be read or two that match the same messages
        buildMessageRoutes(this.options.controllers ?? [], messages)
        // As the app does when it is created, so a test sees the refusal the bot would give
        assertDistinctCommands(this.options.controllers ?? [])
        if (this.options.app) prepareAppPresenter(container, this.options.app)
        bindObservers(container, observers)
        // The store calls ask: the test's own when it provides CooldownStore, else the app's
        const boundStore = store ?? (providers.has(CooldownStore) ? CooldownStore : undefined)
        // What the stages and presenter inject, as the bot makes it; a stage the test replaced contributes nothing
        const stageServices = stageDependencies(startup, providers, appPresenterClass)
        for (const service of stageServices) bindClass(service)
        const unitOf = (token: unknown): LifecycleUnit => ({
          token,
          name: tokenName(token),
          dependencies: tokenDependencies(container, providers, token),
          ...(token === boundStore && { cooldownStore: true }),
        })
        const listed = [...providers.keys(), ...services]
        const run = [...(themeResolver ? [themeResolver] : []), ...(this.options.controllers ?? []), ...observers]
        const first = boundStore ? [boundStore] : []
        // The lifecycle hooks' order without strict mocks: the cooldown store, providers, services and what the stages
        // inject, then the controllers and observers, each after what it injects
        const lifecycle = resolutionOrder(container, providers, [...first, ...listed, ...stageServices, ...run]).map(unitOf)
        // The bot's, which strict mocks use: what only the stages inject comes after the controllers and observers
        const botLifecycle = resolutionOrder(container, providers, [...first, ...listed, ...run, ...stageServices]).map(unitOf)
        // Recorded as the container makes each one, before anything can be made, so close() shuts down exactly what exists
        const constructed = new Set<unknown>()
        for (const { token } of lifecycle) {
          container.onActivation(token as ServiceIdentifier, (_context, instance) => {
            constructed.add(token)
            return instance
          })
        }

        // Every check has run, and touched only the container: from here the module is made, once none found an error
        stopOnStartupErrors()
        // Every class the module runs, so @UseGuard resolves guards on a direct call to any of them
        prepareDirectCalls(container, [...(this.options.controllers ?? []), ...startup.classes])
        prepareThemes(container, appClasses)
        // A handler with no builder is how a fixture is written, so only what is always a mistake is named
        warnUnregisteredCommands(this.options.controllers ?? [], { missingBuilders: false })
        warnInheritedRoutes(this.options.controllers ?? [])
        warnOverlappingPatterns(this.options.controllers ?? [])
        warnHandlersOffControllers(this.options.controllers ?? [], startup.classes)
        warnContextMenuParams(this.options.controllers ?? [])
        for (const warning of perCallEventWarnings(startup, providers, appPresenterClass)) new Logger('TestingModule').warn(warning)

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
          this.options.app,
          this.options.eventFallback,
          botLifecycle,
        )
      })
    } catch (error) {
      if (isRefusal(error) && !isExplainedError(error)) {
        if (logStartupErrors(error, text => new Logger('TestingModule').error(text), 'the testing module did not compile')) markExplained(error)
      }
      throw error
    }
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
 * @see {@link https://meocord.dev/docs/4.2/testing | The testing module}
 */
export class MeoCordTestingModule {
  /**
   * Starts building a testing module from the classes a test needs.
   *
   * @param options - The controllers, providers, observers and app the module is built from.
   * @returns The builder, to override what the test replaces before `compile()`.
   */
  static create(options: TestingModuleOptions): TestingModuleBuilder {
    // A controller listed twice is one controller, as the bot and fromApp take it
    return new TestingModuleBuilder({ ...options, ...(options.controllers && { controllers: [...new Set(options.controllers)] }) })
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
   * @throws TypeError when `app` is not a `@MeoCord` class. After {@link reportAllStartupErrors}, an app whose
   *   `@MeoCord` was refused throws the error it was refused for instead.
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
    // An app that isn't a class at all, as a circular import gives, has no metadata to read
    if (typeof app !== 'function') {
      const { name, hint } = notAClass(app)
      throw new TypeError(`${name} is not a @MeoCord app: fromApp takes the class @MeoCord decorates.${hint}`)
    }
    const appOptions = Reflect.getMetadata(META.appOptions, app) as
      | {
          controllers: (new (...args: any[]) => any)[]
          services?: (new (...args: any[]) => unknown)[]
          providers?: Provider[]
        }
      | undefined
    if (!appOptions) {
      // A refused @MeoCord stores no options, so its own errors, kept with startupErrors: 'all', say why
      collectStartupErrors(() => declaredErrorsOf([app]).forEach(startupError))
      throw new TypeError(`${app?.name ?? String(app)} is not a @MeoCord app: fromApp takes the class @MeoCord decorates.`)
    }
    const controllers = [...new Set([...appOptions.controllers, ...(options.controllers ?? [])])]
    return new TestingModuleBuilder(
      {
        app,
        controllers,
        providers: options.providers,
        observers: options.observers,
        shutdownTimeout: options.shutdownTimeout,
        eventFallback: options.eventFallback,
      },
      { providers: appOptions.providers ?? [], services: appOptions.services ?? [] },
    )
  }
}

// Built by MeoCordTestingModule, never injected; registered here, as meocord/core does not load the testing module
adviseInPlaceOfInjecting(TestingModuleBuilder, 'build it with MeoCordTestingModule.create(…) or MeoCordTestingModule.fromApp(…)')
adviseInPlaceOfInjecting(TestingModule, 'make it with MeoCordTestingModule.create(…).compile()')
