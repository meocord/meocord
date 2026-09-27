import { MetadataKey } from '@src/enum/index.js'

/**
 * Composes several class or method decorators into one.
 *
 * Use it to give a set of stages a name of your own, such as a guard and a cooldown every staff command takes,
 * so each controller or handler applies it with one decorator.
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
    for (const decorator of decorators) {
      if (propertyKey !== undefined && descriptor !== undefined) {
        ;(decorator as MethodDecorator)(target, propertyKey, descriptor)
      } else {
        ;(decorator as ClassDecorator)(target)
      }
    }
    return descriptor
  } as any
}

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
 * Prefer {@link createMetadata}, whose decorator is typed and whose key cannot collide with another. A stage
 * reads the value with `ExecutionContext.get(key)`, the method's first, then the controller's.
 *
 * @param metadataKey - The key to store the value under.
 * @param metadataValue - The value to store.
 * @returns A decorator for a class or a method.
 * @throws Error when `metadataKey` is one MeoCord reserves, such as `'guards'`: a value there would replace
 *   what the framework stores.
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
 * @group Utilities
 * @see {@link createMetadata}
 */
export function SetMetadata<V = any>(metadataKey: string, metadataValue: V): ClassDecorator & MethodDecorator {
  if (RESERVED_KEYS.has(metadataKey)) {
    throw new Error(
      `SetMetadata cannot use the key "${metadataKey}": MeoCord stores its own metadata under it, and a value ` +
        `there would replace it. Choose another key, or declare the decorator with createMetadata, whose key is unique.`,
    )
  }
  return function (target: any, propertyKey?: string | symbol): void {
    if (propertyKey !== undefined) {
      Reflect.defineMetadata(metadataKey, metadataValue, target, propertyKey)
    } else {
      Reflect.defineMetadata(metadataKey, metadataValue, target)
    }
  } as any
}
