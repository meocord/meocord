import { type Logger } from '@src/common/logger.js'

const warned = new Set<string>()

/** Warns once per run that `old` goes in 5.0, naming what to use instead. */
export function warnDeprecated(logger: Logger, old: string, replacement: string): void {
  const text = `${old} is deprecated and will be removed in the next major version (5.0). Use ${replacement} instead.`
  if (warned.has(text)) return
  warned.add(text)
  logger.warn(text)
}

/** Forgets which deprecations have warned: for specs. */
export function forgetDeprecationWarnings(): void {
  warned.clear()
}
