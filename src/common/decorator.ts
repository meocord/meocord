import { warnDeprecated } from '@src/common/deprecation.js'
import { Logger } from '@src/common/logger.js'
import { MetadataKey } from '@src/enum/index.js'
import { decoratedName, refuse } from '@src/util/refusal.util.js'

/**
 * Composes several class or method decorators into one.
 *
 * Use it to give a set of stages a name of your own, such as a guard and a cooldown every staff command takes,
 * so each controller or handler applies it with one decorator.
 *
 * @remarks
 * The decorators apply as they would stacked in the order written: `applyDecorators(A, B)` is `@A @B`, so `B` applies
 * first and `A` last, and guards run in the order listed. A method or class a decorator returns in place of the one it
 * was given, as a wrapping decorator does, is what the next decorator, and TypeScript, receive.
 *
 * @param decorators - The decorators, in the order they would be written stacked.
 * @returns One decorator for a class or a method.
 *
 * @example
 * ```ts
 * export const StaffOnly = () => applyDecorators(UseGuard(StaffGuard), Cooldown({ seconds: 5 }))
 *
 * @Controller()
 * @StaffOnly()
 * export class ModerationController {}
 * ```
 *
 * @group Utilities
 * @see {@link createMetadata}
 * @see {@link https://meocord.dev/docs/4.1/custom-decorators | Custom decorators}
 */
export function applyDecorators(...decorators: (ClassDecorator | MethodDecorator)[]): ClassDecorator & MethodDecorator {
  return function (target: any, propertyKey?: string | symbol, descriptor?: PropertyDescriptor): any {
    // Last first, as TypeScript applies decorators stacked, each given what the one before it returned
    const ordered = [...decorators].reverse()
    if (propertyKey !== undefined && descriptor !== undefined) {
      let current = descriptor
      for (const decorator of ordered) current = ((decorator as MethodDecorator)(target, propertyKey, current) as PropertyDescriptor | void) ?? current
      return current
    }
    let current = target
    for (const decorator of ordered) current = (decorator as ClassDecorator)(current) ?? current
    return current
  } as any
}

const logger = new Logger('SetMetadata')

/** The keys MeoCord and inversify keep their own metadata under, which a user's value would replace. */
const RESERVED_KEYS: ReadonlySet<string> = new Set([
  MetadataKey.Injectable,
  MetadataKey.Container,
  MetadataKey.AppOptions,
  MetadataKey.ParamTypes,
  MetadataKey.Guards,
  MetadataKey.CommandType,
])

/**
 * Attaches a value to a controller or a handler under a string key of your choosing.
 *
 * A stage reads the value with `ExecutionContext.get(key)`, the method's first, then the controller's. Using it
 * logs a warning once.
 *
 * @param metadataKey - The key to store the value under.
 * @param metadataValue - The value to store.
 * @returns A decorator for a class or a method.
 * @throws Error when `metadataKey` is one MeoCord reserves, such as `'guards'`, as the decorator applies: a value
 *   there would replace what the framework stores.
 *
 * @example
 * ```ts
 * export const Roles = (...roles: string[]) => SetMetadata('roles', roles)
 *
 * @Command('ban', CommandType.SLASH)
 * @Roles('admin', 'moderator')
 * async ban(interaction: ChatInputCommandInteraction) {
 *   await respond(interaction).send('Banned.')
 * }
 * // In a guard that injects ExecutionContext: this.context.get<string[]>('roles')
 * ```
 *
 * @deprecated Since 4.1, and removed in the next major version (5.0). Use `createMetadata` instead. Its decorator is
 * typed, and its key cannot collide with another.
 *
 * @group Utilities
 * @see {@link createMetadata}
 */
export function SetMetadata<V = any>(metadataKey: string, metadataValue: V): ClassDecorator & MethodDecorator {
  warnDeprecated(logger, 'SetMetadata', 'createMetadata')
  return function (target: any, propertyKey?: string | symbol): void {
    // Checked where it applies, so the refusal names the handler or controller
    if (RESERVED_KEYS.has(metadataKey)) {
      throw refuse(
        new Error(
          `${decoratedName(target, propertyKey)}: SetMetadata cannot use the key "${metadataKey}": MeoCord stores its own ` +
            `metadata under it, and a value there would replace it. Choose another key, or declare the decorator with ` +
            `createMetadata, whose key is unique.`,
        ),
      )
    }
    if (propertyKey !== undefined) {
      Reflect.defineMetadata(metadataKey, metadataValue, target, propertyKey)
    } else {
      Reflect.defineMetadata(metadataKey, metadataValue, target)
    }
  } as any
}
