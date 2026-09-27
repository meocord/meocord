import { vi } from 'vitest'
import { type RedisEval, type RedisEvalSha } from '@src/common/index.js'

const { createHash } = vi.hoisted(() => ({ createHash: vi.fn() }))

vi.mock('node:crypto', async importOriginal => {
  const crypto = await importOriginal<typeof import('node:crypto')>()
  createHash.mockImplementation(crypto.createHash)
  return { ...crypto, createHash }
})

// A file of its own: the module is loaded once, here, under the mock
describe('RedisCooldownStore, imported', () => {
  it('hashes its scripts only for a store given evalsha, once each', async () => {
    const { RedisCooldownStore } = await import('@src/common/redis-cooldown-store.js')
    expect(createHash).not.toHaveBeenCalled()

    const evaluate = vi.fn<RedisEval>(() => Promise.resolve([1, 0, -1]))
    const limit = { uses: 1, windowMs: 1_000 }
    await new RedisCooldownStore(evaluate).consumeMany([{ key: 'k', limit }])
    expect(createHash).not.toHaveBeenCalled()

    const evalsha = vi.fn<RedisEvalSha>(() => Promise.resolve([1, 0, -1]))
    const store = new RedisCooldownStore(evaluate, { evalsha })
    await store.consumeMany([{ key: 'k', limit }])
    await store.consumeMany([{ key: 'k', limit }])
    await store.peekMany([{ key: 'k', limit }])
    // One hash for each script, the consume script's and the peek script's, however often they run
    expect(createHash).toHaveBeenCalledTimes(2)
  })
})
