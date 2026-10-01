import { MAX_TIMER_MS, timeoutProblem } from '@src/util/timer-limit.util.js'

/** How long shutdown waits for the `onShutdown` hooks when `shutdownTimeout` is not configured. */
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000

/** How much longer than the shards' own shutdown timeout the manager waits before killing them. */
export const SHUTDOWN_MARGIN_MS = 5_000

/** How long the application has to stop itself on a repeated signal, or past its shutdownTimeout, before the CLI kills it. */
export const FORCE_STOP_GRACE_MS = 2_000

/** The longest `shutdownTimeout`: a timer's limit less the margin the shard manager or the CLI waits on top of it. */
export const MAX_SHUTDOWN_TIMEOUT_MS = MAX_TIMER_MS - Math.max(SHUTDOWN_MARGIN_MS, FORCE_STOP_GRACE_MS)

/** What is wrong with a `shutdownTimeout`, or `undefined` for a number of milliseconds from 0 to the longest. */
export function shutdownTimeoutProblem(value: unknown): string | undefined {
  return timeoutProblem(value, { allowZero: true, max: MAX_SHUTDOWN_TIMEOUT_MS })
}

/**
 * The `shutdownTimeout` to wait: the configured one, or the default when none is set. One set but not valid, which only
 * a config the CLI never checked can carry, is named to `warn` in the check's own words, and the default is waited.
 */
export function shutdownTimeoutOf(value: unknown, warn: (message: string) => void): number {
  if (value === undefined) return DEFAULT_SHUTDOWN_TIMEOUT_MS
  const problem = shutdownTimeoutProblem(value)
  if (problem === undefined) return value as number
  warn(`shutdownTimeout ${problem}; shutdown waits the default ${DEFAULT_SHUTDOWN_TIMEOUT_MS} ms.`)
  return DEFAULT_SHUTDOWN_TIMEOUT_MS
}
