import { type StandardSchemaV1Issue } from '@src/interface/standard-schema.interface.js'
import { type MeoCordText, renderText } from '@src/common/meocord-text.js'
import { type CooldownLimit } from '@src/common/cooldown-store.js'

/**
 * Thrown by a guard to deny a call and tell the user why.
 *
 * Use it where returning `false`, which denies silently, would leave the user guessing. The built-in fallback shows
 * the message privately to the user who made an interaction, and as a reply to a message command; a listener's or a
 * reaction's denial is only logged. A filter can catch it to answer otherwise.
 *
 * @example
 * ```ts
 * @Guard()
 * export class OwnerGuard implements GuardInterface {
 *   canActivate(interaction: ButtonInteraction, { ownerId }: { ownerId: string }): boolean {
 *     if (interaction.user.id !== ownerId) throw new GuardDeniedError('Only the owner can use this.')
 *     return true
 *   }
 * }
 * ```
 *
 * @group Responses
 * @category Errors
 * @see {@link Guard}
 * @see {@link UserError}
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
 * A mistake the user can fix, such as too few coins, rather than a fault in the bot.
 *
 * Throw it from a handler, a pipe, a service or a guard to tell the user what to change; for a fault in the bot, throw
 * any other error. The built-in fallback shows its message to the user who made the call, privately for an interaction
 * and as a reply to a message.
 *
 * @remarks
 * It is logged only at debug level, and observers see the outcome `'refused'`. `code` and `context` let an exception
 * filter or a presenter phrase it otherwise, such as in the user's language: a presenter's `error()` receives the
 * error with the interaction.
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
 * The error raised for an interaction no handler matches, such as a button whose customId fits no pattern.
 *
 * Catch it in a global filter to answer an expired or unknown control in your own words. Without one, the
 * built-in fallback answers "Command not found!" and logs a warning naming the customId or command.
 *
 * @remarks
 * Only global filters see it, since no handler ran, so its `ExecutionContext` has no handler. A button, select
 * menu or modal no route takes is left for 1.5 seconds to any other listener on the client, such as a
 * collector, before it is raised; with no other listener, and for a command, it is raised at once.
 *
 * @example
 * ```ts
 * @Catch(CommandNotFoundError)
 * export class ExpiredControlFilter implements ExceptionFilter<CommandNotFoundError> {
 *   async catch(_error: CommandNotFoundError, context: ExecutionContext) {
 *     const interaction = context.getInteraction()
 *     if (interaction?.isRepliable()) await respond(interaction).send({ content: 'That button has expired.', flags: MessageFlags.Ephemeral })
 *   }
 * }
 * ```
 *
 * @group Responses
 * @category Errors
 * @see {@link Catch}
 * @see {@link https://meocord.dev/docs/4.2/exception-filters | Exception filters}
 */
export class CommandNotFoundError extends Error {
  /** @param message - What the error says, `No handler matched the interaction.` unless given. */
  constructor(message = 'No handler matched the interaction.') {
    super(message)
    this.name = 'CommandNotFoundError'
  }
}

/**
 * One problem `@Validate` found in a handler's input.
 *
 * @group Types
 * @see {@link ValidationError}
 */
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
 * Thrown when a handler's input fails its `@Validate` schema, so the handler does not run.
 *
 * The built-in fallback answers with each issue, privately for an interaction and as a reply to a message command.
 * Catch it in a filter to phrase the issues your own way, or in the user's language.
 *
 * @example
 * ```ts
 * @Catch(ValidationError)
 * export class ValidationFilter implements ExceptionFilter<ValidationError> {
 *   async catch(error: ValidationError, context: ExecutionContext) {
 *     const lines = error.issues.map(issue => `${issue.path.map(String).join('.') || 'input'}: ${issue.message}`)
 *     await context.response?.error(error, { message: lines.join('\n') })
 *   }
 * }
 * ```
 *
 * @group Responses
 * @category Errors
 * @see {@link Validate}
 * @see {@link ValidationIssue}
 */
export class ValidationError extends Error {
  /** @param issues - Every problem found, in the order the schema reported them. */
  constructor(readonly issues: ValidationIssue[]) {
    super(issues.map(issue => (issue.path.length > 0 ? `${describePath(issue.path)}: ${issue.message}` : issue.message)).join('\n'))
    this.name = 'ValidationError'
  }

  /**
   * The issues a Standard Schema reported, with each path reduced to its keys.
   *
   * @param issues - The issues, as the schema's `validate` reported them.
   * @returns The error, its issues in the schema's order.
   */
  static fromSchemaIssues(issues: readonly StandardSchemaV1Issue[]): ValidationError {
    return new ValidationError(
      issues.map(({ message, path = [] }) => ({
        message,
        path: path.map(segment => (typeof segment === 'object' ? segment.key : segment)),
      })),
    )
  }
}

/**
 * One thing wrong with a message command's input: a word that is not a value of its param's type, or a param missing.
 *
 * @group Types
 * @see {@link MessageUsageError}
 */
export interface MessageUsageIssue {
  /** The param it is about, if it is about one. */
  param?: string
  /** What is wrong, for the user, in English; the fallback answers in the server's language where the app translates it. */
  message: string
}

/**
 * The error raised when a message names a command but does not fit its pattern, which the user is told.
 *
 * Catch it in a filter to answer a misuse in the app's own words or language. Without one, the built-in fallback
 * replies with the command's usage and the issues, and deletes the reply after
 * `@MeoCord({ messages: { deleteUsageRepliesAfter } })` seconds.
 *
 * @remarks
 * The handler does not run. It carries the command's `usage`, such as `!ban <target> [reason…]`, and the
 * `issues`, one per param: a word that is not a value of its type, a param missing, a flag the command does
 * not have. `serverOnly` and `dmOnly` say the command was sent where it does not work. `quiet` marks a message
 * with no prefix or mention, which may be ordinary chat, so the fallback does not answer it.
 *
 * @example
 * ```ts
 * @Catch(MessageUsageError)
 * export class UsageFilter implements ExceptionFilter<MessageUsageError> {
 *   async catch(error: MessageUsageError, context: ExecutionContext) {
 *     if (!error.quiet) await context.getMessage()?.reply(`Try \`${error.usage}\``)
 *   }
 * }
 * ```
 *
 * @group Responses
 * @category Errors
 * @see {@link MessageHandler}
 * @see {@link translateError}
 * @see {@link https://meocord.dev/docs/4.2/message-commands | Message commands}
 */
export class MessageUsageError extends Error {
  /** Whether the command works only in a server and the message was sent elsewhere. */
  readonly serverOnly: boolean
  /** Whether the command works only in direct messages and the message was sent in a server. */
  readonly dmOnly: boolean
  /** Whether the message used no prefix or mention, so it may be ordinary chat, which is not answered. */
  readonly quiet: boolean

  /**
   * @param usage - The command as the user should type it, such as `!ban <target> [reason…]`, or one line per
   *   subcommand for a message that names only their parent.
   * @param issues - Each thing wrong, in the order of the command's params.
   * @param options - `serverOnly` or `dmOnly` for a command sent where it does not work, and `quiet` for a message
   *   that used no prefix or mention.
   */
  constructor(
    readonly usage: string,
    readonly issues: MessageUsageIssue[],
    { serverOnly = false, dmOnly = false, quiet = false }: { serverOnly?: boolean; dmOnly?: boolean; quiet?: boolean } = {},
  ) {
    super(serverOnly || dmOnly ? issues.map(issue => issue.message).join('\n') : [renderText(undefined, undefined, usageHeading(usage)), ...issues.map(issue => issue.message)].join('\n'))
    this.name = 'MessageUsageError'
    this.serverOnly = serverOnly
    this.dmOnly = dmOnly
    this.quiet = quiet
  }
}

/** The heading of a usage reply: one usage after it, or several, such as a parent's subcommands, each on a line below it. */
export function usageHeading(usage: string): MeoCordText {
  return usage.includes('\n') ? { key: 'meocord.usage.headingMany', params: { usages: usage } } : { key: 'meocord.usage.heading', params: { usage } }
}

/**
 * The scope a cooldown counts calls in.
 *
 * @group Types
 */
export type CooldownScope = 'user' | 'guild' | 'channel' | 'global'

/**
 * The wait before a cooldown allows another call, in plain English, such as "Slow down: try again in 12s.": the
 * message of a {@link CooldownError}, for logs and tests.
 *
 * The answer a caller sees is `meocord.cooldown.until` instead, with the time the wait ends as a Discord timestamp,
 * which the reader's client words in their language and counts down; {@link translateError} gives it.
 *
 * @param retryAfterMs - How long until the next call is allowed.
 * @returns The message, in English.
 *
 * @example
 * ```ts
 * cooldownMessage(12_000) // 'Slow down: try again in 12s.'
 * cooldownMessage(90_000) // 'Slow down: try again in 1m 30s.'
 * cooldownMessage(86_340_000) // 'Slow down: try again in 23h 59m.'
 * ```
 *
 * @group Utilities
 */
export function cooldownMessage(retryAfterMs: number): string {
  return `Slow down: try again in ${waitText(retryAfterMs)}.`
}

/**
 * A wait in its two biggest units: seconds, then minutes and seconds, from an hour hours and minutes, and from a day
 * days and hours. The smaller unit is rounded up, so the text never says less than the wait.
 */
function waitText(retryAfterMs: number): string {
  const both = (big: number, bigUnit: string, small: number, smallUnit: string) =>
    small === 0 ? `${big}${bigUnit}` : `${big}${bigUnit} ${small}${smallUnit}`
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000))
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3_600) return both(Math.floor(seconds / 60), 'm', seconds % 60, 's')
  const minutes = Math.ceil(seconds / 60)
  if (minutes < 1_440) return both(Math.floor(minutes / 60), 'h', minutes % 60, 'm')
  const hours = Math.ceil(minutes / 60)
  return both(Math.floor(hours / 24), 'd', hours % 24, 'h')
}

/** The text a caller sees for a cooldown's wait: when it ends, as a Discord timestamp, rounded up to the second. */
export function cooldownText(retryAt: Date): MeoCordText {
  return { key: 'meocord.cooldown.until', params: { when: `<t:${Math.ceil(retryAt.getTime() / 1000)}:R>` } }
}

/**
 * Thrown when a `@Cooldown` blocks a call, so the handler does not run.
 *
 * Catch it in a filter to answer the caller your own way. Without one, the built-in fallback answers only the caller,
 * with `meocord.cooldown.until`: the time the wait ends, which `retryAt` holds, as a Discord timestamp. A message
 * command is not answered, unless `messages.dmOnCooldown` tells its author in a direct message, once per wait.
 *
 * @example
 * ```ts
 * @Catch(CooldownError)
 * export class CooldownFilter implements ExceptionFilter<CooldownError> {
 *   async catch(error: CooldownError, context: ExecutionContext) {
 *     const interaction = context.getInteraction()
 *     if (interaction?.isRepliable()) {
 *       await interaction.reply({ content: `You can do that again ${time(error.retryAt, 'R')}.`, flags: MessageFlags.Ephemeral })
 *     }
 *   }
 * }
 * ```
 *
 * @group Responses
 * @category Errors
 */
export class CooldownError extends Error {
  /** When the next call is allowed: when the error was made, plus {@link CooldownError.retryAfterMs}. */
  readonly retryAt: Date

  /**
   * @param retryAfterMs - How long until the next call is allowed.
   * @param per - The scope of the cooldown that blocked the call.
   * @param limit - The limit of the cooldown that blocked the call, as `@Cooldown` gives it: its uses and window.
   */
  constructor(
    readonly retryAfterMs: number,
    readonly per: CooldownScope,
    readonly limit?: CooldownLimit,
  ) {
    super(cooldownMessage(retryAfterMs))
    this.name = 'CooldownError'
    this.retryAt = new Date(Date.now() + retryAfterMs)
  }
}

/**
 * The answer the built-in fallback gives a call {@link CooldownStoreError} refused, in English.
 *
 * An app translates it as `meocord.cooldown.storeDown` in its catalogs, and {@link translateError} gives it in a
 * user's language.
 *
 * @returns The answer, in English.
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
  return renderText(undefined, undefined, { key: 'meocord.cooldown.storeDown' })
}

/**
 * Thrown when the cooldown store fails and `@MeoCord({ cooldownStoreFailure })` is `'deny'`, its default.
 *
 * Catch it in a filter to word the refusal your own way, or in the user's language. Without one, the built-in fallback
 * answers only the caller, with {@link cooldownStoreMessage}. A message command is not answered, unless
 * `messages.dmOnError` tells its author in a direct message, once per outage.
 *
 * @remarks
 * The store fails when it rejects or does not answer within `cooldownStoreTimeoutMs`. The call is refused, since a
 * cooldown that cannot be checked is not known to allow it. MeoCord logs the failure once per outage, with its cause,
 * and again when the store answers after 30 seconds without a failure.
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
