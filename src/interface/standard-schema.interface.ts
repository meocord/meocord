/**
 * The Standard Schema interface, version 1, which zod, valibot, arktype and other validation libraries implement.
 *
 * `@Validate` takes any schema that implements it, so MeoCord depends on no validation library. It is declared
 * here rather than imported, as the specification at https://standardschema.dev intends.
 *
 * @group Types
 * @see {@link Validate}
 * @see {@link InferSchemaOutput}
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  /** The properties every Standard Schema carries. */
  readonly '~standard': StandardSchemaV1Props<Input, Output>
}

/**
 * What a Standard Schema exposes under `~standard`.
 *
 * @group Types
 * @see {@link StandardSchemaV1}
 */
export interface StandardSchemaV1Props<Input = unknown, Output = Input> {
  /** The version of the specification, which is `1`. */
  readonly version: 1
  /** The library the schema comes from. */
  readonly vendor: string
  /** Validates a value, synchronously or not. */
  readonly validate: (value: unknown) => StandardSchemaV1Result<Output> | Promise<StandardSchemaV1Result<Output>>
  /** Type information only; never present at runtime. */
  readonly types?: { readonly input: Input; readonly output: Output } | undefined
}

/**
 * The outcome of validation: the output value, or the issues found.
 *
 * @group Types
 * @see {@link StandardSchemaV1}
 */
export type StandardSchemaV1Result<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: readonly StandardSchemaV1Issue[] }

/**
 * One problem a schema found.
 *
 * @group Types
 * @see {@link ValidationError}
 */
export interface StandardSchemaV1Issue {
  /** What is wrong, written by the schema library. */
  readonly message: string
  /** Where it is, from the root of the value. */
  readonly path?: readonly (PropertyKey | { readonly key: PropertyKey })[] | undefined
}

/**
 * The value a schema produces when validation succeeds: what a handler with `@Validate(schema)` receives.
 *
 * @group Types
 * @see {@link Validate}
 */
export type InferSchemaOutput<S extends StandardSchemaV1> = NonNullable<S['~standard']['types']>['output']

/**
 * Brands a {@link Piped} value's type; never present at runtime.
 *
 * @internal
 */
export declare const PIPED_BRAND: unique symbol

/**
 * Marks a value of a handler's input that a separate `@UsePipe` produces, so `@Validate` leaves its type to
 * that pipe.
 *
 * Use it on a handler with both `@Validate` and `@UsePipe` for the same key; inside the handler it is exactly
 * `T`. Pipes given to `@Validate` itself need no marker.
 *
 * @example
 * ```ts
 * import { z } from 'zod'
 *
 * @Pipe()
 * class LengthPipe implements PipeInterface<string, number> {
 *   transform(value: string): number {
 *     return value.length
 *   }
 * }
 *
 * @Command('count/{text}', CommandType.BUTTON)
 * @Validate(z.object({ text: z.string() }))
 * @UsePipe('text', LengthPipe)
 * async count(interaction: ButtonInteraction, { text }: { text: Piped<number> }) {
 *   await respond(interaction).send(`${text} characters.`)
 * }
 * ```
 *
 * @group Types
 * @see {@link UsePipe}
 * @see {@link Validate}
 */
export type Piped<T> = T & { readonly [PIPED_BRAND]?: true }
