/**
 * How many calls a cooldown allows, and in how long a window.
 *
 * @group Types
 */
export interface CooldownLimit {
  /** Calls allowed within the window. */
  uses: number
  /** The window's length, in milliseconds: a whole number, at least `1`, as `@Cooldown` gives it. */
  windowMs: number
}

/**
 * Whether a call may run, and if not, how long until one may.
 *
 * @group Types
 */
export interface CooldownVerdict {
  /** Whether the call may run. */
  allowed: boolean
  /** `0` when allowed; otherwise how long until the oldest call in the window leaves it. */
  retryAfterMs: number
}

/**
 * One cooldown a call counts against: the key it counts under, and its limit.
 *
 * @group Types
 */
export interface CooldownEntry {
  /** The key the store counts the call under. */
  key: string
  /** How many calls that key allows, and in how long a window. */
  limit: CooldownLimit
}

/**
 * Whether a call may run against every cooldown it counts against, and if not, which refused it.
 *
 * @group Types
 */
export interface CooldownBatchVerdict extends CooldownVerdict {
  /** The index of the entry that refused the call; with several, the one with the longest wait. */
  blocked?: number
}

/**
 * Where `@Cooldown` counts calls.
 *
 * The default keeps them in memory, in this process. Bind another with `@MeoCord({ cooldownStore })` so shards or
 * several processes share one count: `ShardedCooldownStore`, `RedisCooldownStore`, or one of your own.
 *
 * @remarks
 * `consume` must check and record a call as one step: two calls at the limit must not both pass. Check a store of your
 * own with `testCooldownStore` from `meocord/testing`.
 *
 * A store class bound with `cooldownStore` gets lifecycle hooks as a service does. Its `onReady` runs before the
 * services' and its `onShutdown` after theirs. A call that comes while `onReady` runs waits for it, within the store's
 * timeout. Its `onShutdown` runs once no call is left to ask it, so it can open a connection in one and close it in
 * the other.
 *
 * @example
 * ```ts
 * // Your database's query: trims, counts and records a key's calls in one transaction that locks the key
 * export abstract class CooldownQueries {
 *   abstract consume(key: string, uses: number, windowMs: number): Promise<CooldownVerdict>
 * }
 *
 * @Service()
 * export class DatabaseCooldownStore extends CooldownStore {
 *   constructor(private readonly queries: CooldownQueries) { super() }
 *
 *   consume(key: string, limit: CooldownLimit): Promise<CooldownVerdict> {
 *     return this.queries.consume(key, limit.uses, limit.windowMs)
 *   }
 * }
 * ```
 *
 * @group Utilities
 * @category Cooldown stores
 */
export abstract class CooldownStore {
  /**
   * Records a call for `key` if the limit allows it: at most `limit.uses` calls within the last
   * `limit.windowMs` milliseconds.
   *
   * @param key - Identifies the handler, the cooldown and the caller, user or place it counts per.
   * @param limit - The calls allowed, and the window they are counted over.
   * @returns Whether this call was recorded, and if not, how long until one can be.
   */
  abstract consume(key: string, limit: CooldownLimit): Promise<CooldownVerdict>

  /**
   * Records a call against every entry: all of a handler's stacked cooldowns, in one step. `@Cooldown`
   * calls this, once per call.
   *
   * This default calls {@link consume} for each entry in order and stops at the first that refuses, so
   * the entries before it have counted the call. Override it to check every entry and record the call
   * against all of them only if all allow it, in one round trip: the built-in stores do, and a store
   * behind a network should.
   *
   * @param entries - The keys and limits the call counts against, in the order the cooldowns are declared.
   * @returns Whether the call was recorded, and if not, how long until it can be and which entry refused it.
   */
  async consumeMany(entries: readonly CooldownEntry[]): Promise<CooldownBatchVerdict> {
    for (const [index, { key, limit }] of entries.entries()) {
      const verdict = await this.consume(key, limit)
      if (!verdict.allowed) return { ...verdict, blocked: index }
    }
    return { allowed: true, retryAfterMs: 0 }
  }

  /**
   * Checks every entry as {@link consumeMany} would, and records nothing: whether a call would be allowed
   * now. It serves a check ahead of work a refused call should not cost, such as fetching what it names from
   * Discord; `consumeMany` still decides once the handler's input is ready. Cooldowns with `by` are never
   * peeked, since their key comes from that input, and a key worked out before it could refuse a call
   * `consumeMany` would allow.
   *
   * This default allows every call, so a store without it costs no round trip and refuses only at
   * `consumeMany`. Override it to answer from the store: the built-in stores do.
   *
   * @param entries - The keys and limits to check, in the order the cooldowns are declared.
   * @returns Whether every entry allows a call now, and if not, how long until it would and which refused.
   */
  peekMany(_entries: readonly CooldownEntry[]): Promise<CooldownBatchVerdict> {
    return Promise.resolve({ allowed: true, retryAfterMs: 0 })
  }
}

/**
 * Of several refusals, the one a caller waits on: the call runs only once every entry allows it, so the
 * longest wait. Undefined when nothing refused.
 */
export function longestRefusal(verdicts: readonly CooldownVerdict[]): CooldownBatchVerdict | undefined {
  let refusal: CooldownBatchVerdict | undefined
  for (const [index, verdict] of verdicts.entries()) {
    if (!verdict.allowed && (!refusal || verdict.retryAfterMs > refusal.retryAfterMs)) refusal = { ...verdict, blocked: index }
  }
  return refusal
}

/** How often the in-memory store drops keys whose every call has left its window. */
const SWEEP_INTERVAL_MS = 60_000

/**
 * The default `CooldownStore`: call times per key, in this process's memory. Checking and recording
 * run with nothing awaited between them, so concurrent calls cannot both take the last use.
 *
 * With process sharding each shard has its own, so `per: 'user'` and `'global'` cooldowns count per
 * shard; bind a shared store for those.
 */
/**
 * A key's call times, oldest first. Those from `head` on are in the window; those before it have left, and
 * are dropped from the array once they outnumber the rest, so trimming a call costs O(1) amortised.
 */
interface CallTimes {
  times: number[]
  head: number
  windowMs: number
}

/** Moves `head` past the calls that have left the window, and drops them from the array now and then. */
function trim(entry: CallTimes, now: number): void {
  const { times, windowMs } = entry
  while (entry.head < times.length && now - times[entry.head] >= windowMs) entry.head++
  if (entry.head > 32 && entry.head * 2 > times.length) {
    entry.times = times.slice(entry.head)
    entry.head = 0
  }
}

/** Whether a key allows one more call now, after trimming the calls that have left its window. */
function verdictOf(entry: CallTimes, { uses, windowMs }: CooldownLimit, now: number): CooldownVerdict {
  entry.windowMs = windowMs
  trim(entry, now)
  const { times, head } = entry
  // A refused call is never recorded, so at most `uses` calls are ever in the window
  return times.length - head < uses ? { allowed: true, retryAfterMs: 0 } : { allowed: false, retryAfterMs: times[times.length - uses] + windowMs - now }
}

/**
 * Counts cooldown calls in this process's memory: the store `@Cooldown` uses unless another is bound.
 *
 * It suits a bot in one process; bind another with `@MeoCord({ cooldownStore })`. Its counts start again on a restart,
 * and with process sharding each shard counts on its own; for those, use {@link ShardedCooldownStore} or
 * {@link RedisCooldownStore}.
 *
 * @remarks
 * The window slides, and stacked cooldowns are counted together: a call is recorded against every key only if all
 * allow it. Keys whose calls have all left their window are dropped once a minute. `testCooldownStore` checks
 * other stores against the behaviour this one defines.
 *
 * @example
 * ```ts
 * const store = new MemoryCooldownStore()
 * const limit = { uses: 1, windowMs: 3_000 }
 *
 * await store.consume('daily:42', limit) // { allowed: true, retryAfterMs: 0 }
 * await store.consume('daily:42', limit) // { allowed: false, retryAfterMs: 3000 }, or just under
 * ```
 *
 * @group Utilities
 * @category Cooldown stores
 * @see {@link CooldownStore}
 */
export class MemoryCooldownStore extends CooldownStore {
  private readonly calls = new Map<string, CallTimes>()
  private sweeper?: ReturnType<typeof setInterval>

  async consume(key: string, limit: CooldownLimit): Promise<CooldownVerdict> {
    const { allowed, retryAfterMs } = await this.consumeMany([{ key, limit }])
    return { allowed, retryAfterMs }
  }

  /** Checks every entry, and records the call against all of them only if all allow it. */
  consumeMany(entries: readonly CooldownEntry[]): Promise<CooldownBatchVerdict> {
    const now = Date.now()
    const counts = this.check(entries, now)
    const refusal = longestRefusal(counts.map(({ verdict }) => verdict))
    if (refusal) return Promise.resolve(refusal)

    // Nothing awaited since the check, so no other call can take a use in between. A clock that steps back
    // records the latest time again, keeping the times in order for trim()
    for (const { entry } of counts) entry.times.push(Math.max(now, entry.times[entry.times.length - 1] ?? now))
    return Promise.resolve({ allowed: true, retryAfterMs: 0 })
  }

  /** Checks every entry as consumeMany does, recording nothing, and holding nothing for a key not yet counted. */
  peekMany(entries: readonly CooldownEntry[]): Promise<CooldownBatchVerdict> {
    const verdicts = entries.map(({ key, limit }) => {
      const entry = this.calls.get(key)
      return entry ? verdictOf(entry, limit, Date.now()) : { allowed: true, retryAfterMs: 0 }
    })
    return Promise.resolve(longestRefusal(verdicts) ?? { allowed: true, retryAfterMs: 0 })
  }

  /** Each entry's call times, trimmed to its window, and whether it allows one more call now. */
  private check(entries: readonly CooldownEntry[], now: number): { entry: CallTimes; verdict: CooldownVerdict }[] {
    this.startSweeping()
    return entries.map(({ key, limit }) => {
      let entry = this.calls.get(key)
      if (!entry) this.calls.set(key, (entry = { times: [], head: 0, windowMs: limit.windowMs }))
      return { entry, verdict: verdictOf(entry, limit, now) }
    })
  }

  /** The number of keys held, for tests of the sweep. */
  get size(): number {
    return this.calls.size
  }

  /** Drops every key whose calls have all left their window. */
  sweep(now = Date.now()): void {
    for (const [key, entry] of this.calls) {
      const newest = entry.times[entry.times.length - 1]
      if (newest === undefined || now - newest >= entry.windowMs) this.calls.delete(key)
    }
  }

  private startSweeping(): void {
    if (this.sweeper) return
    this.sweeper = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS)
    // A cooldown must never be what keeps a stopping bot alive.
    this.sweeper.unref?.()
  }
}
