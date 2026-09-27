import { type FactoryProvider, type ProviderToken, type Token } from '@src/interface/index.js'

/**
 * What a token provides: a class's instance, or a `createToken` token's type; `unknown` for a string or a plain symbol.
 *
 * @group Types
 * @see {@link factoryProvider}
 */
export type Provided<K> = K extends abstract new (...args: any[]) => infer I
  ? I
  : K extends Token<infer V>
    ? unknown extends V
      ? unknown
      : V
    : unknown

/**
 * The values a factory receives for its `inject` list, in order, each what its token provides.
 *
 * @group Types
 * @see {@link factoryProvider}
 */
export type Injected<I extends readonly unknown[]> = { -readonly [K in keyof I]: Provided<I[K]> }

/**
 * Makes a factory provider whose function is typed from its `inject` list and its token.
 *
 * Use it in place of a plain `{ provide, useFactory, inject }` object, which works the same at runtime but whose
 * function TypeScript cannot type inside a list: each parameter is what the token in its place provides, and the
 * function must return what `provide` stands for.
 *
 * @param provider - The token to provide, the tokens to inject, and the function that makes the value.
 * @returns The provider, unchanged, for `@MeoCord({ providers })` or a testing module's `providers`.
 *
 * @example
 * ```ts
 * @Service()
 * class Settings { readonly databaseUrl = process.env.DATABASE_URL! }
 * class Database { constructor(readonly url: string) {} }
 * export const DATABASE = createToken<Database>('Database')
 *
 * @MeoCord({
 *   controllers: [],
 *   // settings is a Settings, and the function must return a Database
 *   providers: [factoryProvider({ provide: DATABASE, inject: [Settings], useFactory: settings => new Database(settings.databaseUrl) })],
 *   clientOptions: { intents: [GatewayIntentBits.Guilds] },
 * })
 * class App {}
 * ```
 *
 * @group Utilities
 * @see {@link FactoryProvider}
 * @see {@link createToken}
 */
export function factoryProvider<const P extends ProviderToken, const I extends readonly ProviderToken[] = []>(provider: {
  provide: P
  inject?: I
  useFactory: (...args: Injected<I>) => Provided<P> | Promise<Provided<P>>
}): FactoryProvider<Provided<P>> {
  return provider as unknown as FactoryProvider<Provided<P>>
}
