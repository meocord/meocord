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
 * Use it for what a handler requires, such as the roles a command needs, which any guard can read. To configure
 * one use of a guard instead, give it `{ provide, params }`.
 *
 * @remarks
 * A method's value wins over its controller's. Stages read it with `ExecutionContext.get(decorator)`, and its key
 * is unique, so two decorators never collide.
 *
 * @param description - A name for the key, shown when the key is logged.
 * @returns A decorator that attaches its value, and the key stages read it by.
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
 *     const roles = interaction.inCachedGuild() ? interaction.member.roles.cache : undefined
 *     return (this.context.get(Roles) ?? []).every(id => roles?.has(id))
 *   }
 * }
 * // On a handler or a controller: @Roles(['123456789012345678'])
 * ```
 *
 * @group Utilities
 * @see {@link ExecutionContext}
 * @see {@link https://meocord.dev/docs/4.1/guards | Guards}
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
