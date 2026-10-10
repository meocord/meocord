import { DEV_RUNNER_ENV, tellDevRunner } from '@src/util/dev-runner.util.js'
import { PARENT_SEND_TIMEOUT_MS } from '@src/util/parent-send.util.js'

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

  it('sends the message to the dev runner', async () => {
    const send = vi.fn((_message: unknown, _handle: unknown, _options: unknown, callback?: () => void) => {
      callback?.()
      return true
    })
    process.send = send as unknown as typeof process.send

    await tellDevRunner({ meocord: 'login-failed' }, false)

    expect(send).toHaveBeenCalledWith({ meocord: 'login-failed' }, undefined, {}, expect.any(Function))
  })

  // Bun's send never calls back when the dev runner is gone, where Node's calls back with an error
  it('stops waiting for a send that never calls back after the timeout', async () => {
    vi.useFakeTimers()
    process.send = vi.fn(() => true) as unknown as typeof process.send
    let settled = false

    const told = tellDevRunner({ meocord: 'login-failed' }, false).then(() => (settled = true))
    await vi.advanceTimersByTimeAsync(PARENT_SEND_TIMEOUT_MS)
    await told

    expect(settled).toBe(true)
  })
})
