import { type StandardSchemaV1Issue } from '@src/interface/standard-schema.interface.js'

/**
 * Thrown by a guard to deny a call and tell the user why. Returning `false` from `canActivate` denies
 * silently; throwing this denies with its message, which the built-in fallback shows only to the user
 * who made the call. A filter can catch it to answer differently.
 *
 * @example
 * ```typescript
 * @Guard()
 * export class OwnerGuard implements GuardInterface {
 *   canActivate(interaction: ButtonInteraction, { ownerId }: { ownerId: string }): boolean {
 *     if (interaction.user.id !== ownerId) throw new GuardDeniedError('Only the owner can use this.')
 *     return true
 *   }
 * }
 * ```
 */
export class GuardDeniedError extends Error {
  /** @param message - What the user is told. */
  constructor(message: string) {
    super(message)
    this.name = 'GuardDeniedError'
  }
}

/**
 * What a {@link UserError} carries besides its message.
 *
 * @group Types
 */
export interface UserErrorOptions {
  /** Names the error, for a filter or presenter to branch on, or to look a translation up by. */
  code?: string
  /** Values the message is built from, such as the amount missing, for a translation to fill in. */
  context?: Readonly<Record<string, unknown>>
  /** The error that led to this one, such as a lookup that failed. */
  cause?: unknown
}

/**
 * A mistake the user can fix, such as too few coins or an account that does not exist, rather than a
 * fault in the bot. Throw it from a handler, a pipe, a service or a guard: the built-in fallback shows
 * its message to the user who made the call, privately for an interaction and as a reply to a message,
 * and logs it only at debug level. Observers see the outcome `'refused'`.
 *
 * `code` and `context` let an exception filter or a presenter phrase it otherwise, such as in the
 * user's language: a presenter's `error()` receives the error with the interaction.
 *
 * @example
 * ```typescript
 * function charge(balance: number, price: number): number {
 *   if (balance < price) {
 *     throw new UserError(`You need ${price - balance} more coins.`, { code: 'shop.poor', context: { missing: price - balance } })
 *   }
 *   return balance - price
 * }
 * ```
 *
 * @group Responses
 * @category Errors
 */
export class UserError extends Error {
  /** Names the error, for a filter or presenter to branch on. */
  readonly code?: string
  /** Values the message is built from. */
  readonly context?: Readonly<Record<string, unknown>>

  /**
   * @param message - What the user is told.
   * @param options - A `code`, the `context` the message is built from, and the `cause`.
   */
  constructor(message: string, { code, context, cause }: UserErrorOptions = {}) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'UserError'
    this.code = code
    this.context = context
  }
}

/**
 * The error dispatch reports when an interaction matches no handler, such as a button whose customId
 * fits no `@Command` pattern. Global filters receive it, with no handler in their `ExecutionContext`;
 * without one, the built-in fallback answers "Command not found!".
 *
 * @example
 * ```typescript
 * @Catch(CommandNotFoundError)
 * export class NotFoundFilter implements ExceptionFilter<CommandNotFoundError> {
 *   async catch(_error: CommandNotFoundError, context: ExecutionContext) {
 *     const interaction = context.getInteraction()
 *     if (interaction?.isRepliable()) await interaction.reply({ content: 'That button has expired.', flags: MessageFlags.Ephemeral })
 *   }
 * }
 * ```
 */
export class CommandNotFoundError extends Error {
  constructor(message = 'No handler matched the interaction.') {
    super(message)
    this.name = 'CommandNotFoundError'
  }
}

/** One problem `@Validate` found in a handler's input. */
export interface ValidationIssue {
  /** What is wrong, as the schema library wrote it. */
  message: string
  /** Where it is, such as `['minutes']`; empty for the input as a whole. */
  path: PropertyKey[]
}

/** A path as the user reads it; a symbol key shows its description. */
const describePath = (path: readonly PropertyKey[]): string =>
  path.map(segment => (typeof segment === 'symbol' ? (segment.description ?? '') : String(segment))).join('.')

/**
 * Thrown when a handler's input fails its `@Validate` schema, so the handler does not run. The user is
 * answered privately with {@link ValidationError.issues}; an exception filter can phrase them otherwise.
 *
 * @example
 * ```ts
 * @Catch(ValidationError)
 * export class ValidationFilter implements ExceptionFilter<ValidationError> {
 *   async catch(error: ValidationError, context: ExecutionContext) {
 *     const lines = error.issues.map(issue => `${issue.path.map(String).join('.') || 'input'}: ${issue.message}`)
 *   }
 * }
 * ```
 */
export class ValidationError extends Error {
  /** @param issues - Every problem found, in the order the schema reported them. */
  constructor(readonly issues: ValidationIssue[]) {
    super(issues.map(issue => (issue.path.length > 0 ? `${describePath(issue.path)}: ${issue.message}` : issue.message)).join('\n'))
    this.name = 'ValidationError'
  }

  /** The issues a Standard Schema reported, with each path reduced to its keys. */
  static fromSchemaIssues(issues: readonly StandardSchemaV1Issue[]): ValidationError {
    return new ValidationError(
      issues.map(({ message, path = [] }) => ({
        message,
        path: path.map(segment => (typeof segment === 'object' ? segment.key : segment)),
      })),
    )
  }
}

/** One thing wrong with a message's command: a param whose word is not a value of its type, or a missing one. */
export interface MessageUsageIssue {
  /** The param it is about, if it is about one. */
  param?: string
  /** What is wrong, for the user. */
  message: string
}

/**
 * Thrown when a message names a command, by its prefix and command words, but its params do not fit the
 * command's pattern: a word that is not a value of its param's type, a param missing, or a command sent
 * where it does not work, such as a server-only one in a DM. The handler does not run. The user is answered with a reply
 * showing {@link MessageUsageError.usage} and the issues, deleted after
 * `@MeoCord({ messages: { deleteUsageRepliesAfter } })` seconds; an exception filter can answer otherwise.
 *
 * @example
 * ```ts
 * @Catch(MessageUsageError)
 * export class UsageFilter implements ExceptionFilter<MessageUsageError> {
 *   async catch(error: MessageUsageError, context: ExecutionContext) {
 *     await context.getMessage()?.reply(`Try \`${error.usage}\``)
 *   }
 * }
 * ```
 */
export class MessageUsageError extends Error {
  /** Whether the command works only in a server and the message was sent elsewhere. */
  readonly serverOnly: boolean
  /** Whether the command works only in direct messages and the message was sent in a server. */
  readonly dmOnly: boolean
  /** Whether the message used no prefix or mention, so it may be ordinary chat, which is not answered. */
  readonly quiet: boolean

  /**
   * @param usage - The command as the user should type it, such as `!ban <target> [reason…]`.
   * @param issues - Each thing wrong, in the order of the command's params.
   */
  constructor(
    readonly usage: string,
    readonly issues: MessageUsageIssue[],
    { serverOnly = false, dmOnly = false, quiet = false }: { serverOnly?: boolean; dmOnly?: boolean; quiet?: boolean } = {},
  ) {
    super(
      serverOnly || dmOnly
        ? issues.map(issue => issue.message).join('\n')
        : [`Usage: ${usage}`, ...issues.map(issue => issue.message)].join('\n'),
    )
    this.name = 'MessageUsageError'
    this.serverOnly = serverOnly
    this.dmOnly = dmOnly
    this.quiet = quiet
  }
}

/**
 * The scope a cooldown counts calls in.
 *
 * @group Types
 */
export type CooldownScope = 'user' | 'guild' | 'channel' | 'global'

/**
 * What a blocked caller is told: "Slow down: try again in 12s." The one place this text is written,
 * so a filter, a presenter or a translator can replace it by catching `CooldownError`.
 *
 * @param retryAfterMs - How long until the next call is allowed.
 *
 * @example
 * ```ts
 * cooldownMessage(12_000) // 'Slow down: try again in 12s.'
 * cooldownMessage(90_000) // 'Slow down: try again in 1m 30s.'
 * ```
 *
 * @group Utilities
 */
export function cooldownMessage(retryAfterMs: number): string {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000))
  const wait = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${seconds % 60 ? ` ${seconds % 60}s` : ''}`
  return `Slow down: try again in ${wait}.`
}

/**
 * Thrown when a `@Cooldown` blocks a call, so the handler does not run. The built-in fallback answers
 * only the caller, with {@link cooldownMessage}; a filter can catch it to answer otherwise.
 *
 * @example
 * ```ts
 * @Catch(CooldownError)
 * export class CooldownFilter implements ExceptionFilter<CooldownError> {
 *   async catch(error: CooldownError, context: ExecutionContext) {
 *     const interaction = context.getInteraction()
 *     if (interaction?.isRepliable()) {
 *       await interaction.reply({ content: `Wait ${Math.ceil(error.retryAfterMs / 1000)}s.`, flags: MessageFlags.Ephemeral })
 *     }
 *   }
 * }
 * ```
 *
 * @group Responses
 * @category Errors
 */
export class CooldownError extends Error {
  /**
   * @param retryAfterMs - How long until the next call is allowed.
   * @param per - The scope of the cooldown that blocked the call.
   */
  constructor(
    readonly retryAfterMs: number,
    readonly per: CooldownScope,
  ) {
    super(cooldownMessage(retryAfterMs))
    this.name = 'CooldownError'
  }
}

/**
 * The answer the built-in fallback gives a call {@link CooldownStoreError} refused.
 *
 * @example
 * ```ts
 * @Catch(CooldownStoreError)
 * export class StoreDownFilter implements ExceptionFilter<CooldownStoreError> {
 *   async catch(error: CooldownStoreError, context: ExecutionContext) {
 *     // MeoCord's words, and where to follow the outage
 *     await context.response?.error(error, { message: `${cooldownStoreMessage()} Status: https://status.example.com` })
 *   }
 * }
 * ```
 *
 * @group Utilities
 */
export function cooldownStoreMessage(): string {
  return "Cooldowns can't be checked right now: try again shortly."
}

/**
 * Thrown when the cooldown store fails to answer, by rejecting or within `cooldownStoreTimeoutMs`, and
 * `@MeoCord({ cooldownStoreFailure })` is `'deny'`, its default: the call is refused, as a cooldown that
 * cannot be checked is not known to allow it. The built-in fallback answers only the caller, with
 * {@link cooldownStoreMessage}; a filter can catch it to answer otherwise, or in the user's language.
 * MeoCord logs the failure once per outage, with its cause, and again when the store answers.
 *
 * @example
 * ```ts
 * @Catch(CooldownStoreError)
 * export class CooldownStoreFilter implements ExceptionFilter<CooldownStoreError> {
 *   async catch(error: CooldownStoreError, context: ExecutionContext) {
 *     await context.response?.error(error, { message: 'Hold on a moment and try again.', visibility: 'private' })
 *   }
 * }
 * ```
 *
 * @group Responses
 * @category Errors
 */
export class CooldownStoreError extends Error {
  /**
   * @param cause - What the store threw or rejected with; undefined when it did not answer in time.
   * @param timedOut - Whether the store did not answer within `cooldownStoreTimeoutMs`.
   */
  constructor(
    cause: unknown,
    readonly timedOut: boolean,
  ) {
    super(cooldownStoreMessage(), { cause })
    this.name = 'CooldownStoreError'
  }
}
