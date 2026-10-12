import { vi } from 'vitest'
import { type CooldownStore, MemoryCooldownStore, RedisCooldownStore, type RedisEval, ShardedCooldownStore } from '@src/common/index.js'
import { createMockFn } from '@src/testing/index.js'

const NOW = 1_700_000_000_000
const limit = { uses: 1, windowMs: 5_000 }

/** A Redis store whose script allows the first call and refuses the next, its wait ending as the memory store's does. */
const redis = () => {
  const replies: unknown[] = [[1, 0, -1], [0, limit.windowMs, 0, NOW + limit.windowMs]]
  return new RedisCooldownStore(createMockFn<RedisEval>(() => Promise.resolve(replies.shift())))
}

describe("the built-in stores' consume", () => {
  afterEach(() => vi.useRealTimers())

  it.each<[string, () => CooldownStore]>([
    ['MemoryCooldownStore', () => new MemoryCooldownStore()],
    ['RedisCooldownStore', redis],
    ['ShardedCooldownStore', () => new ShardedCooldownStore()],
  ])('%s refuses with when the wait ends, which a refusal compares and serialises without', async (_name, make) => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
    const store = make()
    await store.consume('k', limit)

    const refused = await store.consume('k', limit)

    expect(refused.retryTimestamp).toBe(NOW + limit.windowMs)
    expect(refused).toEqual({ allowed: false, retryAfterMs: limit.windowMs })
    expect(JSON.parse(JSON.stringify(refused))).toEqual({ allowed: false, retryAfterMs: limit.windowMs })
  })
})
