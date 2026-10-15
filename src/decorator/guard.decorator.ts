import 'reflect-metadata'
import { type GuardOptions } from '@src/interface/stage-options.interface.js'
import { type GuardInterface } from '@src/interface/index.js'
import { applyGuards, classLevelGuards, declaringPrototype, type GuardEntry, handlerMethods, recordGuards } from '@src/core/guard-runner.js'
import { makeInjectable } from '@src/util/injectable.util.js'
import { type CheckedEntry } from '@src/decorator/stage-entry.js'
import { assertStageEntries, defineStageTypes } from '@src/core/stage-scope.js'
import { META } from '@src/util/metadata-keys.js'
import { declaring, decoratedName, deprecatedOnMethod } from '@src/util/refusal.util.js'

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

  for (const key of [META.classGuards, META.inheritedGuards, META.methodGuards, META.guardWrappers]) {
    const value: unknown = Reflect.getOwnMetadata(key, owner, methodName)
    if (value !== undefined) Reflect.defineMetadata(key, Array.isArray(value) ? [...value] : value, prototype, methodName)
  }
  const baseClassGuards = (Reflect.getOwnMetadata(META.classGuards, owner, methodName) as GuardEntry[] | undefined) ?? []
  Reflect.defineMetadata(META.baseClassGuards, baseClassGuards.length, prototype, methodName)
  Reflect.defineMetadata(META.inheritedFrom, owner, prototype, methodName)
  return { ...inherited }
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
 * @param options - `types`, the context types the guard runs for; every type unless given.
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
 * @pipeline guards where `@UseGuard` or `@MeoCord({ guards })` applies it, the global ones first
 * @group Decorators
 * @category Pipeline stages
 * @see {@link UseGuard}
 * @see {@link GuardDeniedError}
 * @see {@link ExecutionContext}
 * @see {@link https://meocord.dev/docs/4.2/guards | Guards}
 */
export function Guard(
  options: GuardOptions = {},
) {
  return declaring(function (target: any, propertyKey?: string | symbol) {
    if (deprecatedOnMethod('@Guard', target, propertyKey)) return
    makeInjectable(target)
    defineStageTypes(target, options.types, 'Guard')
    Reflect.defineMetadata(META.guardClass, true, target)
  })
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
 * @see {@link https://meocord.dev/docs/4.2/guards | Guards}
 */
export function UseGuard<const T extends readonly unknown[]>(
  ...entries: { [K in keyof T]: CheckedEntry<T[K], new (...args: any[]) => GuardInterface> }
): any {
  const guards = entries as unknown as GuardEntry[]
  return declaring(function (target: any, propertyKey?: string | symbol, descriptor?: PropertyDescriptor) {
    const where = decoratedName(target, propertyKey)
    assertStageEntries('@UseGuard', 'guard', where, guards)
    if (descriptor && propertyKey) {
      // Method Decorator
      applyGuards(descriptor, target, String(propertyKey))
      recordGuards(META.methodGuards, guards, target, String(propertyKey))
    } else if (typeof target === 'function' && !propertyKey && !descriptor) {
      // Class Decorator
      const prototype = target.prototype

      const methods = handlerMethods(prototype)
      const existing = classLevelGuards(target)
      Reflect.defineMetadata(META.classLevelGuards, [...guards, ...existing], target)

      for (const methodName of methods) {
        const methodDescriptor = ownHandlerDescriptor(prototype, methodName)
        if (methodDescriptor) {
          applyGuards(methodDescriptor, prototype, methodName)
          Object.defineProperty(prototype, methodName, methodDescriptor)
          recordGuards(META.classGuards, guards, prototype, methodName)
        }
      }
    }
  })
}
