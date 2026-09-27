import { randomUUID } from 'node:crypto'
import {
  type CooldownBatchVerdict,
  type CooldownEntry,
  type CooldownLimit,
  CooldownStore,
  type CooldownVerdict,
  MemoryCooldownStore,
} from '@src/common/cooldown-store.js'
import { isShardMessage, type ShardMessage } from '@src/core/shard-messages.js'
import { isShardProcess } from '@src/util/sharding-mode.util.js'

/**
 * How long a shard holds a call the manager has not answered before failing it, so an unanswered call is
 * never held forever. MeoCord gives up on it sooner, after `cooldownStoreTimeoutMs`.
 */
export const SHARDED_COOLDOWN_ABANDON_MS = 30_000

/** The IPC between a shard and its manager, as a shard's `process` provides it. */
export interface CooldownChannel {
  send(message: ShardMessage): void
  onMessage(listener: (message: unknown) => void): void
}

/** A shard's channel to its manager, or none outside process sharding. */
function managerChannel(): CooldownChannel | undefined {
  if (!isShardProcess() || typeof process.send !== 'function') return undefined
  return {
    send: message => void process.send!(message),
    onMessage: listener => void process.on('message', listener),
  }
}

/**
 * A `CooldownStore` for process sharding that needs no database.
 *
 * Use it so `'user'` and `'global'` cooldowns are exact across the shards on one host: each shard asks the shard
 * manager, which counts every shard's calls in its memory. For counts that outlive a restart, or bots on several
 * hosts, use `RedisCooldownStore`.
 *
 * @remarks
 * Outside process sharding, where one process runs every shard, it counts in that process, which is exact too. A
 * handler's stacked cooldowns go to the manager as one message. Counts live in the manager's memory, so they start
 * again when the whole bot restarts; a shard that restarts keeps them. A manager that does not answer is a store
 * failure, which `@MeoCord({ cooldownStoreFailure })` decides: refuse the call, or let it through uncounted.
 *
 * @example
 * ```ts
 * @MeoCord({
 *   controllers: [],
 *   clientOptions: { intents: [GatewayIntentBits.Guilds] },
 *   cooldownStore: ShardedCooldownStore,
 * })
 * export default class App {}
 * ```
 *
 * @group Utilities
 * @category Cooldown stores
 */
export class ShardedCooldownStore extends CooldownStore {
  private readonly local = new MemoryCooldownStore()
  private readonly pending = new Map<string, { resolve: (verdict: CooldownBatchVerdict) => void; reject: (error: Error) => void }>()
  private readonly prefix = randomUUID()
  private channel = managerChannel()
  private next = 0
  private listening = false

  /**
   * Records a call for `key` if the limit allows it: in the manager with process sharding, here otherwise.
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
   * Records a call against every entry if all allow it, in one message to the manager.
   *
   * @param entries - The keys and limits the call counts against.
   * @returns Whether the call was recorded, and if not, how long until it can be and which entry refused it.
   * @throws When the manager cannot be reached, its store fails, or it does not answer at all.
   */
  consumeMany(entries: readonly CooldownEntry[]): Promise<CooldownBatchVerdict> {
    return this.ask(entries, false)
  }

  /**
   * Checks every entry as {@link consumeMany} would, recording nothing, in one message to the manager.
   *
   * @param entries - The keys and limits to check.
   * @returns Whether every entry allows a call now, and if not, how long until it would and which refused.
   * @throws When the manager cannot be reached, its store fails, or it does not answer at all.
   */
  peekMany(entries: readonly CooldownEntry[]): Promise<CooldownBatchVerdict> {
    return this.ask(entries, true)
  }

  /** Counts, or with `peek` only checks, the entries in the manager's store, or here without one. */
  private ask(entries: readonly CooldownEntry[], peek: boolean): Promise<CooldownBatchVerdict> {
    const { channel } = this
    if (!channel) return peek ? this.local.peekMany(entries) : this.local.consumeMany(entries)
    this.listen(channel)

    const id = `${this.prefix}:${this.next++}`
    return new Promise<CooldownBatchVerdict>((resolve, reject) => {
      const abandon = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`The shard manager did not answer a cooldown within ${SHARDED_COOLDOWN_ABANDON_MS} ms.`))
      }, SHARDED_COOLDOWN_ABANDON_MS)
      // A cooldown must never be what keeps a stopping shard alive.
      abandon.unref?.()
      const settle = () => {
        clearTimeout(abandon)
        this.pending.delete(id)
      }
      this.pending.set(id, {
        resolve: verdict => (settle(), resolve(verdict)),
        reject: error => (settle(), reject(error)),
      })
      try {
        channel.send({ meocord: 'cooldown', id, entries: [...entries], ...(peek ? { peek: true as const } : {}) })
      } catch (error) {
        // The channel has closed, as when the manager is gone.
        this.pending.get(id)?.reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private listen(channel: CooldownChannel): void {
    if (this.listening) return
    this.listening = true
    channel.onMessage(message => {
      if (!isShardMessage(message) || message.meocord !== 'cooldown-verdict') return
      const waiting = this.pending.get(message.id)
      if ('error' in message) waiting?.reject(new Error(`The shard manager's cooldown store failed: ${message.error}`))
      else waiting?.resolve(message.verdict)
    })
  }
}

/** A store that talks to a manager over `channel`, for tests that stand a process in for the manager. */
export function shardedCooldownStoreOn(channel: CooldownChannel | undefined): ShardedCooldownStore {
  const store = new ShardedCooldownStore()
  ;(store as unknown as { channel: CooldownChannel | undefined }).channel = channel
  return store
}

/**
 * Answers a shard's `cooldown` message from the manager's store, and ignores any other message.
 *
 * @returns Whether the message was a cooldown call.
 */
export function answerCooldown(store: CooldownStore, message: unknown, reply: (message: ShardMessage) => unknown): boolean {
  if (!isShardMessage(message) || message.meocord !== 'cooldown') return false
  void (message.peek ? store.peekMany(message.entries) : store.consumeMany(message.entries)).then(
    verdict => reply({ meocord: 'cooldown-verdict', id: message.id, verdict }),
    error => reply({ meocord: 'cooldown-verdict', id: message.id, error: error instanceof Error ? error.message : String(error) }),
  )
  return true
}
