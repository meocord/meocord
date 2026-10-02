import 'reflect-metadata'
import { type Container } from 'inversify'
import { type PipeInterface } from '@src/interface/index.js'
import { type StandardSchemaV1 } from '@src/interface/standard-schema.interface.js'
import { ValidationError } from '@src/common/errors.js'
import { type HandlerExecutionContext } from '@src/common/execution-context.js'
import { prepareInterceptor } from '@src/core/interceptor-runner.js'
import { perHandler, sourcePrototype } from '@src/core/guard-runner.js'
import { consumeCooldowns, handlerCooldowns } from '@src/core/cooldown-runner.js'
import { META } from '@src/util/metadata-keys.js'

export type PipeClass = new (...args: any[]) => PipeInterface

/** A pipe class, and the params its `ExecutionContext.getParams()` returns. */
export interface PipeWithParams {
  provide: PipeClass
  params?: Record<string, any>
}

export type PipeEntry = PipeClass | PipeWithParams

/** What `@Validate` stores on a method. */
export interface ValidationMetadata {
  schema: StandardSchemaV1
  pipes: Record<string, PipeEntry | readonly PipeEntry[]>
}

/** The pipe class an entry names. */
export function pipeClass(entry: PipeEntry): unknown {
  return isPipeWithParams(entry) ? entry.provide : entry
}

function isPipeWithParams(entry: PipeEntry): entry is PipeWithParams {
  // Entries are checked when @UsePipe or @Validate applies, so an object here is always { provide, params? }
  return typeof entry === 'object'
}

const asList = (entries: PipeEntry | readonly PipeEntry[]): readonly PipeEntry[] =>
  Array.isArray(entries) ? entries : [entries as PipeEntry]

/** The validation and pipes that run on a handler's input: `@Validate`'s first, then `@UsePipe`'s. */
export const handlerInputStages = perHandler((prototype: object, methodName: string): {
  schema?: StandardSchemaV1
  pipes: { key: string; entry: PipeEntry }[]
} => {
  const source = sourcePrototype(prototype, methodName)
  if (!source) return { pipes: [] }

  const validation = Reflect.getOwnMetadata(META.methodValidation, source, methodName) as ValidationMetadata | undefined
  const inline = Object.entries(validation?.pipes ?? {}).flatMap(([key, entries]) => asList(entries).map(entry => ({ key, entry })))
  const used = (Reflect.getOwnMetadata(META.methodPipes, source, methodName) as { key: string; entry: PipeEntry }[]) ?? []
  return { schema: validation?.schema, pipes: [...inline, ...used] }
})

/** Binds a pipe as a singleton, as interceptors are: one that injects `ExecutionContext` is refused. */
export function preparePipe(container: Container, entry: PipeEntry): void {
  prepareInterceptor(container, (isPipeWithParams(entry) ? entry.provide : entry) as never)
}

/**
 * The handler's arguments with its input validated and piped: the second argument is replaced by the
 * schema's output, then each pipe's result for its key; unchanged when the handler has neither. The call is counted
 * against its cooldowns last, and the context is built only if a pipe or a cooldown needs it.
 *
 * @throws ValidationError when the schema reports issues; CooldownError or CooldownStoreError when a cooldown refuses
 *   the call; anything a pipe throws.
 */
export async function prepareHandlerArgs(
  container: Container,
  prototype: object,
  methodName: string,
  contextOf: () => HandlerExecutionContext,
  args: readonly unknown[],
): Promise<unknown[]> {
  const { schema, pipes } = handlerInputStages(prototype, methodName)
  // Counted last, so input that fails validation or a pipe never uses up a cooldown.
  const cooldowns = handlerCooldowns(prototype, methodName)
  // `by` reads the params as the handler will receive them
  const consume = (params: unknown) =>
    consumeCooldowns(container, prototype.constructor, methodName, cooldowns, contextOf, params ?? {})

  if (!schema && pipes.length === 0) {
    await consume(args[1])
    return [...args]
  }

  let input = (args[1] ?? {}) as Record<string, unknown>

  if (schema) {
    const result = await schema['~standard'].validate(input)
    if (result.issues) throw ValidationError.fromSchemaIssues(result.issues)
    input = result.value as Record<string, unknown>
  }

  if (pipes.length > 0) {
    input = { ...input }
    for (const { key, entry } of pipes) {
      const [cls, params] = isPipeWithParams(entry) ? [entry.provide, entry.params] : [entry, undefined]
      preparePipe(container, cls)
      const pipe = container.get<PipeInterface>(cls)
      if (typeof pipe.transform !== 'function') {
        throw new Error(`Pipe ${cls.name} applied to ${methodName} does not have a valid transform method.`)
      }
      input[key] = await pipe.transform(input[key], contextOf().withParams(params))
    }
  }

  await consume(input)
  return [args[0], input, ...args.slice(2)]
}
