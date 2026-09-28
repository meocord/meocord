import { type AutocompleteInteraction, Message } from 'discord.js'
import { type ExecutionContext } from '@src/common/execution-context.js'
import { CommandNotFoundError, CooldownError, cooldownText, CooldownStoreError, GuardDeniedError, MessageUsageError, UserError, ValidationError } from '@src/common/errors.js'
import { type Logger } from '@src/common/logger.js'
import { responseOf } from '@src/common/response/response-state.js'
import { describeInteraction } from '@src/util/interaction.util.js'
import { isUserOutcome } from '@src/common/user-outcome.js'
import { getMessageHandlers } from '@src/decorator/controller.decorator.js'
import { useTheme } from '@src/core/theme-scope.js'
import { errorText } from '@src/common/translate-error.js'
import { interactionLocale, messageLocale, renderText, translatorOfClient } from '@src/common/meocord-text.js'
import { type MessageCommandOptions } from '@src/interface/index.js'
import { logFailedSend } from '@src/common/response/send-failure.js'

/** The app's message options the fallback's replies to messages follow. */
type MessageReplyOptions = Pick<MessageCommandOptions, 'deleteUsageRepliesAfter' | 'replyEmoji' | 'dmOnError' | 'dmOnCooldown'>

/**
 * Answers an error no filter handled, for the call `context` describes. Resolves to the error that kept it from
 * building its answer, if one did, so the call reports that fault; never throws, unless strict.
 */
export type Fallback = (error: unknown, context: ExecutionContext) => Promise<unknown>

/** How the fallback treats an answer it fails to build: logged in a bot, and also rethrown when `strict`, as in a test. */
export interface FallbackOptions {
  strict?: boolean
  /** Whether a caller a cooldown refused is yet to be told during this wait; see `claimCooldownNotice`. */
  cooldownNotice?: (refusal: CooldownError) => Promise<boolean>
}

const UNKNOWN_INTERACTION = 10062
/** Discord's refusal of a direct message: the member's are closed, or they blocked the bot. */
const CANNOT_MESSAGE_USER = 50007

/** A message command as its author typed it, prefix and command words, as the dispatcher matched it. */
const invocations = new WeakMap<Message, string>()

/** Records how `message` invoked its command, such as `!roll`, for a direct message about it to name. */
export function noteInvocation(message: Message, invocation: string): void {
  invocations.set(message, invocation)
}

function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined
}

/** Closes an autocomplete menu that nothing else answered. Never throws. */
export async function closeAutocomplete(interaction: AutocompleteInteraction, logger: Logger): Promise<void> {
  if (interaction.responded) return
  try {
    await interaction.respond([])
  } catch (error) {
    // The three-second window may already have closed, which is not actionable
    logFailedSend(logger, 'close the autocomplete window', error)
  }
}

function describeCall(context: ExecutionContext): string {
  const handler = context.getHandlerName()
  const message = context.getMessage()
  const reaction = context.getReaction()
  const subject = message
    ? `message "${message.content}"`
    : reaction
      ? `reaction "${reaction.emoji.name}"`
      : `${context.getType()}`
  return handler ? `${subject} for method "${handler}"` : subject
}

/** Replies to the message a `UserError` came from, without pinging its author; only logs one from a reaction or event. */
async function tellAuthor(
  context: ExecutionContext,
  error: UserError,
  logger: Logger,
  withEmoji: boolean | undefined,
  answering: Answering,
): Promise<void> {
  logger.debug(`Refused ${describeCall(context)}: ${error.message}`)
  const message = context.getMessage()
  if (message) await replyToMessage(message, error, logger, withEmoji, answering)
}

/**
 * Builds the answers to one error apart from sending them: a failure here is MeoCord's own, not Discord refusing a
 * send, so it is logged as an error naming the call, kept as the call's fault, and rethrown when strict.
 */
class Answering {
  failure: unknown

  constructor(
    private readonly logger: Logger,
    private readonly options: FallbackOptions,
  ) {}

  /** What `render` returns, or `undefined` when it threw. */
  build<T>(what: string, call: string, render: () => T): T | undefined {
    try {
      return render()
    } catch (error) {
      this.fail(what, call, error)
      return undefined
    }
  }

  /** Records that `what` could not be written for `call`, and rethrows when strict. */
  fail(what: string, call: string, error: unknown): void {
    this.logger.error(`Could not write ${what} for ${call}:`, error)
    this.failure ??= error
    if (this.options.strict) throw error
  }
}

/** The text of a reply to a message, after the call's `emojis.warning` when `withEmoji`. */
const replyText = (text: string, withEmoji: boolean | undefined) => (withEmoji ? `${useTheme().emojis.warning} ${text}` : text)

/**
 * Replies to a message with a `UserError`'s message, without pinging, after the call's `emojis.warning` when
 * `withEmoji`; a reply that fails is logged and left.
 */
export async function replyWithUserError(
  message: Message,
  error: UserError,
  logger: Logger,
  withEmoji?: boolean,
  options: FallbackOptions = {},
): Promise<unknown> {
  const answering = new Answering(logger, options)
  await replyToMessage(message, error, logger, withEmoji, answering)
  return answering.failure
}

async function replyToMessage(message: Message, error: UserError, logger: Logger, withEmoji: boolean | undefined, answering: Answering): Promise<void> {
  const content = answering.build('the reply', `message "${message.content}"`, () => replyText(error.message, withEmoji))
  if (content === undefined) return
  try {
    await message.reply({ content, allowedMentions: { repliedUser: false } })
  } catch (replyError) {
    logFailedSend(logger, 'reply to the message', replyError)
  }
}

/** Whether the call is a message command: a `@MessageHandler` with a pattern, not a listener for every message. */
function isCommand(context: ExecutionContext): boolean {
  const controller = context.getController()
  const method = context.getHandlerName()
  return controller !== undefined && getMessageHandlers(controller.prototype).some(handler => handler.method === method && handler.pattern !== undefined)
}

/**
 * Tells a message command's author what went wrong, where only they see it: in a direct message naming the
 * command, channel and server, or, for a command sent in one, as a reply there. A member whose direct messages
 * are closed is not told, at debug level; any other failed send is logged as {@link logFailedSend} does.
 */
async function tellPrivately(
  context: ExecutionContext,
  error: unknown,
  logger: Logger,
  withEmoji: boolean | undefined,
  answering: Answering,
): Promise<void> {
  const message = context.getMessage()
  if (!message) return
  const call = describeCall(context)
  const content = answering.build('the direct message', call, () => {
    const translator = translatorOfClient(message.client)
    const locale = messageLocale(message)
    if (!message.guild) return replyText(errorText(error, translator, locale), withEmoji)
    const channel = 'name' in message.channel && message.channel.name ? `#${message.channel.name}` : `<#${message.channelId}>`
    const place = { command: invocations.get(message) ?? message.content.split(/\s+/)[0]!, channel, server: message.guild.name }
    const text =
      error instanceof CooldownError
        ? { key: 'meocord.dm.cooldown', params: { ...place, wait: cooldownText(error.retryAfterMs) } }
        : { key: 'meocord.dm.error', params: place }
    return replyText(renderText(translator, locale, text), withEmoji)
  })
  if (content === undefined) return
  try {
    if (message.guild) await message.author.send({ content, allowedMentions: { parse: [] } })
    else await message.reply({ content, allowedMentions: { repliedUser: false, parse: [] } })
  } catch (failure) {
    if (errorCode(failure) === CANNOT_MESSAGE_USER) logger.debug(`Could not tell ${message.author.id} about ${call}: they take no direct messages`)
    else logFailedSend(logger, 'send a direct message about a command', failure)
  }
}

/** How long a reply showing a command's usage stays, in seconds, when the app does not say. */
export const DEFAULT_USAGE_REPLY_SECONDS = 10

/**
 * Replies to a message with what the command answers it, its usage, a guard's reason or what is wrong with
 * the input, in the server's language, then deletes the reply after the app's `deleteUsageRepliesAfter` seconds,
 * unless `0`. A reply or deletion that fails, for a missing permission or a message already gone, is logged and left.
 */
async function answerUsage(
  error: Error,
  context: ExecutionContext,
  logger: Logger,
  options: MessageReplyOptions | undefined,
  answering: Answering,
): Promise<void> {
  const message = context.getMessage()
  if (!message) return
  const seconds = options?.deleteUsageRepliesAfter ?? DEFAULT_USAGE_REPLY_SECONDS
  const content = answering.build('the usage reply', describeCall(context), () =>
    replyText(errorText(error, translatorOfClient(message.client), messageLocale(message)), options?.replyEmoji),
  )
  if (content === undefined) return
  try {
    const reply = await message.reply({ content, allowedMentions: { repliedUser: false, parse: [] } })
    if (seconds > 0) {
      setTimeout(() => {
        reply.delete().catch(failure => logFailedSend(logger, 'delete a reply to a command', failure))
      }, seconds * 1000).unref?.()
    }
  } catch (failure) {
    logFailedSend(logger, 'reply to a command', failure)
  }
}

/**
 * The built-in fallback: logs an error no filter handled, then answers the interaction through
 * `respond(interaction).error()` if it can still take an answer. A message that names a command but does
 * not fit it is answered with the command's usage, and one a guard denies or validation refuses with the
 * reason, each deleted after `deleteUsageRepliesAfter` seconds; a listener's denial only at debug level, since
 * its guard filters messages; one a `UserError` refused with that error's message; other errors of messages,
 * reactions and events are only logged.
 */
export function createFallback(
  logger: Logger,
  messageOptions: () => MessageReplyOptions | undefined = () => undefined,
  options: FallbackOptions = {},
): Fallback {
  return async (error, context) => {
    const answering = new Answering(logger, options)
    await answerError(error, context, answering)
    return answering.failure
  }

  async function answerError(error: unknown, context: ExecutionContext, answering: Answering): Promise<void> {
    const interaction = context.getInteraction()
    if (!interaction) {
      if (error instanceof MessageUsageError) {
        // With no prefix or mention the message may be chat that happens to begin with a command's words
        if (error.quiet) logger.debug(`Usage not shown for ${describeCall(context)}: ${error.message}`)
        else await answerUsage(error, context, logger, messageOptions(), answering)
        return
      }
      if ((error instanceof GuardDeniedError || error instanceof ValidationError) && context.getMessage()) {
        logger.debug(`${error instanceof GuardDeniedError ? 'Denied' : 'Invalid input for'} ${describeCall(context)}: ${error.message}`)
        // A command's sender addressed the bot, so is told why, as with the usage; a listener's guard only filters
        if (isCommand(context)) await answerUsage(error, context, logger, messageOptions(), answering)
        return
      }
      const replies = messageOptions()
      // A message sent too often is ignored, as a cooldown means; it is not a fault to report. Its author is told
      // privately when the app asks, once per wait
      if (error instanceof CooldownError) {
        logger.debug(`Cooldown (${error.per}) skipped ${describeCall(context)}`)
        if (replies?.dmOnCooldown && isCommand(context) && (await options.cooldownNotice?.(error))) {
          await tellPrivately(context, error, logger, replies.replyEmoji, answering)
        }
      }
      // Logged once per outage where the store failed, rather than for every call it refused
      else if (error instanceof CooldownStoreError) logger.debug(`Cooldown store down; skipped ${describeCall(context)}`)
      else if (error instanceof UserError) await tellAuthor(context, error, logger, replies?.replyEmoji, answering)
      else {
        logger.error(`Error handling ${describeCall(context)}:`, error)
        if (replies?.dmOnError && isCommand(context)) await tellPrivately(context, error, logger, replies.replyEmoji, answering)
      }
      return
    }

    if (interaction.isAutocomplete()) {
      logger.error(`Error handling ${describeInteraction(interaction)}:`, error)
      await closeAutocomplete(interaction, logger)
      return
    }

    if (!interaction.isRepliable()) {
      logger.error(`Error handling ${describeInteraction(interaction)}:`, error)
      return
    }

    if (errorCode(error) === UNKNOWN_INTERACTION) {
      logger.warn(`${describeInteraction(interaction)} expired before it could be answered:`, error)
      return
    }

    const call = describeInteraction(interaction)
    // MeoCord's own answers are in the user's language, as they alone see them
    const said = () => answering.build('the answer', call, () => errorText(error, translatorOfClient(interaction.client), interactionLocale(interaction)))
    // presentAnswer() logs a send that failed itself, and throws only when building the view fails
    const present = async (message: string | undefined, run: (message: string | undefined) => Promise<void>) => {
      try {
        await run(message)
      } catch (failure) {
        answering.fail('the answer', call, failure)
      }
    }
    if (error instanceof CommandNotFoundError) {
      logger.warn(error.message)
      const message = said()
      // Moot if a collector or another listener answered it meanwhile
      if (message !== undefined) await present(message, text => responseOf(interaction).presentAnswer(error, { message: text }, { ifUnanswered: true }))
    } else if (error instanceof GuardDeniedError) {
      logger.debug(`Denied ${call}: ${error.message}`)
      await present(error.message, text => responseOf(interaction).presentAnswer(error, { message: text, visibility: 'private' }))
    } else if (error instanceof CooldownError || error instanceof CooldownStoreError) {
      if (error instanceof CooldownError) logger.debug(`Cooldown (${error.per}) blocked ${call} for ${error.retryAfterMs} ms`)
      else logger.debug(`Cooldown store down; refused ${call}`)
      const message = said()
      if (message !== undefined) await present(message, text => responseOf(interaction).presentAnswer(error, { message: text, visibility: 'private' }))
    } else if (error instanceof UserError) {
      // The caller's own mistake, which only they need to see, and no fault to log
      logger.debug(`Refused ${call}: ${error.message}`)
      await present(error.message, text => responseOf(interaction).presentAnswer(error, { message: text, visibility: 'private' }))
    } else if (error instanceof ValidationError) {
      // The caller's own input is wrong: only they need to see which part, and it is no fault to log.
      logger.debug(`Invalid input for ${call}: ${error.message}`)
      await present(error.message, text => responseOf(interaction).presentAnswer(error, { message: text, visibility: 'private' }))
    } else {
      logger.error(`Error handling ${call}:`, error)
      await present(undefined, () => responseOf(interaction).presentAnswer(error))
    }
  }
}

export { isUserOutcome }
