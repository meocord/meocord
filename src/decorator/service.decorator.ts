import 'reflect-metadata'
import { makeInjectable } from '@src/util/injectable.util.js'
import { deprecatedOnMethod, declaring } from '@src/util/refusal.util.js'

/**
 * Marks a class as a service, which controllers and other services inject by its type.
 *
 * Use it for logic and state that outlive one call: database access, API clients, caches, counters. The app
 * makes one instance, shared by every class that injects it; list it in `@MeoCord({ services })` when nothing
 * injects it. For a value that is not a class, such as a config object or a client made by a factory, use a
 * provider and {@link Inject}.
 *
 * @remarks
 * A service injects others through its constructor. Its `onReady` and `onShutdown` hooks run as the bot
 * starts and stops.
 *
 * @example
 * ```ts
 * @Service()
 * export class GreetingService {
 *   greet(name: string): string {
 *     return `Hello, ${name}!`
 *   }
 * }
 * ```
 *
 * @group Decorators
 * @category App
 * @see {@link Inject}
 * @see {@link https://meocord.dev/docs/4.1/services | Services}
 */
export function Service<T>() {
  return declaring(function (target: new (...args: any[]) => T, propertyKey?: string | symbol) {
    if (deprecatedOnMethod('@Service', target, propertyKey)) return
    makeInjectable(target)
  })
}
