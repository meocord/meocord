import { randomUUID } from 'node:crypto'
import { type Client } from 'discord.js'
import { type Container } from 'inversify'
import { Logger } from '@src/common/index.js'

/** Where each shard's client keeps the function that runs a `ShardContext.call` in that shard. */
export const SHARD_CALL_KEY = Symbol.for('meocord.shardCall')

/**
 * Runs a service method in the current process: given the class itself in a bot of one process, or its name with
 * process sharding, where every shard, the caller's own included, is reached as JSON.
 */
export type ShardCallHandler = (
  service: string | (abstract new (...args: any[]) => unknown),
  method: string,
  args: PackedArgs,
) => Promise<unknown>

/**
 * A call's arguments as they travel: keyed by position, so JSON drops an `undefined` one, which arrives as `undefined`
 * again, where in a list it would be `null`. A plain list also fits.
 */
type PackedArgs = { length: number } & Record<number, unknown>

const packArgs = (args: readonly unknown[]): PackedArgs => Object.assign({ length: args.length }, args)
const unpackArgs = (packed: PackedArgs): unknown[] => Array.from({ length: packed.length }, (_, index) => packed[index])

type ClassToken = abstract new (...args: any[]) => unknown

/**
 * Runs a {@link ShardContext.call} in this process, on a controller, a service or a class a provider stands in for,
 * given the class itself or, with process sharding, its name. `classes` is read on each call, so it can be filled after
 * this is made. The app refuses to start with two of these classes under one name there, so a name finds one class.
 */
export function shardCallHandler(container: Container, classes: () => readonly ClassToken[], owner: string): ShardCallHandler {
  return async (service, method, args) => {
    const name = typeof service === 'function' ? service.name : service
    const target = classes().find(cls => (typeof service === 'function' ? cls === service : cls.name === service))
    if (!target) throw new Error(`${name} is not a controller, service or provided class of ${owner}.`)
    const instance = container.get(target) as Record<string, (...args: unknown[]) => unknown>
    if (typeof instance[method] !== 'function') throw new Error(`${name}.${method} is not a method.`)
    const result = await instance[method](...unpackArgs(args))
    // From another shard, the answer goes back as JSON: encoded here, a value JSON cannot carry fails the call at once
    // rather than leaving discord.js nothing to send, and the caller waiting out its timeout
    return typeof service === 'string' ? asJson(result) : result
  }
}

/**
 * A value as JSON carries it between processes: dates become strings, maps empty objects, `undefined` in a list
 * `null`, and a value JSON cannot write, such as a function, `undefined`. A BigInt throws, as JSON does.
 */
function asJson<T>(value: T): T {
  const json = JSON.stringify(value) as string | undefined
  return (json === undefined ? undefined : JSON.parse(json)) as T
}

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

/** A value JSON writes and reads back unchanged, which {@link Jsonified} gives back as itself. */
type JsonSafe = string | number | boolean | null | readonly JsonSafe[] | { readonly [key: string]: JsonSafe }

/** What JSON leaves out of an object, and writes as `null` in a list. */
type JsonDropped = undefined | void | symbol | ((...args: any[]) => unknown)

/** A list's item as JSON writes it: `null` for one it leaves out. */
type JsonItem<T> = T extends JsonDropped ? null : Jsonified<T>

/** An object as JSON writes it: its string keys, without those JSON leaves out, a key that may be `undefined` optional. */
type JsonObject<T> = {
  [K in keyof T as K extends string | number ? ([T[K]] extends [JsonDropped] ? never : undefined extends T[K] ? never : K) : never]: Jsonified<T[K]>
} & {
  [K in keyof T as K extends string | number ? ([T[K]] extends [JsonDropped] ? never : undefined extends T[K] ? K : never) : never]?: Jsonified<
    Exclude<T[K], undefined>
  >
}

/**
 * A value as it arrives after a trip through JSON: what `toJSON` returns, so a `Date` as a string; a `Map` or a `Set`
 * as an empty object; a function, a symbol or `undefined` left out of an object, `null` in a list, and `undefined` on
 * its own.
 *
 * A `BigInt` cannot be written, so it is `never`.
 *
 * @typeParam T - The value before it is sent.
 * @group Types
 * @see {@link ShardContext.call}
 */
export type Jsonified<T> = unknown extends T
  ? unknown
  : // Before the mapping, which a recursive JSON type such as type-fest's JsonValue would take too deep
    [T] extends [JsonSafe]
    ? T
    : T extends { toJSON(...args: any[]): infer R }
    ? Jsonified<R>
    : T extends string | number | boolean | null
      ? T
      : T extends bigint
        ? never
        : T extends JsonDropped
          ? undefined
          : T extends ReadonlyMap<unknown, unknown> | ReadonlySet<unknown>
            ? Record<string, never>
            : T extends readonly unknown[]
              ? { -readonly [I in keyof T]: JsonItem<T[I]> }
              : { [K in keyof JsonObject<T>]: JsonObject<T>[K] }

type MethodName<T> = {
  [K in keyof T]: T[K] extends (...args: any[]) => unknown ? K : never
}[keyof T] &
  string

/** A param as it arrives through JSON: what JSON gives back, and `undefined` as itself, since arguments go by position. */
type ArrivesAs<P> = Jsonified<Exclude<P, undefined>> | (undefined extends P ? undefined : never)

/**
 * A method's params as a call passes them: each that JSON would change, such as a `Date`, is replaced by what to
 * declare instead, so the argument is refused naming it.
 */
type JsonArgs<A extends unknown[]> = {
  [I in keyof A]: [ArrivesAs<A[I]>] extends [A[I]] ? A[I] : { 'This argument arrives as JSON, so declare the param as': ArrivesAs<A[I]> }
}

type MethodArgs<T, M extends keyof T> = T[M] extends (...args: infer A) => unknown ? A : never
type MethodResult<T, M extends keyof T> = T[M] extends (...args: any[]) => infer R ? Awaited<R> : never

/**
 * Runs a call in the shard `broadcastEval` sends it to. It is sent as its source and rebuilt there, so it touches only
 * its parameters; coverage instrumentation would add references it cannot resolve.
 */
/* istanbul ignore next */
const runInShard = (client: Client, ctx: { service: string; method: string; args: PackedArgs }) =>
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
 * @see {@link https://meocord.dev/docs/4.2/sharding | Sharding}
 */
export class ShardContext {
  private readonly logger = new Logger(ShardContext.name)
  private warnedAboutBroadcastEval = false

  /**
   * @param client - The bot's client, or `undefined` in a testing module, which runs as one process.
   * @param runHere - Runs a service method in this process, given its class, or its name with process sharding.
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
   * shard. The arguments and the result pass as JSON in every mode, one process and tests included, so a
   * `Date` arrives as a string and a `Map` as `{}` wherever it runs, and a value JSON cannot carry, such as a
   * `BigInt`, fails the call. A method whose params JSON would change, such as one taking a `Date`, cannot be called:
   * the argument is refused, naming what to declare instead. An `undefined` argument arrives as `undefined`. A process
   * that throws, lacks the service, or does not answer within 10 seconds gives an error result instead of failing the
   * others.
   *
   * @param service - The controller, the service, or a class a provider stands in for; each process resolves its own
   *   instance.
   * @param method - The method to call.
   * @param args - The method's arguments.
   * @returns One result per process, each value as JSON gives it back: see {@link Jsonified}.
   */
  async call<T, M extends MethodName<T>>(
    service: abstract new (...args: any[]) => T,
    method: M,
    ...args: JsonArgs<MethodArgs<T, M>>
  ): Promise<ShardCallResult<Jsonified<MethodResult<T, M>>>[]> {
    const shard = this.client?.shard
    if (!shard) {
      try {
        // As JSON, as between processes, so one process and a test see what a process-sharded bot does
        const value = await withTimeout(this.runHere(service, method, asJson(packArgs(args))), SHARD_CALL_TIMEOUT_MS, service.name)
        return [{ shardIds: this.ids, ok: true, value: asJson(value) as Jsonified<MethodResult<T, M>> }]
      } catch (error) {
        return [{ shardIds: this.ids, ok: false, error: describe(error) }]
      }
    }

    // discord.js matches a shard's answer to the script it sent, and shares one in flight among identical scripts, so
    // the id gives each call a script of its own
    const context = { id: randomUUID(), service: service.name, method, args: packArgs(args) }
    const ids = [...Array(shard.count).keys()]
    return Promise.all(
      ids.map(async id => {
        try {
          const value = await withTimeout(
            shard.broadcastEval(runInShard, { shard: id, context }),
            SHARD_CALL_TIMEOUT_MS,
            `Shard ${id}`,
          )
          return { shardIds: [id], ok: true as const, value: value as Jsonified<MethodResult<T, M>> }
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
