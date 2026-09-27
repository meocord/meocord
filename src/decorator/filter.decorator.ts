import 'reflect-metadata'
import { type ExceptionFilter } from '@src/interface/index.js'
import { CATCH_TYPES, CLASS_FILTERS, type FilterEntry, METHOD_FILTERS } from '@src/core/filter-runner.js'
import { makeInjectable } from '@src/util/injectable.util.js'
import { assertStageEntries } from '@src/core/stage-scope.js'
import { type CheckedEntry } from '@src/decorator/stage-entry.js'

/**
 * Marks a class as an exception filter for the given error types.
 *
 * Use it on a class that implements `ExceptionFilter`, then apply the class with {@link UseFilter} or
 * `@MeoCord({ filters })`, to answer an error your own way. For a mistake the user can fix, throwing
 * `UserError` is often enough: the built-in fallback answers it with its message.
 *
 * @remarks
 * Errors are matched with `instanceof`; with no types, the filter handles every error. One instance is
 * shared by every call.
 *
 * @param errorTypes - The error classes the filter handles.
 *
 * @example
 * ```ts
 * @Catch(CooldownError)
 * export class WaitFilter implements ExceptionFilter<CooldownError> {
 *   async catch(error: CooldownError, context: ExecutionContext) {
 *     const seconds = Math.ceil(error.retryAfterMs / 1000)
 *     await context.response?.error(error, { message: `Slow down: try again in ${seconds}s.` })
 *   }
 * }
 * ```
 *
 * @group Decorators
 * @category Pipeline stages
 * @see {@link UseFilter}
 * @see {@link https://meocord.dev/docs/4.1/exception-filters | Exception filters}
 */
export function Catch(...errorTypes: (abstract new (...args: any[]) => unknown)[]) {
  return function (target: new (...args: any[]) => ExceptionFilter<any>) {
    makeInjectable(target)
    Reflect.defineMetadata(CATCH_TYPES, errorTypes, target)
  }
}

/**
 * Applies exception filters to a handler, or to every handler of a controller.
 *
 * Use it to answer the errors a handler's stages or the handler throw in your own way. To answer every
 * handler's errors, list the filters in `@MeoCord({ filters })` instead.
 *
 * @remarks
 * The method's filters are tried first, then the controller's, then the global ones; within one list, the
 * first whose `@Catch` matches handles the error. An error no filter handles goes to the built-in fallback,
 * which answers the user; under `TestingModule.invoke` it rejects instead. A controller method called
 * directly throws as it would without filters.
 *
 * @param filters - Filter classes, or `{ provide, params? }` to give one use its params, which the filter
 *   reads with `context.getParams()`.
 * @throws Error when an entry is neither a filter class nor `{ provide, params? }`, as the decorator applies.
 *
 * @example
 * ```ts
 * @Command('daily', CommandType.SLASH)
 * @Cooldown({ seconds: 86_400 })
 * @UseFilter(CooldownFilter)
 * async daily(interaction: ChatInputCommandInteraction) {
 *   await respond(interaction).send('Here are your coins.')
 * }
 * ```
 *
 * @pipeline filters around every stage and the handler
 * @group Decorators
 * @category Pipeline stages
 * @see {@link Catch}
 * @see {@link https://meocord.dev/docs/4.1/exception-filters | Exception filters}
 */
export function UseFilter<const T extends readonly unknown[]>(
  ...filters: { [K in keyof T]: CheckedEntry<T[K], new (...args: any[]) => ExceptionFilter<any>> }
): ClassDecorator & MethodDecorator {
  return function (target: object, propertyKey?: string | symbol) {
    const where = propertyKey === undefined ? (target as { name: string }).name : `${target.constructor.name}.${String(propertyKey)}`
    assertStageEntries('@UseFilter', 'filter', where, filters)
    // Decorators apply bottom-up, so a higher decorator's filters are tried first.
    if (propertyKey === undefined) {
      const existing: FilterEntry[] = Reflect.getOwnMetadata(CLASS_FILTERS, target) ?? []
      Reflect.defineMetadata(CLASS_FILTERS, [...filters, ...existing], target)
    } else {
      const existing: FilterEntry[] = Reflect.getOwnMetadata(METHOD_FILTERS, target, propertyKey) ?? []
      Reflect.defineMetadata(METHOD_FILTERS, [...filters, ...existing], target, propertyKey)
    }
  } as ClassDecorator & MethodDecorator
}
