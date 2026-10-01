import { createHash, randomUUID } from 'node:crypto'
import {
  type CooldownBatchVerdict,
  type CooldownEntry,
  type CooldownLimit,
  CooldownStore,
  type CooldownVerdict,
  longestRefusal,
} from '@src/common/cooldown-store.js'

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
 * One call against every cooldown it counts against, checked and recorded as one step on the server. A
 * sorted set per key holds the time of each call in the window: calls that have left it are trimmed and the
 * rest counted, and only when every key allows the call is it added to all of them, each key set to expire
 * when its window would be empty. Time is the server's, so every process counts by one clock, and each
 * member carries a nonce, so calls in the same microsecond stay apart. A refusal reports the longest wait
 * among the keys that refused, and which key that is.
 *
 * KEYS the keys; ARGV[1] a nonce for this call, then uses and windowMs for each key in turn.
 * Replies {1, 0, -1} when allowed, {0, retryAfterMs, index} when refused.
 */
const SCRIPT = `local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local member = time[1] .. '.' .. time[2] .. ':' .. ARGV[1]
local blocked, wait = 0, 0
for i, key in ipairs(KEYS) do
  local uses = tonumber(ARGV[i * 2])
  local window = tonumber(ARGV[i * 2 + 1])
  redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
  local count = redis.call('ZCARD', key)
  if count >= uses then
    local oldest = redis.call('ZRANGE', key, count - uses, count - uses, 'WITHSCORES')
    local retry = math.max(tonumber(oldest[2]) + window - now, 1)
    if retry > wait then
      blocked, wait = i, retry
    end
    redis.call('PEXPIRE', key, window)
  end
end
if blocked > 0 then
  return {0, wait, blocked - 1}
end
for i, key in ipairs(KEYS) do
  redis.call('ZADD', key, now, member)
  redis.call('PEXPIRE', key, tonumber(ARGV[i * 2 + 1]))
end
return {1, 0, -1}
`

/**
 * The same check as SCRIPT, writing nothing: calls newer than the window are counted in place rather than
 * trimmed, and a key at its limit reports the wait until its oldest call in the window leaves it.
 *
 * KEYS the keys; ARGV uses and windowMs for each key in turn. Replies as SCRIPT does.
 */
const PEEK_SCRIPT = `local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local blocked, wait = 0, 0
for i, key in ipairs(KEYS) do
  local uses = tonumber(ARGV[i * 2 - 1])
  local window = tonumber(ARGV[i * 2])
  local count = redis.call('ZCOUNT', key, '(' .. (now - window), '+inf')
  if count >= uses then
    local total = redis.call('ZCARD', key)
    local oldest = redis.call('ZRANGE', key, total - uses, total - uses, 'WITHSCORES')
    local retry = math.max(tonumber(oldest[2]) + window - now, 1)
    if retry > wait then
      blocked, wait = i, retry
    end
  end
end
if blocked > 0 then
  return {0, wait, blocked - 1}
end
return {1, 0, -1}
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
   * @param options - A key prefix, and an `EVALSHA` runner to send the script only when the server lacks it.
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
   * script cannot reach them all, each key is counted by a script of its own, in order, so a call one
   * cooldown refuses has counted against those before it; `hashTag: 'handler'` keeps them in one slot.
   *
   * @param entries - The keys and limits the call counts against.
   * @returns Whether the call was recorded, and if not, how long until it can be and which entry refused it.
   */
  async consumeMany(entries: readonly CooldownEntry[]): Promise<CooldownBatchVerdict> {
    if (entries.length === 0) return { allowed: true, retryAfterMs: 0 }
    const args = [randomUUID(), ...limitsOf(entries)]
    try {
      return verdictOf(await this.run(SCRIPT, this.keysOf(entries), args), entries.length)
    } catch (error) {
      if (entries.length === 1 || !messageOf(error).includes('CROSSSLOT')) throw error
      return super.consumeMany(entries)
    }
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

/** A key with its handler part, `Controller.method`, as a Redis Cluster hash tag: `{Controller.method}#1/60000:user:user:1`. */
function handlerTagged(key: string): string {
  const end = key.indexOf('#')
  return end === -1 ? `{${key}}` : `{${key.slice(0, end)}}${key.slice(end)}`
}

const messageOf = (error: unknown): string => String((error as Error | undefined)?.message ?? error)

/** The script's `{allowed, retryAfterMs, index}` reply, as a verdict. */
function verdictOf(reply: unknown, count: number): CooldownBatchVerdict {
  const [allowed, retryAfterMs, blocked] = Array.isArray(reply) ? reply.map(Number) : []
  const valid =
    (allowed === 1 && blocked === -1) || (allowed === 0 && Number.isInteger(blocked) && blocked >= 0 && blocked < count)
  if (!valid || !Number.isFinite(retryAfterMs)) {
    throw new Error(
      `RedisCooldownStore's script replied ${JSON.stringify(reply)}, where it returns [allowed, retryAfterMs, index]. ` +
        'Check that the function given to RedisCooldownStore.using resolves to what the client’s eval returns.',
    )
  }
  return allowed === 1 ? { allowed: true, retryAfterMs: 0 } : { allowed: false, retryAfterMs, blocked }
}
