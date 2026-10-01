import { vi } from 'vitest'
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

  it.each([
    [0, 0],
    [MAX_SHUTDOWN_TIMEOUT_MS, MAX_SHUTDOWN_TIMEOUT_MS],
    [undefined, DEFAULT_SHUTDOWN_TIMEOUT_MS],
  ])('waits %s as %s, saying nothing', (configured, waited) => {
    const warn = vi.fn()

    expect(shutdownTimeoutOf(configured, warn)).toBe(waited)
    expect(warn).not.toHaveBeenCalled()
  })

  // A bot started without the CLI loads its config unchecked, so it waits the default and says why
  it.each([
    [2 ** 31, '2147483648'],
    [-1, '-1'],
    [Number.NaN, 'NaN'],
  ])('waits the default for %s, naming it in the check’s words', (configured, shown) => {
    const warn = vi.fn()

    expect(shutdownTimeoutOf(configured, warn)).toBe(DEFAULT_SHUTDOWN_TIMEOUT_MS)
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      `shutdownTimeout must be a number of milliseconds 0 or more, at most 2147478647 (got ${shown}); shutdown waits the default 10000 ms.`,
    )
  })
})
