import { type ExecutionContext, type ExecutionContextType, HandlerExecutionContext } from '@src/common/execution-context.js'

/**
 * What {@link createExecutionContext} describes besides the handler.
 *
 * @group Testing
 * @category Inspection
 */
export interface ExecutionContextOptions {
  /** The handler's arguments, such as the interaction and its params. */
  args?: unknown[]

  /** The `params` of the guard's `{ provide, params }` entry, returned by `getParams()`. */
  params?: Record<string, unknown>

  /** What is being handled. Read from the first argument when omitted. */
  type?: ExecutionContextType

  /**
   * The handler's params, returned by `getHandlerParams()` and as `getArgs()`'s second argument, such as
   * the validated and piped params an interceptor reads after `next.handle()`. Without it, `args`'
   * second argument.
   */
  handlerParams?: Record<string, unknown>
}

/**
 * Builds the `ExecutionContext` a guard, interceptor or filter receives for one handler, to test it on its own.
 *
 * Use it for a stage that reads the handler's metadata, its params or the call's arguments, without building a
 * module. The metadata is read from the real controller, as it is at runtime.
 *
 * @param controller - The controller class declaring the handler.
 * @param methodName - The handler method's name.
 * @param options - The call's arguments, the stage's params, the handler's params and the call type.
 * @returns The context for that call.
 *
 * @example
 * ```ts
 * import { expect } from 'vitest'
 *
 * @Controller()
 * class StatsController {
 *   @Command('stats', CommandType.SLASH)
 *   async stats(interaction: ChatInputCommandInteraction) {
 *     await respond(interaction).send('Stats.')
 *   }
 * }
 * const interaction = createMockInteraction(ChatInputCommandInteraction)
 * const context = createExecutionContext(StatsController, 'stats', { args: [interaction] })
 * expect(context.getInteraction()).toBe(interaction)
 * ```
 *
 * @group Testing
 * @category Inspection
 * @see {@link inspectHandler}
 * @see {@link ExecutionContext}
 */
export function createExecutionContext<C extends new (...args: any[]) => unknown>(
  controller: C,
  methodName: keyof InstanceType<C> & string,
  options: ExecutionContextOptions = {},
): ExecutionContext {
  const { args = [], params, type, handlerParams } = options
  return new HandlerExecutionContext({
    controller,
    methodName,
    args,
    params,
    type,
    // The handler params stand in as the second argument, so getArgs() and getHandlerParams() agree
    currentArgs: handlerParams === undefined ? undefined : { current: [args[0], handlerParams, ...args.slice(2)] },
  })
}
