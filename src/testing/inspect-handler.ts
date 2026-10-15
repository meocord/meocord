import 'reflect-metadata'
import { type DispatchObserver, type ExceptionFilter, type GuardInterface, type InterceptorInterface } from '@src/interface/index.js'
import { type ExecutionContextType, HandlerExecutionContext } from '@src/common/execution-context.js'
import { type MetadataDecorator } from '@src/common/metadata.js'
import { appStages, handlerStages } from '@src/core/handler-pipeline.js'
import { handlerCooldowns } from '@src/core/cooldown-runner.js'
import {
  getAutocompleteHandlers,
  getCommandMap,
  getDeclaredRoutes,
  getHandlerRoutes,
  getMessageHandlers,
  getReactionHandlers,
  eventRoute,
  type HandlerRoute,
  ownEventHandlers,
} from '@src/decorator/controller.decorator.js'
import { getEventHandlers } from '@src/decorator/event.decorator.js'
import { appliesTo } from '@src/core/stage-scope.js'
import { Logger } from '@src/common/logger.js'
import { warnOnce } from '@src/common/deprecation.js'
import { strictMocks } from './strict-mocks.js'
import { appObservers } from '@src/core/observer-runner.js'
import { type CooldownScope } from '@src/common/errors.js'

/**
 * A guard as `@UseGuard` declares it: the class, or the class with its params.
 *
 * @group Testing
 * @category Inspection
 */
export type InspectedGuard =
  | (new (...args: any[]) => GuardInterface)
  | { provide: new (...args: any[]) => GuardInterface; params?: Record<string, any> }

/**
 * An interceptor as `@UseInterceptor` declares it: the class, or the class with its params.
 *
 * @group Testing
 * @category Inspection
 */
export type InspectedInterceptor =
  | (new (...args: any[]) => InterceptorInterface)
  | { provide: new (...args: any[]) => InterceptorInterface; params?: Record<string, any> }

/**
 * A filter as `@UseFilter` declares it: the class, or the class with its params.
 *
 * @group Testing
 * @category Inspection
 */
export type InspectedFilter =
  | (new (...args: any[]) => ExceptionFilter<any>)
  | { provide: new (...args: any[]) => ExceptionFilter<any>; params?: Record<string, any> }

/**
 * What runs for one handler, and the metadata declared on it, as {@link inspectHandler} reports it.
 *
 * @group Testing
 * @category Inspection
 */
export interface HandlerInspection {
  /** The controller class declaring the handler. */
  readonly controller: new (...args: any[]) => unknown

  /** The handler method's name. */
  readonly methodName: string

  /**
   * The guards that run before the handler, in order: global guards, class guards, then method guards. Under
   * `useStrictMocks()`, only those for the handler's context types.
   */
  readonly guards: readonly InspectedGuard[]

  /**
   * The interceptors around the handler, outermost first: global, class, then method interceptors. Under
   * `useStrictMocks()`, only those for the handler's context types, and none for an autocomplete.
   */
  readonly interceptors: readonly InspectedInterceptor[]

  /**
   * The exception filters for the handler, in the order they are tried: the method's, then the
   * controller's, then global ones.
   */
  readonly filters: readonly InspectedFilter[]

  /** The handler's cooldowns, the controller's first, with their defaults filled in. */
  readonly cooldowns: readonly InspectedCooldown[]

  /** The `@MessageHandler` pattern, or `undefined` for a listener and for any other kind of handler. */
  readonly pattern: string | undefined
  /**
   * The routes the handler answers because a class its controller extends declares them, such as `slash "ping"`:
   * those its own class doesn't declare for it. Empty for a handler that declares all it answers. Under
   * `useStrictMocks()` it names an inherited `@On` or `@Once` event too, such as `event "guildCreate"`; default mode
   * leaves events out, with a warning once where it would name one. A test reads it; `toEqual` doesn't compare it, so
   * an assertion on the other fields holds either way.
   */
  readonly inheritedRoutes: readonly string[]
  /**
   * The `app`'s observers, in the order they are told about the call; empty without an `app`. Under `useStrictMocks()`,
   * only those whose `types` include the handler's.
   */
  readonly observers: readonly (new (...args: any[]) => DispatchObserver)[]

  /**
   * Reads a metadata value as `ExecutionContext.get` does: the method's value, else the controller's.
   *
   * @param metadata - A decorator made by `createMetadata`.
   * @returns The value, or `undefined` when neither declares one.
   */
  get<T>(metadata: MetadataDecorator<T>): T | undefined
  /**
   * Reads the value stored under a `SetMetadata` key as `ExecutionContext.get` does: the method's value, else the
   * controller's.
   *
   * @param key - The key `SetMetadata` stored the value under.
   * @returns The value, or `undefined` when neither declares one.
   */
  get<T = unknown>(key: string | symbol): T | undefined

  /**
   * Reads every declared value as `ExecutionContext.getAll` does, method first, then controller.
   *
   * @param metadata - A decorator made by `createMetadata`.
   * @returns The declared values; empty when none is declared.
   */
  getAll<T>(metadata: MetadataDecorator<T>): T[]
  /**
   * Reads every value stored under a `SetMetadata` key as `ExecutionContext.getAll` does, method first, then
   * controller.
   *
   * @param key - The key `SetMetadata` stored the values under.
   * @returns The declared values; empty when none is declared.
   */
  getAll<T = unknown>(key: string | symbol): T[]
}

/**
 * One `@Cooldown` on a handler, with its defaults filled in, as {@link inspectHandler} reports it.
 *
 * @group Testing
 * @category Inspection
 */
export interface InspectedCooldown {
  /** The window, in seconds. */
  readonly seconds: number
  /** How many calls the window allows. */
  readonly uses: number
  /** Whom the calls are counted for: `'user'`, `'channel'`, `'guild'` or `'global'`. */
  readonly per: CooldownScope
  /** Whether it exempts some callers. */
  readonly bypass: boolean
  /** Whether it counts calls apart by a value of the call. */
  readonly by: boolean
}

/**
 * What {@link inspectHandler} includes besides the handler's own stages.
 *
 * @group Testing
 * @category Inspection
 */
export interface InspectHandlerOptions {
  /**
   * The `@MeoCord` app class: its global guards and interceptors come before the handler's own, its global filters
   * are tried after them, and its observers are listed.
   */
  app?: new (...args: any[]) => unknown
}

/**
 * Reports what runs when a handler is dispatched, and the metadata declared on it, without running anything.
 *
 * Use it to check that decorators set a handler up as intended: its guards with their params, its interceptors,
 * filters and cooldowns, in the order dispatch applies them. Under `useStrictMocks()`, the guards, interceptors and
 * observers are those dispatch runs for the handler's context types: a stage declared with `types` is listed only for
 * a handler of one of them, and an autocomplete lists no interceptors. Default mode lists every one, with a warning
 * once where dispatch runs fewer. To check what a handler does, run it with {@link TestingModule.invoke}.
 *
 * @param controller - The controller class declaring the handler.
 * @param methodName - The handler method's name.
 * @param options - `app`, to include the global stages and observers `@MeoCord` declares.
 * @returns The handler's stages in order, its message pattern, and readers for its metadata.
 *
 * @example
 * ```ts
 * import { expect } from 'vitest'
 *
 * @Controller()
 * @UseGuard(StaffGuard)
 * class ModerationController {
 *   @Command('ban', CommandType.SLASH)
 *   @UseGuard({ provide: ChannelGuard, params: { channelIds: ['123456789012345678'] } })
 *   async ban(interaction: ChatInputCommandInteraction) {
 *     await respond(interaction).send('Banned.')
 *   }
 * }
 * const { guards } = inspectHandler(ModerationController, 'ban')
 * expect(guards).toEqual([StaffGuard, { provide: ChannelGuard, params: { channelIds: ['123456789012345678'] } }])
 * ```
 *
 * @group Testing
 * @category Inspection
 * @see {@link createExecutionContext}
 * @see {@link https://meocord.dev/docs/4.2/testing-recipes | Testing recipes}
 */
export function inspectHandler<C extends new (...args: any[]) => unknown>(
  controller: C,
  methodName: keyof InstanceType<C> & string,
  options: InspectHandlerOptions = {},
): HandlerInspection {
  const context = new HandlerExecutionContext({ controller, methodName, args: [] })
  const globals = options.app ? appStages(options.app) : undefined
  const { guards, interceptors, filters } = handlerStages(controller.prototype as object, methodName, globals)
  const observers = options.app ? appObservers(options.app) : []
  const stages = runStages(controller.prototype as object, methodName, { guards, interceptors, observers })

  const inspection = {
    controller,
    methodName,
    guards: Object.freeze([...stages.guards]),
    interceptors: Object.freeze([...stages.interceptors]),
    filters: Object.freeze(filters.flat()),
    cooldowns: Object.freeze(
      handlerCooldowns(controller.prototype as object, methodName).map(({ seconds, uses, per, bypass, by }) =>
        Object.freeze({ seconds, uses, per, bypass: bypass !== undefined, by: by !== undefined }),
      ),
    ),
    pattern: getMessageHandlers(controller.prototype).find(handler => handler.method === methodName)?.pattern,
    observers: Object.freeze([...stages.observers]),
    get: (metadata: MetadataDecorator<unknown> | string | symbol) => context.get(metadata as string),
    getAll: (metadata: MetadataDecorator<unknown> | string | symbol) => context.getAll(metadata as string),
  }
  // Read by a test but not compared by toEqual, so an assertion on the result's other fields holds
  const routes = Object.freeze(inheritedRoutesOf(controller.prototype as object, methodName, false))
  const withEvents = Object.freeze(inheritedRoutesOf(controller.prototype as object, methodName, true))
  Object.defineProperty(inspection, 'inheritedRoutes', {
    get: () => {
      if (strictMocks()) return withEvents
      if (withEvents.length > routes.length) {
        warnOnce(
          new Logger('inspectHandler'),
          `inspectHandler() here leaves the @On and @Once events ${controller.name}.${methodName} inherits out of ` +
            'inheritedRoutes, though the bot answers them; under useStrictMocks() it lists them.',
        )
      }
      return routes
    },
    enumerable: false,
  })
  return inspection as unknown as HandlerInspection
}

/** The context types dispatch calls `methodName` with: one for each kind of route it answers. */
function handlerContextTypes(prototype: object, methodName: string): ExecutionContextType[] {
  const answers: [ExecutionContextType, boolean][] = [
    ['interaction', Object.values(getCommandMap(prototype) ?? {}).some(metas => metas.some(meta => meta.methodName === methodName))],
    ['autocomplete', getAutocompleteHandlers(prototype).some(handler => handler.methodName === methodName)],
    ['message', getMessageHandlers(prototype).some(handler => handler.method === methodName)],
    ['reaction', getReactionHandlers(prototype).some(handler => handler.method === methodName)],
    ['event', getEventHandlers(prototype).some(handler => handler.method === methodName)],
  ]
  return answers.filter(([, answered]) => answered).map(([type]) => type)
}

type Stage = Parameters<typeof appliesTo>[0]

/**
 * The guards, interceptors and observers dispatch runs for the handler, by the same `appliesTo` it uses: those for one
 * of its context types, and no interceptors for an autocomplete. Default mode lists every one, and warns once where
 * that lists more; a method no route reaches lists every one in both modes.
 */
function runStages<T extends { guards: readonly Stage[]; interceptors: readonly Stage[]; observers: readonly Stage[] }>(
  prototype: object,
  methodName: string,
  all: T,
): T {
  const types = handlerContextTypes(prototype, methodName)
  if (types.length === 0) return all
  const forTypes = (entries: readonly Stage[], among: readonly ExecutionContextType[]) =>
    entries.filter(entry => among.some(type => appliesTo(entry, type)))
  const run = {
    ...all,
    guards: forTypes(all.guards, types),
    // Autocomplete answers within three seconds and has no reply to shape, so it runs no interceptors
    interceptors: forTypes(all.interceptors, types.filter(type => type !== 'autocomplete')),
    observers: forTypes(all.observers, types),
  }
  if (strictMocks()) return run
  const handlerName = `${(prototype.constructor as { name: string }).name}.${methodName}`
  const count = (stages: T | typeof run) => stages.guards.length + stages.interceptors.length + stages.observers.length
  if (count(run) < count(all)) {
    warnOnce(
      new Logger('inspectHandler'),
      `inspectHandler() here lists the guards, interceptors and observers of every context type for ${handlerName}, ` +
        "where dispatch runs only those of its own; under useStrictMocks() it lists the ones dispatch runs.",
    )
  }
  return all
}

/**
 * The routes `methodName` answers that the class declaring it last doesn't declare for it: those it inherits, its
 * `@On` and `@Once` events among them when `events` is set.
 */
function inheritedRoutesOf(prototype: object, methodName: string, events: boolean): string[] {
  const labels = (routes: readonly HandlerRoute[]) => routes.filter(route => route.method === methodName).map(route => route.label)
  const answered = [...new Set(labels([...getHandlerRoutes(prototype), ...(events ? getEventHandlers(prototype).map(eventRoute) : [])]))]
  // The nearest class with its own decorators on the method; a class that only overrides it declares none
  for (let at: object | null = prototype; at && at !== Object.prototype; at = Object.getPrototypeOf(at) as object | null) {
    const own = labels([...getDeclaredRoutes(at), ...(events ? ownEventHandlers(at).map(eventRoute) : [])])
    if (own.length > 0) return at === prototype ? answered.filter(label => !own.includes(label)) : answered
  }
  return []
}
