import 'reflect-metadata'
import { type ExceptionFilter } from '@src/interface/index.js'
import { type FilterEntry } from '@src/core/filter-runner.js'
import { makeInjectable } from '@src/util/injectable.util.js'
import { assertStageEntries } from '@src/core/stage-scope.js'
import { Logger } from '@src/common/logger.js'
import { type CheckedEntry } from '@src/decorator/stage-entry.js'
import { warnDeprecatedBehaviour } from '@src/common/deprecation.js'
import { describeValue, isConstructor } from '@src/util/value.util.js'
import { META } from '@src/util/metadata-keys.js'
import { refuseOnMethod, declaring } from '@src/util/refusal.util.js'

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
 *     await context.response?.error(error, { message: `Slow down: try again ${time(error.retryAt, 'R')}.` })
 *   }
 * }
 * ```
 *
 * @pipeline filters where `@UseFilter` or `@MeoCord({ filters })` applies it, around every stage and the handler
 * @group Decorators
 * @category Pipeline stages
 * @see {@link UseFilter}
 * @see {@link https://meocord.dev/docs/4.1/exception-filters | Exception filters}
 */
export function Catch(...errorTypes: (abstract new (...args: any[]) => unknown)[]) {
  return declaring(function (target: new (...args: any[]) => ExceptionFilter<any>, propertyKey?: string | symbol) {
    refuseOnMethod('@Catch', target, propertyKey)
    makeInjectable(target)
    errorTypes.forEach((type, index) => {
      if (isConstructor(type)) return
      const entry = ORDINALS[index] ? `${ORDINALS[index]} entry` : `entry ${index + 1}`
      warnDeprecatedBehaviour(
        logger,
        `${target.name}: @Catch's ${entry}, ${describeValue(type)}, which matches no error,`,
        'is refused',
        'an error class, such as @Catch(CooldownError),',
      )
    })
    Reflect.defineMetadata(META.catchTypes, errorTypes, target)
  })
}

const logger = new Logger('Catch')
const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth']

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
  return declaring(function (target: object, propertyKey?: string | symbol) {
    const where = propertyKey === undefined ? (target as { name: string }).name : `${target.constructor.name}.${String(propertyKey)}`
    assertStageEntries('@UseFilter', 'filter', where, filters)
    // Decorators apply bottom-up, so a higher decorator's filters are tried first.
    if (propertyKey === undefined) {
      const existing: FilterEntry[] = Reflect.getOwnMetadata(META.classFilters, target) ?? []
      Reflect.defineMetadata(META.classFilters, [...filters, ...existing], target)
    } else {
      const existing: FilterEntry[] = Reflect.getOwnMetadata(META.methodFilters, target, propertyKey) ?? []
      Reflect.defineMetadata(META.methodFilters, [...filters, ...existing], target, propertyKey)
    }
  }) as ClassDecorator & MethodDecorator
}
