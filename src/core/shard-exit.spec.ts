import { tellManager } from '@src/core/shard-exit.js'
import { PARENT_SEND_TIMEOUT_MS } from '@src/util/parent-send.util.js'

describe('tellManager', () => {
  const originalSend = process.send

  afterEach(() => {
    process.send = originalSend
    vi.useRealTimers()
  })

  // Bun's send never calls back once the manager is gone, which would leave a shard's stop() waiting for ever
  it('stops waiting for a manager that never takes the message', async () => {
    vi.useFakeTimers()
    process.send = vi.fn(() => true) as unknown as typeof process.send
    let settled = false

    const told = tellManager({ meocord: 'stop' }).then(() => (settled = true))
    await vi.advanceTimersByTimeAsync(PARENT_SEND_TIMEOUT_MS)
    await told

    expect(settled).toBe(true)
  })

  it('resolves when the channel is already closed and send throws', async () => {
    process.send = vi.fn(() => {
      throw new Error('Channel closed')
    }) as unknown as typeof process.send

    await expect(tellManager({ meocord: 'stop' })).resolves.toBeUndefined()
  })
})
