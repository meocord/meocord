import 'reflect-metadata'
import { AsyncLocalStorage } from 'node:async_hooks'
import { Container, LazyServiceIdentifier } from 'inversify'
import { type GuardInterface } from '@src/interface/index.js'
import { MetadataKey } from '@src/enum/index.js'
import {
  ExecutionContext,
  type ExecutionContextType,
  type CurrentArgs,
  HandlerExecutionContext,
  inferContextType,
} from '@src/common/execution-context.js'
import { appliesTo } from '@src/core/stage-scope.js'
import { Logger } from '@src/common/logger.js'
import { GuardDeniedError } from '@src/common/errors.js'
import {
  getAutocompleteHandlers,
  getCommandMap,
  getMessageHandlers,
  getReactionHandlers,
} from '@src/decorator/controller.decorator.js'
import { getEventHandlers } from '@src/decorator/event.decorator.js'

export type GuardClass = new (...args: any[]) => GuardInterface

/** A guard class, and the properties set on its instance before `canActivate` runs. */
export interface GuardWithParams {
  /** The guard class to resolve. */
  provide: GuardClass

  /** Properties assigned to the guard instance; none when omitted. */
  params?: Record<string, any>
}

export type GuardEntry = GuardClass | GuardWithParams

/** Private metadata: marks a class `@Guard` decorated. */
export const GUARD_CLASS = Symbol('guard_class')

/** Whether a `@UseGuard` entry is a guard with params rather than a guard class. */
export function isGuardWithParams(guard: unknown): guard is GuardWithParams {
  // Entries are checked when @UseGuard or @MeoCord applies, so an object here is always { provide, params? }
  return typeof guard === 'object'
}

/** Where inversify keeps the tokens `@inject` declares; `design:paramtypes` covers the rest. */
const INVERSIFY_CLASS_METADATA = '@inversifyjs/core/classMetadataReflectKey'

interface InjectedElement {
  value?: unknown
}

/** The tokens a class's constructor and injected properties ask for. */
export function injectedTokens(cls: object): unknown[] {
  const tokens: unknown[] = [...((Reflect.getMetadata(MetadataKey.ParamTypes, cls) as unknown[] | undefined) ?? [])]
  const metadata = Reflect.getMetadata(INVERSIFY_CLASS_METADATA, cls) as
    | { constructorArguments?: InjectedElement[]; properties?: Map<unknown, InjectedElement> }
    | undefined

  for (const element of [...(metadata?.constructorArguments ?? []), ...(metadata?.properties?.values() ?? [])]) {
    const token = element?.value instanceof LazyServiceIdentifier ? element.value.unwrap() : element?.value
    if (token !== undefined) tokens.push(token)
  }
  return tokens
}

/**
 * The position of the first constructor parameter with no runtime type and no `@Inject` token, or -1.
 * Such a parameter reads as `Object` when it is typed with an interface or an `import type`, and as
 * `Object` or `undefined` when its class's module had not finished loading, as when two classes
 * import each other.
 */
export function untypedParameter(cls: object): number {
  const types = (Reflect.getMetadata(MetadataKey.ParamTypes, cls) as unknown[] | undefined) ?? []
  const metadata = Reflect.getMetadata(INVERSIFY_CLASS_METADATA, cls) as
    | { constructorArguments?: (InjectedElement | null | undefined)[] }
    | undefined
  // Once the class is injectable, inversify records each parameter here too: an @Inject token, or the parameter's class
  const tokens = types.map((type, index) => metadata?.constructorArguments?.[index]?.value ?? type)
  return tokens.findIndex(token => token === undefined || token === Object)
}

/**
 * The error for a class resolved once and shared that asks for the per-call `ExecutionContext`,
 * which would keep the first call's context for every later one.
 */
export function singletonContextError(cls: abstract new (...args: any[]) => unknown): Error {
  return new Error(
    `${cls.name || 'A class'}: resolved once and shared, so it cannot inject ExecutionContext: it would keep ` +
      `the first call's context for every later call. Inject ExecutionContext only into guards.`,
  )
}

const needsContextCache = new WeakMap<Container, WeakMap<object, boolean>>()

/**
 * Whether resolving `cls` from `container` reaches `ExecutionContext` through classes built for the
 * call. Bound tokens are shared and resolved from the root, so the walk stops at them.
 */
function needsContext(container: Container, cls: object, seen = new Set<object>()): boolean {
  let cache = needsContextCache.get(container)
  if (!cache) needsContextCache.set(container, (cache = new WeakMap()))
  const cached = cache.get(cls)
  if (cached !== undefined) return cached

  seen.add(cls)
  const result = injectedTokens(cls).some(token => {
    if (token === ExecutionContext) return true
    if (typeof token !== 'function' || seen.has(token)) return false
    if (container.isBound(token as never)) return false
    return needsContext(container, token, seen)
  })
  cache.set(cls, result)
  return result
}

/** Resolves a guard for one call, in a child container holding the context when it needs one. */
function resolveGuard(container: Container, guard: GuardClass, context: HandlerExecutionContext): GuardInterface {
  if (!needsContext(container, guard)) {
    return container.get(guard, { autobind: true })
  }

  const child = new Container({ parent: container })
  child.bind(ExecutionContext).toConstantValue(context)
  return child.get(guard, { autobind: true })
}

/**
 * The params of the guard calls in progress, by guard instance, which a guard shared as one instance reads
 * through {@link readPerCall}. Keyed by instance, so a shared guard another one calls reads its own.
 */
const callParams = new AsyncLocalStorage<ReadonlyMap<object, Record<string, unknown>>>()

const sharedGuards = new WeakMap<Container, Map<GuardClass, boolean>>()

/**
 * Whether a guard resolves to one instance shared by every call: bound as a provider, a service or a
 * dependency, where an unbound guard is made for each call. Read before the guard is first resolved,
 * since resolving an unbound guard binds it.
 */
function isShared(container: Container, guard: GuardClass): boolean {
  let known = sharedGuards.get(container)
  if (!known) sharedGuards.set(container, (known = new Map()))
  let shared = known.get(guard)
  if (shared === undefined) known.set(guard, (shared = container.isBound(guard)))
  return shared
}

const perCallKeys = new WeakMap<object, Set<string>>()

/** Whether the class defines this property with a getter or setter, which the instance reaches through its prototype. */
const isClassAccessor = (instance: object, key: string) => !Object.prototype.hasOwnProperty.call(instance, key) && key in instance

/**
 * Makes these properties of a shared guard read the params of the call in progress, so calls that
 * overlap each see their own. Outside a call, or in one that does not give the property, it keeps its
 * own value. A property the class defines as a getter or setter is left as it is.
 */
function readPerCall(instance: object, keys: readonly string[]): void {
  let done = perCallKeys.get(instance)
  if (!done) perCallKeys.set(instance, (done = new Set()))
  for (const key of keys) {
    if (done.has(key)) continue
    done.add(key)
    if (isClassAccessor(instance, key)) continue
    let own = (instance as Record<string, unknown>)[key]
    Object.defineProperty(instance, key, {
      configurable: true,
      enumerable: true,
      get: () => {
        const call = callParams.getStore()?.get(instance)
        return call && key in call ? call[key] : own
      },
      set: (value: unknown) => {
        const call = callParams.getStore()?.get(instance)
        if (call && key in call) call[key] = value
        else own = value
      },
    })
  }
}

const logger = new Logger('Guard')
const warnedShared = new WeakMap<Container, Set<GuardClass>>()

/** Warns once per guard in each app that its params are set on the one instance every call shares, and why. */
function warnSharedParams(container: Container, guardClass: GuardClass, why: string, remedy: string): void {
  let warned = warnedShared.get(container)
  if (!warned) warnedShared.set(container, (warned = new Set()))
  if (warned.has(guardClass)) return
  warned.add(guardClass)
  logger.warn(
    `${guardClass.name} is one instance every call shares, and ${why}, so each call's params are set on that ` +
      `instance: calls that overlap can read each other's. ${remedy}, or stop binding the guard, in services, ` +
      `providers or a constructor that injects it, so each call gets its own.`,
  )
}

/** Whether each of these properties can be made to read the call's params, which a frozen or sealed instance's cannot. */
function canReadPerCall(instance: object, keys: readonly string[]): boolean {
  return keys.every(key => {
    const own = Object.getOwnPropertyDescriptor(instance, key)
    return own ? own.configurable === true : Object.isExtensible(instance) || key in instance
  })
}

/** Sets a call's params on a guard instance: each property, and the whole under `params` where the instance can take it. */
function assignParams(guardClass: GuardClass, instance: object, params: Record<string, any>): void {
  try {
    Object.assign(instance, params)
    // A sealed instance without the property takes each param but not the whole
    Reflect.set(instance, 'params', params)
  } catch (error) {
    if (!(error instanceof TypeError) || Object.isExtensible(instance)) throw error
    throw new Error(
      `${guardClass.name} cannot take the params its { provide, params } entry gives: its instance is frozen or ` +
        `sealed, so they cannot be set on it. Leave the instance open to new properties, or give the guard no params.`,
      { cause: error },
    )
  }
}

/** One guarded call: the container guards resolve from, and what the context describes. */
export interface GuardedCall {
  container: Container
  controller: new (...args: any[]) => unknown
  methodName: string
  args: readonly unknown[]
  type?: ExecutionContextType
  currentArgs?: CurrentArgs
  /** Filled with the guard that denied the call, by returning `false` or throwing `GuardDeniedError`. */
  denial?: { by?: abstract new (...args: any[]) => unknown }
}

/**
 * Runs guards in order, stopping at the first that denies.
 *
 * @returns Whether every guard allows the call.
 */
export async function runGuards(guards: readonly GuardEntry[], call: GuardedCall): Promise<boolean> {
  if (guards.length === 0) return true

  // Guards declared for other context types are skipped; with none left, no context is built
  const type = call.type ?? inferContextType(call.args[0])
  const applicable = guards.filter(guard => appliesTo(guard, type))
  if (applicable.length === 0) return true

  const { container, ...handlerCall } = call
  const context = new HandlerExecutionContext({ ...handlerCall, type })

  for (const guard of applicable) {
    const [guardClass, params] = isGuardWithParams(guard) ? [guard.provide, guard.params] : [guard, undefined]
    const shared = isShared(container, guardClass)
    const guardInstance = resolveGuard(container, guardClass, context.withParams(params))
    // Each property, and the whole under `params`, which a guard declares to have them typed. A shared
    // instance reads them from the call instead, and a call without params reads the instance's own values;
    // one frozen or sealed cannot, and takes them as a guard made for the call does.
    let callStore: Record<string, unknown> | undefined
    const perCall = params && shared ? { ...params, params } : undefined
    if (perCall && canReadPerCall(guardInstance, Object.keys(perCall))) {
      callStore = perCall
      readPerCall(guardInstance, Object.keys(perCall))
      // A param the class takes through a setter has nowhere to be kept per call: it is set on the instance
      const setters = Object.keys(perCall).filter(key => isClassAccessor(guardInstance, key))
      if (setters.length > 0) {
        warnSharedParams(container, guardClass, `takes ${setters.join(', ')} through a setter`, 'Read the param as a plain property')
        for (const key of setters) Reflect.set(guardInstance, key, perCall[key])
      }
    } else if (params) {
      assignParams(guardClass, guardInstance, params)
      // A sealed instance's properties cannot become accessors, so nothing can keep its calls apart
      if (shared) warnSharedParams(container, guardClass, 'its instance is sealed', 'Leave the instance unsealed')
    } else if (shared && perCallKeys.has(guardInstance)) {
      callStore = {}
    }

    if (typeof guardInstance.canActivate !== 'function') {
      throw new Error(
        `Guard ${guardClass.name} applied to ${call.methodName} does not have a valid canActivate method.`,
      )
    }

    let allowed: boolean
    try {
      const args = call.args as Parameters<GuardInterface['canActivate']>
      if (callStore) {
        // The calls already in progress keep theirs, as when one guard calls another
        const store = new Map(callParams.getStore())
        store.set(guardInstance, callStore)
        allowed = await callParams.run(store, () => guardInstance.canActivate(...args))
      } else {
        allowed = await guardInstance.canActivate(...args)
      }
    } catch (error) {
      if (error instanceof GuardDeniedError && call.denial) call.denial.by = guardClass
      throw error
    }
    if (!allowed) {
      if (call.denial) call.denial.by = guardClass
      return false
    }
  }
  return true
}

/** Private metadata: how many guard wrappers `@UseGuard` and `@Controller` put around one method. */
export const GUARD_WRAPPERS = Symbol('guard_wrappers')

/** The prototype on the chain that declares `methodName`, which is the function dispatch calls. */
export function declaringPrototype(prototype: object, methodName: string): object | undefined {
  for (let current: object | null = prototype; current; current = Object.getPrototypeOf(current)) {
    if (Object.prototype.hasOwnProperty.call(current, methodName)) return current
  }
  return undefined
}

/** Private metadata: the prototype whose method a class-level `@UseGuard` re-declared on a subclass. */
export const INHERITED_FROM = Symbol('inherited_from')

/**
 * The prototype that declares the handler as written, looking through methods a class-level
 * `@UseGuard` re-declared on a subclass to wrap an inherited handler.
 */
export function sourcePrototype(prototype: object, methodName: string): object | undefined {
  let owner = declaringPrototype(prototype, methodName)
  while (owner) {
    const from = Reflect.getOwnMetadata(INHERITED_FROM, owner, methodName) as object | undefined
    if (!from) return owner
    owner = declaringPrototype(from, methodName)
  }
  return undefined
}

/**
 * Caches a function of a class's prototype and one of its handlers. Handler metadata is fixed once
 * the classes are decorated, so dispatch resolves each handler's stages once, not on every call.
 */
export function perHandler<T>(resolve: (prototype: object, methodName: string) => T): (prototype: object, methodName: string) => T {
  const cache = new WeakMap<object, Map<string, T>>()
  return (prototype, methodName) => {
    let byMethod = cache.get(prototype)
    if (!byMethod) cache.set(prototype, (byMethod = new Map()))
    if (!byMethod.has(methodName)) byMethod.set(methodName, resolve(prototype, methodName))
    return byMethod.get(methodName)!
  }
}

/** Private metadata: `false` when `@Controller({ inheritStages: false })` stops class stages at this class. */
export const INHERIT_STAGES = Symbol('inherit_stages')

/** Private metadata: the guards a class-level `@UseGuard` declares, kept on the class. */
export const CLASS_LEVEL_GUARDS = Symbol('class_level_guards')

/** Private metadata: the guards method-level `@UseGuard` applies to one method, in the order they run. */
export const METHOD_GUARDS = Symbol('method_guards')

/** A class a handler's class-level stages are read from. */
export type StageClass = abstract new (...args: any[]) => unknown

/**
 * The classes whose class-level stages apply to a handler, outermost first: the top of the chain down to the class it
 * is dispatched on, cut above a class with `@Controller({ inheritStages: false })` at or above the declaring one, so a
 * base wraps everything that extends it, as global stages wrap controllers. Guards, interceptors and cooldowns go in
 * this order; filters are tried in reverse.
 */
export const stageClasses = perHandler(
  (prototype: object, methodName: string): readonly StageClass[] => {
    const source = sourcePrototype(prototype, methodName)
    return source ? classChain(prototype, source).reverse() : []
  },
)

/**
 * The classes of {@link stageClasses}, innermost first and uncached, for a handler `source` declares: read while classes
 * are still being decorated.
 */
export function classChain(prototype: object, source: object): StageClass[] {
  const classes: StageClass[] = []
  let declared = false
  for (let current: object | null = prototype; current && current !== Object.prototype; current = Object.getPrototypeOf(current)) {
    const cls = current.constructor as StageClass
    classes.push(cls)
    if (current === source) declared = true
    if (declared && Reflect.getOwnMetadata(INHERIT_STAGES, cls) === false) break
  }
  return classes
}

/** The guards a class-level `@UseGuard` declares on `cls`. */
export function classLevelGuards(cls: StageClass): GuardEntry[] {
  return (Reflect.getOwnMetadata(CLASS_LEVEL_GUARDS, cls) as GuardEntry[] | undefined) ?? []
}

/** Every handler a class declares or inherits: commands, components, messages, reactions, autocomplete and events. */
export function handlerMethods(prototype: object): Set<string> {
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
 * The guards dispatch runs before a handler: its classes' class-level guards, outermost first, then
 * the method's. A method that is no handler has only its own, since class guards apply to handlers.
 */
export const handlerGuards = perHandler((prototype: object, methodName: string): readonly GuardEntry[] => {
  const source = sourcePrototype(prototype, methodName)
  if (!source) return []
  return [
    ...(handlerMethods(prototype).has(methodName) ? stageClasses(prototype, methodName).flatMap(classLevelGuards) : []),
    ...((Reflect.getOwnMetadata(METHOD_GUARDS, source, methodName) as GuardEntry[]) ?? []),
  ]
})

const wrapperCount = perHandler((prototype: object, methodName: string): number => {
  const owner = declaringPrototype(prototype, methodName)
  return owner ? ((Reflect.getOwnMetadata(GUARD_WRAPPERS, owner, methodName) as number | undefined) ?? 0) : 0
})

/**
 * Calls dispatch has already guarded, keyed by first argument and method, counting the wrappers still
 * to pass. A user decorator that awaits between two wrappers leaves a pass pending during that await,
 * which a concurrent direct call with the same object and method could take; other overlaps fail closed.
 * An event whose first argument is not an object, such as `debug`'s string, is keyed by the instance.
 */
const dispatched = new WeakMap<object, Map<string, number>>()

/** The object a call's dispatch mark is kept on: its first argument, or the instance when that is not an object. */
function markKey(first: unknown, instance: object): object {
  return typeof first === 'object' && first !== null ? first : instance
}

/** Takes one pass for the wrapper being entered, if dispatch left one for this call. */
export function consumeDispatchMark(first: unknown, instance: object, methodName: string): boolean {
  const marks = dispatched.get(markKey(first, instance))
  const remaining = marks?.get(methodName)
  if (!marks || !remaining) return false

  if (remaining > 1) marks.set(methodName, remaining - 1)
  else marks.delete(methodName)
  return true
}

/**
 * Runs a direct call to a guarded handler: the handler's guards, as dispatch resolves them, then the
 * call with a pass for each wrapper inside the one entered, so no guard runs twice.
 */
export async function runDirectCall(
  instance: object,
  methodName: string,
  args: unknown[],
  call: () => unknown,
): Promise<unknown> {
  const prototype = Object.getPrototypeOf(instance) as object
  const controller = instance.constructor as new (...args: any[]) => unknown
  const container = Reflect.getMetadata(MetadataKey.Container, controller) as Container
  if (!(await runGuards(handlerGuards(prototype, methodName), { container, controller, methodName, args }))) return undefined

  const inner = wrapperCount(prototype, methodName) - 1
  if (inner <= 0) return call()
  const key = markKey(args[0], instance)
  let marks = dispatched.get(key)
  if (!marks) dispatched.set(key, (marks = new Map()))
  marks.set(methodName, inner)
  try {
    return await call()
  } finally {
    marks.delete(methodName)
  }
}

/**
 * Calls a handler dispatch has already guarded. Its wrappers let this one call through; the passes
 * are removed afterwards, so a later direct call with the same (cached) object runs its guards.
 */
export async function callGuardedHandler(
  instance: Record<string, (...args: unknown[]) => unknown>,
  methodName: string,
  args: unknown[],
): Promise<unknown> {
  const count = wrapperCount(Object.getPrototypeOf(instance), methodName)
  if (count === 0) return instance[methodName](...args)

  const key = markKey(args[0], instance)
  let marks = dispatched.get(key)
  if (!marks) dispatched.set(key, (marks = new Map()))
  marks.set(methodName, count)
  try {
    return await instance[methodName](...args)
  } finally {
    marks.delete(methodName)
  }
}
