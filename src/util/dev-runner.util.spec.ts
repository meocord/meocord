import { DEV_RUNNER_ENV, DEV_RUNNER_SEND_TIMEOUT_MS, tellDevRunner } from '@src/util/dev-runner.util.js'

describe('tellDevRunner', () => {
  const originalSend = process.send

  beforeEach(() => {
    process.env[DEV_RUNNER_ENV] = '1'
  })

  afterEach(() => {
    delete process.env[DEV_RUNNER_ENV]
    process.send = originalSend
    vi.useRealTimers()
  })

  it('resolves once the message is sent', async () => {
    process.send = vi.fn((_message: unknown, _handle: unknown, _options: unknown, callback?: () => void) => {
      callback?.()
      return true
    }) as unknown as typeof process.send

    await expect(tellDevRunner({ meocord: 'login-failed' })).resolves.toBeUndefined()
  })

  // Bun's send never calls back when the dev runner is gone, where Node's calls back with an error
  it('stops waiting for a send that never calls back after the timeout', async () => {
    vi.useFakeTimers()
    process.send = vi.fn(() => true) as unknown as typeof process.send
    let settled = false

    const told = tellDevRunner({ meocord: 'login-failed' }).then(() => (settled = true))
    await vi.advanceTimersByTimeAsync(DEV_RUNNER_SEND_TIMEOUT_MS - 1)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await told

    expect(settled).toBe(true)
  })

  it('resolves when the channel is already closed and send throws', async () => {
    process.send = vi.fn(() => {
      throw new Error('Channel closed')
    }) as unknown as typeof process.send

    await expect(tellDevRunner({ meocord: 'login-failed' })).resolves.toBeUndefined()
  })
})
