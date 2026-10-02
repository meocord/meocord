import { createHash } from 'node:crypto'
import { CooldownStore, RedisCooldownStore, type RedisEval, type RedisEvalSha } from '@src/common/index.js'
import { createMockFn } from '@src/testing/index.js'

const limit = { uses: 2, windowMs: 5_000 }
const sha1 = (text: string) => createHash('sha1').update(text).digest('hex')

describe('RedisCooldownStore', () => {
  it('runs one script with the prefixed key, a nonce for the call, and the limit', async () => {
    const evaluate = createMockFn<RedisEval>(() => Promise.resolve([1, 0, -1]))
    const store = new RedisCooldownStore(evaluate)

    await store.consume('Ping.run#0:per:user:1', limit)
    await store.consume('Ping.run#0:per:user:1', limit)

    const [[script, keys, args], [, , second]] = evaluate.mock.calls
    expect(script).toContain("redis.call('TIME')")
    expect(keys).toEqual(['meocord:cooldown:Ping.run#0:per:user:1'])
    expect(args.slice(1)).toEqual(['2', '5000'])
    expect(args[0]).not.toBe(second[0])
  })

  it("sends every cooldown of a call in one script, each key's limit after the nonce", async () => {
    const evaluate = createMockFn<RedisEval>(() => Promise.resolve([1, 0, -1]))

    await new RedisCooldownStore(evaluate).consumeMany([
      { key: 'Ping.run#0:user:user:1', limit: { uses: 1, windowMs: 3_000 } },
      { key: 'Ping.run#1:user:user:1', limit: { uses: 5, windowMs: 60_000 } },
    ])

    expect(evaluate).toHaveBeenCalledTimes(1)
    const [, keys, args] = evaluate.mock.calls[0]
    expect(keys).toEqual(['meocord:cooldown:Ping.run#0:user:user:1', 'meocord:cooldown:Ping.run#1:user:user:1'])
    expect(args.slice(1)).toEqual(['1', '3000', '5', '60000'])
  })

  it('puts its own prefix before every key', async () => {
    const evaluate = createMockFn<RedisEval>(() => Promise.resolve([1, 0, -1]))

    await new RedisCooldownStore(evaluate, { prefix: 'bot:cd:' }).consume('k', limit)

    expect(evaluate.mock.calls[0][1]).toEqual(['bot:cd:k'])
  })

  it("with hashTag: 'handler', puts a handler's keys in one Cluster slot", async () => {
    const evaluate = createMockFn<RedisEval>(() => Promise.resolve([1, 0, -1]))

    await new RedisCooldownStore(evaluate, { hashTag: 'handler' }).consumeMany([
      { key: 'Ping.run#0:user:user:1', limit },
      { key: 'Ping.run#1:guild:guild:2', limit },
    ])

    expect(evaluate.mock.calls[0][1]).toEqual([
      'meocord:cooldown:{Ping.run}#0:user:user:1',
      'meocord:cooldown:{Ping.run}#1:guild:guild:2',
    ])
  })

  it.each([
    [[1, 0, -1], { allowed: true, retryAfterMs: 0 }],
    [[0, 1234, 0], { allowed: false, retryAfterMs: 1234, blocked: 0 }],
    // Some clients reply with strings
    [['0', '42', '0'], { allowed: false, retryAfterMs: 42, blocked: 0 }],
  ])('reads the reply %j as %j', async (reply, verdict) => {
    const store = new RedisCooldownStore(() => Promise.resolve(reply))

    expect(await store.consumeMany([{ key: 'k', limit }])).toEqual(verdict)
  })

  it('reports a single consume without the index of the key that refused it', async () => {
    const store = new RedisCooldownStore(() => Promise.resolve([0, 900, 0]))

    expect(await store.consume('k', limit)).toEqual({ allowed: false, retryAfterMs: 900 })
  })

  it.each([null, 'OK', [2, 0, -1], [0], [1, 0], [0, 10, 3]])('says what it expected when the adapter resolves to %j', async reply => {
    const store = new RedisCooldownStore(() => Promise.resolve(reply))

    await expect(store.consume('k', limit)).rejects.toThrow(/replied .*where it returns \[allowed, retryAfterMs, index\], and when refused the wait's end/)
  })

  it('on Redis Cluster, counts keys in other slots with a script each, in order, giving back those counted at a refusal', async () => {
    const replies = [
      [1, 0, -1],
      [0, 2_000, 0],
    ]
    const evaluate = createMockFn<RedisEval>((_script, keys) =>
      keys.length > 1
        ? Promise.reject(new Error("CROSSSLOT Keys in request don't hash to the same slot"))
        : Promise.resolve(replies.shift()),
    )

    const verdict = await new RedisCooldownStore(evaluate).consumeMany([
      { key: 'a', limit },
      { key: 'b', limit },
      { key: 'c', limit },
    ])

    expect(verdict).toEqual({ allowed: false, retryAfterMs: 2_000, blocked: 1 })
    expect(evaluate.mock.calls.map(([script, keys]) => [script.includes('ZADD') ? 'count' : 'release', ...keys])).toEqual([
      ['count', 'meocord:cooldown:a', 'meocord:cooldown:b', 'meocord:cooldown:c'],
      ['count', 'meocord:cooldown:a'],
      ['count', 'meocord:cooldown:b'],
      // a counted the call before b refused it, so it is given back
      ['release', 'meocord:cooldown:a'],
    ])
  })

  // A give-back is cleanup: when it fails, the call is still refused, not failed as though the store were down
  it('on Redis Cluster, still refuses a call when giving back the keys counted before the refusal fails', async () => {
    const replies = [
      [1, 0, -1],
      [0, 2_000, 0, 1_700_000_002_000],
    ]
    const evaluate = createMockFn<RedisEval>((script, keys) =>
      !script.includes('ZADD')
        ? Promise.reject(new Error('connection reset'))
        : keys.length > 1
          ? Promise.reject(new Error("CROSSSLOT Keys in request don't hash to the same slot"))
          : Promise.resolve(replies.shift()),
    )

    const verdict = await new RedisCooldownStore(evaluate).consumeMany([
      { key: 'a', limit },
      { key: 'b', limit },
    ])

    expect(verdict).toEqual({ allowed: false, retryAfterMs: 2_000, blocked: 1, retryTimestamp: 1_700_000_002_000 })
  })

  it('on Redis Cluster, gives back the keys counted before a later key fails, then rejects with it', async () => {
    const failure = new Error('connection reset')
    const evaluate = createMockFn<RedisEval>((script, keys) =>
      keys.length > 1
        ? Promise.reject(new Error("CROSSSLOT Keys in request don't hash to the same slot"))
        : !script.includes('ZADD')
          ? Promise.resolve(1)
          : keys[0] === 'meocord:cooldown:b'
            ? Promise.reject(failure)
            : Promise.resolve([1, 0, -1]),
    )

    const counting = new RedisCooldownStore(evaluate).consumeMany([
      { key: 'a', limit },
      { key: 'b', limit },
    ])

    await expect(counting).rejects.toBe(failure)
    expect(evaluate.mock.calls.map(([script, keys]) => [script.includes('ZADD') ? 'count' : 'release', ...keys])).toEqual([
      ['count', 'meocord:cooldown:a', 'meocord:cooldown:b'],
      ['count', 'meocord:cooldown:a'],
      ['count', 'meocord:cooldown:b'],
      ['release', 'meocord:cooldown:a'],
    ])
  })

  // A call counted after the timeout is given back, on a cluster too
  it('on Redis Cluster, gives back every key a call counted when its verdict is released', async () => {
    const evaluate = createMockFn<RedisEval>((script, keys) =>
      keys.length > 1 && script.includes('ZADD')
        ? Promise.reject(new Error("CROSSSLOT Keys in request don't hash to the same slot"))
        : Promise.resolve([1, 0, -1]),
    )

    const verdict = await new RedisCooldownStore(evaluate).consumeMany([
      { key: 'a', limit },
      { key: 'b', limit },
    ])
    await verdict.release?.()

    expect(evaluate.mock.calls.filter(([script]) => !script.includes('ZADD')).map(([, keys]) => keys)).toEqual([
      ['meocord:cooldown:a'],
      ['meocord:cooldown:b'],
    ])
  })

  it("gives a refusal the end of the wait the script reports, by the server's clock", async () => {
    const evaluate = createMockFn<RedisEval>(() => Promise.resolve([0, 2_000, 0, 1_700_000_002_000]))

    expect(await new RedisCooldownStore(evaluate).consumeMany([{ key: 'k', limit }])).toEqual({
      allowed: false,
      retryAfterMs: 2_000,
      blocked: 0,
      retryTimestamp: 1_700_000_002_000,
    })
  })

  it('sends the script by its SHA1 when given evalsha, and in full only when the server answers NOSCRIPT', async () => {
    const evaluate = createMockFn<RedisEval>(() => Promise.resolve([1, 0, -1]))
    let loaded = false
    const evalsha = createMockFn<RedisEvalSha>(() =>
      loaded ? Promise.resolve([1, 0, -1]) : Promise.reject(new Error('NOSCRIPT No matching script. Please use EVAL.')),
    )
    const store = new RedisCooldownStore(evaluate, { evalsha })

    await store.consume('k', limit)
    loaded = true
    await store.consume('k', limit)

    expect(evalsha.mock.calls.map(([sha]) => sha)).toEqual([sha1(evaluate.mock.calls[0][0]), sha1(evaluate.mock.calls[0][0])])
    expect(evaluate.mock.calls).toHaveLength(1)
  })

  it("peeks every cooldown of a call in one read-only script, with each key's limit and no nonce", async () => {
    const evaluate = createMockFn<RedisEval>(() => Promise.resolve([0, 1200, 1]))

    const peeked = await new RedisCooldownStore(evaluate, { hashTag: 'handler' }).peekMany([
      { key: 'Ping.run#0:user:user:1', limit: { uses: 1, windowMs: 3_000 } },
      { key: 'Ping.run#1:user:user:1', limit: { uses: 5, windowMs: 60_000 } },
    ])

    expect(peeked).toEqual({ allowed: false, retryAfterMs: 1200, blocked: 1 })
    expect(evaluate).toHaveBeenCalledTimes(1)
    const [script, keys, args] = evaluate.mock.calls[0]
    expect(script).not.toMatch(/ZADD|ZREM|PEXPIRE|DEL/)
    expect(keys).toEqual(['meocord:cooldown:{Ping.run}#0:user:user:1', 'meocord:cooldown:{Ping.run}#1:user:user:1'])
    expect(args).toEqual(['1', '3000', '5', '60000'])
  })

  it('on Redis Cluster, peeks keys in other slots with a script each, and reports the longest wait', async () => {
    const evaluate = createMockFn<RedisEval>((_script, keys) =>
      keys.length > 1
        ? Promise.reject(new Error("CROSSSLOT Keys in request don't hash to the same slot"))
        : Promise.resolve(keys[0].endsWith('long') ? [0, 9000, 0] : keys[0].endsWith('short') ? [0, 800, 0] : [1, 0, -1]),
    )

    const peeked = await new RedisCooldownStore(evaluate).peekMany([
      { key: 'free', limit },
      { key: 'short', limit },
      { key: 'long', limit },
    ])

    expect(peeked).toEqual({ allowed: false, retryAfterMs: 9000, blocked: 2 })
    expect(evaluate).toHaveBeenCalledTimes(4)
  })

  it('peeks by its own SHA1 when given evalsha, and in full on NOSCRIPT', async () => {
    const evaluate = createMockFn<RedisEval>(() => Promise.resolve([1, 0, -1]))
    const evalsha = createMockFn<RedisEvalSha>(() => Promise.reject(new Error('NOSCRIPT No matching script. Please use EVAL.')))
    const store = new RedisCooldownStore(evaluate, { evalsha })

    await store.peekMany([{ key: 'k', limit }])
    await store.consumeMany([{ key: 'k', limit }])

    const [peekSha, consumeSha] = evalsha.mock.calls.map(([sha]) => sha)
    const [[peekScript], [consumeScript]] = evaluate.mock.calls
    expect(peekSha).toBe(sha1(peekScript))
    expect(consumeSha).toBe(sha1(consumeScript))
    expect(peekSha).not.toBe(consumeSha)
  })

  it('passes on an error from evalsha that is not NOSCRIPT', async () => {
    const evaluate = createMockFn<RedisEval>(() => Promise.resolve([1, 0, -1]))
    const store = new RedisCooldownStore(evaluate, { evalsha: () => Promise.reject(new Error('READONLY replica')) })

    await expect(store.consume('k', limit)).rejects.toThrow('READONLY replica')
    expect(evaluate.mock.calls).toHaveLength(0)
  })

  describe('using', () => {
    it('makes a class @MeoCord({ cooldownStore }) can resolve, with nothing to inject', async () => {
      const evaluate = createMockFn<RedisEval>(() => Promise.resolve([0, 900, 0]))
      const Store = RedisCooldownStore.using(evaluate, { prefix: 'p:' })
      const store = new Store()

      expect(Store.name).toBe('RedisCooldownStore')
      expect(Store.length).toBe(0)
      expect(store).toBeInstanceOf(CooldownStore)
      expect(await store.consume('k', limit)).toEqual({ allowed: false, retryAfterMs: 900 })
      expect(evaluate.mock.calls[0][1]).toEqual(['p:k'])
    })
  })
})
