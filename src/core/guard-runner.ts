import 'reflect-metadata'
import { AsyncLocalStorage } from 'node:async_hooks'
import { checkOnFirstUse } from '@src/core/startup-checked.js'
import { Container, LazyServiceIdentifier } from 'inversify'
import { type GuardInterface } from '@src/interface/index.js'
import { MetadataKey } from '@src/enum/index.js'
import {
  ExecutionContext,
  type ExecutionContextType,
  type CurrentArgs,
  HandlerExecutionContext,
  inferContextType,
  UnroutedExecutionContext,
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
import { META, type MetaKey } from '@src/util/metadata-keys.js'
import { wrapsMethod } from '@src/util/method-wrapper.util.js'

export type GuardClass = new (...args: any[]) => GuardInterface

/** A guard class, and the properties set on its instance before `canActivate` runs. */
export interface GuardWithParams {
  /** The guard class to resolve. */
  provide: GuardClass

  /** Properties assigned to the guard instance; none when omitted. */
  params?: Record<string, any>
}

export type GuardEntry = GuardClass | GuardWithParams

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
 * Whether a class's constructor takes more parameters than the types inversify will read for it: its recorded
 * `design:paramtypes`, its own or a decorated base's, and its `@Inject` tokens, as for a class with no decorator. A
 * parameter with a default value and a rest parameter are not in `length`, so they are not asked for.
 */
export function undecoratedConstructor(cls: abstract new (...args: any[]) => unknown): boolean {
  const types = (Reflect.getMetadata(MetadataKey.ParamTypes, cls) as unknown[] | undefined) ?? []
  const metadata = Reflect.getMetadata(INVERSIFY_CLASS_METADATA, cls) as { constructorArguments?: (InjectedElement | null | undefined)[] } | undefined
  return Array.from({ length: Math.max(cls.length - types.length, 0) }, (_, index) => metadata?.constructorArguments?.[types.length + index]?.value).some(
    token => token === undefined,
  )
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
function resolveGuard(container: Container, guard: GuardClass, context: HandlerExecutionContext | UnroutedExecutionContext): GuardInterface {
  if (!container.isBound(guard)) checkOnFirstUse(container, guard)
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

/**
 * One guarded call: the container guards resolve from, and what the context describes. A call no handler
 * takes, such as the built-in help, has no controller or method, and its guards get an unrouted context.
 */
export interface GuardedCall {
  container: Container
  controller?: new (...args: any[]) => unknown
  methodName?: string
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

  const { container, controller, methodName, ...handlerCall } = call
  const context =
    controller && methodName !== undefined
      ? new HandlerExecutionContext({ ...handlerCall, controller, methodName, type })
      : new UnroutedExecutionContext(call.args)

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
        `Guard ${guardClass.name}${methodName === undefined ? '' : ` applied to ${methodName}`} does not have a valid canActivate method.`,
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

/** The prototype on the chain that declares `methodName`, which is the function dispatch calls. */
export function declaringPrototype(prototype: object, methodName: string): object | undefined {
  for (let current: object | null = prototype; current; current = Object.getPrototypeOf(current)) {
    if (Object.prototype.hasOwnProperty.call(current, methodName)) return current
  }
  return undefined
}

/**
 * The prototype that declares the handler as written, looking through methods a class-level
 * `@UseGuard` re-declared on a subclass to wrap an inherited handler.
 */
export function sourcePrototype(prototype: object, methodName: string): object | undefined {
  let owner = declaringPrototype(prototype, methodName)
  while (owner) {
    const from = Reflect.getOwnMetadata(META.inheritedFrom, owner, methodName) as object | undefined
    if (!from) return owner
    owner = declaringPrototype(from, methodName)
  }
  return undefined
}

/**
 * The prototypes on the chain that declare `methodName` as written, base first: the handler and each override of it,
 * looking through methods a class-level `@UseGuard` re-declared to wrap an inherited handler. A handler's method-level
 * stages are read from each, so an override keeps its base method's, as it keeps its route.
 */
export function stageOwners(prototype: object, methodName: string): object[] {
  const owners: object[] = []
  for (let current: object | null = prototype; current && current !== Object.prototype; current = Object.getPrototypeOf(current)) {
    if (!Object.prototype.hasOwnProperty.call(current, methodName)) continue
    if (!Reflect.getOwnMetadata(META.inheritedFrom, current, methodName)) owners.push(current)
  }
  return owners.reverse()
}

/** The entries a method-level stage lists under `key` on each of a handler's {@link stageOwners}, base first. */
export function methodStages<T>(prototype: object, methodName: string, key: MetaKey): T[] {
  return stageOwners(prototype, methodName).flatMap(owner => (Reflect.getOwnMetadata(key, owner, methodName) as T[] | undefined) ?? [])
}

/** The value a method-level stage holds under `key` on the nearest of a handler's {@link stageOwners} that declares one. */
export function nearestMethodStage<T>(prototype: object, methodName: string, key: MetaKey): T | undefined {
  for (const owner of stageOwners(prototype, methodName).reverse()) {
    const value = Reflect.getOwnMetadata(key, owner, methodName) as T | undefined
    if (value !== undefined) return value
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
    if (declared && Reflect.getOwnMetadata(META.inheritStages, cls) === false) break
  }
  return classes
}

/** The guards a class-level `@UseGuard` declares on `cls`. */
export function classLevelGuards(cls: StageClass): GuardEntry[] {
  return (Reflect.getOwnMetadata(META.classLevelGuards, cls) as GuardEntry[] | undefined) ?? []
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
  if (!sourcePrototype(prototype, methodName)) return []
  return [
    ...(handlerMethods(prototype).has(methodName) ? stageClasses(prototype, methodName).flatMap(classLevelGuards) : []),
    ...methodStages<GuardEntry>(prototype, methodName, META.methodGuards),
  ]
})

/**
 * The type a direct call to a handler runs as, which is the one dispatch gives it: `'event'` for an `@On` or `@Once`
 * handler, as its first argument may be a message or an interaction; otherwise read from the first argument.
 */
const directCallType = perHandler((prototype: object, methodName: string): ExecutionContextType | undefined => {
  if (!getEventHandlers(prototype).some(handler => handler.method === methodName)) return undefined
  const routed = [
    ...Object.values(getCommandMap(prototype) ?? {})
      .flat()
      .map(command => command.methodName),
    ...getMessageHandlers(prototype).map(handler => handler.method),
    ...getReactionHandlers(prototype).map(handler => handler.method),
    ...getAutocompleteHandlers(prototype).map(handler => handler.methodName),
  ]
  // A method dispatch also routes as a command, message or reaction has no one type
  return routed.includes(methodName) ? undefined : 'event'
})

/** Whether `@UseGuard` wraps the method anywhere on the chain, an override's base included. */
const isWrapped = perHandler((prototype: object, methodName: string): boolean => {
  for (let current: object | null = prototype; current; current = Object.getPrototypeOf(current)) {
    if (Object.prototype.hasOwnProperty.call(current, methodName) && Reflect.getOwnMetadata(META.guardWrappers, current, methodName)) return true
  }
  return false
})

/**
 * A call whose guards have run. Each wrapper it enters lets it through once, an overridden one reached through `super`
 * included; entering one again is a new call, as when the handler calls itself, and runs the guards again.
 */
interface GuardedPass {
  instance: object
  methodName: string
  first: unknown
  entered: Set<object>
  open: boolean
}

/**
 * The pass of the guarded call running. Kept per call, so a concurrent call with the same object and method runs its own
 * guards, and closed when the call returns, so work it leaves running, such as a timer, does not carry it.
 */
const guardedPasses = new AsyncLocalStorage<GuardedPass>()

/** Takes the pass for `wrapper` when it belongs to a call whose guards have already run and has not let it through yet. */
export function takeGuardedPass(wrapper: object, first: unknown, instance: object, methodName: string): boolean {
  const pass = guardedPasses.getStore()
  if (!pass?.open || pass.instance !== instance || pass.methodName !== methodName || pass.first !== first) return false
  if (pass.entered.has(wrapper)) return false
  pass.entered.add(wrapper)
  return true
}

/** Runs a call whose guards have run, with its pass; `wrapper` is the one that ran them, which it has entered. */
async function runWithPass(
  instance: object,
  methodName: string,
  args: readonly unknown[],
  call: () => unknown,
  wrapper?: object,
): Promise<unknown> {
  const pass: GuardedPass = { instance, methodName, first: args[0], entered: new Set(wrapper ? [wrapper] : []), open: true }
  try {
    return await guardedPasses.run(pass, call)
  } finally {
    pass.open = false
  }
}

/**
 * Adds guards to a method's class or method list, then republishes the effective list under
 * `META.guards`, in the order they run: the bases' before the class's own, and within one class or method the
 * latest decorator first, since it wraps outermost.
 */
export function recordGuards(key: MetaKey, guards: GuardEntry[], prototype: object, methodName: string): void {
  const existing: GuardEntry[] = Reflect.getOwnMetadata(key, prototype, methodName) ?? []
  const bases: number = key === META.classGuards ? (Reflect.getOwnMetadata(META.baseClassGuards, prototype, methodName) ?? 0) : 0
  Reflect.defineMetadata(key, [...existing.slice(0, bases), ...guards, ...existing.slice(bases)], prototype, methodName)

  const [classGuards, inheritedGuards] = [META.classGuards, META.inheritedGuards].map(
    list => (Reflect.getOwnMetadata(list, prototype, methodName) as GuardEntry[] | undefined) ?? [],
  )
  // The method's guards and those of the methods it overrides, base first, as dispatch runs them
  const methodGuards = methodStages<GuardEntry>(prototype, methodName, META.methodGuards)
  Reflect.defineMetadata(META.guards, [...inheritedGuards, ...classGuards, ...methodGuards], prototype, methodName)
}

/** The classes {@link guardOwnHandlersWithBaseGuards} has handled, as `@Controller` and each app's startup both call it. */
const guardedWithBases = new WeakSet<object>()

/**
 * Gives each handler a class declares itself the class-level guards of the classes it extends,
 * as its inherited handlers have: recorded under `META.guards`, and wrapped so a direct call
 * runs them when no other guard wraps the handler. `@Controller` calls this as it decorates, and
 * {@link prepareDirectCalls} for every class an app runs, a service included. Once per class.
 */
export function guardOwnHandlersWithBaseGuards(target: abstract new (...args: any[]) => unknown): void {
  if (guardedWithBases.has(target)) return
  guardedWithBases.add(target)
  const prototype = target.prototype as object
  for (const methodName of handlerMethods(prototype)) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, methodName)
    // Inherited handlers have the chain of the class that declares them
    if (typeof descriptor?.value !== 'function' || Reflect.getOwnMetadata(META.inheritedFrom, prototype, methodName)) continue
    // Base first, as dispatch runs them
    const guards = classChain(prototype, prototype).slice(1).reverse().flatMap(classLevelGuards)
    if (guards.length === 0) continue
    if (!Reflect.getOwnMetadata(META.guardWrappers, prototype, methodName)) {
      applyGuards(descriptor, prototype, methodName)
      Object.defineProperty(prototype, methodName, descriptor)
    }
    recordGuards(META.inheritedGuards, guards, prototype, methodName)
  }
}

/** The container that made each instance, so a direct call runs in its own app or testing module. */
const instanceContainers = new WeakMap<object, Container>()

/**
 * Readies direct calls to the handlers of the classes an app or testing module runs, controllers and services alike:
 * - stamps each class with the container, and records each instance the container makes as its own, so two testing
 *   modules made from one class each run a direct call on their own instance in themselves;
 * - gives each handler a class declares itself the class-level guards of the classes it extends, and wraps each
 *   override of a guarded handler, so a direct call to it runs the guards it inherits before its body.
 */
export function prepareDirectCalls(container: Container, classes: readonly (new (...args: any[]) => unknown)[]): void {
  for (const cls of classes) {
    Reflect.defineMetadata(META.container, container, cls)
    // Each class on the chain, base first, so an override above the one the app runs is wrapped too
    for (const owner of classesOf(cls).reverse()) guardOwnHandlersWithBaseGuards(owner)
    wrapGuardedOverrides(cls.prototype as object)
    container.onActivation(cls, (_context, instance) => {
      if (typeof instance === 'object' && instance !== null) instanceContainers.set(instance, container)
      return instance
    })
  }
}

/** `cls` and the classes it extends, innermost first. */
function classesOf(cls: abstract new (...args: any[]) => unknown): (abstract new (...args: any[]) => unknown)[] {
  const classes: (abstract new (...args: any[]) => unknown)[] = []
  for (let current: object | null = cls.prototype as object; current && current !== Object.prototype; current = Object.getPrototypeOf(current)) {
    classes.push(current.constructor as abstract new (...args: any[]) => unknown)
  }
  return classes
}

/** Wraps each method on the chain that overrides a handler a base method guards and is not wrapped itself. */
function wrapGuardedOverrides(prototype: object): void {
  for (const methodName of handlerMethods(prototype)) {
    let guardedBelow = false
    for (const owner of stageOwners(prototype, methodName)) {
      const descriptor = Object.getOwnPropertyDescriptor(owner, methodName)
      if (guardedBelow && typeof descriptor?.value === 'function' && !Reflect.getOwnMetadata(META.guardWrappers, owner, methodName)) {
        applyGuards(descriptor, owner, methodName)
        Object.defineProperty(owner, methodName, descriptor)
      }
      if (((Reflect.getOwnMetadata(META.methodGuards, owner, methodName) as GuardEntry[] | undefined) ?? []).length > 0) guardedBelow = true
    }
  }
}

/**
 * Wraps a method so a direct call runs its guards first: the wrapper entered first runs the whole
 * chain dispatch resolves for the handler, and lets the ones inside it through. A call from dispatch,
 * which has already run the guards, passes through every wrapper.
 */
export function applyGuards(descriptor: PropertyDescriptor, prototype: object, propertyKey: string): void {
  const originalMethod = descriptor.value as (...args: unknown[]) => unknown
  // Which wrapper a call has passed, so it passes each once
  const wrapper = {}
  descriptor.value = wrapsMethod(async function (this: object, ...args: unknown[]) {
    if (takeGuardedPass(wrapper, args[0], this, propertyKey)) return originalMethod.apply(this, args)
    return runDirectCall(this, propertyKey, args, () => originalMethod.apply(this, args), wrapper)
  }, originalMethod)

  const wrappers: number = Reflect.getOwnMetadata(META.guardWrappers, prototype, propertyKey) ?? 0
  Reflect.defineMetadata(META.guardWrappers, wrappers + 1, prototype, propertyKey)
}

/**
 * Runs a direct call to a guarded handler: the handler's guards, as dispatch resolves and types them, then
 * the call with a pass every wrapper inside the one entered takes, so no guard runs twice.
 */
export async function runDirectCall(
  instance: object,
  methodName: string,
  args: unknown[],
  call: () => unknown,
  wrapper?: object,
): Promise<unknown> {
  const prototype = Object.getPrototypeOf(instance) as object
  const controller = instance.constructor as new (...args: any[]) => unknown
  // The container that made the instance, or else the app that made the class or a class it extends: a subclass the
  // app's code makes runs as its base does
  const container = instanceContainers.get(instance) ?? (Reflect.getMetadata(META.container, controller) as Container | undefined)
  if (!container) {
    throw new Error(
      `${controller.name}.${methodName}: @UseGuard runs its guards through the app that made ${controller.name}, and this ` +
        `instance was made outside one. Inject ${controller.name}, or call it on an instance the app made.`,
    )
  }
  const type = directCallType(prototype, methodName)
  if (!(await runGuards(handlerGuards(prototype, methodName), { container, controller, methodName, args, type }))) return undefined
  return runWithPass(instance, methodName, args, call, wrapper)
}

/**
 * Calls a handler dispatch has already guarded. Its wrappers let this one call through; the pass
 * closes afterwards, so a later direct call with the same (cached) object runs its guards.
 */
export async function callGuardedHandler(
  instance: Record<string, (...args: unknown[]) => unknown>,
  methodName: string,
  args: unknown[],
): Promise<unknown> {
  if (!isWrapped(Object.getPrototypeOf(instance) as object, methodName)) return instance[methodName](...args)
  return runWithPass(instance, methodName, args, () => instance[methodName](...args))
}
