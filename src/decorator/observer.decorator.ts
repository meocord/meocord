import 'reflect-metadata'
import { type ObserverOptions } from '@src/interface/stage-options.interface.js'
import { makeInjectable } from '@src/util/injectable.util.js'
import { type DispatchObserver } from '@src/interface/index.js'
import { defineStageTypes } from '@src/core/stage-scope.js'
import { refuse, refuseOnMethod, declaring } from '@src/util/refusal.util.js'
import { META } from '@src/util/metadata-keys.js'

/**
 * Marks a class as a dispatch observer, told about every call once it has settled, for metrics and audit logs.
 *
 * Use it on a class that implements `DispatchObserver`, listed in `@MeoCord({ observers })`, to record how
 * calls end and how long they take. To change or stop a call, use an interceptor or a guard: an observer
 * cannot.
 *
 * @remarks
 * `onSettled` runs once the call has been answered, with its outcome and duration, and the optional `onStart`
 * as it begins. The call waits for neither, and one that throws is logged. One instance is resolved from the
 * container, so it injects services, and both methods receive the call's `ExecutionContext`.
 *
 * @param options - `types`, the context types the observer is told about; every type unless given.
 * @throws Error when the class has no `onSettled` method, or `types` is empty, as the decorator applies.
 *
 * @example
 * ```ts
 * @Observer()
 * export class SlowCallObserver implements DispatchObserver {
 *   private readonly logger = new Logger(SlowCallObserver.name)
 *
 *   onSettled(context: ExecutionContext, { outcome, durationMs }: DispatchResult) {
 *     if (durationMs > 1000) this.logger.warn(`${context.getHandlerName()} ${outcome} in ${durationMs} ms`)
 *   }
 * }
 * ```
 *
 * @pipeline observers-start before anything else runs
 * @pipeline observers-settled once the call has settled and been answered, however it ended
 * @group Decorators
 * @category Pipeline stages
 * @see {@link https://meocord.dev/docs/4.2/observers | Observers}
 */
export function Observer(
  options: ObserverOptions = {},
) {
  return declaring(function (target: new (...args: any[]) => DispatchObserver, propertyKey?: string | symbol) {
    refuseOnMethod('@Observer', target, propertyKey)
    if (typeof (target.prototype as Partial<DispatchObserver>).onSettled !== 'function') {
      throw refuse(new Error(`${target.name}: an @Observer needs an onSettled method, and it has none.`))
    }
    makeInjectable(target)
    defineStageTypes(target, options.types, 'Observer')
    Reflect.defineMetadata(META.observerClass, true, target)
  })
}
