import { createHash, randomUUID } from 'node:crypto'
import {
  type CooldownBatchVerdict,
  type CooldownEntry,
  type CooldownLimit,
  CooldownStore,
  type CooldownVerdict,
  longestRefusal,
  withRelease,
} from '@src/common/cooldown-store.js'
import { Logger } from '@src/common/logger.js'

const logger = new Logger('RedisCooldownStore')

/**
 * Runs a Lua script on the server, as a client's `EVAL` does.
 *
 * It receives the script, the keys it touches and its arguments, and resolves to the script's reply.
 *
 * @group Types
 */
export type RedisEval = (script: string, keys: string[], args: string[]) => Promise<unknown>

/**
 * Runs a script the server already holds, by its SHA1, as a client's `EVALSHA` does.
 *
 * @group Types
 */
export type RedisEvalSha = (sha: string, keys: string[], args: string[]) => Promise<unknown>

/**
 * How a {@link RedisCooldownStore} names its keys and runs its script.
 *
 * @group Types
 */
export interface RedisCooldownStoreOptions {
  /** Put before every key the store writes. Defaults to `meocord:cooldown:`. */
  prefix?: string
  /**
   * Runs the script by its SHA1, sending it in full only when the server answers `NOSCRIPT`: once after
   * each restart or `SCRIPT FLUSH`. Without it, every call sends the script with `EVAL`.
   */
  evalsha?: RedisEvalSha
  /**
   * `'handler'` puts each handler's keys in one Redis Cluster slot, as `{Controller.method}#…`, so its
   * stacked cooldowns stay one step on Cluster as they are on one server. Every call to a handler then lands
   * on that one slot, so a busy handler's slot carries all of its traffic. Without it, on Cluster, a
   * handler's cooldowns are each counted by a script of their own, in order. A single server needs neither.
   */
  hashTag?: 'handler'
}

/**
 * Checks and records one call against every key in one step, by the server's clock: a sorted set of call nonces
 * scored by time per key, each set to expire when its window empties. KEYS the keys; ARGV[1] the nonce, then uses and
 * windowMs per key. Replies {1, 0, -1} allowed, or {0, retryAfterMs, index, retryTimestamp} for the longest refusal.
 */
const SCRIPT = `local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local member = ARGV[1]
local blocked, wait, ends = 0, 0, 0
for i, key in ipairs(KEYS) do
  local uses = tonumber(ARGV[i * 2])
  local window = tonumber(ARGV[i * 2 + 1])
  redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
  local count = redis.call('ZCARD', key)
  if count >= uses then
    local oldest = redis.call('ZRANGE', key, count - uses, count - uses, 'WITHSCORES')
    local retry = math.max(tonumber(oldest[2]) + window - now, 1)
    if retry > wait then
      blocked, wait, ends = i, retry, tonumber(oldest[2]) + window
    end
    redis.call('PEXPIRE', key, window)
  end
end
if blocked > 0 then
  return {0, wait, blocked - 1, ends}
end
for i, key in ipairs(KEYS) do
  redis.call('ZADD', key, now, member)
  redis.call('PEXPIRE', key, tonumber(ARGV[i * 2 + 1]))
end
return {1, 0, -1}
`

/**
 * The same check as SCRIPT, writing nothing: calls in the window are counted, and those that have left it stay.
 * KEYS the keys; ARGV uses and windowMs for each key in turn. Replies as SCRIPT does.
 */
const PEEK_SCRIPT = `local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local blocked, wait, ends = 0, 0, 0
for i, key in ipairs(KEYS) do
  local uses = tonumber(ARGV[i * 2 - 1])
  local window = tonumber(ARGV[i * 2])
  local count = redis.call('ZCOUNT', key, '(' .. (now - window), '+inf')
  if count >= uses then
    local total = redis.call('ZCARD', key)
    local oldest = redis.call('ZRANGE', key, total - uses, total - uses, 'WITHSCORES')
    local retry = math.max(tonumber(oldest[2]) + window - now, 1)
    if retry > wait then
      blocked, wait, ends = i, retry, tonumber(oldest[2]) + window
    end
  end
end
if blocked > 0 then
  return {0, wait, blocked - 1, ends}
end
return {1, 0, -1}
`

/** Undoes a call SCRIPT recorded: KEYS its keys, ARGV[1] the call's nonce, which is its member in each. */
const RELEASE_SCRIPT = `for _, key in ipairs(KEYS) do
  redis.call('ZREM', key, ARGV[1])
end
return 1
`

const shas = new Map<string, string>()

/** A script's SHA1, as EVALSHA names it: worked out on first use, so an app without Redis never hashes anything. */
function shaOf(script: string): string {
  let sha = shas.get(script)
  if (sha === undefined) shas.set(script, (sha = createHash('sha1').update(script).digest('hex')))
  return sha
}

const DEFAULT_PREFIX = 'meocord:cooldown:'

/**
 * A `CooldownStore` on Redis, or on any server that speaks its protocol and runs its Lua scripts.
 *
 * Use it for counts that outlive a restart and are shared by every process and shard on one server, so `'user'` and
 * `'global'` cooldowns stay exact across them. For process shards on one host, {@link ShardedCooldownStore} needs no
 * database.
 *
 * @remarks
 * It runs on Valkey, KeyDB, Dragonfly, and Upstash, which runs `EVAL`; Garnet runs Lua only in part, so check it with
 * `testCooldownStore` before relying on it. MeoCord does not depend on a Redis client: give
 * {@link RedisCooldownStore.using} a function that runs a script with the client you have, and pass what it returns to
 * `@MeoCord({ cooldownStore })`.
 *
 * @example
 * ```ts
 * import { createClient } from 'redis'
 *
 * const redis = await createClient({ url: process.env.REDIS_URL }).connect()
 *
 * @MeoCord({
 *   controllers: [],
 *   clientOptions: { intents: [GatewayIntentBits.Guilds] },
 *   cooldownStore: RedisCooldownStore.using((script, keys, args) => redis.eval(script, { keys, arguments: args })),
 * })
 * export default class App {}
 * ```
 *
 * @group Utilities
 * @category Cooldown stores
 */
export class RedisCooldownStore extends CooldownStore {
  private readonly prefix: string

  /**
   * A store that runs its script through `evaluate`. To bind one to an app, use
   * {@link RedisCooldownStore.using}, which `@MeoCord({ cooldownStore })` takes.
   *
   * @param evaluate - Runs a script, as the client's `EVAL`.
   * @param options - A key prefix, an `EVALSHA` runner, and `hashTag` for Redis Cluster.
   */
  constructor(
    private readonly evaluate: RedisEval,
    private readonly options: RedisCooldownStoreOptions = {},
  ) {
    super()
    this.prefix = options.prefix ?? DEFAULT_PREFIX
  }

  /**
   * A store class for `@MeoCord({ cooldownStore })` that runs its script with your client.
   *
   * @param evaluate - Runs a script, as the client's `EVAL`.
   * @param options - A key prefix, an `EVALSHA` runner to send the script only when the server lacks it, and `hashTag`
   *   to keep a handler's keys in one Redis Cluster slot.
   * @returns A class the app resolves like a service, with nothing to inject.
   *
   * @example
   * ```ts
   * // node-redis, sending the script by its SHA1 once the server has it
   * RedisCooldownStore.using((script, keys, args) => redis.eval(script, { keys, arguments: args }), {
   *   evalsha: (sha, keys, args) => redis.evalSha(sha, { keys, arguments: args }),
   * })
   *
   * // ioredis
   * RedisCooldownStore.using((script, keys, args) => redis.eval(script, keys.length, ...keys, ...args), {
   *   prefix: 'mybot:cooldown:',
   * })
   * ```
   */
  static using(evaluate: RedisEval, options: RedisCooldownStoreOptions = {}): new () => RedisCooldownStore {
    const Bound = class extends RedisCooldownStore {
      constructor() {
        super(evaluate, options)
      }
    }
    Object.defineProperty(Bound, 'name', { value: RedisCooldownStore.name })
    return Bound
  }

  /**
   * Records a call for `key` on the server if the limit allows it, as one script.
   *
   * @param key - Identifies the handler, the cooldown and the caller, user or place it counts per.
   * @param limit - The calls allowed, and the window they are counted over.
   * @returns Whether this call was recorded, and if not, how long until one can be.
   */
  async consume(key: string, limit: CooldownLimit): Promise<CooldownVerdict> {
    const { allowed, retryAfterMs } = await this.consumeMany([{ key, limit }])
    return { allowed, retryAfterMs }
  }

  /**
   * Records a call against every entry if all allow it, as one script: one round trip, however many
   * cooldowns a handler stacks. On Redis Cluster, where a handler's keys sit in different slots and one
   * script cannot reach them all, each key is counted by a script of its own, in order, and a refusal gives
   * back the uses counted before it, so a refused call counts against none unless a give-back fails;
   * `hashTag: 'handler'` keeps the keys in one slot, in one round trip.
   *
   * @param entries - The keys and limits the call counts against.
   * @returns Whether the call was recorded, and if not, how long until it can be and which entry refused it.
   */
  async consumeMany(entries: readonly CooldownEntry[]): Promise<CooldownBatchVerdict> {
    if (entries.length === 0) return { allowed: true, retryAfterMs: 0 }
    const call = randomUUID()
    const keys = this.keysOf(entries)
    try {
      const verdict = verdictOf(await this.run(SCRIPT, keys, [call, ...limitsOf(entries)]), entries.length)
      return verdict.allowed ? withRelease(verdict, async () => void (await this.run(RELEASE_SCRIPT, keys, [call]))) : verdict
    } catch (error) {
      if (entries.length === 1 || !messageOf(error).includes('CROSSSLOT')) throw error
      return this.consumeEach(entries)
    }
  }

  /** Counts the entries one script each, in order, keeping each one's release: what one script does, in steps. */
  private async consumeEach(entries: readonly CooldownEntry[]): Promise<CooldownBatchVerdict> {
    const releases: (() => Promise<void>)[] = []
    const releaseAll = async () => void (await Promise.all(releases.map(release => release())))
    // The refusal or failure stands either way: a failed give-back leaves those keys counted, as one script never would
    const giveBack = () =>
      Promise.all(
        releases.map(release =>
          release().catch((failure: unknown) => logger.debug(`Could not give back a use a refused call counted: ${String(failure)}`)),
        ),
      )
    for (const [index, entry] of entries.entries()) {
      let verdict: CooldownBatchVerdict
      try {
        verdict = await this.consumeMany([entry])
      } catch (error) {
        await giveBack()
        throw error
      }
      if (!verdict.allowed) {
        await giveBack()
        return { ...verdict, blocked: index }
      }
      if (verdict.release) releases.push(verdict.release)
    }
    return withRelease({ allowed: true, retryAfterMs: 0 }, releaseAll)
  }

  /**
   * Checks every entry as {@link consumeMany} would, recording nothing, as one read-only script: one round
   * trip. On Redis Cluster, where a handler's keys sit in different slots, each key is checked by a script
   * of its own, together; `hashTag: 'handler'` keeps them in one slot.
   *
   * @param entries - The keys and limits to check.
   * @returns Whether every entry allows a call now, and if not, how long until it would and which refused.
   */
  async peekMany(entries: readonly CooldownEntry[]): Promise<CooldownBatchVerdict> {
    if (entries.length === 0) return { allowed: true, retryAfterMs: 0 }
    try {
      return verdictOf(await this.run(PEEK_SCRIPT, this.keysOf(entries), limitsOf(entries)), entries.length)
    } catch (error) {
      if (entries.length === 1 || !messageOf(error).includes('CROSSSLOT')) throw error
      const verdicts = await Promise.all(entries.map(entry => this.peekMany([entry])))
      return longestRefusal(verdicts) ?? { allowed: true, retryAfterMs: 0 }
    }
  }

  private keysOf(entries: readonly CooldownEntry[]): string[] {
    return entries.map(({ key }) => `${this.prefix}${this.options.hashTag === 'handler' ? handlerTagged(key) : key}`)
  }

  private async run(script: string, keys: string[], args: string[]): Promise<unknown> {
    const { evalsha } = this.options
    if (!evalsha) return this.evaluate(script, keys, args)
    try {
      return await evalsha(shaOf(script), keys, args)
    } catch (error) {
      // The server has not seen the script since it started, or its scripts were flushed: EVAL loads it.
      if (!messageOf(error).includes('NOSCRIPT')) throw error
      return this.evaluate(script, keys, args)
    }
  }
}

/** Each entry's uses and windowMs, in turn, as the scripts read them from ARGV. */
const limitsOf = (entries: readonly CooldownEntry[]): string[] =>
  entries.flatMap(({ limit: { uses, windowMs } }) => [String(uses), String(windowMs)])

/** A key with its handler part, `Controller.method`, as a Redis Cluster hash tag: `{Controller.method}#60000:user:user:1`. */
function handlerTagged(key: string): string {
  const end = key.indexOf('#')
  return end === -1 ? `{${key}}` : `{${key.slice(0, end)}}${key.slice(end)}`
}

const messageOf = (error: unknown): string => String((error as Error | undefined)?.message ?? error)

/** The script's `{allowed, retryAfterMs, index, retryTimestamp?}` reply, as a verdict. */
function verdictOf(reply: unknown, count: number): CooldownBatchVerdict {
  const [allowed, retryAfterMs, blocked, retryTimestamp] = Array.isArray(reply) ? reply.map(Number) : []
  const valid =
    (allowed === 1 && blocked === -1) || (allowed === 0 && Number.isInteger(blocked) && blocked >= 0 && blocked < count)
  if (!valid || !Number.isFinite(retryAfterMs)) {
    throw new Error(
      `RedisCooldownStore's script replied ${JSON.stringify(reply)}, where it returns [allowed, retryAfterMs, index], and when refused the wait's end. ` +
        'Check that the function given to RedisCooldownStore.using resolves to what the client’s eval returns.',
    )
  }
  if (allowed === 1) return { allowed: true, retryAfterMs: 0 }
  // A reply without the end of the wait leaves it out
  return Number.isFinite(retryTimestamp) ? { allowed: false, retryAfterMs, blocked, retryTimestamp } : { allowed: false, retryAfterMs, blocked }
}
