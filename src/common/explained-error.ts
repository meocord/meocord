const EXPLAINED = Symbol.for('meocord.explained')

/** Marks an error MeoCord has logged an explanation for, leaving the error otherwise as it was. */
export function markExplained(error: unknown): void {
  if (typeof error === 'object' && error !== null && Object.isExtensible(error)) {
    Object.defineProperty(error, EXPLAINED, { value: true, enumerable: false })
  }
}

/**
 * Whether MeoCord has already logged what went wrong and what to do about it.
 *
 * Use it where a bot logs a startup failure, so an error MeoCord explained is not logged twice: an app
 * `MeoCordFactory.create()` refuses, such as two handlers for one command, or Discord refusing the bot token or a
 * privileged intent at login. The error is otherwise unchanged.
 *
 * @param error - An error `MeoCordFactory.create()` threw or `app.start()` rejected with.
 * @returns `true` when MeoCord explained the error.
 *
 * @example
 * ```typescript
 * // src/main.ts, as a generated app has it
 * declare const App: new () => object
 * const logger = new Logger()
 *
 * async function bootstrap() {
 *   const app = MeoCordFactory.create(App)
 *   await app.start()
 * }
 *
 * // An error MeoCord explained, such as an app it refuses or a token Discord refused, is already logged
 * bootstrap().catch(error => {
 *   if (!isExplainedError(error)) logger.error('Error during startup:', error)
 *   process.exitCode = 1
 * })
 * ```
 *
 * @group Utilities
 */
export function isExplainedError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as Record<symbol, unknown>)[EXPLAINED] === true
}
