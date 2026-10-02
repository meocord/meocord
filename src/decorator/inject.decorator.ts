import { inject, type ServiceIdentifier } from 'inversify'
import { type ProviderToken } from '@src/interface/provider.interface.js'
import { refuseOnClass } from '@src/util/refusal.util.js'

/**
 * Injects what a token provides into a constructor parameter.
 *
 * Use it for a value provided under a string, a symbol or a `createToken` token, such as a database pool made
 * by a factory, or to inject a different class than the parameter's type. A parameter typed as a class is
 * injected by its type, and needs no decorator.
 *
 * @param token - The token a provider in `@MeoCord({ providers })` is bound under.
 *
 * @example
 * ```ts
 * const GREETING = createToken<string>('GREETING')
 *
 * @Service()
 * export class Greeter {
 *   constructor(@Inject(GREETING) private readonly greeting: string) {}
 * }
 * ```
 *
 * @group Decorators
 * @category Params
 * @see {@link Service}
 * @see {@link createToken}
 * @see {@link https://meocord.dev/docs/4.1/services | Services}
 */
export function Inject(
  token: ProviderToken,
): (target: object, propertyKey: string | symbol | undefined, parameterIndex: number) => void {
  const decorate = inject(token as ServiceIdentifier)
  return (target, propertyKey, parameterIndex) => {
    // A constructor parameter has no property key either, but has an index
    if (typeof parameterIndex !== 'number') refuseOnClass('@Inject', target, propertyKey, 'a constructor parameter or a property')
    decorate(target, propertyKey, parameterIndex)
  }
}
