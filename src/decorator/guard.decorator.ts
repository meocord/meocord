import 'reflect-metadata'
import { type GuardInterface } from '@src/interface/index.js'
import { MetadataKey } from '@src/enum/index.js'
import {
  CLASS_LEVEL_GUARDS,
  classChain,
  classLevelGuards,
  consumeDispatchMark,
  declaringPrototype,
  GUARD_CLASS,
  GUARD_WRAPPERS,
  handlerMethods,
  INHERITED_FROM,
  METHOD_GUARDS,
  type GuardEntry,
  runDirectCall,
} from '@src/core/guard-runner.js'
import { makeInjectable } from '@src/util/injectable.util.js'
import { type CheckedEntry } from '@src/decorator/stage-entry.js'
import { assertStageEntries, defineStageTypes } from '@src/core/stage-scope.js'
import { type ExecutionContextType } from '@src/common/execution-context.js'

/** The guards a class-level `@UseGuard` applies to one method, in the order they run. */
const CLASS_GUARDS = Symbol('class_guards')

/** The guards of the classes a class extends that `@Controller` applies to one of its own handlers. */
const INHERITED_GUARDS = Symbol('inherited_guards')

/**
 * Adds guards to a method's class or method list, then republishes the effective list under
 * `MetadataKey.Guards`. The latest decorator wraps outermost, so its guards run first.
 */
function recordGuards(key: symbol, guards: GuardEntry[], prototype: object, methodName: string): void {
  const existing: GuardEntry[] = Reflect.getOwnMetadata(key, prototype, methodName) ?? []
  Reflect.defineMetadata(key, [...guards, ...existing], prototype, methodName)

  const [classGuards, inheritedGuards, methodGuards] = [CLASS_GUARDS, INHERITED_GUARDS, METHOD_GUARDS].map(
    list => (Reflect.getOwnMetadata(list, prototype, methodName) as GuardEntry[] | undefined) ?? [],
  )
  Reflect.defineMetadata(MetadataKey.Guards, [...classGuards, ...inheritedGuards, ...methodGuards], prototype, methodName)
}

/**
 * Wraps a method so a direct call runs its guards first: the wrapper entered first runs the whole
 * chain dispatch resolves for the handler, and lets the ones inside it through. A call from dispatch,
 * which has already run the guards, passes through every wrapper.
 */
function applyGuards(descriptor: PropertyDescriptor, prototype: object, propertyKey: string) {
  const originalMethod = descriptor.value

  descriptor.value = async function (this: object, ...args: unknown[]) {
    if (consumeDispatchMark(args[0], this, propertyKey)) return originalMethod.apply(this, args)
    return runDirectCall(this, propertyKey, args, () => originalMethod.apply(this, args))
  }

  const wrappers: number = Reflect.getOwnMetadata(GUARD_WRAPPERS, prototype, propertyKey) ?? 0
  Reflect.defineMetadata(GUARD_WRAPPERS, wrappers + 1, prototype, propertyKey)
}

/**
 * The class's own descriptor for a handler. An inherited handler gets one that calls the inherited
 * method, starting from its guard lists and wrapper count, so class guards wrap it like an own method.
 */
function ownHandlerDescriptor(prototype: object, methodName: string): PropertyDescriptor | undefined {
  const own = Object.getOwnPropertyDescriptor(prototype, methodName)
  if (own) return own

  const owner = declaringPrototype(prototype, methodName)
  const inherited = owner && Object.getOwnPropertyDescriptor(owner, methodName)
  if (!owner || typeof inherited?.value !== 'function') return undefined

  for (const key of [CLASS_GUARDS, INHERITED_GUARDS, METHOD_GUARDS, GUARD_WRAPPERS]) {
    const value: unknown = Reflect.getOwnMetadata(key, owner, methodName)
    if (value !== undefined) Reflect.defineMetadata(key, Array.isArray(value) ? [...value] : value, prototype, methodName)
  }
  Reflect.defineMetadata(INHERITED_FROM, owner, prototype, methodName)
  return { ...inherited }
}

/**
 * Gives each handler a controller declares itself the class-level guards of the classes it extends,
 * as its inherited handlers have: recorded under `MetadataKey.Guards`, and wrapped so a direct call
 * runs them when no other guard wraps the handler. `@Controller` calls this.
 */
export function guardOwnHandlersWithBaseGuards(target: abstract new (...args: any[]) => unknown): void {
  const prototype = target.prototype as object
  for (const methodName of handlerMethods(prototype)) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, methodName)
    // Inherited handlers have the chain of the class that declares them
    if (typeof descriptor?.value !== 'function' || Reflect.getOwnMetadata(INHERITED_FROM, prototype, methodName)) continue
    const guards = classChain(prototype, prototype).slice(1).flatMap(classLevelGuards)
    if (guards.length === 0) continue
    if (!Reflect.getOwnMetadata(GUARD_WRAPPERS, prototype, methodName)) {
      applyGuards(descriptor, prototype, methodName)
      Object.defineProperty(prototype, methodName, descriptor)
    }
    recordGuards(INHERITED_GUARDS, guards, prototype, methodName)
  }
}

/**
 * Marks a class as a guard, which decides whether a handler runs.
 *
 * Use it on a class that implements `GuardInterface`, then apply the class with {@link UseGuard} or
 * `@MeoCord({ guards })`. For facts about the handler a guard reads, use `createMetadata`; to limit how
 * often a handler runs, use {@link Cooldown} instead.
 *
 * @remarks
 * `canActivate` returns `true` to let the call through and `false` to stop it silently; throwing
 * `GuardDeniedError` tells the user why. A new instance is made for every call unless the guard is bound
 * once, in `services` or `providers`, when each call still reads its own `params`.
 *
 * @throws Error when `types` is empty, as the decorator applies.
 *
 * @example
 * ```ts
 * @Guard({ types: ['interaction'] })
 * export class OwnerOnlyGuard implements GuardInterface {
 *   canActivate(interaction: ButtonInteraction, { ownerId }: { ownerId: string }): boolean {
 *     return interaction.user.id === ownerId
 *   }
 * }
 * ```
 *
 * @group Decorators
 * @category Pipeline stages
 * @see {@link UseGuard}
 * @see {@link GuardDeniedError}
 * @see {@link ExecutionContext}
 * @see {@link https://meocord.dev/docs/latest/guards | Guards}
 */
export function Guard(
  options: {
    /**
     * The context types the guard runs for, as `ExecutionContext.getType()` reports them; it is skipped for
     * any other call. A subclass inherits them unless it declares its own. A global guard also runs before
     * `@On` handlers, so one that reads an interaction declares `['interaction']`.
     *
     * @defaultValue every type
     */
    types?: readonly ExecutionContextType[]
  } = {},
) {
  return function (target: any) {
    makeInjectable(target)
    defineStageTypes(target, options.types, 'Guard')
    Reflect.defineMetadata(GUARD_CLASS, true, target)
  }
}

/**
 * Runs guards before a handler, or before every handler of a controller.
 *
 * Use it to decide whether a call may run at all: who may use a command, where, or on whose message. To
 * limit how often a handler runs, use {@link Cooldown}; to check its input, {@link Validate}.
 *
 * @remarks
 * The handler runs only when every guard allows the call. On a controller, the guards apply to every
 * handler it declares or inherits and to every handler of a class that extends it. A guard that declares
 * `declare readonly params?: P` has its `params` checked against `P` when the code compiles.
 *
 * @param entries - Guard classes, or `{ provide, params? }` to give one use of a guard its params.
 * @throws Error when an entry is neither a guard class nor `{ provide, params? }`, as the decorator applies.
 *
 * @example
 * ```ts
 * @Command('trade', CommandType.SLASH)
 * @UseGuard(StaffGuard, { provide: ChannelGuard, params: { channelIds: ['123456789012345678'] } })
 * async trade(interaction: ChatInputCommandInteraction) {
 *   await respond(interaction).send('Trade opened.')
 * }
 * ```
 *
 * @pipeline guards after the global guards from `@MeoCord({ guards })`, a controller's before a method's
 * @group Decorators
 * @category Pipeline stages
 * @see {@link Guard}
 * @see {@link GuardDeniedError}
 * @see {@link ExecutionContext}
 * @see {@link https://meocord.dev/docs/latest/guards | Guards}
 */
export function UseGuard<const T extends readonly unknown[]>(
  ...entries: { [K in keyof T]: CheckedEntry<T[K], new (...args: any[]) => GuardInterface> }
): any {
  const guards = entries as unknown as GuardEntry[]
  return function (target: any, propertyKey?: string | symbol, descriptor?: PropertyDescriptor) {
    const where = propertyKey === undefined ? String(target?.name) : `${target.constructor.name}.${String(propertyKey)}`
    assertStageEntries('@UseGuard', 'guard', where, guards)
    if (descriptor && propertyKey) {
      // Method Decorator
      applyGuards(descriptor, target, String(propertyKey))
      recordGuards(METHOD_GUARDS, guards, target, String(propertyKey))
    } else if (typeof target === 'function' && !propertyKey && !descriptor) {
      // Class Decorator
      const prototype = target.prototype

      const methods = handlerMethods(prototype)
      const existing = classLevelGuards(target)
      Reflect.defineMetadata(CLASS_LEVEL_GUARDS, [...guards, ...existing], target)

      for (const methodName of methods) {
        const methodDescriptor = ownHandlerDescriptor(prototype, methodName)
        if (methodDescriptor) {
          applyGuards(methodDescriptor, prototype, methodName)
          Object.defineProperty(prototype, methodName, methodDescriptor)
          recordGuards(CLASS_GUARDS, guards, prototype, methodName)
        }
      }
    }
  }
}
