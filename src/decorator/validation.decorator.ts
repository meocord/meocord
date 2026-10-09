import 'reflect-metadata'
import { type ValidateOptions, type ValidatePipes } from '@src/interface/stage-options.interface.js'
import { type PipeInterface } from '@src/interface/index.js'
import { type InferSchemaOutput, type StandardSchemaV1 } from '@src/interface/standard-schema.interface.js'
import { type Unpiped } from '@src/decorator/piped.js'
import { type PipeEntry, type ValidationMetadata } from '@src/core/input-runner.js'
import { type CheckedEntry } from '@src/decorator/stage-entry.js'
import { makeInjectable } from '@src/util/injectable.util.js'
import { assertStageEntries } from '@src/core/stage-scope.js'
import { refuse, refuseOnClass, refuseOnMethod, declaring } from '@src/util/refusal.util.js'
import { META } from '@src/util/metadata-keys.js'

export type Handler = (interaction: any, params: any, ...rest: any[]) => unknown

/** Stands for the input parameter of a handler that declares none, which accepts any input. */
declare const _noInput: unique symbol
export type NoInput = typeof _noInput

/** A handler's second parameter, or `NoInput` when it takes fewer than two. */
export type ParamsOf<M extends Handler> = Parameters<M> extends [unknown, ...infer Rest] ? (Rest extends [] ? NoInput : Parameters<M>[1]) : NoInput

type PipeEntryOf = (new (...args: any[]) => PipeInterface) | { provide: new (...args: any[]) => PipeInterface; params?: Record<string, any> }

type PipeClassOf<E> = E extends { provide: infer C } ? C : E
type PipeOutput<E> = PipeClassOf<E> extends new (...args: any[]) => PipeInterface<any, infer O> ? Awaited<O> : never
type LastPipeOutput<E> = E extends readonly [...unknown[], infer Last] ? PipeOutput<Last> : PipeOutput<E>

/** What the handler receives: the schema's output, with each piped key replaced by its last pipe's output. */
export type ValidatedInput<S extends StandardSchemaV1, Pipes = Record<never, never>> = Omit<InferSchemaOutput<S>, keyof Pipes> & {
  [K in keyof Pipes]: LastPipeOutput<Pipes[K]>
}

/** Allows the descriptor when the validated input fits the handler's params; otherwise names the problem. */
type AcceptsInput<P, Input> = [P] extends [NoInput]
  ? unknown
  : [Input] extends [Unpiped<P>]
  ? unknown
  : { 'The handler params do not match the validated input; mark keys a separate @UsePipe produces Piped<T>': Input }

/**
 * Validates a handler's input with a Standard Schema before it runs.
 *
 * Use it so a handler receives typed, valid values or does not run at all: a command's options, a
 * component's customId params, a modal's fields or a message command's params. Any Standard Schema library
 * works, such as zod, valibot or arktype. To transform one value, use {@link UsePipe}.
 *
 * @remarks
 * The handler receives the schema's output, so its defaults and coercions apply, and its second parameter is
 * checked against that output. Invalid input throws a `ValidationError` listing each issue: only an interaction's
 * caller sees it, and a message command's is a reply deleted after `@MeoCord({ messages })`'s
 * `deleteUsageRepliesAfter`. A handler takes one `@Validate`: combine schemas into one.
 *
 * @param schema - A Standard Schema for the whole input object.
 * @param options - `pipes`, for single keys of the schema's output, run before that key's `@UsePipe` pipes.
 * @throws Error when `schema` is not a Standard Schema, or the handler already has a `@Validate`, as the decorator applies.
 *
 * @example
 * ```ts
 * import { z } from 'zod'
 *
 * @Command('remind', CommandType.SLASH)
 * @Validate(z.object({ minutes: z.number().int().min(1).max(1440) }))
 * async remind(interaction: ChatInputCommandInteraction, { minutes }: { minutes: number }) {
 *   await respond(interaction).send(`I'll remind you in ${minutes} minutes.`)
 * }
 * ```
 *
 * @pipeline validation after the guards and the fetch, inside the interceptors
 * @group Decorators
 * @category Pipeline stages
 * @see {@link UsePipe}
 * @see {@link ValidationError}
 * @see {@link https://meocord.dev/docs/4.2/validation | Validation and pipes}
 */
export function Validate<S extends StandardSchemaV1, const Pipes extends ValidatePipes<S> = Record<never, never>>(
  schema: S,
  options: ValidateOptions<Pipes> = {},
) {
  return declaring(function <M extends Handler>(
    target: object,
    propertyKey: string,
    _descriptor: TypedPropertyDescriptor<M> & AcceptsInput<ParamsOf<M>, ValidatedInput<S, Pipes>>,
  ): void {
    refuseOnClass('@Validate', target, propertyKey)
    // Checked where it applies, so the refusal names the handler
    if (typeof schema?.['~standard']?.validate !== 'function') {
      throw refuse(
        new Error(
          `${target.constructor.name}.${propertyKey}: @Validate takes a Standard Schema, such as a zod, valibot or arktype schema.`,
        ),
      )
    }
    if (Reflect.hasOwnMetadata(META.methodValidation, target, propertyKey)) {
      throw refuse(new Error(
        `${target.constructor.name}.${propertyKey}: more than one @Validate; one @Validate per handler: combine the schemas into one.`,
      ))
    }
    const inlinePipes = Object.values(options.pipes ?? {}).flatMap(entries => (Array.isArray(entries) ? entries : [entries]))
    assertStageEntries('@Validate', 'pipe', `${target.constructor.name}.${propertyKey}`, inlinePipes)
    const metadata: ValidationMetadata = { schema, pipes: (options.pipes ?? {}) as ValidationMetadata['pipes'] }
    Reflect.defineMetadata(META.methodValidation, metadata, target, propertyKey)
  })
}

/** Allows the descriptor when the handler's params take the pipe's output at `key`. */
type AcceptsPiped<P, K extends string, Out> = [P] extends [NoInput]
  ? unknown
  : K extends keyof P
  ? [Out] extends [P[K]]
    ? unknown
    : Record<`The pipe's output does not fit the handler param "${K}"`, Out>
  : Record<`The handler params have no "${K}"`, P>

/**
 * Runs pipes on one value of a handler's input, to turn it into what the handler works with.
 *
 * Use it to trim, parse or look up a single option, customId param or field, such as an account ID into the
 * account. To check the whole input first, use {@link Validate}; its own `pipes` option does the same for the
 * schema's output.
 *
 * @remarks
 * Pipes run after `@Validate` and its pipes, in the order listed, each receiving the previous one's result.
 * With `@Validate`, mark the handler's param `Piped<T>`. One instance of a pipe is shared by every call.
 *
 * @param key - The input key: a command option, customId param, modal field or message param name.
 * @param pipes - Pipe classes, or `{ provide, params? }` to give one use its params, which the pipe reads with
 *   `context.getParams()`.
 * @throws Error when an entry is neither a pipe class nor `{ provide, params? }`, as the decorator applies.
 *
 * @example
 * ```ts
 * @Command('say', CommandType.SLASH)
 * @UsePipe('text', TrimPipe)
 * async say(interaction: ChatInputCommandInteraction, { text }: { text: string }) {
 *   await respond(interaction).send(text)
 * }
 * ```
 *
 * @pipeline pipes after validation
 * @group Decorators
 * @category Pipeline stages
 * @see {@link Pipe}
 * @see {@link Validate}
 * @see {@link https://meocord.dev/docs/4.2/validation | Validation and pipes}
 */
export function UsePipe<K extends string, const Pipes extends readonly [PipeEntryOf, ...PipeEntryOf[]]>(
  key: K,
  ...pipes: Pipes & { [I in keyof Pipes]: CheckedEntry<Pipes[I], new (...args: any[]) => PipeInterface> }
) {
  return declaring(function <M extends Handler>(
    target: object,
    propertyKey: string,
    _descriptor: TypedPropertyDescriptor<M> & AcceptsPiped<ParamsOf<M>, K, LastPipeOutput<Pipes>>,
  ): void {
    refuseOnClass('@UsePipe', target, propertyKey)
    assertStageEntries('@UsePipe', 'pipe', `${target.constructor.name}.${propertyKey}`, pipes)
    // Decorators apply bottom-up, so a higher @UsePipe's pipes go first, in the order they read.
    const existing = (Reflect.getOwnMetadata(META.methodPipes, target, propertyKey) as { key: string; entry: PipeEntry }[]) ?? []
    Reflect.defineMetadata(META.methodPipes, [...pipes.map(entry => ({ key, entry: entry as PipeEntry })), ...existing], target, propertyKey)
  })
}

/**
 * Marks a class as a pipe, which turns one input value into what the handler works with.
 *
 * Use it on a class that implements `PipeInterface`, then apply the class with {@link UsePipe} or
 * `@Validate(schema, { pipes })`. To reject input by its shape, a schema with {@link Validate} says why more
 * precisely; a pipe throws to stop the call.
 *
 * @remarks
 * One instance is shared by every call, and it can inject services, such as the one that looks an account up.
 *
 * @example
 * ```ts
 * @Pipe()
 * export class LowercasePipe implements PipeInterface<string, string> {
 *   transform(value: string): string {
 *     return value.toLowerCase()
 *   }
 * }
 * ```
 *
 * @pipeline pipes where `@UsePipe` or `@Validate`'s `pipes` applies it, after validation
 * @group Decorators
 * @category Pipeline stages
 * @see {@link UsePipe}
 * @see {@link https://meocord.dev/docs/4.2/validation | Validation and pipes}
 */
export function Pipe() {
  return declaring(function (target: new (...args: any[]) => PipeInterface, propertyKey?: string | symbol) {
    refuseOnMethod('@Pipe', target, propertyKey)
    makeInjectable(target)
  })
}
