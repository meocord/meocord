import { MAX_TIMER_MS } from '@src/util/timer-limit.util.js'
import {
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  FORCE_STOP_GRACE_MS,
  MAX_SHUTDOWN_TIMEOUT_MS,
  SHUTDOWN_MARGIN_MS,
  shutdownTimeoutOf,
} from '@src/util/shutdown-timeout.util.js'

describe('shutdownTimeout', () => {
  it('leaves room under a timer’s limit for the margins the shard manager and the CLI wait on top', () => {
    expect(MAX_SHUTDOWN_TIMEOUT_MS + Math.max(SHUTDOWN_MARGIN_MS, FORCE_STOP_GRACE_MS)).toBe(MAX_TIMER_MS)
  })

  // A bot started without the CLI loads its config unchecked
  it.each([
    [0, 0],
    [MAX_SHUTDOWN_TIMEOUT_MS, MAX_SHUTDOWN_TIMEOUT_MS],
    [undefined, DEFAULT_SHUTDOWN_TIMEOUT_MS],
    [MAX_SHUTDOWN_TIMEOUT_MS + 1, DEFAULT_SHUTDOWN_TIMEOUT_MS],
    [-1, DEFAULT_SHUTDOWN_TIMEOUT_MS],
    [Number.NaN, DEFAULT_SHUTDOWN_TIMEOUT_MS],
  ])('waits %s as %s', (configured, waited) => {
    expect(shutdownTimeoutOf(configured)).toBe(waited)
  })
})
