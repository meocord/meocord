import { PARENT_SEND_TIMEOUT_MS, sendToParent } from '@src/util/parent-send.util.js'

describe('sendToParent', () => {
  const originalSend = process.send

  afterEach(() => {
    process.send = originalSend
    vi.useRealTimers()
  })

  it('resolves once the message is sent', async () => {
    process.send = vi.fn((_message: unknown, _handle: unknown, _options: unknown, callback?: () => void) => {
      callback?.()
      return true
    }) as unknown as typeof process.send

    await expect(sendToParent({ meocord: 'stop' })).resolves.toBeUndefined()
  })

  // Bun's send never calls back when the parent is gone, where Node's calls back with an error
  it('stops waiting for a send that never calls back after the timeout', async () => {
    vi.useFakeTimers()
    process.send = vi.fn(() => true) as unknown as typeof process.send
    let settled = false

    const sent = sendToParent({ meocord: 'stop' }).then(() => (settled = true))
    await vi.advanceTimersByTimeAsync(PARENT_SEND_TIMEOUT_MS - 1)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await sent

    expect(settled).toBe(true)
  })

  it('resolves when the channel is already closed and send throws', async () => {
    process.send = vi.fn(() => {
      throw new Error('Channel closed')
    }) as unknown as typeof process.send

    await expect(sendToParent({ meocord: 'stop' })).resolves.toBeUndefined()
  })
})
