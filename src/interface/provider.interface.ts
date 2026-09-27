declare const tokenType: unique symbol

/**
 * A symbol that names a value to provide and inject, typed with what it provides, as `createToken` makes it.
 *
 * Use one for a value that is not a class instance, such as a settings object or a client from another library,
 * so `@Inject` and `TestingModule.get` know its type.
 *
 * @group Types
 * @see {@link createToken}
 */
export type Token<T> = symbol & { readonly [tokenType]?: T }

/**
 * What a provider is bound under and injected by: a class, a string, a symbol, or a typed {@link Token}.
 *
 * @group Types
 * @see {@link Provider}
 */
export type ProviderToken<T = unknown> = (abstract new (...args: any[]) => T) | string | symbol | Token<T>

/**
 * A provider that binds an existing value, such as a settings object or a configured client, as it is.
 *
 * @example
 * ```ts
 * export const SETTINGS = createToken<{ prefix: string }>('Settings')
 *
 * const settings: ValueProvider<{ prefix: string }> = { provide: SETTINGS, useValue: { prefix: '!' } }
 * ```
 *
 * @group Configuration
 * @category App options
 * @see {@link Provider}
 */
export interface ValueProvider<T = any> {
  /** The token classes inject the value by. */
  provide: ProviderToken<T>
  /** The value itself, shared by every class that injects it. */
  useValue: T
}

/**
 * A provider that binds a class's instance under a token, made once and shared, with its own dependencies injected.
 *
 * Use it to let classes inject an abstract class and receive one implementation of it, such as an in-memory store
 * in development and a database-backed one in production.
 *
 * @example
 * ```ts
 * abstract class NoteStore {
 *   abstract save(text: string): Promise<void>
 * }
 * class MemoryNoteStore extends NoteStore {
 *   readonly notes: string[] = []
 *   async save(text: string) {
 *     this.notes.push(text)
 *   }
 * }
 *
 * // A class that injects NoteStore gets the one MemoryNoteStore
 * const notes: ClassProvider<NoteStore> = { provide: NoteStore, useClass: MemoryNoteStore }
 * ```
 *
 * @group Configuration
 * @category App options
 * @see {@link Provider}
 */
export interface ClassProvider<T = any> {
  /** The token classes inject the instance by, often the abstract class it implements. */
  provide: ProviderToken<T>
  /** The class to make the instance from, whose constructor dependencies are injected. */
  useClass: new (...args: any[]) => T
}

/**
 * A provider that binds what a function returns, called once with the values of `inject`, in order.
 *
 * Use it for a value that takes work to make, such as a database connection. {@link factoryProvider} types the
 * function's parameters from `inject`, which a plain object in a list cannot.
 *
 * @remarks
 * The function may return a promise: the bot resolves every factory before it logs in and before any `onReady`
 * hook.
 *
 * @example
 * ```ts
 * class Database {
 *   constructor(readonly url: string) {}
 * }
 * export const DATABASE = createToken<Database>('Database')
 *
 * const database: FactoryProvider<Database> = { provide: DATABASE, useFactory: () => new Database(process.env.DATABASE_URL!) }
 * ```
 *
 * @group Configuration
 * @category App options
 * @see {@link factoryProvider}
 * @see {@link Provider}
 */
export interface FactoryProvider<T = any> {
  /** The token classes inject the value by. */
  provide: ProviderToken<T>
  /** Makes the value, from the values of `inject` in order; it may return a promise. */
  useFactory: (...args: any[]) => T | Promise<T>
  /** The tokens whose values the factory receives, in order. */
  inject?: ProviderToken[]
}

/**
 * A value `@MeoCord({ providers })` or a testing module binds under a token, for classes to `@Inject`.
 *
 * A class needs no provider: listing it, or injecting it, binds it. Use a provider for a value that is not a class
 * instance, for one class standing in for another, or for what a function makes.
 *
 * @group Configuration
 * @category App options
 * @see {@link ValueProvider}
 * @see {@link ClassProvider}
 * @see {@link FactoryProvider}
 */
export type Provider<T = any> = ValueProvider<T> | ClassProvider<T> | FactoryProvider<T>
