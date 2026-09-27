import { type AutocompleteInteraction, Message } from 'discord.js'
import { type ExecutionContext } from '@src/common/execution-context.js'
import { CommandNotFoundError, CooldownError, CooldownStoreError, GuardDeniedError, MessageUsageError, UserError, ValidationError } from '@src/common/errors.js'
import { type Logger } from '@src/common/logger.js'
import { respond, responseOf } from '@src/common/response/response-state.js'
import { describeInteraction } from '@src/util/interaction.util.js'
import { isUserOutcome } from '@src/common/user-outcome.js'
import { getMessageHandlers } from '@src/decorator/controller.decorator.js'
import { useTheme } from '@src/core/theme-scope.js'
import { errorText } from '@src/common/translate-error.js'
import { interactionLocale, messageLocale, translatorOfClient } from '@src/common/meocord-text.js'
import { type MessageCommandOptions } from '@src/interface/index.js'

/** The app's message options the fallback's replies to messages follow. */
type MessageReplyOptions = Pick<MessageCommandOptions, 'deleteUsageRepliesAfter' | 'replyEmoji'>

/** Answers an error no filter handled, for the call `context` describes. Never throws. */
export type Fallback = (error: unknown, context: ExecutionContext) => Promise<void>

const UNKNOWN_INTERACTION = 10062

function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined
}

/** Closes an autocomplete menu that nothing else answered. Never throws. */
export async function closeAutocomplete(interaction: AutocompleteInteraction, logger: Logger): Promise<void> {
  if (interaction.responded) return
  try {
    await interaction.respond([])
  } catch (error) {
    // The three-second window may already have closed, which is not actionable.
    logger.debug(`Could not close autocomplete window: ${String(error)}`)
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
async function tellAuthor(context: ExecutionContext, error: UserError, logger: Logger, withEmoji: boolean | undefined): Promise<void> {
  logger.debug(`Refused ${describeCall(context)}: ${error.message}`)
  const message = context.getMessage()
  if (message) await replyWithUserError(message, error, logger, withEmoji)
}

/** The text of a reply to a message, after the call's `emojis.warning` when `withEmoji`. */
const replyText = (text: string, withEmoji: boolean | undefined) => (withEmoji ? `${useTheme().emojis.warning} ${text}` : text)

/**
 * Replies to a message with a `UserError`'s message, without pinging, after the call's `emojis.warning` when
 * `withEmoji`; a reply that fails is logged and left.
 */
export async function replyWithUserError(message: Message, error: UserError, logger: Logger, withEmoji?: boolean): Promise<void> {
  try {
    await message.reply({ content: replyText(error.message, withEmoji), allowedMentions: { repliedUser: false } })
  } catch (replyError) {
    logger.debug(`Could not reply to the message: ${String(replyError)}`)
  }
}

/** Whether the call is a message command: a `@MessageHandler` with a pattern, not a listener for every message. */
function isCommand(context: ExecutionContext): boolean {
  const controller = context.getController()
  const method = context.getHandlerName()
  return controller !== undefined && getMessageHandlers(controller.prototype).some(handler => handler.method === method && handler.pattern !== undefined)
}

/** How long a reply showing a command's usage stays, in seconds, when the app does not say. */
export const DEFAULT_USAGE_REPLY_SECONDS = 10

/**
 * Replies to a message with what the command answers it, its usage, a guard's reason or what is wrong with
 * the input, in the server's language, then deletes the reply after the app's `deleteUsageRepliesAfter` seconds,
 * unless `0`. A reply or deletion that fails, for a missing permission or a message already gone, is logged and left.
 */
async function answerUsage(error: Error, context: ExecutionContext, logger: Logger, options: MessageReplyOptions | undefined): Promise<void> {
  const message = context.getMessage()
  if (!message) return
  const seconds = options?.deleteUsageRepliesAfter ?? DEFAULT_USAGE_REPLY_SECONDS
  try {
    const text = errorText(error, translatorOfClient(message.client), messageLocale(message))
    const reply = await message.reply({ content: replyText(text, options?.replyEmoji), allowedMentions: { repliedUser: false, parse: [] } })
    if (seconds > 0) {
      setTimeout(() => {
        reply.delete().catch(failure => logger.debug(`Could not delete a reply to a command: ${String(failure)}`))
      }, seconds * 1000).unref?.()
    }
  } catch (failure) {
    logger.debug(`Could not reply to a command: ${String(failure)}`)
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
export function createFallback(logger: Logger, messageOptions: () => MessageReplyOptions | undefined = () => undefined): Fallback {
  return async (error, context) => {
    const interaction = context.getInteraction()
    if (!interaction) {
      if (error instanceof MessageUsageError) {
        // With no prefix or mention the message may be chat that happens to begin with a command's words
        if (error.quiet) logger.debug(`Usage not shown for ${describeCall(context)}: ${error.message}`)
        else await answerUsage(error, context, logger, messageOptions())
        return
      }
      if ((error instanceof GuardDeniedError || error instanceof ValidationError) && context.getMessage()) {
        logger.debug(`${error instanceof GuardDeniedError ? 'Denied' : 'Invalid input for'} ${describeCall(context)}: ${error.message}`)
        // A command's sender addressed the bot, so is told why, as with the usage; a listener's guard only filters
        if (isCommand(context)) await answerUsage(error, context, logger, messageOptions())
        return
      }
      // A message sent too often is ignored, as a cooldown means; it is not a fault to report.
      if (error instanceof CooldownError) logger.debug(`Cooldown (${error.per}) skipped ${describeCall(context)}`)
      // Logged once per outage where the store failed, rather than for every call it refused
      else if (error instanceof CooldownStoreError) logger.debug(`Cooldown store down; skipped ${describeCall(context)}`)
      else if (error instanceof UserError) await tellAuthor(context, error, logger, messageOptions()?.replyEmoji)
      else logger.error(`Error handling ${describeCall(context)}:`, error)
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

    // MeoCord's own answers are in the user's language, as they alone see them
    const said = () => errorText(error, translatorOfClient(interaction.client), interactionLocale(interaction))
    if (error instanceof CommandNotFoundError) {
      logger.warn(error.message)
      // Moot if a collector or another listener answered it meanwhile
      await responseOf(interaction).error(error, { message: said() }, { ifUnanswered: true })
    } else if (error instanceof GuardDeniedError) {
      logger.debug(`Denied ${describeInteraction(interaction)}: ${error.message}`)
      await respond(interaction).error(error, { message: error.message, visibility: 'private' })
    } else if (error instanceof CooldownError) {
      logger.debug(`Cooldown (${error.per}) blocked ${describeInteraction(interaction)} for ${error.retryAfterMs} ms`)
      await respond(interaction).error(error, { message: said(), visibility: 'private' })
    } else if (error instanceof CooldownStoreError) {
      logger.debug(`Cooldown store down; refused ${describeInteraction(interaction)}`)
      await respond(interaction).error(error, { message: said(), visibility: 'private' })
    } else if (error instanceof UserError) {
      // The caller's own mistake, which only they need to see, and no fault to log
      logger.debug(`Refused ${describeInteraction(interaction)}: ${error.message}`)
      await respond(interaction).error(error, { message: error.message, visibility: 'private' })
    } else if (error instanceof ValidationError) {
      // The caller's own input is wrong: only they need to see which part, and it is no fault to log.
      logger.debug(`Invalid input for ${describeInteraction(interaction)}: ${error.message}`)
      await respond(interaction).error(error, { message: error.message, visibility: 'private' })
    } else {
      logger.error(`Error handling ${describeInteraction(interaction)}:`, error)
      await respond(interaction).error(error)
    }
  }
}

export { isUserOutcome }
