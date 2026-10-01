import { type ExecutionContextType } from '@src/common/execution-context.js'
import { type PipeInterface } from './index.js'
import { type InferSchemaOutput, type StandardSchemaV1 } from './standard-schema.interface.js'

/**
 * What `@Guard` takes: the context types the guard runs for.
 *
 * @group Types
 * @see {@link Guard}
 */
export interface GuardOptions {
  /**
   * The context types the guard runs for, as `ExecutionContext.getType()` reports them; it is skipped for
   * any other call. A subclass inherits them unless it declares its own. A global guard also runs before
   * `@On` handlers, so one that reads an interaction declares `['interaction']`.
   *
   * @defaultValue every type
   */
  types?: readonly ExecutionContextType[]
}

/**
 * What `@Interceptor` takes: the context types the interceptor runs for.
 *
 * @group Types
 * @see {@link Interceptor}
 */
export interface InterceptorOptions {
  /**
   * The context types the interceptor runs for, as `ExecutionContext.getType()` reports them; it is skipped for
   * any other call. A subclass inherits them unless it declares its own.
   *
   * @defaultValue every type
   */
  types?: readonly ExecutionContextType[]
}

/**
 * What `@Observer` takes: the context types the observer is told about.
 *
 * @group Types
 * @see {@link Observer}
 */
export interface ObserverOptions {
  /**
   * The context types the observer is told about, as `ExecutionContext.getType()` reports them; calls of any
   * other type pass it by. A subclass inherits them unless it declares its own.
   *
   * @defaultValue every type
   */
  types?: readonly ExecutionContextType[]
}

/** A pipe `@Validate` runs on one key: a pipe class, or `{ provide, params? }`. */
type ValidatePipeEntry = (new (...args: any[]) => PipeInterface) | { provide: new (...args: any[]) => PipeInterface; params?: Record<string, any> }

/**
 * The pipes `@Validate` takes for a schema: some of the schema's output keys, each with one pipe or several applied in
 * order.
 *
 * Use it to type a decorator of your own that wraps `@Validate`, so the pipes it passes on are checked against the
 * schema as `@Validate` checks them.
 *
 * @typeParam S - The Standard Schema the pipes are for.
 *
 * @example
 * ```ts
 * const Checked = <S extends StandardSchemaV1, const P extends ValidatePipes<S> = Record<never, never>>(
 *   schema: S,
 *   options?: ValidateOptions<P>,
 * ) => Validate(schema, options)
 * ```
 *
 * @group Types
 * @see {@link ValidateOptions}
 */
export type ValidatePipes<S extends StandardSchemaV1> = { [K in keyof InferSchemaOutput<S>]?: ValidatePipeEntry | readonly ValidatePipeEntry[] }

/**
 * What `@Validate` takes beside its schema: pipes for single values of the schema's output.
 *
 * @typeParam Pipes - The pipes by key, which `@Validate` checks against the schema's output; a wrapper of its own
 *   types them as {@link ValidatePipes} of its schema.
 * @group Types
 * @see {@link Validate}
 */
export interface ValidateOptions<Pipes = Record<string, unknown>> {
  /**
   * Pipes for single values of the schema's output, by key: one pipe, or several applied in order. They run
   * before the key's `@UsePipe` pipes.
   */
  pipes?: Pipes
}
