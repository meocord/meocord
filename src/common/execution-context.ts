import 'reflect-metadata'
import {
  AutocompleteInteraction,
  BaseInteraction,
  type Interaction,
  Message,
  MessageReaction,
  type PartialMessageReaction,
} from 'discord.js'
import { warnDeprecated } from '@src/common/deprecation.js'
import { Logger } from '@src/common/logger.js'
import { type MetadataDecorator } from '@src/common/metadata.js'
import { respond, type ResponseState } from '@src/common/response/response-state.js'
import { type DeepReadonly, type MeoCordTheme } from '@src/interface/theme.interface.js'
import { useTheme } from '@src/core/theme-scope.js'

/**
 * What an {@link ExecutionContext} is running a handler for: an interaction, an autocomplete, a message, a
 * reaction or a gateway event.
 *
 * @group Types
 * @see {@link ExecutionContext}
 */
export type ExecutionContextType = 'interaction' | 'autocomplete' | 'message' | 'reaction' | 'event'

/**
 * Describes one handler call: which controller and method run, with which arguments, and the metadata on them.
 *
 * Use it in a guard, an interceptor, a filter, a pipe or an observer to read the call: its interaction or
 * message, the handler's params, what the handler is decorated with, and its answer through `response`.
 *
 * @remarks
 * A guard injects it through its constructor; an interceptor, a filter, a pipe and an observer receive it as
 * an argument. Each call gets its own, so a controller or a service, shared by every call, cannot inject it.
 *
 * @example
 * ```ts
 * export const UnderMaintenance = createMetadata<boolean>('maintenance')
 *
 * @Guard()
 * export class MaintenanceGuard implements GuardInterface {
 *   constructor(private readonly context: ExecutionContext) {}
 *
 *   canActivate(): boolean {
 *     if (!this.context.get(UnderMaintenance)) return true
 *     throw new GuardDeniedError(`${this.context.getHandlerName()} is closed for now.`)
 *   }
 * }
 * ```
 *
 * @group Utilities
 * @see {@link createMetadata}
 * @see {@link StageParams}
 * @see {@link https://meocord.dev/docs/4.2/guards | Guards}
 */
export abstract class ExecutionContext {
  /**
   * The response state of the interaction being handled, the same one `respond(interaction)` returns,
   * or `undefined` for anything that cannot be answered: a message, a reaction, an event or
   * autocomplete.
   */
  get response(): ResponseState | undefined {
    const interaction = this.getInteraction()
    return interaction?.isRepliable() ? respond(interaction) : undefined
  }

  /**
   * Reads a metadata value for the running handler: the method's value, else the controller's.
   * Values resolve through the prototype chain, so an inherited handler reads its base class's
   * method value before the subclass's class value.
   *
   * @param metadata - A decorator made by `createMetadata`.
   * @returns The value, or `undefined` when neither the method nor the controller declares one.
   */
  abstract get<T>(metadata: MetadataDecorator<T>): T | undefined
  /**
   * Reads a metadata value stored under a key, such as one `SetMetadata` set.
   *
   * @deprecated Since 4.1, and removed in the next major version (5.0). Use `get(metadata)` instead. Its
   * `metadata` is a decorator made by `createMetadata`, whose value is typed and whose key cannot collide with another.
   */
  abstract get<T = unknown>(key: string | symbol): T | undefined

  /**
   * Reads every declared value for the running handler, method first, then controller.
   *
   * @param metadata - A decorator made by `createMetadata`.
   * @returns The declared values; empty when none is declared.
   */
  abstract getAll<T>(metadata: MetadataDecorator<T>): T[]
  /**
   * Reads every value stored under a key, such as one `SetMetadata` set.
   *
   * @deprecated Since 4.1, and removed in the next major version (5.0). Use `getAll(metadata)` instead. Its
   * `metadata` is a decorator made by `createMetadata`, whose values are typed and whose key cannot collide with another.
   */
  abstract getAll<T = unknown>(key: string | symbol): T[]

  /**
   * The arguments the handler is called with, as they stand when the stage asks: raw in a guard, and
   * validated and piped once the handler's arguments are prepared, so in an interceptor after
   * `next.handle()` and in a filter for an error the handler threw. The second is what
   * {@link ExecutionContext.getHandlerParams} returns.
   */
  abstract getArgs(): readonly unknown[]

  /** The interaction being handled, or `undefined` for a message, reaction or event. */
  abstract getInteraction(): Interaction | undefined

  /** The message being handled, or `undefined` for anything else. */
  abstract getMessage(): Message | undefined

  /** The reaction being handled, or `undefined` for anything else. */
  abstract getReaction(): MessageReaction | PartialMessageReaction | undefined

  /** What is being handled: an interaction, an autocomplete request, a message, a reaction or an event. */
  abstract getType(): ExecutionContextType

  /**
   * The controller class the handler runs on, the subclass for a handler it inherits, or `undefined` in a filter
   * handling an error no handler was reached for, such as `CommandNotFoundError`.
   */
  abstract getController(): (new (...args: any[]) => unknown) | undefined

  /**
   * The handler method as the controller declares it, with its decorators applied, so the function
   * returned is the decorated one rather than the source method. `undefined` when no handler was
   * reached.
   */
  abstract getHandler(): ((...args: any[]) => unknown) | undefined

  /** The name of the handler method, or `undefined` when no handler was reached. */
  abstract getHandlerName(): string | undefined

  /**
   * The `params` of the running guard's, interceptor's, pipe's or filter's own `{ provide, params }` entry: how
   * that stage was configured. For the call's input, the handler's second argument, see
   * {@link ExecutionContext.getHandlerParams}.
   *
   * @returns The params, or `undefined` for one applied by class alone.
   */
  abstract getParams<P extends Record<string, unknown> = Record<string, unknown>>(): Readonly<P> | undefined

  /**
   * The handler's params, its second argument: a command's options, a component's customId params, a
   * modal's fields, a select menu's choices or a message pattern's params. They are read as they stand when the
   * stage asks. A guard sees them raw. An interceptor sees them raw before `next.handle()` and validated and piped
   * after it. A filter sees
   * them as they were when the error was thrown. Not the same as {@link ExecutionContext.getParams},
   * which is the running stage's own configuration.
   *
   * @typeParam P - The params' type, such as the handler's own second parameter type.
   * @returns The params, or `undefined` where the handler takes none: a message handler without a
   *   pattern, a reaction or gateway event handler, or a call no handler was reached for.
   *
   * @example
   * ```typescript
   * @Interceptor()
   * export class AuditInterceptor implements InterceptorInterface {
   *   async intercept(context: ExecutionContext, next: CallHandler) {
   *     const result = await next.handle()
   *     // Validated and piped by now, as the handler received them
   *     audit.record(context.getHandlerName(), context.getHandlerParams<{ uid: string }>()?.uid)
   *     return result
   *   }
   * }
   * ```
   */
  abstract getHandlerParams<P = Record<string, unknown>>(): Readonly<P> | undefined

  /**
   * The theme of the call: the same one `useTheme()` returns inside it, with the app's theme and each `@UseTheme`
   * that applies to the handler merged over MeoCord's defaults. Frozen, since it is shared by every call it applies to.
   */
  getTheme(): DeepReadonly<MeoCordTheme> {
    return useTheme()
  }
}

/** A call's arguments as they stand, replaced in place once validation and pipes have prepared them. */
export interface CurrentArgs {
  current: readonly unknown[]
}

/** Whether a call of this type passes the handler params as its second argument. */
export function takesHandlerParams(type: ExecutionContextType): boolean {
  return type === 'interaction' || type === 'autocomplete' || type === 'message'
}

/** What a {@link HandlerExecutionContext} describes. */
export interface HandlerCall {
  controller: new (...args: any[]) => unknown
  methodName: string
  args: readonly unknown[]
  type?: ExecutionContextType
  params?: Record<string, unknown>
  /** The arguments as they stand, shared by every stage of the call; without it, `args`. */
  currentArgs?: CurrentArgs
}

/** The type of a call, read from its first argument when the caller does not say. */
export function inferContextType(first: unknown): ExecutionContextType {
  if (first instanceof AutocompleteInteraction) return 'autocomplete'
  if (first instanceof BaseInteraction) return 'interaction'
  if (first instanceof Message) return 'message'
  if (first instanceof MessageReaction) return 'reaction'
  return 'event'
}

function metadataKey(metadata: MetadataDecorator<unknown> | string | symbol): string | symbol {
  if (typeof metadata === 'function') return metadata.key
  warnDeprecated(logger, 'Reading metadata by a key with ExecutionContext.get() or getAll()', 'a decorator made by createMetadata')
  return metadata
}

const logger = new Logger('ExecutionContext')

/** The context of one handler call. */
export class HandlerExecutionContext extends ExecutionContext {
  private readonly type: ExecutionContextType

  constructor(private readonly call: HandlerCall) {
    super()
    this.type = call.type ?? inferContextType(call.args[0])
  }

  /** The same call, with the params of another stage's `{ provide, params }` entry. */
  withParams(params: Record<string, unknown> | undefined): HandlerExecutionContext {
    return new HandlerExecutionContext({ ...this.call, type: this.type, params })
  }

  get<T>(metadata: MetadataDecorator<T> | string | symbol): T | undefined {
    return this.getAll<T>(metadata as MetadataDecorator<T>)[0]
  }

  getAll<T>(metadata: MetadataDecorator<T> | string | symbol): T[] {
    const key = metadataKey(metadata as MetadataDecorator<unknown>)
    const { controller, methodName } = this.call
    const values = [
      Reflect.getMetadata(key, controller.prototype, methodName) as T | undefined,
      Reflect.getMetadata(key, controller) as T | undefined,
    ]
    return values.filter((value): value is T => value !== undefined)
  }

  getArgs(): readonly unknown[] {
    return this.call.currentArgs?.current ?? this.call.args
  }

  getInteraction(): Interaction | undefined {
    const [first] = this.call.args
    return first instanceof BaseInteraction ? (first as Interaction) : undefined
  }

  getMessage(): Message | undefined {
    const [first] = this.call.args
    return first instanceof Message ? first : undefined
  }

  getReaction(): MessageReaction | PartialMessageReaction | undefined {
    const [first] = this.call.args
    return first instanceof MessageReaction ? first : undefined
  }

  getType(): ExecutionContextType {
    return this.type
  }

  getController(): new (...args: any[]) => unknown {
    return this.call.controller
  }

  getHandler(): (...args: any[]) => unknown {
    return this.call.controller.prototype[this.call.methodName]
  }

  getHandlerName(): string {
    return this.call.methodName
  }

  getParams<P extends Record<string, unknown> = Record<string, unknown>>(): Readonly<P> | undefined {
    return this.call.params as Readonly<P> | undefined
  }

  getHandlerParams<P = Record<string, unknown>>(): Readonly<P> | undefined {
    return takesHandlerParams(this.type) ? (this.getArgs()[1] as Readonly<P> | undefined) : undefined
  }
}

/**
 * The context of an interaction or message that reached no handler: one no route matched, or one that failed
 * before routing. It has arguments and a type, but no controller, handler or metadata.
 */
export class UnroutedExecutionContext extends ExecutionContext {
  private readonly type: ExecutionContextType

  constructor(
    private readonly args: readonly unknown[],
    private readonly params?: Record<string, unknown>,
  ) {
    super()
    this.type = inferContextType(args[0])
  }

  /** The same call, with the params of a filter's `{ provide, params }` entry. */
  withParams(params: Record<string, unknown> | undefined): UnroutedExecutionContext {
    return new UnroutedExecutionContext(this.args, params)
  }

  get(): undefined {
    return undefined
  }

  getAll(): [] {
    return []
  }

  getArgs(): readonly unknown[] {
    return this.args
  }

  getInteraction(): Interaction | undefined {
    const [first] = this.args
    return first instanceof BaseInteraction ? (first as Interaction) : undefined
  }

  getMessage(): Message | undefined {
    const [first] = this.args
    return first instanceof Message ? first : undefined
  }

  getReaction(): MessageReaction | PartialMessageReaction | undefined {
    const [first] = this.args
    return first instanceof MessageReaction ? first : undefined
  }

  getType(): ExecutionContextType {
    return this.type
  }

  getController(): undefined {
    return undefined
  }

  getHandler(): undefined {
    return undefined
  }

  getHandlerName(): undefined {
    return undefined
  }

  getParams<P extends Record<string, unknown> = Record<string, unknown>>(): Readonly<P> | undefined {
    return this.params as Readonly<P> | undefined
  }

  getHandlerParams(): undefined {
    return undefined
  }
}
