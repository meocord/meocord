/** The longest delay a timer keeps: 2^31 - 1 ms, about 24.8 days. Node fires a longer one at once. */
export const MAX_TIMER_MS = 2_147_483_647

/** A value as a refusal quotes it: a number as itself, `Infinity` and `NaN` included, a string in quotes. */
function quoted(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return String(value)
  return Array.isArray(value) ? 'an array' : typeof value
}

/**
 * What is wrong with a timeout option, or `undefined` when it is a number of milliseconds a timer keeps: finite, above
 * 0, or 0 or more with `allowZero`, and at most {@link MAX_TIMER_MS}. The caller names the option before it.
 */
export function timeoutProblem(value: unknown, { allowZero = false }: { allowZero?: boolean } = {}): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && (allowZero ? value >= 0 : value > 0) && value <= MAX_TIMER_MS) return undefined
  return `must be a number of milliseconds ${allowZero ? '0 or more' : 'above 0'}, at most ${MAX_TIMER_MS} (got ${quoted(value)})`
}
