import 'reflect-metadata'
import { type Container } from 'inversify'
import { type InterceptorInterface } from '@src/interface/index.js'
import { injectedTokens, perHandler, singletonContextError, sourcePrototype, stageClasses } from '@src/core/guard-runner.js'
import { ExecutionContext, type HandlerExecutionContext } from '@src/common/execution-context.js'
import { makeInjectable } from '@src/util/injectable.util.js'
import { isAppClassToken } from '@src/core/lifecycle-order.js'
import { refuse } from '@src/util/refusal.util.js'
import { Logger } from '@src/common/logger.js'

const logger = new Logger('Interceptor')

/** A function's source when the engine wrote it: what `await` and `Promise.race` hand a promise, not code of the app's. */
const NATIVE_SOURCE = /\{\s*\[native code\]\s*\}$/

/** Whether `onRejected` is code of the app's that handles a rejection, rather than an engine's step passing it on. */
const handlesRejection = (onRejected: unknown): boolean =>
  typeof onRejected === 'function' && !NATIVE_SOURCE.test(Function.prototype.toString.call(onRejected))

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
 * The interceptors around a handler: each class's, base first, down to the controller it is dispatched on, then the
 * method's.
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

/** One run of the rest of a call that an interceptor started with `next.handle()`. */
interface StartedRun {
  /** Settles, never rejecting, once the run has. */
  settled: Promise<void>
  /** Whether the run has settled. */
  done: boolean
  /** What the run rejected with, once it has. */
  failure?: { error: unknown }
  /** Chains from the run's promise that pass its rejection on and end there, so nothing handles it. */
  open: number
  /** Whether code of the app's took the run's rejection in a chain from it, as `.catch()` does. */
  caught?: boolean
}

/**
 * The promise `next.handle()` returns. Each chain from it is counted: one made without a rejection
 * handler passes the run's rejection on, and while it is the end of its chain, nothing handles that
 * rejection. Such a chain never surfaces it as unhandled, since the call fails with it instead.
 */
class Continuation extends Promise<unknown> {
  private run?: StartedRun
  private passesRejection = false
  private branched = false

  /** Starts `rest` as a run whose promise is tracked. */
  static start(rest: () => Promise<unknown>): { run: StartedRun; promise: Continuation } {
    const inner = rest()
    const run: StartedRun = { settled: undefined as never, done: false, open: 0 }
    run.settled = inner.then(
      () => void (run.done = true),
      (error: unknown) => void ((run.failure = { error }), (run.done = true)),
    )
    const promise = new Continuation((resolve, reject) => inner.then(resolve, reject))
    return { run, promise: promise.track(run, true) }
  }

  override then<A = unknown, B = never>(
    onFulfilled?: ((value: unknown) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: any) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    const next = super.then(onFulfilled, onRejected) as Promise<A | B>
    if (this.run && handlesRejection(onRejected)) this.run.caught = true
    return this.branch(next, typeof onRejected !== 'function')
  }

  // Native finally would call then with a rejection handler, which counts as handling what it passes on
  override finally(onFinally?: (() => void) | null): Promise<unknown> {
    const next = super.then(
      async value => {
        await onFinally?.()
        return value
      },
      async (reason: unknown) => {
        await onFinally?.()
        throw reason
      },
    )
    return this.branch(next, true)
  }

  private branch<T>(next: Promise<T>, passesRejection: boolean): Promise<T> {
    if (this.run && next instanceof Continuation) {
      if (this.passesRejection && !this.branched) this.run.open--
      this.branched = true
      next.track(this.run, this.passesRejection && passesRejection)
    }
    return next
  }

  private track(run: StartedRun, passesRejection: boolean): this {
    this.run = run
    this.passesRejection = passesRejection
    if (passesRejection) {
      run.open++
      // The run's own rejection is the call's to report. Any other, from a callback in the chain, stays unhandled
      // where the chain ends; a branch from here passes it on to be handled or reported there
      Promise.prototype.then.call(this, undefined, (reason: unknown) => {
        if (reason !== run.failure?.error && !this.branched) throw reason
      })
    }
    return this
  }
}

/**
 * Runs `handler` inside `interceptors`, the first outermost. Each receives the call's context with its
 * own params, and continues with `next.handle()`. A level ends once its interceptor has settled and every
 * run it left on a chain that ends unhandled has, so the call ends when such a handler does; that run's
 * rejection fails the call. `returnedEarly` is told of each interceptor that settles while a run it started is still
 * going, or without starting one, innermost first, so the last it is told of is the outermost.
 */
export async function runInterceptors(
  interceptors: readonly InterceptorEntry[],
  container: Container,
  context: HandlerExecutionContext,
  handler: () => Promise<unknown>,
  returnedEarly?: (cls: InterceptorClass) => void,
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

    const started: StartedRun[] = []
    let ended = false
    // A run started once the interceptor has settled is its own, outside the call
    const handle = () => {
      if (ended) return run(index + 1)
      const { run: startedRun, promise } = Continuation.start(() => run(index + 1))
      started.push(startedRun)
      return promise
    }
    let outcome: { value: unknown } | { error: unknown }
    try {
      outcome = { value: await interceptor.intercept(context.withParams(params), { handle }) }
    } catch (error) {
      outcome = { error }
    }
    ended = true
    if (started.length === 0 || started.some(({ done }) => !done)) returnedEarly?.(cls)
    // A run it took on, as a timeout racing it does, and that fails once the call has ended reaches nobody: said here
    for (const taken of started) {
      if (taken.done || taken.open > 0) continue
      void taken.settled.then(() => {
        if (!taken.failure || taken.caught) return
        logger.warn(
          `${cls.name} returned before ${context.getController().name}.${context.getHandlerName()} finished, which then threw; ` +
            'nothing caught it, so the call could not report it:',
          taken.failure.error,
        )
      })
    }
    // Only a run left on a chain that ends unhandled is the call's; one the interceptor took on, as a timeout
    // racing it does, is left to it
    const left = started.filter(({ open }) => open > 0)
    await Promise.all(left.map(({ settled }) => settled))
    if ('error' in outcome) throw outcome.error
    const dropped = left.find(({ failure }) => failure)?.failure
    if (dropped) throw dropped.error
    return outcome.value
  }
  return run(0)
}
