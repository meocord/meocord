import { type Logger } from '@src/common/logger.js'

const warned = new Set<string>()

/** Warns once per run that `old` goes in 5.0, naming what to use instead. */
export function warnDeprecated(logger: Logger, old: string, replacement: string): void {
  warnOnce(logger, `${old} is deprecated and will be removed in the next major version (5.0). Use ${replacement} instead.`)
}

/**
 * Warns once per run that a behaviour changes in 5.0, such as a call 5.0 refuses or rejects, naming what to use
 * instead. For a deprecated name, use {@link warnDeprecated}.
 */
export function warnDeprecatedBehaviour(logger: Logger, old: string, outcome: 'is refused' | 'rejects', replacement: string): void {
  warnOnce(logger, `${old} is deprecated; in the next major version (5.0) it ${outcome}. Use ${replacement} instead.`)
}

function warnOnce(logger: Logger, text: string): void {
  if (warned.has(text)) return
  warned.add(text)
  logger.warn(text)
}

/** Forgets which deprecations have warned: for specs. */
export function forgetDeprecationWarnings(): void {
  warned.clear()
}
