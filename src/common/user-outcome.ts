import { BaseInteraction, type Interaction } from 'discord.js'
import {
  CommandNotFoundError,
  CooldownError,
  CooldownStoreError,
  GuardDeniedError,
  MessageUsageError,
  UserError,
  ValidationError,
} from '@src/common/errors.js'

/**
 * Whether the fallback answers `error`, raised for `call`, as the user's own outcome rather than a fault:
 * one it handles below error level. It mirrors `createFallback`'s branches in core/fallback.ts, which
 * fallback.spec pins pair by pair, and gives a presenter's error its `tone`. An interaction that expired
 * is only warned about, but counts as a fault: it is a timing failure.
 */
export function isUserOutcome(error: unknown, call: unknown): boolean {
  if (!(call instanceof BaseInteraction)) {
    return (
      error instanceof GuardDeniedError ||
      error instanceof ValidationError ||
      error instanceof MessageUsageError ||
      error instanceof CooldownError ||
      error instanceof CooldownStoreError ||
      error instanceof UserError
    )
  }
  const interaction = call as Interaction
  if (!interaction.isAutocomplete() && !interaction.isRepliable()) return false
  return (
    error instanceof CommandNotFoundError ||
    error instanceof GuardDeniedError ||
    error instanceof CooldownError ||
    error instanceof CooldownStoreError ||
    error instanceof UserError ||
    error instanceof ValidationError
  )
}
