import 'reflect-metadata'
import { type Container } from 'inversify'
import { refuse, startupError, stopOnStartupErrors } from '@src/util/refusal.util.js'
import { type ResponsePresenter, type ThemeOverride, type ThemeResolvers } from '@src/interface/index.js'
import { setPresenter } from '@src/common/response/presenter.js'
import { type InteractionResponse, responseOf } from '@src/common/response/response-state.js'
import { deferMisuseError, handlerDefer, nonInteractionHandler, startDefer } from '@src/core/defer.js'
import { callGuardedHandler, type GuardEntry, handlerGuards, isGuardWithParams, perHandler, runGuards } from '@src/core/guard-runner.js'
import {
  bindShared,
  handlerInterceptors,
  interceptorClass,
  type InterceptorClass,
  type InterceptorEntry,
  prepareInterceptor,
  runInterceptors,
} from '@src/core/interceptor-runner.js'
import {
  type ExecutionContext,
  type ExecutionContextType,
  HandlerExecutionContext,
  type CurrentArgs,
  inferContextType,
  UnroutedExecutionContext,
} from '@src/common/execution-context.js'
import {
  callFilter,
  type FilterContext,
  type FilterEntry,
  filterClass,
  handlerFilterLevels,
  matchFilter,
  prepareFilter,
} from '@src/core/filter-runner.js'
import { type Fallback } from '@src/core/fallback.js'
import { handlerInputStages, pipeClass, prepareHandlerArgs, preparePipe } from '@src/core/input-runner.js'
import { hasObservers, notifyObservers, notifyStart, outcomeOf, responsePhaseOf } from '@src/core/observer-runner.js'
import { type DispatchOutcome, type DispatchResult } from '@src/interface/observer.interface.js'
import { handlerCooldowns, methodCooldowns, peekCooldowns } from '@src/core/cooldown-runner.js'
import { Logger } from '@src/common/logger.js'
import { beginCallTheme, configureThemes } from '@src/core/theme-runtime.js'
import { runInThemeScope } from '@src/core/theme-scope.js'
import { type ThemeResolverOptions } from '@src/core/theme-resolvers.js'
import { getEventHandlers } from '@src/decorator/event.decorator.js'
import {
  getAutocompleteHandlers,
  getCommandMap,
  getMessageHandlers,
  getReactionHandlers,
} from '@src/decorator/controller.decorator.js'
import { appliesTo } from '@src/core/stage-scope.js'
import { META } from '@src/util/metadata-keys.js'

/** The stages that run around one handler, in the order they run. */
export interface HandlerStages {
  readonly guards: readonly GuardEntry[]
  readonly interceptors: readonly InterceptorEntry[]
  /** Filters by level, the level closest to the handler first: method, class, global. */
  readonly filters: readonly (readonly FilterEntry[])[]
}

/**
 * The stages `@MeoCord` applies to every handler: its guards and interceptors run before the controller's and method's,
 * and its filters are tried after theirs.
 */
export interface GlobalStages {
  guards: readonly GuardEntry[]
  interceptors: readonly InterceptorEntry[]
  filters: readonly FilterEntry[]
  /** The app's `@MeoCord({ theme })`, as `@MeoCord` checked and copied it, beneath every `@UseTheme`. */
  theme?: ThemeOverride
  /** The app's `@MeoCord({ themeFor })`, with its cache's options and lookup timeout. */
  themeFor?: ThemeResolverOptions
}

const NO_GLOBAL_STAGES: GlobalStages = { guards: [], interceptors: [], filters: [] }

/** Where a container keeps its application's global stages. */
const GLOBAL_STAGES = Symbol('global_stages')

/** The global stages declared by `@MeoCord` on an application class. */
export function appStages(app: object): GlobalStages {
  const options = Reflect.getMetadata(META.appOptions, app) as
    | {
        guards?: GuardEntry[]
        interceptors?: InterceptorEntry[]
        filters?: FilterEntry[]
        theme?: ThemeOverride
        themeFor?: ThemeResolvers
        themeCache?: ThemeResolverOptions['cache']
        themeForTimeoutMs?: number
      }
    | undefined
  if (!options) {
    throw refuse(new Error(`${(app as { name?: string }).name || 'The app class'}: not decorated with @MeoCord().`))
  }
  return {
    guards: [...(options.guards ?? [])],
    interceptors: [...(options.interceptors ?? [])],
    filters: [...(options.filters ?? [])],
    ...(options.theme !== undefined && { theme: options.theme }),
    ...(options.themeFor !== undefined && {
      themeFor: { resolvers: options.themeFor, cache: options.themeCache, timeoutMs: options.themeForTimeoutMs },
    }),
  }
}

/**
 * Resolves the presenter `@MeoCord({ presenter })` declares, as a singleton of `container`, and makes it
 * the one `respond()` uses for interactions `client` receives. Returns it, or `undefined` without one.
 */
export function bindAppPresenter(container: Container, app: object, client?: object): ResponsePresenter | undefined {
  const options = Reflect.getMetadata(META.appOptions, app) as { presenter?: new (...args: any[]) => ResponsePresenter } | undefined
  if (!options?.presenter) return undefined
  bindShared(container, options.presenter)
  const presenter = container.get<ResponsePresenter>(options.presenter)
  container.bind<ResponsePresenter>(APP_PRESENTER).toConstantValue(presenter)
  if (client) setPresenter(client, presenter)
  return presenter
}

/** Where a container keeps the application's presenter. */
const APP_PRESENTER = Symbol('app_presenter')

/** The presenter `bindAppPresenter` resolved into `container`, if any. */
export function appPresenterOf(container: Container): ResponsePresenter | undefined {
  return container.isBound(APP_PRESENTER) ? container.get<ResponsePresenter>(APP_PRESENTER) : undefined
}

/** Stores the global stages that handlers run through `container` start with. */
export function bindGlobalStages(container: Container, stages: GlobalStages): void {
  container.bind<GlobalStages>(GLOBAL_STAGES).toConstantValue(stages)
}

export function globalStagesOf(container: Container): GlobalStages {
  return container.isBound(GLOBAL_STAGES) ? container.get<GlobalStages>(GLOBAL_STAGES) : NO_GLOBAL_STAGES
}

/** How a call through the pipeline ended. */
export interface HandlerOutcome {
  /** Whether the handler itself ran. */
  ran: boolean

  /** The error a filter or the fallback handled, when the call failed. */
  error?: unknown
}

/**
 * The stages dispatch runs for `methodName`: guards and interceptors global first, then the controller's and method's;
 * filters method, class, then global. Resolved once per set of global stages and handler, then shared, so the lists
 * must not be changed.
 */
export function handlerStages(
  prototype: object,
  methodName: string,
  globals: GlobalStages = NO_GLOBAL_STAGES,
): HandlerStages {
  let resolve = stagesByGlobals.get(globals)
  if (!resolve) {
    resolve = perHandler((handlerPrototype, handler): HandlerStages =>
      Object.freeze({
        guards: Object.freeze([...globals.guards, ...handlerGuards(handlerPrototype, handler)]),
        interceptors: Object.freeze([...globals.interceptors, ...handlerInterceptors(handlerPrototype, handler)]),
        filters: Object.freeze(handlerFilterLevels(handlerPrototype, handler, globals.filters).map(level => Object.freeze(level))),
      }),
    )
    stagesByGlobals.set(globals, resolve)
  }
  return resolve(prototype, methodName)
}

const stagesByGlobals = new WeakMap<GlobalStages, (prototype: object, methodName: string) => HandlerStages>()

/** The names of a controller's handler methods, of every kind. */
function handlerMethods(prototype: object): Set<string> {
  return new Set<string>([
    ...Object.values(getCommandMap(prototype) ?? {})
      .flat()
      .map(command => command.methodName),
    ...getMessageHandlers(prototype).map(handler => handler.method),
    ...getReactionHandlers(prototype).map(handler => handler.method),
    ...getAutocompleteHandlers(prototype).map(handler => handler.methodName),
    ...getEventHandlers(prototype).map(handler => handler.method),
  ])
}

/**
 * The decorator each class an app runs from its metadata takes: `@Controller()` for `controllers`, and for the global
 * stages and each handler's guards, interceptors, filters and pipes, theirs. Read before the app is bound, so a class
 * that cannot be created is refused by name as the app starts rather than at its first call.
 */
export function classDecorators(controllers: readonly object[], globals: GlobalStages = NO_GLOBAL_STAGES): Map<unknown, string> {
  const decorators = new Map<unknown, string>()
  const add = (cls: unknown, decorator: string) => {
    if (!decorators.has(cls)) decorators.set(cls, decorator)
  }
  const guard = (entry: GuardEntry) => (isGuardWithParams(entry) ? entry.provide : entry)
  for (const controller of controllers) add(controller, '@Controller()')
  for (const entry of globals.guards) add(guard(entry), '@Guard()')
  for (const entry of globals.interceptors) add(interceptorClass(entry), '@Interceptor()')
  for (const entry of globals.filters) add(filterClass(entry), '@Catch()')
  for (const controller of controllers) for (const [cls, decorator] of handlerStageClasses(controller)) add(cls, decorator)
  return decorators
}

/**
 * The guards, interceptors, filters and pipes the handlers of `cls` declare, each with its decorator: a controller's,
 * or a service's `@On` and `@Once` handlers, which run their stages too.
 */
export function handlerStageClasses(cls: object): [unknown, string][] {
  const prototype = (cls as { prototype: object }).prototype
  const guard = (entry: GuardEntry) => (isGuardWithParams(entry) ? entry.provide : entry)
  return [...handlerMethods(prototype)].flatMap(method => [
    ...handlerGuards(prototype, method).map(entry => [guard(entry), '@Guard()'] as [unknown, string]),
    ...handlerInterceptors(prototype, method).map(entry => [interceptorClass(entry), '@Interceptor()'] as [unknown, string]),
    ...handlerFilterLevels(prototype, method, []).flat().map(entry => [filterClass(entry), '@Catch()'] as [unknown, string]),
    ...handlerInputStages(prototype, method).pipes.map(({ entry }) => [pipeClass(entry), '@Pipe()'] as [unknown, string]),
  ])
}

/**
 * Binds the interceptors, filters and pipes every handler of `controllers` uses, and the global ones, as singletons, so
 * one that cannot be shared, or a filter without `@Catch`, fails at startup; refuses there `@Defer`, `@Validate`,
 * `@UsePipe` and `@Cooldown` where they cannot apply, and two classes that keep state under one name.
 */
export function prepareHandlerStages(container: Container, controllers: readonly (new (...args: any[]) => unknown)[]): void {
  assertDistinctNamesWhereKeyed(controllers)
  stopOnStartupErrors()
  const globals = globalStagesOf(container)
  configureThemes(container, globals.theme, controllers, globals.themeFor)
  for (const entry of globals.interceptors) prepareInterceptor(container, entry)
  for (const entry of globals.filters) prepareFilter(container, entry)

  for (const controller of controllers) {
    const prototype = controller.prototype as object
    for (const method of handlerMethods(prototype)) {
      const kind = handlerDefer(prototype, method) ? nonInteractionHandler(prototype, method) : undefined
      if (kind) { startupError(deferMisuseError(controller.name, method, kind)); continue }
      for (const entry of handlerInterceptors(prototype, method)) prepareInterceptor(container, entry)
      for (const entry of handlerFilterLevels(prototype, method, []).flat()) prepareFilter(container, entry)
      for (const { entry } of handlerInputStages(prototype, method).pipes) preparePipe(container, entry)
    }
    assertInputStagesOnInteractions(controller, prototype)
  }
}

/** Whether a class has state keyed by its name: a cooldown on a handler, or a `@Once` handler. */
function keyedByName(cls: new (...args: any[]) => unknown): boolean {
  const prototype = cls.prototype as object
  const handlers = [
    ...Object.values(getCommandMap(prototype) ?? {})
      .flat()
      .map(command => command.methodName),
    ...getMessageHandlers(prototype).map(handler => handler.method),
  ]
  return handlers.some(method => handlerCooldowns(prototype, method).length > 0) || getEventHandlers(prototype).some(handler => handler.once)
}

/**
 * Refuses two same-named classes when either keeps state under its name, since cooldown counts and
 * `@Once` tracking would be shared between them.
 */
function assertDistinctNamesWhereKeyed(classes: readonly (new (...args: any[]) => unknown)[]): void {
  const byName = new Map<string, new (...args: any[]) => unknown>()
  for (const cls of classes) {
    const other = byName.get(cls.name)
    if (other && other !== cls && (keyedByName(cls) || keyedByName(other))) {
      startupError(new Error(
        `${cls.name}: two classes have this name; @Cooldown and @Once tell classes apart by name, so they would share ` +
          `their counts. Rename one of them.`,
      ))
      continue
    }
    byName.set(cls.name, cls)
  }
}

/** Refuses `@Validate` and `@UsePipe` on handlers with no params to check, and `@Cooldown` on ones it never counts. */
function assertInputStagesOnInteractions(controller: new (...args: any[]) => unknown, prototype: object): void {
  const others: [string, string][] = [
    ...getMessageHandlers(prototype)
      .filter(handler => handler.pattern === undefined)
      .map(handler => [handler.method, 'message'] as [string, string]),
    ...getReactionHandlers(prototype).map(handler => [handler.method, 'reaction'] as [string, string]),
    ...getAutocompleteHandlers(prototype).map(handler => [handler.methodName, 'autocomplete'] as [string, string]),
    ...getEventHandlers(prototype).map(handler => [handler.method, 'event'] as [string, string]),
  ]
  for (const [method, kind] of others) {
    const { schema, pipes } = handlerInputStages(prototype, method)
    const handler =
      kind === 'message'
        ? 'a message handler without a pattern'
        : `${kind === 'autocomplete' || kind === 'event' ? 'an' : 'a'} ${kind} handler`
    if (schema || pipes.length > 0) {
      startupError(new Error(
        `${controller.name}.${method}: @Validate and @UsePipe are for interaction and patterned message handlers, ` +
          `whose options, customId params, modal fields and pattern params they check, and this is ${handler}.`,
      ))
      continue
    }
    // A controller's own @Cooldown skips these handlers; one on the method itself is a mistake.
    if (kind !== 'message' && methodCooldowns(prototype, method).length > 0) {
      startupError(new Error(
        `${controller.name}.${method}: @Cooldown is for interaction and message handlers, and this is ${handler}.`,
      ))
    }
  }
}

/** What a call the guards let through can do before its arguments are fetched. */
export interface AdmittedCall {
  /**
   * Throws the error a cooldown would refuse the call with, without counting the call, so a refused call
   * fetches nothing. Cooldowns with `by` are judged only when the call is counted, after validation.
   */
  checkCooldowns(): Promise<void>
}

/**
 * How a caller runs a call through the pipeline: its fallback, the argument steps around the guards, its context type,
 * and what the observers and the unanswered warning are told.
 */
export interface RunOptions {
  /** Answers an error no filter handled. Without it, such an error rejects the call. */
  fallback?: Fallback
  /**
   * Turns the call's arguments into the ones the guards see, before them and inside the filters, with no
   * request to Discord: a message's typed params read, with members, users, roles and channels as refs, or
   * a usage error thrown for the filters.
   */
  parseArgs?: (args: unknown[]) => Promise<unknown[]>
  /**
   * Turns the arguments the guards let through into the ones the interceptors and the handler receive,
   * inside the filters: what a message's params name, fetched from Discord. It never runs for a call the
   * guards deny, so a caller they refuse costs no request.
   */
  fetchArgs?: (args: unknown[], admitted: AdmittedCall) => Promise<unknown[]>
  /** What the call handles, when its first argument cannot say, as for an event whose first argument is a message. */
  type?: ExecutionContextType
  /**
   * Waits for the observers before the run settles, as the testing module does so a test sees what they
   * were told. At runtime they are never waited for.
   */
  awaitObservers?: boolean
  /** When dispatch received the call, from `performance.now()`, when it started before the pipeline. */
  startedAt?: number
  /**
   * Told when a call ended without an error and left its interaction unanswered, or deferred without a
   * follow-up: with the interceptor that returned before the handler finished, if one did, and whether the
   * handler had started by then.
   */
  onUnanswered?: (phase: 'unanswered' | 'deferred', returnedBy?: { interceptor: InterceptorClass; handlerStarted: boolean }) => void
}

/**
 * Reports a settled call to the observers: awaited when the run asks, else left to run on its own. The
 * context is built only when there are observers to tell.
 */
async function observe(
  container: Container,
  contextOf: () => ExecutionContext,
  settlement: Settlement,
  { awaitObservers }: RunOptions,
): Promise<void> {
  if (!hasObservers(container)) return
  const context = contextOf()
  const reported = notifyObservers(container, context, settled(context, settlement))
  if (awaitObservers) await reported
}

/** How a call settled, as the pipeline saw it. */
interface Settlement {
  outcome: DispatchOutcome
  /** When the call started, from `performance.now()`. */
  startedAt: number
  handled: boolean
  failure?: { error: unknown }
  deniedBy?: abstract new (...args: any[]) => unknown
}

/**
 * A call's result for the observers, each optional field only when it applies. The response is read
 * from the interaction now, once the call has settled.
 */
function settled(context: ExecutionContext, { outcome, startedAt, handled, failure, deniedBy }: Settlement): DispatchResult {
  const result: DispatchResult = {
    outcome,
    startedAt: performance.timeOrigin + startedAt,
    durationMs: performance.now() - startedAt,
    handled,
  }
  if (failure) result.error = failure.error
  if (deniedBy) result.deniedBy = deniedBy
  const response = responsePhaseOf(context)
  if (response) result.response = response
  return result
}

const logger = new Logger('ExceptionFilter')

/**
 * Hands a failed call's error to the first matching filter, level by level, then to the fallback. A
 * filter that throws is logged and the fallback answers the original error; without a fallback, the
 * unhandled error, or the filter's own, rejects.
 */
async function handleError(
  levels: readonly (readonly FilterEntry[])[],
  container: Container,
  context: FilterContext,
  error: unknown,
  { fallback }: RunOptions,
): Promise<unknown> {
  const filter = matchFilter(levels, error)
  if (filter) {
    try {
      await callFilter(filter, container, context, error)
      return
    } catch (filterError) {
      if (!fallback) throw filterError
      const name = (typeof filter === 'object' ? filter.provide : filter).name
      logger.error(`Filter ${name} threw while handling an error:`, filterError)
    }
  }
  if (!fallback) throw error
  return fallback(error, context)
}

/**
 * Runs one handler through the pipeline, inside its filters: the global guards, then the handler's
 * own; then the interceptors, global first, around the handler, which is called with the dispatch
 * marks set. Dispatch and `TestingModule.invoke` both call this, so a test runs what production runs.
 * The context is built only when a stage needs it: an interceptor, a pipe, a cooldown, an observer or a filter.
 */
export async function runHandler(
  container: Container,
  instance: Record<string, (...args: unknown[]) => unknown>,
  methodName: string,
  args: unknown[],
  options: RunOptions = {},
): Promise<HandlerOutcome> {
  // The handler's theme, with the call's server's and user's over it, for everything the call runs
  const theme = beginCallTheme(container, args, Object.getPrototypeOf(instance), methodName)
  return theme
    ? runInThemeScope(theme.scope, () => runPipeline(container, instance, methodName, args, options, theme.ready))
    : runPipeline(container, instance, methodName, args, options)
}

/** {@link runHandler}'s pipeline, in the call's theme. */
async function runPipeline(
  container: Container,
  instance: Record<string, (...args: unknown[]) => unknown>,
  methodName: string,
  args: unknown[],
  options: RunOptions,
  themeReady?: Promise<void>,
): Promise<HandlerOutcome> {
  const controller = instance.constructor as new (...args: any[]) => unknown
  const { guards, interceptors, filters } = handlerStages(
    Object.getPrototypeOf(instance),
    methodName,
    globalStagesOf(container),
  )
  const type = options.type ?? inferContextType(args[0])
  // One cell for the whole call, so every stage's context reads the arguments as they stand now
  const currentArgs: CurrentArgs = { current: args }
  let context: HandlerExecutionContext | undefined
  const contextOf = () => (context ??= new HandlerExecutionContext({ controller, methodName, args, type, currentArgs }))
  const receivedAt = Date.now()
  const defer = type === 'interaction' ? handlerDefer(Object.getPrototypeOf(instance), methodName) : undefined
  const [first] = args as [{ isRepliable?: () => boolean } | undefined]
  const response: InteractionResponse | undefined =
    defer && first?.isRepliable?.() ? responseOf(first as Parameters<typeof responseOf>[0]) : undefined

  // What the observers are told once the call has settled
  const startedAt = options.startedAt ?? performance.now()
  let outcome: DispatchOutcome = 'ran'
  let failure: { error: unknown } | undefined
  let handled = false
  const denial: { by?: abstract new (...args: any[]) => unknown } = {}
  // Told before anything runs, with the context onSettled will get; never waited for here
  const starting = hasObservers(container) ? notifyStart(container, contextOf()) : undefined

  let ran = false
  // Once the handler has settled: before then, a call that ends is one an interceptor ended
  let finished = false
  // The outermost interceptor that returned before the handler finished, or without starting it
  let returnedEarly: InterceptorClass | undefined
  try {
    // @Defer's first step, inside the filters so a failed acknowledgement reaches them.
    if (response) await startDefer(response, defer!, receivedAt)
    // After @Defer's acknowledgement, which cannot wait, and before anything reads or renders the theme
    if (themeReady) await themeReady
    if (options.parseArgs) {
      args = await options.parseArgs(args)
      currentArgs.current = args
    }
    if (!(await runGuards(guards, { container, controller, methodName, args, type, currentArgs, denial }))) {
      outcome = 'denied'
      await response?.abandon()
      return { ran: false }
    }
    if (options.fetchArgs) {
      // Checked in the context the cooldowns are later counted in, so a bypass is judged once per call
      const cooldowns = handlerCooldowns(Object.getPrototypeOf(instance), methodName)
      const admitted: AdmittedCall = { checkCooldowns: () => peekCooldowns(container, controller, methodName, cooldowns, contextOf) }
      args = await options.fetchArgs(args, admitted)
      currentArgs.current = args
    }

    const handler = async () => {
      // Inside the interceptors, so they see a validation failure as the handler's error.
      const handlerArgs = await prepareHandlerArgs(container, Object.getPrototypeOf(instance), methodName, contextOf, args)
      currentArgs.current = handlerArgs
      // @Defer's second step, only once the call will run: a denied or invalid call never touches the message.
      await response?.lock({ disable: defer!.disable })
      ran = true
      try {
        return await callGuardedHandler(instance, methodName, handlerArgs)
      } finally {
        finished = true
      }
    }
    // Autocomplete answers within three seconds and has no reply to shape, so it skips interceptors.
    const applicable = type === 'autocomplete' ? [] : interceptors.filter(entry => appliesTo(entry, type))
    if (applicable.length === 0) await handler()
    else await runInterceptors(applicable, container, contextOf(), handler, cls => (returnedEarly = cls))
    return { ran }
  } catch (error) {
    outcome = outcomeOf(error)
    failure = { error }
    const unanswered = await handleError(filters, container, contextOf(), error, options)
    // The fallback could not build its answer: the call ends in that fault, unanswered
    if (unanswered === undefined) handled = true
    else [outcome, failure] = ['error', { error: unanswered }]
    return { ran, error }
  } finally {
    await response?.release()
    if (options.onUnanswered && (ran || returnedEarly) && outcome === 'ran' && type === 'interaction') {
      const phase = responsePhaseOf(contextOf())
      // The handler is to blame only once it has finished; until then, the interceptor that ended the call is
      const blamed = !finished && returnedEarly ? { interceptor: returnedEarly, handlerStarted: ran } : undefined
      if (phase === 'unanswered' || phase === 'deferred') options.onUnanswered(phase, blamed)
    }
    if (options.awaitObservers) await starting
    // After the answer and the release, so the duration covers the whole call
    await observe(container, contextOf, { outcome, startedAt, handled, failure, deniedBy: denial.by }, options)
  }
}

/**
 * Handles an error raised for an interaction or a message no handler was reached for: one no route matched, or one that
 * failed before routing. Only global filters apply, then the fallback.
 */
export async function handleUnroutedError(
  container: Container,
  args: readonly unknown[],
  error: unknown,
  options: RunOptions = {},
): Promise<void> {
  return runInAppTheme(container, args, () => answerUnrouted(container, args, error, options))
}

/** Runs an answer to a call no handler takes, such as the built-in help, in the app's theme for where it came from. */
export async function runInAppTheme<T>(container: Container, args: readonly unknown[], answer: () => Promise<T>): Promise<T> {
  const theme = beginCallTheme(container, args)
  if (!theme) return answer()
  return runInThemeScope(theme.scope, async () => {
    await theme.ready
    return answer()
  })
}

/** {@link handleUnroutedError}'s answer, in the app's theme. */
async function answerUnrouted(container: Container, args: readonly unknown[], error: unknown, options: RunOptions): Promise<void> {
  const startedAt = options.startedAt ?? performance.now()
  const context = new UnroutedExecutionContext(args)
  let handled = false
  let outcome = outcomeOf(error)
  let failure: { error: unknown } = { error }
  try {
    const unanswered = await handleError([[...globalStagesOf(container).filters]], container, context, error, options)
    if (unanswered === undefined) handled = true
    else [outcome, failure] = ['error', { error: unanswered }]
  } finally {
    await observe(container, () => context, { outcome, startedAt, handled, failure }, options)
  }
}

/**
 * Reports an interaction no handler claimed and no error was raised for, such as an autocomplete no
 * `@Autocomplete` handler answers, to the observers as `'not-found'`.
 */
export async function observeUnclaimed(
  container: Container,
  args: readonly unknown[],
  options: RunOptions = {},
): Promise<void> {
  const startedAt = options.startedAt ?? performance.now()
  await observe(container, () => new UnroutedExecutionContext(args), { outcome: 'not-found', startedAt, handled: false }, options)
}
