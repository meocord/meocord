import 'reflect-metadata'
import { type Container } from 'inversify'
import { type InterceptorInterface } from '@src/interface/index.js'
import { injectedTokens, perHandler, singletonContextError, sourcePrototype, stageClasses } from '@src/core/guard-runner.js'
import { ExecutionContext, type HandlerExecutionContext } from '@src/common/execution-context.js'
import { makeInjectable } from '@src/util/injectable.util.js'
import { isAppClassToken } from '@src/core/lifecycle-order.js'
import { refuse } from '@src/util/refusal.util.js'

export type InterceptorClass = new (...args: any[]) => InterceptorInterface

/** An interceptor class, and the params its `ExecutionContext.getParams()` returns. */
export interface InterceptorWithParams {
  provide: InterceptorClass
  params?: Record<string, any>
}

export type InterceptorEntry = InterceptorClass | InterceptorWithParams

function isInterceptorWithParams(entry: unknown): entry is InterceptorWithParams {
  // Entries are checked when @UseInterceptor or @MeoCord applies, so an object here is always { provide, params? }
  return typeof entry === 'object'
}

/** Private metadata: the interceptors a class-level `@UseInterceptor` applies, on the class. */
export const CLASS_INTERCEPTORS = Symbol('class_interceptors')

/** Private metadata: the interceptors a method-level `@UseInterceptor` applies, on the method. */
export const METHOD_INTERCEPTORS = Symbol('method_interceptors')

/**
 * The interceptors around a handler: class interceptors from the controller up to the class declaring
 * the handler, subclass first, then the method's.
 */
export const handlerInterceptors = perHandler((prototype: object, methodName: string): readonly InterceptorEntry[] => {
  const source = sourcePrototype(prototype, methodName)
  if (!source) return []
  return [
    ...stageClasses(prototype, methodName).flatMap(cls => (Reflect.getOwnMetadata(CLASS_INTERCEPTORS, cls) as InterceptorEntry[]) ?? []),
    ...((Reflect.getOwnMetadata(METHOD_INTERCEPTORS, source, methodName) as InterceptorEntry[]) ?? []),
  ]
})

/** Binds `cls` and its unbound dependencies as singletons, refusing any that injects `ExecutionContext`. */
export function bindShared(container: Container, cls: new (...args: any[]) => unknown): void {
  if (container.isBound(cls)) return
  if (injectedTokens(cls).includes(ExecutionContext)) throw refuse(singletonContextError(cls))

  makeInjectable(cls)
  container.bind(cls).toSelf().inSingletonScope()
  for (const dep of injectedTokens(cls)) {
    if (isAppClassToken(dep)) bindShared(container, dep)
  }
}

/**
 * Binds an interceptor as a singleton in `container`, unless it is already bound (an override, or an
 * earlier call). A shared instance cannot inject the per-call `ExecutionContext`.
 */
export function prepareInterceptor(container: Container, entry: InterceptorEntry): void {
  bindShared(container, isInterceptorWithParams(entry) ? entry.provide : entry)
}

/**
 * Runs `handler` inside `interceptors`, the first outermost. Each receives the call's context with its
 * own params, and continues with `next.handle()`. `entering` is told of each interceptor as it is called.
 */
export async function runInterceptors(
  interceptors: readonly InterceptorEntry[],
  container: Container,
  context: HandlerExecutionContext,
  handler: () => Promise<unknown>,
  entering?: (cls: InterceptorClass) => void,
): Promise<unknown> {
  const run = async (index: number): Promise<unknown> => {
    if (index === interceptors.length) return handler()

    const entry = interceptors[index]
    const [cls, params] = isInterceptorWithParams(entry) ? [entry.provide, entry.params] : [entry, undefined]
    prepareInterceptor(container, cls)
    const interceptor = container.get<InterceptorInterface>(cls)

    if (typeof interceptor.intercept !== 'function') {
      throw new Error(
        `Interceptor ${cls.name} applied to ${context.getHandlerName()} does not have a valid intercept method.`,
      )
    }
    entering?.(cls)
    return interceptor.intercept(context.withParams(params), { handle: () => run(index + 1) })
  }
  return run(0)
}
