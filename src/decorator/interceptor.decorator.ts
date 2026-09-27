import 'reflect-metadata'
import { type InterceptorInterface } from '@src/interface/index.js'
import { CLASS_INTERCEPTORS, type InterceptorEntry, METHOD_INTERCEPTORS } from '@src/core/interceptor-runner.js'
import { makeInjectable } from '@src/util/injectable.util.js'
import { assertStageEntries, defineStageTypes } from '@src/core/stage-scope.js'
import { type ExecutionContextType } from '@src/common/execution-context.js'
import { type CheckedEntry } from '@src/decorator/stage-entry.js'

/**
 * Marks a class as an interceptor, which wraps a handler to act before and after it.
 *
 * Use it on a class that implements `InterceptorInterface`, then apply the class with {@link UseInterceptor}
 * or `@MeoCord({ interceptors })`: for timing, logging, caching, or turning one error into another. To stop
 * a call before it runs, use a {@link Guard}; to handle an error, an exception filter ({@link Catch}).
 *
 * @remarks
 * `intercept` continues with `next.handle()`, which resolves to what the handler returns; not calling it
 * skips the handler, and calling it twice runs the handler twice. One instance is shared by every call, so
 * it reads each use's params with `context.getParams()`.
 *
 * @throws Error when `types` is empty or only `['autocomplete']`, which interceptors never run for.
 *
 * @example
 * ```ts
 * @Interceptor({ types: ['interaction'] })
 * export class AuditInterceptor implements InterceptorInterface {
 *   async intercept(context: ExecutionContext, next: CallHandler): Promise<unknown> {
 *     const result = await next.handle()
 *     console.log(`${context.getInteraction()?.user.id} ran ${context.getHandlerName()}`)
 *     return result
 *   }
 * }
 * ```
 *
 * @group Decorators
 * @category Pipeline stages
 * @see {@link UseInterceptor}
 * @see {@link https://meocord.dev/docs/4.1/interceptors | Interceptors}
 */
export function Interceptor(
  options: {
    /**
     * The context types the interceptor runs for, as `ExecutionContext.getType()` reports them; it is skipped for
     * any other call. A subclass inherits them unless it declares its own.
     *
     * @defaultValue every type
     */
    types?: readonly ExecutionContextType[]
  } = {},
) {
  return function (target: new (...args: any[]) => InterceptorInterface) {
    makeInjectable(target)
    defineStageTypes(target, options.types, 'Interceptor')
  }
}

/**
 * Runs interceptors around a handler, or around every handler of a controller.
 *
 * Use it for work that wraps the call: measuring it, logging it, caching its result, or mapping its error.
 * To decide whether the call runs, use {@link UseGuard}; to handle an error only, {@link UseFilter}.
 *
 * @remarks
 * Interceptors run once the guards allow the call, and wrap validation, pipes, the cooldown count and the
 * handler. The global ones run outermost, then the controller's, then the method's, and within one list the
 * first is outermost. A controller method called directly runs no interceptors, and neither does an
 * autocomplete handler.
 *
 * @param interceptors - Interceptor classes, or `{ provide, params? }` to give one use its params, which the
 *   interceptor reads with `context.getParams()`.
 * @throws Error when an entry is neither an interceptor class nor `{ provide, params? }`, as the decorator applies.
 *
 * @example
 * ```ts
 * @Command('profile', CommandType.SLASH)
 * @UseInterceptor(TimingInterceptor)
 * async profile(interaction: ChatInputCommandInteraction) {
 *   await respond(interaction).send('Your profile.')
 * }
 * ```
 *
 * @pipeline interceptors after the guards, around everything up to the handler
 * @group Decorators
 * @category Pipeline stages
 * @see {@link Interceptor}
 * @see {@link https://meocord.dev/docs/4.1/interceptors | Interceptors}
 */
export function UseInterceptor<const T extends readonly unknown[]>(
  ...interceptors: { [K in keyof T]: CheckedEntry<T[K], new (...args: any[]) => InterceptorInterface> }
): ClassDecorator & MethodDecorator {
  return function (target: object, propertyKey?: string | symbol) {
    const where = propertyKey === undefined ? (target as { name: string }).name : `${target.constructor.name}.${String(propertyKey)}`
    assertStageEntries('@UseInterceptor', 'interceptor', where, interceptors)
    // Decorators apply bottom-up, so a higher decorator's interceptors go first, as with @UseGuard.
    if (propertyKey === undefined) {
      const existing: InterceptorEntry[] = Reflect.getOwnMetadata(CLASS_INTERCEPTORS, target) ?? []
      Reflect.defineMetadata(CLASS_INTERCEPTORS, [...interceptors, ...existing], target)
    } else {
      const existing: InterceptorEntry[] = Reflect.getOwnMetadata(METHOD_INTERCEPTORS, target, propertyKey) ?? []
      Reflect.defineMetadata(METHOD_INTERCEPTORS, [...interceptors, ...existing], target, propertyKey)
    }
  } as ClassDecorator & MethodDecorator
}
