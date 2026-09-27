import { type Client } from 'discord.js'
import { Logger } from '@src/common/index.js'

/** Where each shard's client keeps the function that runs a `ShardContext.call` in that shard. */
export const SHARD_CALL_KEY = Symbol.for('meocord.shardCall')

/**
 * Runs a service method in the current process: the class itself when the call starts here, or its
 * name when it comes from another shard, where only JSON arrives.
 */
export type ShardCallHandler = (
  service: string | (abstract new (...args: any[]) => unknown),
  method: string,
  args: unknown[],
) => Promise<unknown>

/** How long `ShardContext.call` waits for a shard to answer. */
export const SHARD_CALL_TIMEOUT_MS = 10_000

/**
 * One process's answer to a {@link ShardContext.call}: the shards it runs, and the method's value or its error.
 *
 * Check `ok` before reading `value`: a process that threw, lacked the service or did not answer in time gives
 * `ok: false` with the error's message, and the other processes still answer.
 *
 * @group Types
 * @see {@link ShardContext}
 */
export type ShardCallResult<T> =
  | { shardIds: number[]; ok: true; value: T }
  | { shardIds: number[]; ok: false; error: string }

type MethodName<T> = {
  [K in keyof T]: T[K] extends (...args: any[]) => unknown ? K : never
}[keyof T] &
  string

type MethodArgs<T, M extends keyof T> = T[M] extends (...args: infer A) => unknown ? A : never
type MethodResult<T, M extends keyof T> = T[M] extends (...args: any[]) => infer R ? Awaited<R> : never

/**
 * Runs a call in the shard `broadcastEval` sends it to. It is turned into a string there, so it touches
 * only its parameters; coverage instrumentation would add references it cannot resolve.
 */
/* istanbul ignore next */
const runInShard = (client: Client, ctx: { service: string; method: string; args: unknown[] }) =>
  (client as unknown as Record<symbol, ShardCallHandler>)[Symbol.for('meocord.shardCall')](ctx.service, ctx.method, ctx.args)

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not answer within ${ms} ms.`)), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Tells a service which shards its process runs, and calls a service method in every shard.
 *
 * Inject it where the answer needs every shard, such as a total server count, or where one-off work must run in
 * one process only. With process sharding each shard runs in its own process; otherwise one process runs every
 * shard and `call` runs once, here.
 *
 * @example
 * ```ts
 * @Service()
 * export class StatsService {
 *   constructor(private readonly shards: ShardContext, private readonly client: Client) {}
 *
 *   guildCount() {
 *     return this.client.guilds.cache.size
 *   }
 *
 *   async totalGuilds() {
 *     const results = await this.shards.call(StatsService, 'guildCount')
 *     return results.reduce((sum, result) => sum + (result.ok ? result.value : 0), 0)
 *   }
 * }
 * ```
 *
 * @group Controllers
 * @see {@link ShardCallResult}
 * @see {@link https://meocord.dev/docs/4.1/sharding | Sharding}
 */
export class ShardContext {
  private readonly logger = new Logger(ShardContext.name)
  private warnedAboutBroadcastEval = false

  /**
   * @param client - The bot's client, or `undefined` in a testing module, which runs as one process.
   * @param runHere - Runs a named service method in this process.
   */
  constructor(
    private readonly client: Client | undefined,
    private readonly runHere: ShardCallHandler,
  ) {}

  /** The ids of the shards this process runs. With process sharding, one id; otherwise every shard, once ready. */
  get ids(): number[] {
    if (this.client?.shard) return [...this.client.shard.ids]
    const ids = this.client ? [...this.client.ws.shards.keys()] : []
    return ids.length > 0 ? ids : [0]
  }

  /** How many shards the bot runs in all. */
  get count(): number {
    return this.client?.shard?.count ?? this.client?.options.shardCount ?? 1
  }

  /**
   * Whether this process should do one-off work: always with one process, and with process sharding
   * only in the process running shard 0.
   */
  get isPrimary(): boolean {
    return this.client?.shard ? this.client.shard.ids.includes(0) : true
  }

  /**
   * Calls a service method in every process, each resolving the service from its own container, and
   * collects one result per process.
   *
   * With process sharding that is one result per shard; with one process, a single result listing every
   * shard. Only JSON crosses between processes, so the arguments and the result must be JSON. A process
   * that throws, lacks the service, or does not answer within 10 seconds gives an error result instead
   * of failing the others.
   *
   * @param service - The service or controller class; each process resolves its own instance.
   * @param method - The method to call.
   * @param args - The method's arguments.
   * @returns One result per process.
   */
  async call<T, M extends MethodName<T>>(
    service: abstract new (...args: any[]) => T,
    method: M,
    ...args: MethodArgs<T, M>
  ): Promise<ShardCallResult<MethodResult<T, M>>[]> {
    const shard = this.client?.shard
    if (!shard) {
      try {
        const value = await withTimeout(this.runHere(service, method, args), SHARD_CALL_TIMEOUT_MS, service.name)
        return [{ shardIds: this.ids, ok: true, value: value as MethodResult<T, M> }]
      } catch (error) {
        return [{ shardIds: this.ids, ok: false, error: describe(error) }]
      }
    }

    const context = { service: service.name, method, args }
    const ids = [...Array(shard.count).keys()]
    return Promise.all(
      ids.map(async id => {
        try {
          const value = await withTimeout(
            shard.broadcastEval(runInShard, { shard: id, context }),
            SHARD_CALL_TIMEOUT_MS,
            `Shard ${id}`,
          )
          return { shardIds: [id], ok: true as const, value: value as MethodResult<T, M> }
        } catch (error) {
          return { shardIds: [id], ok: false as const, error: describe(error) }
        }
      }),
    )
  }

  /**
   * Runs a function in every shard with discord.js's `broadcastEval`, or here with one process.
   *
   * The function is converted to a string and evaluated in each shard, so it cannot use anything outside
   * its parameters; a minified bundle can break it. Prefer {@link call}.
   *
   * @param fn - The function, given each shard's client and `context`.
   * @param context - JSON passed to the function.
   * @returns Each process's result.
   */
  async broadcastEval<R, C = undefined>(fn: (client: Client, context: C) => R, context?: C): Promise<Awaited<R>[]> {
    if (!this.warnedAboutBroadcastEval) {
      this.warnedAboutBroadcastEval = true
      this.logger.warn('broadcastEval stringifies its function, which minified bundles can break; prefer call().')
    }
    const shard = this.client?.shard
    if (!shard) return [await fn(this.client as Client, context as C)]
    return (await shard.broadcastEval(fn as never, { context } as never)) as Awaited<R>[]
  }
}
