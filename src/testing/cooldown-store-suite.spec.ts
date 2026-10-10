import { vi } from 'vitest'
import {
  type CooldownBatchVerdict,
  type CooldownEntry,
  CooldownStore,
  type CooldownLimit,
  type CooldownVerdict,
  MemoryCooldownStore,
} from '@src/common/index.js'
import { withRelease } from '@src/common/cooldown-store.js'
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

/** A store that counts in fixed windows from a key's first call, freeing every use at once rather than sliding. */
class FixedWindowStore extends CooldownStore {
  private readonly windows = new Map<string, { start: number; count: number }>()
  consume(key: string, { uses, windowMs }: CooldownLimit): Promise<CooldownVerdict> {
    const now = Date.now()
    let window = this.windows.get(key)
    if (!window || now - window.start >= windowMs) this.windows.set(key, (window = { start: now, count: 0 }))
    if (window.count >= uses) return Promise.resolve({ allowed: false, retryAfterMs: window.start + windowMs - now })
    window.count++
    return Promise.resolve({ allowed: true, retryAfterMs: 0 })
  }
}

/** Runs `body` with every timer of 200 ms or more firing `lateMs` late, as on a busy CI runner. */
async function withLateTimers<T>(lateMs: number, body: () => Promise<T>): Promise<T> {
  const setTimer = globalThis.setTimeout
  const late = vi
    .spyOn(globalThis, 'setTimeout')
    .mockImplementation(((handler: () => void, ms = 0, ...args: unknown[]) => setTimer(handler, ms >= 200 ? ms + lateMs : ms, ...args)) as never)
  try {
    return await body()
  } finally {
    late.mockRestore()
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

/** A store that counts a batch at once, as the built-in ones do, with what its subclasses get wrong left overridable. */
class BatchStore extends CooldownStore {
  protected readonly calls = new Map<string, number[]>()

  /** How long until `times` allows a call: until a use frees up, from the oldest of the newest `uses`. */
  protected waitOf(times: number[], { uses, windowMs }: CooldownLimit, now: number): number {
    return times[times.length - uses] + windowMs - now
  }

  /** Which refusal a batch reports: the longest wait. */
  protected pick(refusals: { blocked: number; retryAfterMs: number }[]) {
    return refusals.reduce((longest, refusal) => (refusal.retryAfterMs > longest.retryAfterMs ? refusal : longest))
  }

  /** Gives back the call recorded at `at` against `key`. */
  protected release(key: string, at: number) {
    const times = this.calls.get(key)!
    times.splice(times.lastIndexOf(at), 1)
  }

  async consume(key: string, limit: CooldownLimit): Promise<CooldownVerdict> {
    const { allowed, retryAfterMs } = await this.consumeMany([{ key, limit }])
    return { allowed, retryAfterMs }
  }

  consumeMany(entries: readonly CooldownEntry[]): Promise<CooldownBatchVerdict> {
    const now = Date.now()
    const refusals = entries.flatMap(({ key, limit }, blocked) => {
      const times = (this.calls.get(key) ?? []).filter(time => now - time < limit.windowMs)
      this.calls.set(key, times)
      return times.length < limit.uses ? [] : [{ blocked, retryAfterMs: this.waitOf(times, limit, now) }]
    })
    if (refusals.length > 0) return Promise.resolve({ allowed: false, ...this.pick(refusals) })
    for (const { key } of entries) this.calls.get(key)!.push(now)
    return Promise.resolve(withRelease({ allowed: true, retryAfterMs: 0 }, async () => entries.forEach(({ key }) => this.release(key, now))))
  }
}

/** A store whose release drops every call of a key, other calls' uses included. */
class OverReleaseStore extends BatchStore {
  protected release(key: string) {
    this.calls.delete(key)
  }
}

/** A store whose batch refusal names the first cooldown that refuses, not the longest wait. */
class FirstBlockedStore extends BatchStore {
  protected pick(refusals: { blocked: number; retryAfterMs: number }[]) {
    return refusals[0]
  }
}

/** A store that counts a wait from the oldest call in the window, however many calls past `uses` it holds. */
class OldestCallStore extends BatchStore {
  protected waitOf(times: number[], { windowMs }: CooldownLimit, now: number): number {
    return times[0] + windowMs - now
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

// Each test runs the whole suite against one store, real waits included: about 4 s, more on a slow runner
describe('testCooldownStore', { timeout: 30_000 }, () => {
  it('fails a store that checks and records in two steps, where several concurrent calls at the limit pass', async () => {
    // It keeps the default consumeMany, which takes each key with its consume
    expect(await failures(() => new TwoStepStore())).toEqual([
      expect.stringContaining('lets exactly one of several concurrent calls take the last use'),
      expect.stringContaining('lets exactly one of several concurrent batches take the last use'),
    ])
  })

  it('fails a store that merges calls made in the same millisecond', async () => {
    expect(await failures(() => new MergingStore())).toContainEqual(expect.stringContaining('the same instant'))
  })

  it('fails a store that frees every use when a fixed window resets, rather than sliding', async () => {
    expect(await failures(() => new FixedWindowStore())).toContainEqual(expect.stringContaining('slides its window'))
  })

  it('passes a correct store when timers fire late', async () => {
    expect(await withLateTimers(400, () => failures(() => new MemoryCooldownStore()))).toEqual([])
  })

  it.each([
    ['frees every use when a fixed window resets', () => new FixedWindowStore(), 'slides its window'],
    ['counts retryAfterMs from the newest call', () => new NewestStore(), 'from the oldest call'],
  ])('still fails a store that %s when timers fire late', async (_what, factory, failing) => {
    expect(await withLateTimers(400, () => failures(factory))).toContainEqual(expect.stringContaining(failing))
  })

  it('fails a store that counts retryAfterMs from the newest call', async () => {
    expect(await failures(() => new NewestStore())).toContainEqual(expect.stringContaining('from the oldest call'))
  })

  it.each([
    ['frees other calls’ uses when it releases one', () => new OverReleaseStore(), 'releases only the call it counted'],
    ['names the first refusal of a batch rather than the longest wait', () => new FirstBlockedStore(), 'names the longest wait when several'],
    ['counts a wait from the oldest call when a lowered limit leaves more in the window', () => new OldestCallStore(), 'when a lowered limit'],
  ])('fails a store that %s', async (_what, factory, failing) => {
    expect(await failures(factory)).toEqual([expect.stringContaining(failing)])
  })

  it('fails a store that counts every key together', async () => {
    // Some batch and peek cases, which count a second key, fail it too
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
