/**
 * The params a guard, interceptor, filter or pipe declares, as `{ provide, params }` must give them.
 *
 * Use it to read an interceptor's, a filter's or a pipe's params typed, with
 * `context.getParams<StageParams<typeof X>>()`: those are shared by every call, so their params come through
 * the context rather than `this`. It is `P` for a class that declares `declare readonly params?: P`, and any
 * values for one that declares none.
 *
 * @example
 * ```ts
 * @Interceptor()
 * export class SlowCallInterceptor implements InterceptorInterface {
 *   declare readonly params?: { thresholdMs: number }
 *
 *   async intercept(context: ExecutionContext, next: CallHandler): Promise<unknown> {
 *     const { thresholdMs } = context.getParams<StageParams<typeof SlowCallInterceptor>>() ?? { thresholdMs: 1000 }
 *     const started = performance.now()
 *     const result = await next.handle()
 *     if (performance.now() - started > thresholdMs) console.warn(`${context.getHandlerName()} was slow`)
 *     return result
 *   }
 * }
 * ```
 *
 * @group Types
 * @see {@link ExecutionContext}
 * @see {@link UseInterceptor}
 */
export type StageParams<C extends abstract new (...args: any[]) => unknown> = 'params' extends keyof InstanceType<C>
  ? NonNullable<InstanceType<C>['params' & keyof InstanceType<C>]>
  : Record<string, any>
