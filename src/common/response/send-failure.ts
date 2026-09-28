import { DiscordAPIError } from 'discord.js'
import { type Logger } from '@src/common/logger.js'

/**
 * Logs a send that failed: one Discord refused, for a missing permission or a message already gone, is routine and
 * logged at debug; any other failure is a fault in the code that sent it, logged as an error.
 */
export function logFailedSend(logger: Pick<Logger, 'debug' | 'error'>, what: string, error: unknown): void {
  if (error instanceof DiscordAPIError) logger.debug(`Could not ${what}: ${String(error)}`)
  else logger.error(`Could not ${what}:`, error)
}
