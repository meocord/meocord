import { CooldownStore, type CooldownLimit, type CooldownVerdict, MemoryCooldownStore } from '@src/common/index.js'
import { testCooldownStore } from '@src/testing/index.js'

testCooldownStore('MemoryCooldownStore', () => new MemoryCooldownStore(), { describe, it, expect })

/** The suite's cases, collected rather than registered, so a test can run them against a broken store. */
function collect(factory: () => CooldownStore): { name: string; run: () => Promise<void> }[] {
  const cases: { name: string; run: () => Promise<void> }[] = []
  const prefix: string[] = []
  testCooldownStore('a store', factory, {
    describe: (name, body) => {
      prefix.push(name)
      body()
      prefix.pop()
    },
    it: (name, body) => cases.push({ name: [...prefix, name].join(' > '), run: async () => body() }),
    expect,
  })
  return cases
}

/** The names of the cases a store fails. */
async function failures(factory: () => CooldownStore): Promise<string[]> {
  const failed: string[] = []
  for (const { name, run } of collect(factory)) await run().catch(() => failed.push(name))
  return failed
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** A store that awaits between checking and recording, as a store of two round trips does. */
class TwoStepStore extends CooldownStore {
  private readonly memory = new Map<string, number[]>()
  async consume(key: string, { uses, windowMs }: CooldownLimit): Promise<CooldownVerdict> {
    const now = Date.now()
    const times = (this.memory.get(key) ?? []).filter(time => now - time < windowMs)
    await sleep(1)
    if (times.length >= uses) return { allowed: false, retryAfterMs: times[times.length - uses] + windowMs - now }
    this.memory.set(key, [...(this.memory.get(key) ?? []), now])
    return { allowed: true, retryAfterMs: 0 }
  }
}

/** A store that keeps one entry per millisecond, as a sorted set scored and keyed by the time alone does. */
class MergingStore extends CooldownStore {
  private readonly memory = new Map<string, Set<number>>()
  consume(key: string, { uses, windowMs }: CooldownLimit): Promise<CooldownVerdict> {
    const now = Date.now()
    const times = [...(this.memory.get(key) ?? [])].filter(time => now - time < windowMs)
    if (times.length >= uses) return Promise.resolve({ allowed: false, retryAfterMs: times[0] + windowMs - now })
    this.memory.set(key, new Set([...times, now]))
    return Promise.resolve({ allowed: true, retryAfterMs: 0 })
  }
}

/** A store that answers how long until the newest call leaves the window, not the oldest. */
class NewestStore extends MemoryCooldownStore {
  private readonly last = new Map<string, number>()
  async consume(key: string, limit: CooldownLimit): Promise<CooldownVerdict> {
    const verdict = await super.consume(key, limit)
    if (verdict.allowed) this.last.set(key, Date.now())
    else verdict.retryAfterMs = this.last.get(key)! + limit.windowMs - Date.now()
    return verdict
  }
}

/** A store that counts every key together. */
class OneCountStore extends MemoryCooldownStore {
  consume(_key: string, limit: CooldownLimit): Promise<CooldownVerdict> {
    return super.consume('everything', limit)
  }
}

/** A store whose peek records the call, as a peek written with consume's script would. */
class RecordingPeekStore extends MemoryCooldownStore {
  peekMany(entries: Parameters<MemoryCooldownStore['peekMany']>[0]) {
    return this.consumeMany(entries)
  }
}

/** A store whose peek answers without looking, allowing every call. */
class BlindPeekStore extends MemoryCooldownStore {
  peekMany() {
    return Promise.resolve({ allowed: true, retryAfterMs: 0 })
  }
}

describe('testCooldownStore', () => {
  it('fails a store that checks and records in two steps, where concurrent calls at the limit both pass', async () => {
    // It keeps the default consumeMany, which takes each key with its consume
    expect(await failures(() => new TwoStepStore())).toEqual([
      expect.stringContaining('lets exactly one of several concurrent calls take the last use'),
      expect.stringContaining('lets exactly one of several concurrent batches take the last use'),
    ])
  })

  it('fails a store that merges calls made in the same millisecond', async () => {
    expect(await failures(() => new MergingStore())).toContainEqual(expect.stringContaining('the same instant'))
  })

  it('fails a store that counts retryAfterMs from the newest call', async () => {
    expect(await failures(() => new NewestStore())).toContainEqual(expect.stringContaining('from the oldest call'))
  })

  it('fails a store that counts every key together', async () => {
    // The batch cases, which count several keys, fail it too
    expect(await failures(() => new OneCountStore())).toContainEqual(expect.stringContaining('each key on its own'))
  })

  it('fails a store whose peek records the call', async () => {
    expect(await failures(() => new RecordingPeekStore())).toContainEqual(expect.stringContaining('peeks without recording'))
  })

  it('fails a store whose peek allows a call its limit refuses', async () => {
    const failed = await failures(() => new BlindPeekStore())
    expect(failed).toContainEqual(expect.stringContaining('peeks a refusal with the wait consume gives'))
    expect(failed).toContainEqual(expect.stringContaining('peeks a batch as consumeMany would'))
  })

  it('passes a store that keeps the default consumeMany and peekMany, checking what those defaults do', async () => {
    const memory = new MemoryCooldownStore()
    class ConsumeOnlyStore extends CooldownStore {
      consume(key: string, limit: CooldownLimit) {
        return memory.consume(key, limit)
      }
    }

    expect(await failures(() => new ConsumeOnlyStore())).toEqual([])
  })

  it('names its cases after the store, under one describe', () => {
    const names = collect(() => new MemoryCooldownStore()).map(({ name }) => name)

    expect(names.length).toBeGreaterThanOrEqual(6)
    expect(names.every(name => name.startsWith('a store as a CooldownStore > '))).toBe(true)
  })
})
