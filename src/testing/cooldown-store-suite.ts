import { randomUUID } from 'node:crypto'
import { CooldownStore, type CooldownVerdict } from '@src/common/cooldown-store.js'

/** The assertions the suite makes, which both Vitest's and Jest's `expect` provide. */
interface Expectation {
  toBe(expected: unknown): void
  toEqual(expected: unknown): void
  toBeGreaterThan(expected: number): void
  toBeGreaterThanOrEqual(expected: number): void
  toBeLessThanOrEqual(expected: number): void
}

/**
 * The test framework {@link testCooldownStore} registers its cases with: its `describe`, `it` and `expect`.
 *
 * @group Testing
 * @category Inspection
 */
export interface CooldownStoreSuiteFramework {
  /** Groups the cases under the store's name. */
  describe: (name: string, body: () => void) => void
  /** Registers one case, with its timeout in milliseconds. */
  it: (name: string, body: () => Promise<void>, timeout?: number) => void
  /** The framework's assertions; Vitest's and Jest's both fit. */
  expect: (actual: unknown) => Expectation
}

/** Long enough for a store over the network to answer each case, short enough that the suite takes seconds. */
const CASE_TIMEOUT_MS = 10_000

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Checks that a `CooldownStore` counts calls as `MemoryCooldownStore` does, as a suite of test cases.
 *
 * Use it for a store you write over a database, or one you configure, such as Redis. It registers one `describe` of
 * cases with the framework you pass, so it runs under Vitest, Jest or any runner with the same three functions.
 *
 * @remarks
 * The cases cover what a shared store most often gets wrong: a sliding window rather than fixed buckets,
 * `retryAfterMs` from the oldest call still in the window, calls in the same millisecond kept apart, and concurrent
 * calls at the limit where exactly one may pass. They use real time, with windows short enough that the suite takes
 * a few seconds, and each case counts under keys of its own. Each window is a whole number of milliseconds, as
 * `@Cooldown` gives a store: it rounds its `seconds` to the millisecond.
 *
 * @param name - What the store is called in the report.
 * @param factory - Makes the store to check, once per case.
 * @param framework - The test framework's `describe`, `it` and `expect`.
 *
 * @example
 * ```ts
 * import { describe, expect, it } from 'vitest'
 *
 * testCooldownStore('MemoryCooldownStore', () => new MemoryCooldownStore(), { describe, it, expect })
 * ```
 *
 * @group Testing
 * @category Inspection
 * @see {@link CooldownStore}
 * @see {@link https://meocord.dev/docs/4.1/recipes/cooldown-stores | Cooldown stores}
 */
export function testCooldownStore(
  name: string,
  factory: () => CooldownStore | Promise<CooldownStore>,
  { describe, it, expect }: CooldownStoreSuiteFramework,
): void {
  const run = randomUUID()
  const key = (label: string) => `meocord-suite:${run}:${label}`
  const test = (label: string, body: (store: CooldownStore) => Promise<void>) =>
    it(label, async () => body(await factory()), CASE_TIMEOUT_MS)

  describe(`${name} as a CooldownStore`, () => {
    test('allows `uses` calls within a window, then refuses with how long until the next', async store => {
      const limit = { uses: 3, windowMs: 2_000 }
      for (let call = 0; call < 3; call += 1) {
        expect(await store.consume(key('uses'), limit)).toEqual({ allowed: true, retryAfterMs: 0 })
      }

      const refused = await store.consume(key('uses'), limit)
      expect(refused.allowed).toBe(false)
      expect(refused.retryAfterMs).toBeGreaterThan(0)
      expect(refused.retryAfterMs).toBeLessThanOrEqual(limit.windowMs)
    })

    test('slides its window: a call is allowed once the oldest leaves it, not when a bucket resets', async store => {
      const limit = { uses: 2, windowMs: 500 }
      await store.consume(key('sliding'), limit)
      await sleep(250)
      await store.consume(key('sliding'), limit)

      const refused = await store.consume(key('sliding'), limit)
      expect(refused.allowed).toBe(false)
      await sleep(refused.retryAfterMs + 40)

      // The first call has left the window; the second, 250ms younger, still holds its use.
      expect((await store.consume(key('sliding'), limit)).allowed).toBe(true)
      expect((await store.consume(key('sliding'), limit)).allowed).toBe(false)
    })

    test('counts retryAfterMs from the oldest call still in the window', async store => {
      const limit = { uses: 2, windowMs: 1_000 }
      await store.consume(key('retry'), limit)
      await sleep(300)
      await store.consume(key('retry'), limit)

      // From the oldest call, about 700ms remain; from the newest, about 1000ms would.
      const { retryAfterMs } = await store.consume(key('retry'), limit)
      expect(retryAfterMs).toBeGreaterThan(limit.windowMs - 600)
      expect(retryAfterMs).toBeLessThanOrEqual(limit.windowMs - 200)
    })

    test('counts each key on its own', async store => {
      const limit = { uses: 1, windowMs: 2_000 }
      expect((await store.consume(key('first'), limit)).allowed).toBe(true)
      expect((await store.consume(key('first'), limit)).allowed).toBe(false)
      expect((await store.consume(key('second'), limit)).allowed).toBe(true)
    })

    test('keeps calls made at the same instant apart, rather than counting them as one', async store => {
      const limit = { uses: 3, windowMs: 2_000 }
      const verdicts = await Promise.all([1, 2, 3].map(() => store.consume(key('instant'), limit)))

      expect(verdicts.every(verdict => verdict.allowed)).toBe(true)
      expect((await store.consume(key('instant'), limit)).allowed).toBe(false)
    })

    test('lets exactly one of several concurrent calls take the last use', async store => {
      const limit = { uses: 1, windowMs: 2_000 }
      const verdicts: CooldownVerdict[] = await Promise.all(
        Array.from({ length: 8 }, () => store.consume(key('concurrent'), limit)),
      )

      expect(verdicts.filter(verdict => verdict.allowed).length).toBe(1)
    })

    test('counts a call against all of a batch at once, and names the longest wait when one refuses', async store => {
      const short = { uses: 2, windowMs: 1_000 }
      const long = { uses: 1, windowMs: 2_000 }
      const batch = [
        { key: key('batch-short'), limit: short },
        { key: key('batch-long'), limit: long },
      ]
      expect(await store.consumeMany(batch)).toEqual({ allowed: true, retryAfterMs: 0 })

      const refused = await store.consumeMany(batch)
      expect(refused.allowed).toBe(false)
      expect(refused.blocked).toBe(1)
      expect(refused.retryAfterMs).toBeGreaterThan(short.windowMs)
      expect(refused.retryAfterMs).toBeLessThanOrEqual(long.windowMs)
    })

    // The default consumeMany counts in order and stops at the first refusal, so the entries before it count
    test('records nothing when one cooldown of a batch refuses it, or with the default consumeMany, counts those before it', async store => {
      const limit = { uses: 1, windowMs: 2_000 }
      await store.consume(key('taken'), limit)

      const refused = await store.consumeMany([
        { key: key('free'), limit },
        { key: key('taken'), limit },
      ])
      expect(refused.allowed).toBe(false)
      expect(refused.blocked).toBe(1)
      expect((await store.consume(key('free'), limit)).allowed).toBe(overridesConsumeMany(store))
    })

    // The default consumeMany takes each key with consume, so only the batch that took the first goes on to the rest
    test('lets exactly one of several concurrent batches take the last use of each', async store => {
      const limit = { uses: 1, windowMs: 2_000 }
      const batch = [
        { key: key('concurrent-a'), limit },
        { key: key('concurrent-b'), limit },
      ]
      const verdicts = await Promise.all(Array.from({ length: 8 }, () => store.consumeMany(batch)))

      expect(verdicts.filter(verdict => verdict.allowed).length).toBe(1)
    })

    // The default peekMany allows every call and records nothing, leaving the check to consumeMany
    test('peeks without recording: allowed below the limit, however often', async store => {
      const limit = { uses: 2, windowMs: 2_000 }
      const entry = { key: key('peek-free'), limit }
      for (let peek = 0; peek < 5; peek++) expect(await store.peekMany([entry])).toEqual({ allowed: true, retryAfterMs: 0 })

      expect((await store.consume(entry.key, limit)).allowed).toBe(true)
      expect((await store.consume(entry.key, limit)).allowed).toBe(true)
    })

    test('peeks a refusal with the wait consume gives, or allows it with the default peekMany, and records nothing', async store => {
      const limit = { uses: 1, windowMs: 2_000 }
      const entry = { key: key('peek-taken'), limit }
      await store.consume(entry.key, limit)
      const consumed = await store.consume(entry.key, limit)

      const peeked = await store.peekMany([entry])
      if (!overridesPeekMany(store)) {
        expect(peeked).toEqual({ allowed: true, retryAfterMs: 0 })
        expect((await store.consume(entry.key, limit)).allowed).toBe(false)
        return
      }
      expect(peeked.allowed).toBe(false)
      expect(peeked.blocked).toBe(0)
      // Asked after consume, so its wait is at most consume's, and at most a little less
      expect(peeked.retryAfterMs).toBeLessThanOrEqual(consumed.retryAfterMs)
      expect(peeked.retryAfterMs).toBeGreaterThanOrEqual(consumed.retryAfterMs - 250)

      await sleep(limit.windowMs + 50)
      expect(await store.peekMany([entry])).toEqual({ allowed: true, retryAfterMs: 0 })
    })

    test('peeks a batch as consumeMany would, naming the longest wait, or allows it with the default peekMany', async store => {
      const short = { uses: 1, windowMs: 1_000 }
      const long = { uses: 1, windowMs: 2_000 }
      const batch = [
        { key: key('peek-batch-free'), limit: short },
        { key: key('peek-batch-short'), limit: short },
        { key: key('peek-batch-long'), limit: long },
      ]
      await store.consume(batch[1].key, short)
      await store.consume(batch[2].key, long)

      const peeked = await store.peekMany(batch)
      if (!overridesPeekMany(store)) {
        expect(peeked).toEqual({ allowed: true, retryAfterMs: 0 })
        expect((await store.consume(batch[0].key, short)).allowed).toBe(true)
        return
      }
      expect(peeked.allowed).toBe(false)
      expect(peeked.blocked).toBe(2)
      expect(peeked.retryAfterMs).toBeGreaterThan(short.windowMs)
      expect(peeked.retryAfterMs).toBeLessThanOrEqual(long.windowMs)
      // Nothing recorded against the free key by the refused peek, nor by the one before
      expect((await store.consume(batch[0].key, short)).allowed).toBe(true)
    })
  })
}

/** Whether a store overrides `consumeMany`, as a store that counts a batch at once does. */
function overridesConsumeMany(store: CooldownStore): boolean {
  return store.consumeMany !== CooldownStore.prototype.consumeMany
}

/** Whether a store overrides `peekMany`, as a store that can check a batch without recording it does. */
function overridesPeekMany(store: CooldownStore): boolean {
  return store.peekMany !== CooldownStore.prototype.peekMany
}
