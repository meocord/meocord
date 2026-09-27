import 'reflect-metadata'

/**
 * A typed metadata decorator, made by {@link createMetadata}.
 *
 * Call it with a value to decorate a controller or a handler, and pass it to `ExecutionContext.get` to read
 * the value back.
 *
 * @group Types
 * @see {@link createMetadata}
 */
export interface MetadataDecorator<T> {
  /** Attaches `value` to the decorated class or method. */
  (value: T): ClassDecorator & MethodDecorator

  /** The unique key the value is stored under. */
  readonly key: symbol
}

/**
 * Creates a typed decorator for facts about a handler that guards and other stages read.
 *
 * Use it for what a handler requires rather than how one use of a guard is configured: the roles a command
 * needs, say, which any guard can read. To configure one use of a guard, give it `params` with
 * `{ provide, params }` instead.
 *
 * @remarks
 * On a controller, the value applies to every handler; on a method, to that handler, over the controller's.
 * Stages read it with `ExecutionContext.get(decorator)`. Its key is unique, so two decorators never collide.
 *
 * @param description - A name for the key, shown when the key is logged.
 * @returns A decorator that takes the value to attach.
 *
 * @example
 * ```ts
 * export const Roles = createMetadata<string[]>('roles')
 *
 * @Guard()
 * export class RolesGuard implements GuardInterface {
 *   constructor(private readonly context: ExecutionContext) {}
 *
 *   canActivate(interaction: ChatInputCommandInteraction): boolean {
 *     const required = this.context.get(Roles) ?? []
 *     return required.length === 0 || (interaction.inCachedGuild() && required.some(id => interaction.member.roles.cache.has(id)))
 *   }
 * }
 * ```
 *
 * @group Utilities
 * @see {@link ExecutionContext}
 * @see {@link applyDecorators}
 * @see {@link https://meocord.dev/docs/latest/guards | Guards}
 */
export function createMetadata<T>(description?: string): MetadataDecorator<T> {
  const key = Symbol(description)

  const decorator = (value: T): ClassDecorator & MethodDecorator =>
    function (target: object, propertyKey?: string | symbol): void {
      if (propertyKey !== undefined) {
        Reflect.defineMetadata(key, value, target, propertyKey)
      } else {
        Reflect.defineMetadata(key, value, target)
      }
    } as ClassDecorator & MethodDecorator

  return Object.assign(decorator, { key }) as MetadataDecorator<T>
}
