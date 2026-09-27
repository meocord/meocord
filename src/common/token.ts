import { type Token } from '@src/interface/provider.interface.js'

/**
 * Creates a token to provide and inject a value by, typed with what it provides.
 *
 * Use one for a value that is not a class instance, such as a settings object, so `@Inject(TOKEN)` and
 * `TestingModule.get(TOKEN)` know its type. A class is its own token and needs none.
 *
 * @remarks
 * A token is a symbol, so two tokens with the same description stay distinct, and its description names it in
 * errors.
 *
 * @param description - A name for the token, shown in errors and logs.
 * @returns A new token.
 *
 * @example
 * ```ts
 * export const SETTINGS = createToken<{ prefix: string }>('Settings')
 *
 * @Service()
 * export class GreetingService {
 *   constructor(@Inject(SETTINGS) private readonly settings: { prefix: string }) {}
 * }
 *
 * @MeoCord({
 *   controllers: [],
 *   services: [GreetingService],
 *   providers: [{ provide: SETTINGS, useValue: { prefix: '!' } }],
 *   clientOptions: { intents: [GatewayIntentBits.Guilds] },
 * })
 * class App {}
 * ```
 *
 * @group Utilities
 * @see {@link Token}
 * @see {@link Provider}
 */
export function createToken<T>(description: string): Token<T> {
  return Symbol(description) as Token<T>
}
