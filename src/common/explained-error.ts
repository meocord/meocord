const EXPLAINED = Symbol.for('meocord.explained')

/** Marks an error MeoCord has logged an explanation for, leaving the error otherwise as it was. */
export function markExplained(error: unknown): void {
  if (typeof error === 'object' && error !== null && Object.isExtensible(error)) {
    Object.defineProperty(error, EXPLAINED, { value: true, enumerable: false })
  }
}

/**
 * Whether MeoCord has already logged what went wrong and what to do about it, such as Discord refusing
 * the bot token or a privileged intent at login. The error is the one discord.js raised, unchanged; logging it again
 * would only repeat the explanation with a stack trace.
 *
 * @param error - An error `app.start()` rejected with.
 * @returns `true` when MeoCord explained the error.
 *
 * @example
 * ```typescript
 * // As src/main.ts starts the app: an error MeoCord explained is already logged
 * export function start(app: MeoCordApplication, logger: Logger) {
 *   app.start().catch((error: unknown) => {
 *     if (!isExplainedError(error)) logger.error('Error during startup:', error)
 *   })
 * }
 * ```
 *
 * @group Utilities
 */
export function isExplainedError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as Record<symbol, unknown>)[EXPLAINED] === true
}
