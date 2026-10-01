import { vi } from 'vitest'
import { CooldownStore, MemoryCooldownStore, ShardedCooldownStore } from '@src/common/index.js'
import {
  answerCooldown,
  type CooldownChannel,
  SHARDED_COOLDOWN_ABANDON_MS,
  shardedCooldownStoreOn,
} from '@src/common/sharded-cooldown-store.js'
import { type ShardMessage } from '@src/core/shard-messages.js'
import { testCooldownStore } from '@src/testing/index.js'

/** A manager in this process, reached as over IPC: messages cross as JSON, a turn of the event loop later. */
function loopback(manager: CooldownStore = new MemoryCooldownStore()): CooldownChannel {
  const listeners: ((message: unknown) => void)[] = []
  const deliver = (message: ShardMessage) =>
    setImmediate(() => listeners.forEach(listener => listener(JSON.parse(JSON.stringify(message)))))
  return {
    send: message => setImmediate(() => answerCooldown(manager, JSON.parse(JSON.stringify(message)), deliver)),
    onMessage: listener => void listeners.push(listener),
  }
}

const limit = { uses: 1, windowMs: 5_000 }

testCooldownStore('ShardedCooldownStore outside process sharding', () => new ShardedCooldownStore(), { describe, it, expect })

testCooldownStore('ShardedCooldownStore counting in a manager', () => shardedCooldownStoreOn(loopback()), {
  describe,
  it,
  expect,
})

describe('ShardedCooldownStore', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('counts every shard in the manager, so two shards share one count', async () => {
    const manager = new MemoryCooldownStore()
    const [first, second] = [shardedCooldownStoreOn(loopback(manager)), shardedCooldownStoreOn(loopback(manager))]

    expect((await first.consume('shared', limit)).allowed).toBe(true)
    expect((await second.consume('shared', limit)).allowed).toBe(false)
  })

  it('needs nothing injected, so @MeoCord({ cooldownStore }) can take it as it is', () => {
    expect(ShardedCooldownStore.length).toBe(0)
    expect(new ShardedCooldownStore()).toBeInstanceOf(CooldownStore)
  })

  it("counts a call against all of a handler's cooldowns in the manager, or against none", async () => {
    const manager = new MemoryCooldownStore()
    const store = shardedCooldownStoreOn(loopback(manager))
    await manager.consume('minute', limit)

    const refused = await store.consumeMany([
      { key: 'second', limit },
      { key: 'minute', limit },
    ])

    expect(refused).toMatchObject({ allowed: false, blocked: 1 })
    expect((await manager.consume('second', limit)).allowed).toBe(true)
  })

  it("peeks a handler's cooldowns in the manager in one message, recording nothing there", async () => {
    const manager = new MemoryCooldownStore()
    const channel = loopback(manager)
    const sent: ShardMessage[] = []
    const store = shardedCooldownStoreOn({ ...channel, send: message => (sent.push(message), channel.send(message)) })
    await manager.consume('minute', limit)

    const peeked = await store.peekMany([
      { key: 'second', limit },
      { key: 'minute', limit },
    ])

    expect(peeked).toMatchObject({ allowed: false, blocked: 1 })
    expect(sent).toEqual([expect.objectContaining({ meocord: 'cooldown', peek: true })])
    expect((await manager.consume('second', limit)).allowed).toBe(true)
  })

  // A manager that does not answer is a store failure, for @MeoCord({ cooldownStoreFailure }) to decide
  it('fails a call the manager never answers, once it has waited long enough to let it go', async () => {
    vi.useFakeTimers()
    const silent: CooldownChannel = { send: () => undefined, onMessage: () => undefined }
    const call = shardedCooldownStoreOn(silent).consume('k', limit)
    const failed = expect(call).rejects.toThrow(`did not answer a cooldown within ${SHARDED_COOLDOWN_ABANDON_MS} ms`)

    await vi.advanceTimersByTimeAsync(SHARDED_COOLDOWN_ABANDON_MS)
    await failed
  })

  it('fails a call at once when the channel to the manager has closed', async () => {
    const closed: CooldownChannel = {
      send: () => {
        throw new Error('Channel closed')
      },
      onMessage: () => undefined,
    }

    await expect(shardedCooldownStoreOn(closed).consume('k', limit)).rejects.toThrow('Channel closed')
  })

  it("fails a call when the manager's own store fails, with its reason", async () => {
    const broken = new MemoryCooldownStore()
    vi.spyOn(broken, 'consumeMany').mockRejectedValue(new Error('disk full'))

    await expect(shardedCooldownStoreOn(loopback(broken)).consume('k', limit)).rejects.toThrow(
      "The shard manager's cooldown store failed: disk full",
    )
  })

  it("ignores another store's answers, and messages that are not verdicts", async () => {
    const listeners: ((message: unknown) => void)[] = []
    const channel: CooldownChannel = {
      send: message => {
        if (message.meocord !== 'cooldown') return
        setImmediate(() => {
          for (const listener of listeners) {
            listener({ meocord: 'cooldown-verdict', id: 'someone-else:0', verdict: { allowed: false, retryAfterMs: 9 } })
            listener({ meocord: 'shutdown' })
            listener('not ours')
            listener({ meocord: 'cooldown-verdict', id: message.id, verdict: { allowed: true, retryAfterMs: 0 } })
          }
        })
      },
      onMessage: listener => void listeners.push(listener),
    }

    expect(await shardedCooldownStoreOn(channel).consume('k', limit)).toEqual({ allowed: true, retryAfterMs: 0 })
  })
})

describe('answerCooldown', () => {
  it("answers a shard's call from the manager's store, under the call's id", async () => {
    const reply = vi.fn()
    const handled = answerCooldown(new MemoryCooldownStore(), { meocord: 'cooldown', id: 'a:1', entries: [{ key: 'k', limit }] }, reply)
    await vi.waitFor(() => expect(reply).toHaveBeenCalled())

    expect(handled).toBe(true)
    // With the calls it recorded, which the shard's release sends back, so the manager keeps nothing for it
    expect(reply).toHaveBeenCalledWith({
      meocord: 'cooldown-verdict',
      id: 'a:1',
      verdict: { allowed: true, retryAfterMs: 0 },
      recorded: [{ key: 'k', at: expect.any(Number) }],
    })
  })

  // As after the manager restarts, or once the call has left its window
  it('leaves alone a release of calls the manager does not hold', async () => {
    const manager = new MemoryCooldownStore()
    await manager.consumeMany([{ key: 'k', limit }])

    expect(answerCooldown(manager, { meocord: 'cooldown-release', recorded: [{ key: 'k', at: 1 }, { key: 'gone', at: 1 }] }, vi.fn())).toBe(true)
    expect((await manager.consumeMany([{ key: 'k', limit }])).allowed).toBe(false)
  })

  it.each([{ meocord: 'fatal', code: 'x', message: 'y' }, { meocord: 'shutdown' }, 'text', null])('leaves %j alone', message => {
    const reply = vi.fn()

    expect(answerCooldown(new MemoryCooldownStore(), message, reply)).toBe(false)
    expect(reply).not.toHaveBeenCalled()
  })
})
