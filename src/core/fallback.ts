import { type APIEmbed, type AttachmentBuilder, type AutocompleteInteraction, Message } from 'discord.js'
import { type ExecutionContext } from '@src/common/execution-context.js'
import { CommandNotFoundError, CooldownError, cooldownText, CooldownStoreError, GuardDeniedError, MessageUsageError, UserError, ValidationError } from '@src/common/errors.js'
import { type Logger } from '@src/common/logger.js'
import { responseOf } from '@src/common/response/response-state.js'
import { describeInteraction } from '@src/util/interaction.util.js'
import { isUserOutcome } from '@src/common/user-outcome.js'
import { getMessageHandlers } from '@src/decorator/controller.decorator.js'
import { themeForInteraction, useTheme } from '@src/core/theme-scope.js'
import { errorText } from '@src/common/translate-error.js'
import { interactionLocale, messageLocale, renderText, translatorOfClient } from '@src/common/meocord-text.js'
import { type MessageCommandOptions } from '@src/interface/index.js'
import { logFailedSend } from '@src/common/response/send-failure.js'
import {
  attachmentsOf,
  DEFAULT_ATTACHMENT_SIZE_LIMIT,
  isTooLarge,
  presenterFor,
  REFUSED_AS_TOO_LARGE,
  renderEmbed,
  withoutFiles,
  withSendableFiles,
} from '@src/common/response/presenter.js'
import { escapeForLog, quoteForLog } from '@src/util/user-text.util.js'

/** The app's message options the fallback's replies to messages follow. */
type MessageReplyOptions = Pick<MessageCommandOptions, 'deleteUsageRepliesAfter' | 'replyEmoji' | 'dmOnError' | 'dmOnCooldown'>

/**
 * Answers an error no filter handled, for the call `context` describes. Resolves to the error that kept it from
 * building its answer, if one did, so the call reports that fault; never throws, unless strict.
 */
export type Fallback = (error: unknown, context: ExecutionContext) => Promise<unknown>

/** How the fallback answers, beyond its defaults. */
export interface FallbackOptions {
  /** Rethrows an answer it fails to build, as in a test, besides logging it as a bot does. */
  strict?: boolean
  /** Whether a caller a cooldown refused is yet to be told during this wait; see `claimCooldownNotice`. */
  cooldownNotice?: (refusal: CooldownError) => Promise<boolean>
  /** Whether a caller refused because the cooldown store failed is yet to be told; see `claimStoreDownNotice`. */
  storeDownNotice?: (who: string) => boolean
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

/** Names a call in a log line, quoting the message's text as {@link quoteForLog} does, since its author wrote it. */
function describeCall(context: ExecutionContext): string {
  const handler = context.getHandlerName()
  const message = context.getMessage()
  const reaction = context.getReaction()
  const subject = message
    ? `message ${quoteForLog(String(message.content))}`
    : reaction
      ? `reaction ${quoteForLog(String(reaction.emoji.name))}`
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
  logger.debug(`Refused ${describeCall(context)}: ${escapeForLog(error.message)}`)
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

  /** What `draw` resolves to, or `undefined` when it threw or rejected. */
  async draw<T>(what: string, call: string, draw: () => Promise<T>): Promise<T | undefined> {
    try {
      return await draw()
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

/** A reply to a message: plain text, or an app presenter's embed and the files it shows. */
type ReplyBody = { content: string } | { embeds: APIEmbed[]; files?: AttachmentBuilder[] }

/** A reply as drawn, and, when it carries files, the same reply without them, for Discord refusing them as too large. */
interface PresentedReply {
  body: ReplyBody
  withoutFiles?: ReplyBody
  /** Warns that the reply goes without its files, and why. */
  warn?: (problem: string) => void
  /** Why the presenter's view could not be drawn, when the plain text stands in for it: the call's fault to report. */
  failure?: unknown
}

/** Sends a drawn reply with `send`, and again without its files should Discord refuse them as too large. */
async function sendReply<T>(reply: PresentedReply, send: (body: ReplyBody) => Promise<T>): Promise<T> {
  try {
    return await send(reply.body)
  } catch (error) {
    if (!reply.withoutFiles || !isTooLarge(error)) throw error
    reply.warn?.(REFUSED_AS_TOO_LARGE)
    return send(reply.withoutFiles)
  }
}

/** The text of a reply to a message, after the call's `emojis.warning` when `withEmoji`. */
const replyText = (text: string, withEmoji: boolean | undefined) => (withEmoji ? `${useTheme().emojis.warning} ${text}` : text)

/**
 * `text`, answering `error` for `message`: plain, after the call's `emojis.warning` when `withEmoji`, unless the
 * presenter's `messageError` draws it as an embed, coloured as an interaction's view is, with that emoji when it has
 * none and its files when Discord takes them. Should that view fail to draw or render, the plain text stands in, and
 * the failure comes back with it, for the caller to report once sent.
 */
async function presentedReply(message: Message, error: unknown, text: string, withEmoji: boolean | undefined, logger: Logger): Promise<PresentedReply> {
  const presenter = presenterFor(message.client)
  const plain = { body: { content: replyText(text, withEmoji) } }
  const { messageError } = presenter
  if (!messageError) return plain
  try {
    const theme = await themeForInteraction(message)
    const translator = translatorOfClient(message.client)
    const locale = messageLocale(message) ?? translator?.defaultLocale ?? 'en-US'
    const tone = isUserOutcome(error, message) ? 'warning' : 'danger'
    const drawn = await messageError.call(presenter, { message, locale, mode: 'embed', theme }, { message: text, error, tone })
    let view = drawn.color === undefined ? { ...drawn, color: theme.colors.primary } : drawn
    if (withEmoji && view.emoji === undefined) view = { ...view, emoji: theme.emojis.warning }
    const warn = (problem: string) =>
      logger.warn(`The view for message ${quoteForLog(String(message.content))} is sent without its files: ${problem}.`)
    view = withSendableFiles(view, { sizeLimit: DEFAULT_ATTACHMENT_SIZE_LIMIT }, warn)
    const files = attachmentsOf(view)
    const embeds = [renderEmbed(view)]
    if (files.length === 0) return { body: { embeds } }
    return { body: { embeds, files }, withoutFiles: { embeds: [renderEmbed(withoutFiles(view))] }, warn }
  } catch (failure) {
    return { ...plain, failure }
  }
}

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
  const call = `message ${quoteForLog(String(message.content))}`
  const reply = await answering.draw('the reply', call, () => presentedReply(message, error, error.message, withEmoji, logger))
  if (reply === undefined) return
  try {
    await sendReply(reply, body => message.reply({ ...body, allowedMentions: { repliedUser: false } }))
  } catch (replyError) {
    logFailedSend(logger, 'reply to the message', replyError)
  }
  // The plain text answered for a presenter that failed; the failure is still the call's fault
  if (reply.failure !== undefined) answering.fail('the reply', call, reply.failure)
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
  const reply = await answering.draw('the direct message', call, () => {
    const translator = translatorOfClient(message.client)
    const locale = messageLocale(message)
    if (!message.guild) return presentedReply(message, error, errorText(error, translator, locale), withEmoji, logger)
    const channel = 'name' in message.channel && message.channel.name ? `#${message.channel.name}` : `<#${message.channelId}>`
    const place = { command: invocations.get(message) ?? message.content.split(/\s+/)[0]!, channel, server: message.guild.name }
    const text =
      error instanceof CooldownError
        ? { key: 'meocord.dm.cooldown', params: { ...place, wait: cooldownText(error.retryAt) } }
        : { key: 'meocord.dm.error', params: { ...place, reason: errorText(error, translator, locale) } }
    return presentedReply(message, error, renderText(translator, locale, text), withEmoji, logger)
  })
  if (reply === undefined) return
  try {
    if (message.guild) await sendReply(reply, body => message.author.send({ ...body, allowedMentions: { parse: [] } }))
    else await sendReply(reply, body => message.reply({ ...body, allowedMentions: { repliedUser: false, parse: [] } }))
  } catch (failure) {
    if (errorCode(failure) === CANNOT_MESSAGE_USER) logger.debug(`Could not tell ${message.author.id} about ${call}: they take no direct messages`)
    else logFailedSend(logger, 'send a direct message about a command', failure)
  }
  if (reply.failure !== undefined) answering.fail('the direct message', call, reply.failure)
}

/**
 * Logs an error an interaction's call raised that is the user's own outcome, below error level, and says whether it
 * was one: a command no handler takes, a denial, a cooldown or its failing store, a refusal or invalid input.
 * `isUserOutcome` agrees.
 */
function logUserOutcome(logger: Logger, error: unknown, call: string): boolean {
  if (error instanceof CommandNotFoundError) logger.warn(error.message)
  else if (error instanceof GuardDeniedError) logger.debug(`Denied ${call}: ${escapeForLog(error.message)}`)
  else if (error instanceof CooldownError) logger.debug(`Cooldown (${error.per}) blocked ${call} for ${error.retryAfterMs} ms`)
  else if (error instanceof CooldownStoreError) logger.debug(`Cooldown store down; refused ${call}`)
  else if (error instanceof UserError) logger.debug(`Refused ${call}: ${escapeForLog(error.message)}`)
  else if (error instanceof ValidationError) logger.debug(`Invalid input for ${call}: ${escapeForLog(error.message)}`)
  else return false
  return true
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
  const call = describeCall(context)
  const body = await answering.draw('the usage reply', call, () =>
    presentedReply(message, error, errorText(error, translatorOfClient(message.client), messageLocale(message)), options?.replyEmoji, logger),
  )
  if (body === undefined) return
  await sendUsage(message, body, seconds, logger)
  if (body.failure !== undefined) answering.fail('the usage reply', call, body.failure)
}

/** Sends a usage reply, and deletes it after `seconds` unless `0`; a reply or deletion that fails is logged and left. */
async function sendUsage(message: Message, body: PresentedReply, seconds: number, logger: Logger): Promise<void> {
  try {
    const reply = await sendReply(body, drawn => message.reply({ ...drawn, allowedMentions: { repliedUser: false, parse: [] } }))
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
 * The built-in fallback: logs an error no filter handled and answers the call. An interaction that can still take an
 * answer gets its error view, and an autocomplete an empty menu. A message command gets its usage, a guard's or
 * validation's reason, or a `UserError`'s message as a reply, and with `dmOnError` or `dmOnCooldown` a direct message
 * for other errors and cooldown refusals. Anything else, as a reaction's or an event's error, is only logged.
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
        if (error.quiet) logger.debug(`Usage not shown for ${describeCall(context)}: ${escapeForLog(error.message)}`)
        else await answerUsage(error, context, logger, messageOptions(), answering)
        return
      }
      if (error instanceof GuardDeniedError || error instanceof ValidationError) {
        logger.debug(`${error instanceof GuardDeniedError ? 'Denied' : 'Invalid input for'} ${describeCall(context)}: ${escapeForLog(error.message)}`)
        // A command's sender addressed the bot, so is told why, as with the usage; a listener's or a reaction's guard only filters
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
      // The store's failure is logged once per outage where it failed, each call it refused only at debug level; a
      // command's author is told privately when the app asks, once per outage
      else if (error instanceof CooldownStoreError) {
        logger.debug(`Cooldown store down; skipped ${describeCall(context)}`)
        const author = context.getMessage()?.author.id
        if (replies?.dmOnError && isCommand(context) && author !== undefined && options.storeDownNotice?.(author)) {
          await tellPrivately(context, error, logger, replies.replyEmoji, answering)
        }
      }
      else if (error instanceof UserError) await tellAuthor(context, error, logger, replies?.replyEmoji, answering)
      else {
        logger.error(`Error handling ${describeCall(context)}:`, error)
        if (replies?.dmOnError && isCommand(context)) await tellPrivately(context, error, logger, replies.replyEmoji, answering)
      }
      return
    }

    if (interaction.isAutocomplete()) {
      // The menu closes either way; a denial or a refusal is the user's outcome there as on a command
      if (!logUserOutcome(logger, error, describeInteraction(interaction))) logger.error(`Error handling ${describeInteraction(interaction)}:`, error)
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
    if (!logUserOutcome(logger, error, call)) {
      logger.error(`Error handling ${call}:`, error)
      await present(undefined, () => responseOf(interaction).presentAnswer(error))
    } else if (error instanceof CommandNotFoundError) {
      const message = said()
      // Moot if a collector or another listener answered it meanwhile
      if (message !== undefined) await present(message, text => responseOf(interaction).presentAnswer(error, { message: text }, { ifUnanswered: true }))
    } else if (error instanceof CooldownError || error instanceof CooldownStoreError) {
      const message = said()
      if (message !== undefined) await present(message, text => responseOf(interaction).presentAnswer(error, { message: text, visibility: 'private' }))
    } else {
      // A denial, a refusal or invalid input, in the app's own words, which only the caller needs to see
      const { message } = error as Error
      await present(message, text => responseOf(interaction).presentAnswer(error, { message: text, visibility: 'private' }))
    }
  }
}

export { isUserOutcome }
