import 'reflect-metadata'
import { type Container } from 'inversify'
import { BaseInteraction, Message } from 'discord.js'
import { CooldownError, type CooldownScope, CooldownStoreError } from '@src/common/errors.js'
import { type CooldownBatchVerdict, type CooldownEntry, CooldownStore, MemoryCooldownStore } from '@src/common/cooldown-store.js'
import { Logger } from '@src/common/logger.js'
import { type ExecutionContext, type HandlerExecutionContext } from '@src/common/execution-context.js'
import { perHandler, sourcePrototype, stageClasses } from '@src/core/guard-runner.js'

/** A value `@Cooldown`'s `by` counts under: calls with different values are counted apart. */
export type CooldownKey = string | number

/**
 * What `@Cooldown` takes: the limit, whose calls count together, and how to exempt or tell calls apart.
 *
 * `P` is the handler's second parameter, as `by` receives it.
 *
 * @group Types
 * @see {@link Cooldown}
 */
export interface CooldownOptions<P = Record<string, unknown>> {
  /** The window's length, in seconds. */
  seconds: number
  /**
   * Calls allowed within the window.
   *
   * @defaultValue `1`
   */
  uses?: number
  /**
   * Whose calls are counted together: `'user'`, `'guild'`, `'channel'` or `'global'`. Outside a server,
   * `'guild'` and `'channel'` count per user.
   *
   * @defaultValue `'user'`
   */
  per?: CooldownScope
  /** Exempts a call, such as one from an owner, without counting it. */
  bypass?: (context: ExecutionContext) => boolean | Promise<boolean>
  /**
   * Counts calls apart by a value of the call, such as the account a button acts on, within the scope `per`
   * names. It receives the handler's params as the handler does, after validation and pipes, and returns
   * `undefined` to count the call as though there were no `by`. Declare the params it reads, and the
   * handler's are checked against them; an error it throws goes to the exception filters.
   */
  by?: (context: ExecutionContext, params: P) => CooldownKey | undefined | Promise<CooldownKey | undefined>
}

/** A `@Cooldown` as the decorator stores it, with its defaults filled in. */
export type StoredCooldown = CooldownOptions<any> & { uses: number; per: CooldownScope }

/** Private metadata: a controller's class-level `@Cooldown`s. */
export const CLASS_COOLDOWNS = Symbol('class_cooldowns')

/** Private metadata: a method's `@Cooldown`s, in declaration order. */
export const METHOD_COOLDOWNS = Symbol('method_cooldowns')

/** The cooldowns on a handler: each class's, base first, then the method's. */
export const handlerCooldowns = perHandler((prototype: object, methodName: string): readonly StoredCooldown[] => {
  const source = sourcePrototype(prototype, methodName)
  if (!source) return []
  return [
    // Base first, as guards run; a cooldown's key holds its place in this list, so the order stays put
    ...stageClasses(prototype, methodName).flatMap(cls => (Reflect.getOwnMetadata(CLASS_COOLDOWNS, cls) as StoredCooldown[]) ?? []),
    ...((Reflect.getOwnMetadata(METHOD_COOLDOWNS, source, methodName) as StoredCooldown[]) ?? []),
  ]
})

/** The cooldowns declared on a method itself. */
export function methodCooldowns(prototype: object, methodName: string): StoredCooldown[] {
  const source = sourcePrototype(prototype, methodName)
  return source ? ((Reflect.getOwnMetadata(METHOD_COOLDOWNS, source, methodName) as StoredCooldown[]) ?? []) : []
}

/** Who and where a call came from: an interaction's or a message's user, server and channel. */
function caller(first: unknown): { user?: string; guild?: string | null; channel?: string | null } {
  if (first instanceof BaseInteraction) return { user: first.user?.id, guild: first.guildId, channel: first.channelId }
  if (first instanceof Message) return { user: first.author?.id, guild: first.guildId, channel: first.channelId }
  return {}
}

/** The id a scope counts under; outside a server, `guild` and `channel` count per user. */
function scopeId(per: CooldownScope, first: unknown): string {
  const { user, guild, channel } = caller(first)
  if (per === 'global') return 'global'
  if (per === 'guild' && guild) return `guild:${guild}`
  if (per === 'channel' && channel && guild) return `channel:${channel}`
  return `user:${user ?? 'unknown'}`
}

/**
 * What a call gets when the cooldown store throws, rejects or does not answer in time.
 *
 * Set it with `@MeoCord({ cooldownStoreFailure })`: `'deny'`, the default, refuses the call with `CooldownStoreError`,
 * and `'allow'` runs it uncounted.
 *
 * @group Configuration
 * @category App options
 */
export type CooldownStoreFailure = 'deny' | 'allow'

/** How `@Cooldown` treats its store: `@MeoCord({ cooldownStoreFailure, cooldownStoreTimeoutMs })`. */
export interface CooldownPolicy {
  failure: CooldownStoreFailure
  timeoutMs: number
}

/** How long a call waits for the cooldown store before it counts as a failure, unless the app says otherwise. */
export const DEFAULT_COOLDOWN_STORE_TIMEOUT_MS = 1_000

/** Private binding: the app's cooldown policy. */
export const COOLDOWN_POLICY = Symbol('meocord.cooldownPolicy')

const DEFAULT_POLICY: CooldownPolicy = { failure: 'deny', timeoutMs: DEFAULT_COOLDOWN_STORE_TIMEOUT_MS }

/** The cooldown policy an app's `@MeoCord` options set, with the defaults for what they leave out. */
export function cooldownPolicyFrom(options: { cooldownStoreFailure?: CooldownStoreFailure; cooldownStoreTimeoutMs?: number }): CooldownPolicy {
  return {
    failure: options.cooldownStoreFailure ?? DEFAULT_POLICY.failure,
    timeoutMs: options.cooldownStoreTimeoutMs ?? DEFAULT_POLICY.timeoutMs,
  }
}

/** The app's cooldown policy, else refusing calls after a second without an answer. */
export function cooldownPolicyOf(container: Container): CooldownPolicy {
  return container.isBound(COOLDOWN_POLICY) ? container.get<CooldownPolicy>(COOLDOWN_POLICY) : DEFAULT_POLICY
}

const logger = new Logger('Cooldown')

/** The failing calls of each store that has not answered since its last failure. */
const outages = new WeakMap<CooldownStore, { failures: number; since: number }>()

/** Logs a store's failure once per outage: the first, with its cause and what calls get until it answers. */
function reportFailure(store: CooldownStore, error: CooldownStoreError, { failure, timeoutMs }: CooldownPolicy): void {
  const outage = outages.get(store)
  if (outage) {
    outage.failures++
    return
  }
  outages.set(store, { failures: 1, since: Date.now() })
  const name = store.constructor.name
  const reason = error.timedOut ? `did not answer within ${timeoutMs} ms` : `failed: ${String((error.cause as Error | undefined)?.message ?? error.cause)}`
  if (failure === 'allow') logger.warn(`The cooldown store ${name} ${reason}. Calls run uncounted until it answers again.`)
  else logger.error(`The cooldown store ${name} ${reason}. Calls with a cooldown are refused until it answers again.`, error.cause ?? '')
}

/** Logs that a store answers again, after an outage. */
function reportRecovery(store: CooldownStore): void {
  const outage = outages.get(store)
  if (!outage) return
  outages.delete(store)
  const seconds = Math.round((Date.now() - outage.since) / 1000)
  logger.log(`The cooldown store ${store.constructor.name} answers again, after ${outage.failures} failed call(s) over ${seconds}s.`)
}

/**
 * Asks the store once, for every entry, to count the call or with `peek` only to check it, and fails with
 * {@link CooldownStoreError} when it throws, rejects or does not answer within `timeoutMs`. An answer that
 * comes later is dropped: nothing counts the call a second time.
 */
async function askWithin(store: CooldownStore, entries: CooldownEntry[], timeoutMs: number, peek: boolean): Promise<CooldownBatchVerdict> {
  // A store given as a value, rather than a class extending CooldownStore, may have only consume()
  const ask = peek
    ? typeof store.peekMany === 'function' ? store.peekMany : CooldownStore.prototype.peekMany
    : typeof store.consumeMany === 'function' ? store.consumeMany : CooldownStore.prototype.consumeMany
  const attempt = Promise.resolve().then(() => ask.call(store, entries))
  // A rejection after the timeout has nobody left to hear it
  attempt.catch(() => undefined)
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new CooldownStoreError(undefined, true)), timeoutMs)
    timer.unref?.()
  })
  try {
    return await Promise.race([attempt, timeout])
  } catch (error) {
    throw error instanceof CooldownStoreError ? error : new CooldownStoreError(error, false)
  } finally {
    clearTimeout(timer)
  }
}

/** The store `@Cooldown` counts in: the one bound, else an in-memory one shared by the container. */
export function cooldownStoreOf(container: Container): CooldownStore {
  if (!container.isBound(CooldownStore)) container.bind(CooldownStore).toConstantValue(new MemoryCooldownStore())
  return container.get(CooldownStore)
}

/** What a call's peek found out, for its consume: each cooldown's bypass, and whether the store failed. */
interface Peeked {
  bypassed: (boolean | undefined)[]
  storeFailed: boolean
}

/** Keyed by the call's context, which the peek and the consume of one call share. */
const peeked = new WeakMap<HandlerExecutionContext, Peeked>()

interface Counted { key: string; seconds: number; uses: number; per: CooldownScope }

/**
 * The cooldowns a call counts against, keyed. With `peek`, those with `by` are left out, since their key
 * comes from params not resolved yet; after a peek the store failed, only those are left, the rest having
 * run uncounted. A bypass is asked once per call: the peek's answer serves the consume.
 */
async function keyed(
  controller: { name: string },
  methodName: string,
  cooldowns: readonly StoredCooldown[],
  contextOf: () => HandlerExecutionContext,
  params: unknown,
  peek: boolean,
): Promise<Counted[]> {
  const context = contextOf()
  const first = context.getArgs()[0]
  const earlier = peek ? undefined : peeked.get(context)
  const bypassed = earlier?.bypassed ?? []
  if (peek) peeked.set(context, { bypassed, storeFailed: false })

  const counted: Counted[] = []
  for (const [index, { seconds, uses, per, bypass, by }] of cooldowns.entries()) {
    if (peek && by) continue
    if (earlier?.storeFailed && !by) continue
    if (bypass) {
      bypassed[index] ??= Boolean(await bypass(context))
      if (bypassed[index]) continue
    }

    const value = by ? await by(context, params) : undefined
    // Encoded, so a value holding a colon cannot count under another value's key
    const suffix = value === undefined ? '' : `:by:${encodeURIComponent(String(value))}`
    counted.push({ key: `${controller.name}.${methodName}#${index}:${per}:${scopeId(per, first)}${suffix}`, seconds, uses, per })
  }
  return counted
}

/** The store key of the cooldown each refusal came from, for {@link claimCooldownNotice}. */
const refusalKeys = new WeakMap<CooldownError, string>()

/** Asks the store about the call under the app's policy, and throws what the answer means for it. */
async function ask(container: Container, counted: Counted[], peek: boolean, call: Peeked | undefined): Promise<void> {
  const store = cooldownStoreOf(container)
  const policy = cooldownPolicyOf(container)
  let verdict: CooldownBatchVerdict
  try {
    verdict = await askWithin(
      store,
      counted.map(({ key, seconds, uses }) => ({ key, limit: { uses, windowMs: seconds * 1000 } })),
      policy.timeoutMs,
      peek,
    )
  } catch (error) {
    const failure = error as CooldownStoreError
    reportFailure(store, failure, policy)
    if (call) call.storeFailed = true
    if (policy.failure === 'allow') return
    throw failure
  }
  reportRecovery(store)
  if (verdict.allowed) return
  const blocking = counted[verdict.blocked ?? 0] ?? counted[0]
  const refusal = new CooldownError(verdict.retryAfterMs, blocking.per)
  refusalKeys.set(refusal, blocking.key)
  throw refusal
}

/**
 * Whether the caller a cooldown refused is yet to be told so during this wait: a one-use cooldown in the same
 * store, keyed on the refusing cooldown's own key, over the wait left. The first refusal of a wait claims it;
 * every retry in that wait is refused it, and the next wait claims its own. A refusal `@Cooldown` did not
 * make, or a store that fails to answer, claims nothing.
 */
export async function claimCooldownNotice(container: Container, refusal: CooldownError): Promise<boolean> {
  const key = refusalKeys.get(refusal)
  if (key === undefined) return false
  const notice = { key: `${key}:notice`, limit: { uses: 1, windowMs: Math.max(1, refusal.retryAfterMs) } }
  try {
    return (await askWithin(cooldownStoreOf(container), [notice], cooldownPolicyOf(container).timeoutMs, false)).allowed
  } catch (error) {
    logger.debug(`Could not ask the cooldown store whether to tell a refused caller: ${String((error as Error).cause ?? error)}`)
    return false
  }
}

/** Whether the call is one cooldowns count: an interaction's or a message's. */
function isCounted(contextOf: () => HandlerExecutionContext): boolean {
  // Only a controller's own cooldowns reach other handlers, and those are not counted there.
  const type = contextOf().getType()
  return type === 'interaction' || type === 'message'
}

/**
 * Checks the call against the handler's cooldowns without counting it, in one store call, `peekMany`: before
 * the work a call needs ahead of its handler, such as fetching what it names from Discord, so a call a
 * cooldown refuses costs none of it. Cooldowns with `by` are left to {@link consumeCooldowns}. It refuses
 * as consumeCooldowns does, with the same errors, and a failing store is handled by the same policy.
 *
 * @throws CooldownError with the time until every cooldown checked allows another call.
 * @throws CooldownStoreError when the store fails and the policy is `'deny'`.
 */
export async function peekCooldowns(
  container: Container,
  controller: { name: string },
  methodName: string,
  cooldowns: readonly StoredCooldown[],
  contextOf: () => HandlerExecutionContext,
): Promise<void> {
  if (cooldowns.length === 0 || !isCounted(contextOf)) return
  const counted = await keyed(controller, methodName, cooldowns, contextOf, undefined, true)
  if (counted.length === 0) return
  await ask(container, counted, true, peeked.get(contextOf()))
}

/**
 * Counts the call against all of the handler's cooldowns in one store call, `consumeMany`. With a store
 * that overrides it, as the built-in ones do, a call one cooldown refuses counts against none. Every key is
 * worked out first, so a `bypass` or `by` that throws leaves every count untouched. A store that fails is
 * handled by the app's policy: the call is refused with CooldownStoreError, or runs uncounted. When the
 * call's {@link peekCooldowns} found the store failing, the cooldowns it checked run uncounted without
 * asking again; those with `by`, which it never checked, are still counted, so a call waits a second
 * timeout only when the store is still down and the handler has one.
 *
 * @param params - The handler's second argument, as the handler receives it, for `by`.
 * @throws CooldownError with the time until every cooldown allows another call.
 * @throws CooldownStoreError when the store fails and the policy is `'deny'`.
 */
export async function consumeCooldowns(
  container: Container,
  controller: { name: string },
  methodName: string,
  cooldowns: readonly StoredCooldown[],
  contextOf: () => HandlerExecutionContext,
  params: unknown,
): Promise<void> {
  if (cooldowns.length === 0 || !isCounted(contextOf)) return
  const counted = await keyed(controller, methodName, cooldowns, contextOf, params, false)
  if (counted.length === 0) return
  await ask(container, counted, false, undefined)
}
