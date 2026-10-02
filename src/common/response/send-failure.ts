import { DiscordAPIError, RESTJSONErrorCodes } from 'discord.js'
import { type Logger } from '@src/common/logger.js'

/** Discord's codes for a body it could not read: invalid form body or JSON, or an empty message. */
const MALFORMED_BODY = new Set<unknown>([
  RESTJSONErrorCodes.InvalidFormBodyOrContentType,
  RESTJSONErrorCodes.RequestBodyContainsInvalidJSON,
  RESTJSONErrorCodes.CannotSendAnEmptyMessage,
])

/**
 * Logs a send that failed. A refusal for something Discord reports, such as a missing permission or a message already
 * gone, is logged at debug; a body Discord could not read, or any other failure, is a fault in the code that sent it,
 * logged as an error.
 */
export function logFailedSend(logger: Pick<Logger, 'debug' | 'error'>, what: string, error: unknown): void {
  const refused = error instanceof DiscordAPIError && !MALFORMED_BODY.has(error.code)
  if (refused) logger.debug(`Could not ${what}: ${String(error)}`)
  else logger.error(`Could not ${what}:`, error)
}
