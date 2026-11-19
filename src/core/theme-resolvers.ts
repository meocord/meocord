import { BaseInteraction, Message, MessageReaction, User } from 'discord.js'
import { Logger } from '@src/common/logger.js'
import { type ThemeOverride, type ThemeResolver, type ThemeResolvers } from '@src/interface/index.js'
import { themeProblems } from '@src/core/theme-validation.js'
import { copyLayer, outsideThemeScope } from '@src/core/theme-scope.js'
import { quoteForLog } from '@src/util/user-text.util.js'
import { shared, sharedClass } from '@src/util/shared-state.util.js'
import { readQuietly } from '@src/util/quiet-reads.util.js'

/** How long a resolver's result is kept, in seconds, unless `themeCache.ttlSeconds` says otherwise. */
export const DEFAULT_THEME_TTL_SECONDS = 300
/** How many servers' results are kept, unless `themeCache.maxGuilds` says otherwise. */
export const DEFAULT_THEME_MAX_GUILDS = 10_000
/** How many users' results are kept, unless `themeCache.maxUsers` says otherwise. */
export const DEFAULT_THEME_MAX_USERS = 50_000
/** How long a call waits for a resolver, unless `themeForTimeoutMs` says otherwise. */
export const DEFAULT_THEME_FOR_TIMEOUT_MS = 1_000

/** How long a component's lock waits for the presenter's loading view before showing MeoCord's; matches themeFor's default. */
export const LOADING_DRAW_TIMEOUT_MS = 1_000
/** How long a server or user whose lookup failed is not asked again. */
export const THEME_FAILURE_BACKOFF_MS = 10_000
/** How long a burst of failures or of answers lasts, from its first: its second is summed up, the rest only counted. */
const BURST_MS = 2 * THEME_FAILURE_BACKOFF_MS
/** How many lookups in a row an id must answer before its failure is over: one failing again first is flapping. */
const STEADY_ANSWERS = 2

/**
 * Failures, or answers after failing, across a resolver's servers or users, in bursts of `BURST_MS` from each burst's
 * first: that one is logged on its own, the second as one summary for the resolver, and the rest are not logged. Only
 * time ends a burst, so a later outage is always logged, however many servers or users keep failing.
 */
class Burst {
  private start = Number.NEGATIVE_INFINITY
  private count = 0

  /** How an event at `now` is logged. */
  next(now: number): 'alone' | 'summary' | 'counted' {
    if (now - this.start >= BURST_MS) {
      this.start = now
      this.count = 0
    }
    this.count++
    return this.count === 1 ? 'alone' : this.count === 2 ? 'summary' : 'counted'
  }
}

/** A class `@MeoCord({ themeFor })` takes, resolved from the app's container. */
export type ThemeResolverClass = new (...args: any[]) => ThemeResolver

/** The class `themeFor` names, which the app binds and runs the hooks of, or `undefined` for functions or none. */
export function themeResolverClass(themeFor: ThemeResolvers | ThemeResolverClass | undefined): ThemeResolverClass | undefined {
  return typeof themeFor === 'function' ? themeFor : undefined
}

/** How `@MeoCord` configures its resolvers' caches. */
export interface ThemeResolverOptions {
  resolvers: ThemeResolvers | ThemeResolverClass
  cache?: { ttlSeconds?: number; maxGuilds?: number; maxUsers?: number }
  timeoutMs?: number
}

type Kind = 'guild' | 'user'

const logger = new Logger('Theme')

/** What a lookup that did not answer in time rejects with, told apart by identity alone, which no value can intercept. */
const TIMED_OUT = Symbol('themeFor lookup timed out')
/** What a lookup the app abandoned as it shut down rejects with: it ends quietly, as nothing is left to serve. */
const ABANDONED = Symbol('themeFor lookup abandoned')

/**
 * What a resolver threw or rejected with, as a log line names it. Reading it may throw too, as a getter or a Proxy may;
 * then it is named as such, so describing a failure can never fail.
 */
function describeThrown(error: unknown): string {
  try {
    return String((error as Error)?.message ?? error)
  } catch {
    return 'a value that throws as it is read'
  }
}

/** What a resolver gave for one id: its result, or what it threw or rejected with. */
type Outcome = { result: unknown } | { error: unknown }

/** One resolver's results, by server or user id: each kept until it expires, the oldest dropped past the limit. */
class ResolverCache {
  private readonly entries = new Map<string, { layer: ThemeOverride | undefined; expiresAt: number }>()
  /** The lookup in flight for each id, shared by every call that asks meanwhile. */
  private readonly pending = new Map<string, { token: object; result: Promise<ThemeOverride | undefined>; cut?: boolean }>()
  /** How to end each lookup in flight, those an invalidation forgot included, until it settles. */
  private readonly live = new Set<() => void>()
  /** The ids already warned about for an invalid result, until one gives a valid result again. */
  private readonly warned = new Set<string>()
  /**
   * The ids whose lookups are failing, so an id that keeps failing is counted once, when it starts; each is kept after it
   * answers until it has answered `STEADY_ANSWERS` lookups in a row, so failing again first is flapping, not a new
   * failure, however long the cache keeps an answer.
   */
  private readonly failing = new Map<string, { failures: number; since: number; answers: number; flapping: boolean }>()
  /** The ids that start failing, and those that answer again. */
  private readonly failures = new Burst()
  private readonly answers = new Burst()

  constructor(
    private readonly kind: Kind,
    private readonly resolve: (id: string) => ThemeOverride | null | undefined | Promise<ThemeOverride | null | undefined>,
    private readonly max: number,
    private readonly ttlMs: number,
    private readonly timeoutMs: number,
  ) {}

  /** Whether `id` has a result cached as of `now`, and that result, without looking it up. */
  peek(id: string, now: number): { layer: ThemeOverride | undefined } | undefined {
    const entry = this.entries.get(id)
    return entry && entry.expiresAt > now ? { layer: entry.layer } : undefined
  }

  /** The layer for `id` as of `now`: at once when it is cached, else a promise of it that never rejects. */
  lookup(id: string, now: number): ThemeOverride | undefined | Promise<ThemeOverride | undefined> {
    const entry = this.entries.get(id)
    if (entry) {
      if (entry.expiresAt > now) return entry.layer
      this.entries.delete(id)
    }
    const inFlight = this.pending.get(id)
    if (inFlight) return inFlight.result
    const attempt = this.attempt(id)
    // A resolver that answers or throws synchronously gives its layer at once, so a call it serves waits for nothing
    if (!(attempt instanceof Promise)) return this.settle(id, attempt, true)
    const token = {}
    const result = this.fetch(id, token, this.within(attempt))
    this.pending.set(id, { token, result })
    return result
  }

  /** The lookup in flight for `id`, if one is: what a wait for it names should the wait be cut short. */
  inFlight(id: string): { cut?: boolean } | undefined {
    return this.pending.get(id)
  }

  /**
   * Whether `lookup`, a lookup in flight as a wait for it began, is cut short for the first time, so the lookup
   * is named once however many waits on it are cut, and whether or not it has landed since.
   */
  cutShort(lookup: { cut?: boolean }): boolean {
    if (lookup.cut) return false
    lookup.cut = true
    return true
  }

  /**
   * Ends every lookup in flight, an invalidated one included, as the app shuts down: each settles with no layer, so a
   * wait on it goes on in the theme it has, and nothing it gives later is logged, counted or kept. Its timeout is
   * cleared at once.
   */
  abandon(): void {
    // Dropped first, so each settles as a lookup no longer current
    this.pending.clear()
    for (const end of [...this.live]) end()
  }

  /** Forgets `id`'s result, or every result, so the next call looks it up again; a lookup in flight is not kept. */
  invalidate(id?: string): void {
    if (id === undefined) {
      this.entries.clear()
      this.pending.clear()
      this.warned.clear()
      this.failing.clear()
      return
    }
    this.entries.delete(id)
    this.pending.delete(id)
    this.warned.delete(id)
    this.failing.delete(id)
  }

  /** The resolver's outcome for `id`: at once when it answers or throws synchronously, else a promise of its answer. */
  private attempt(id: string): Outcome | Promise<unknown> {
    // Never throws: whatever goes wrong, reading the answer included, is the resolver failing
    try {
      // Outside the call's theme, which the resolver has no use for and whatever it starts would otherwise keep
      const answer: unknown = outsideThemeScope(() => this.resolve(id))
      // Any thenable, not only a native promise
      return typeof (answer as { then?: unknown } | null | undefined)?.then === 'function' ? Promise.resolve(answer) : { result: answer }
    } catch (error) {
      return { error }
    }
  }

  private async fetch(id: string, token: object, answer: Promise<unknown>): Promise<ThemeOverride | undefined> {
    let outcome: Outcome
    try {
      outcome = { result: await answer }
    } catch (error) {
      outcome = { error }
    }
    // An invalidation while it was looked up forgot the id: the result still serves the calls that asked, and that is all
    return this.settle(id, outcome, this.pending.get(id)?.token === token)
  }

  /** The layer `outcome` gives, kept for `id` and counted in its failures and answers when `current`. */
  private settle(id: string, outcome: Outcome, current: boolean): ThemeOverride | undefined {
    let layer: ThemeOverride | undefined
    let keepMs = this.ttlMs
    if ('error' in outcome) {
      if (current) this.failed(id, outcome.error)
      keepMs = THEME_FAILURE_BACKOFF_MS
    } else {
      layer = this.accept(id, outcome.result, current)
      if (current) this.recovered(id)
    }
    if (current) {
      this.pending.delete(id)
      this.entries.delete(id)
      this.entries.set(id, { layer, expiresAt: performance.now() + keepMs })
      while (this.entries.size > this.max) this.entries.delete(this.entries.keys().next().value!)
    }
    return layer
  }

  /** The resolver's answer, or a rejection when it rejects, passes the timeout or is abandoned. */
  private within(attempt: Promise<unknown>): Promise<unknown> {
    // A rejection after the timeout, or once abandoned, has nobody left to hear it
    attempt.catch(() => undefined)
    const ended = Promise.withResolvers<never>()
    const timer = setTimeout(() => ended.reject(TIMED_OUT), this.timeoutMs)
    timer.unref?.()
    const end = () => {
      // At once, not once the race settles a few microtasks on, so no timer outlives the shutdown that abandons it
      clearTimeout(timer)
      ended.reject(ABANDONED)
    }
    this.live.add(end)
    return Promise.race([attempt, ended.promise]).finally(() => {
      clearTimeout(timer)
      this.live.delete(end)
    })
  }

  /**
   * A result as a layer: copied, then checked; one with problems, or that throws as it is read, is left out, with a
   * warning once per id when `report`. `null`, as a database gives for a missing row, is no theme, as `undefined` is.
   */
  private accept(id: string, result: unknown, report: boolean): ThemeOverride | undefined {
    if (result === undefined || result === null) return undefined
    const where = `themeFor.${this.kind} for ${this.kind} ${id}`
    let layer: ThemeOverride | undefined
    let problems: string[]
    try {
      layer = copyLayer(result) as ThemeOverride
      // A value from the app's data, such as a user's saved choice, shown as a log line shows outside text
      problems = themeProblems(layer, where, { forLog: true })
    } catch (error) {
      // A cycle overflows the copy, and a getter may throw: the result is left out as one with problems is
      problems = [`${where}: theme cannot be read: ${quoteForLog(describeThrown(error))}`]
    }
    if (problems.length === 0) {
      if (report) this.warned.delete(id)
      return layer
    }
    if (report && !this.warned.has(id)) {
      if (this.warned.size >= this.max) this.warned.clear()
      this.warned.add(id)
      logger.warn(`${problems.join('\n')}\nCalls from this ${this.kind} use the theme without it until the result changes.`)
    }
    return undefined
  }

  /**
   * Logs an id that starts failing, once until it answers, and once more when it fails again before it has answered
   * `STEADY_ANSWERS` lookups in a row, as flapping: on its own, or as the second in a burst, in one summary for the
   * resolver, since many servers or users failing together is the resolver failing.
   */
  private failed(id: string, error: unknown): void {
    const now = Date.now()
    const failing = this.failing.get(id)
    const cause = error === TIMED_OUT ? `did not answer within ${this.timeoutMs} ms` : describeThrown(error)
    const reason = error === TIMED_OUT ? cause : `failed: ${cause}`
    const backoff = `${THEME_FAILURE_BACKOFF_MS / 1000}s`
    let alone: string
    if (failing) {
      failing.failures++
      const answered = failing.answers > 0
      failing.answers = 0
      if (!answered || failing.flapping) return
      failing.flapping = true
      alone =
        `themeFor.${this.kind} for ${this.kind} ${id} fails again before answering steadily: ${cause}. It is not logged again ` +
        `until it has answered ${STEADY_ANSWERS} lookups in a row.`
    } else {
      if (this.failing.size >= this.max) this.failing.clear()
      this.failing.set(id, { failures: 1, since: now, answers: 0, flapping: false })
      alone = `themeFor.${this.kind} for ${this.kind} ${id} ${reason}. Its calls use the theme without it, and it is asked again after ${backoff}.`
    }
    switch (this.failures.next(now)) {
      case 'alone':
        logger.error(alone)
        break
      case 'summary':
        logger.error(
          `themeFor.${this.kind} is failing for more than one ${this.kind}; the latest, ${this.kind} ${id}, ${reason}. Their ` +
            `calls use the theme without it, each is asked again after ${backoff}, and others that fail in the next ` +
            `${BURST_MS / 1000}s are not logged.`,
        )
    }
  }

  /**
   * Logs that an id whose lookups were failing answers again, at once, or for one that was flapping, once it has
   * answered `STEADY_ANSWERS` lookups in a row: on its own, or as the second in a burst, in one summary.
   */
  private recovered(id: string): void {
    const failing = this.failing.get(id)
    if (!failing) return
    const now = Date.now()
    failing.answers++
    if (failing.answers >= STEADY_ANSWERS) this.failing.delete(id)
    // Logged once for each: a steady id on its first answer, a flapping one when it is steady
    if (failing.flapping ? failing.answers < STEADY_ANSWERS : failing.answers > 1) return
    const seconds = Math.round((now - failing.since) / 1000)
    const steadily = failing.flapping ? ' steadily' : ''
    switch (this.answers.next(now)) {
      case 'alone': {
        logger.log(`themeFor.${this.kind} for ${this.kind} ${id} answers${steadily} again, after ${failing.failures} failed lookup(s) over ${seconds}s.`)
        break
      }
      case 'summary':
        logger.log(
          `themeFor.${this.kind} answers again for more than one ${this.kind}; the latest, ${this.kind} ${id}. Others that ` +
            `answer in the next ${BURST_MS / 1000}s are not logged.`,
        )
    }
  }
}

/** An app's resolvers, each with its own cache. */
export interface ThemeResolverCaches {
  guild?: ResolverCache
  user?: ResolverCache
}

/**
 * A resolver class's methods as functions, each asking the instance `instance` gives when it is called, so the class
 * is made only once a call needs it, and a method an override's instance lacks gives no theme.
 */
function classResolvers(cls: ThemeResolverClass, instance: () => ThemeResolver): ThemeResolvers {
  const { guild, user } = cls.prototype as ThemeResolver
  return {
    ...(typeof guild === 'function' && { guild: target => instance().guild?.(target) }),
    ...(typeof user === 'function' && { user: target => instance().user?.(target) }),
  }
}

/** The caches for an app's `themeFor`, or `undefined` when it sets no resolver; `instanceOf` gives a class's instance. */
export function resolverCaches(
  options: ThemeResolverOptions | undefined,
  instanceOf: (cls: ThemeResolverClass) => ThemeResolver,
): ThemeResolverCaches | undefined {
  const cls = themeResolverClass(options?.resolvers)
  const { guild, user } = cls ? classResolvers(cls, () => instanceOf(cls)) : ((options?.resolvers as ThemeResolvers | undefined) ?? {})
  if (!guild && !user) return undefined
  const ttlMs = (options?.cache?.ttlSeconds ?? DEFAULT_THEME_TTL_SECONDS) * 1000
  const timeoutMs = options?.timeoutMs ?? DEFAULT_THEME_FOR_TIMEOUT_MS
  return {
    ...(guild && { guild: new ResolverCache('guild', id => guild({ guild: { id } }), options?.cache?.maxGuilds ?? DEFAULT_THEME_MAX_GUILDS, ttlMs, timeoutMs) }),
    ...(user && { user: new ResolverCache('user', id => user({ user: { id } }), options?.cache?.maxUsers ?? DEFAULT_THEME_MAX_USERS, ttlMs, timeoutMs) }),
  }
}

const idOf = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)

/** The server and user whose themes a call takes, read once from its arguments as its scope is made. */
export interface ThemeTargets {
  guildId?: string
  userId?: string
}

/**
 * The server and user a call comes from: an interaction's or a message's server and its user or author; a
 * reaction's message's server and the user who reacted, which a reaction handler gets second as `{ user }` and a
 * reaction event as the `User`; an event argument's server and user, when it has them.
 */
export function themeTargets(args: readonly unknown[]): ThemeTargets {
  const [first, second] = args as [Record<string, any> | undefined, Record<string, any> | undefined]
  if (!first || typeof first !== 'object') return {}
  // An interaction, a message and a reaction by their class, so nothing is read that the class lacks
  if (first instanceof BaseInteraction) return { guildId: serverOf(first), userId: idOf(first.user?.id) }
  // A partial message has no author: a call that gives a user second, as a bound function may, is that user's
  if (first instanceof Message) return { guildId: serverOf(first), userId: idOf(first.author?.id) ?? userOf(second) }
  if (first instanceof MessageReaction) return { guildId: idOf(first.message.guildId), userId: userOf(second) }
  // An event argument of any class, read quietly: a default-mode mock answers a key its class lacks with a placeholder
  return readQuietly(() => {
    // A call whose guildId is null has no server at all
    const own: unknown = first.guildId
    const guildId = idOf(own) ?? idOf(first.guild?.id) ?? (own === null ? undefined : idOf(first.message?.guildId))
    // Only a User's own id: an event of an old and a new channel, role or message would give the new one's otherwise
    const userId =
      idOf(first.user?.id) ?? idOf(first.author?.id) ?? idOf(second?.user?.id) ?? (second instanceof User ? idOf(second.id) : undefined)
    return { guildId, userId }
  })
}

/**
 * The user a call gives second: a User, or `{ user }` as a reaction handler gets it; read quietly, since an event's
 * second argument, such as a messageUpdate's new message, has no `user`.
 */
function userOf(second: Record<string, any> | undefined): string | undefined {
  return second instanceof User ? idOf(second.id) : readQuietly(() => idOf(second?.user?.id))
}

/** A call's server: its `guildId`, or its `guild`'s id; none in a DM, where both are null. */
function serverOf(target: { guildId?: unknown; guild?: { id?: unknown } | null }): string | undefined {
  return idOf(target.guildId) ?? idOf(target.guild?.id)
}

/**
 * The layers a call's server and user give, in that order: at once when every one is cached, else a promise of
 * them that never rejects. `undefined` when the call has neither a server nor a user a resolver is set for.
 */
export function lookupLayers(
  caches: ThemeResolverCaches,
  targets: ThemeTargets,
): [ThemeOverride | undefined, ThemeOverride | undefined] | Promise<[ThemeOverride | undefined, ThemeOverride | undefined]> | undefined {
  const { guildId, userId } = targets
  const byGuild = caches.guild && guildId !== undefined ? caches.guild : undefined
  const byUser = caches.user && userId !== undefined ? caches.user : undefined
  if (!byGuild && !byUser) return undefined
  const now = performance.now()
  const guild = byGuild?.lookup(guildId!, now)
  const user = byUser?.lookup(userId!, now)
  // Two misses are looked up together, so the call waits for the slower, not both in turn
  if (guild instanceof Promise || user instanceof Promise) return Promise.all([guild, user])
  return [guild, user]
}

/**
 * The lookups in flight for `targets` as a wait for them begins, and how to name them should the wait be cut short:
 * each the first time a wait on it is cut, read from the lookups the wait began with, so a lookup landing in the same
 * moment as the cut is named all the same.
 */
export function lookupsInFlight(caches: ThemeResolverCaches, targets: ThemeTargets): () => string[] {
  const held: { cache: ResolverCache; lookup: { cut?: boolean }; name: string }[] = []
  for (const kind of ['guild', 'user'] as const) {
    const id = kind === 'guild' ? targets.guildId : targets.userId
    const cache = caches[kind]
    const lookup = id === undefined ? undefined : cache?.inFlight(id)
    if (lookup) held.push({ cache: cache!, lookup, name: `themeFor.${kind} for ${kind} ${id}` })
  }
  return () => held.filter(({ cache, lookup }) => cache.cutShort(lookup)).map(({ name }) => name)
}

/**
 * What a call's server and user give from the cache alone, without looking anything up: their layers when every one
 * is cached, `uncached` when one has to be looked up, `undefined` when the call has neither a server nor a user a
 * resolver is set for.
 */
export function cachedLayers(
  caches: ThemeResolverCaches,
  targets: ThemeTargets,
): { layers: [ThemeOverride | undefined, ThemeOverride | undefined] } | 'uncached' | undefined {
  const { guildId, userId } = targets
  const byGuild = caches.guild && guildId !== undefined ? caches.guild : undefined
  const byUser = caches.user && userId !== undefined ? caches.user : undefined
  if (!byGuild && !byUser) return undefined
  const now = performance.now()
  const guild = byGuild ? byGuild.peek(guildId!, now) : { layer: undefined }
  const user = byUser ? byUser.peek(userId!, now) : { layer: undefined }
  return guild && user ? { layers: [guild.layer, user.layer] } : 'uncached'
}

// One per process for this meocord version, as the rest of an app's theme state is
const stores = shared('themeCaches', () => new WeakMap<ThemeCache, ThemeResolverCaches>())

/**
 * An app's cache of the themes `@MeoCord({ themeFor })` looked up, by server and by user.
 *
 * Inject it to clear a result once the theme it came from changes, so the next call looks it up again rather than
 * waiting for the result to expire. Each app has its own.
 *
 * @example
 * ```ts
 * @Service()
 * export class GuildSettings {
 *   readonly themes = new Map<string, ThemeOverride>()
 *
 *   constructor(private readonly cache: ThemeCache) {}
 *
 *   setColour(guildId: string, primary: HexColorString) {
 *     this.themes.set(guildId, { colors: { primary } })
 *     // The next call in this server looks its theme up again, rather than waiting for ttlSeconds
 *     this.cache.invalidateGuild(guildId)
 *   }
 * }
 * ```
 *
 * @group Utilities
 */
@sharedClass('ThemeCache')
export class ThemeCache {
  /**
   * Forgets a server's theme, so the next call from it looks it up again.
   *
   * @param guildId - The server's id; without it, every server's theme is forgotten.
   */
  invalidateGuild(guildId?: string): void {
    stores.get(this)?.guild?.invalidate(guildId)
  }

  /**
   * Forgets a user's theme, so the next call from them looks it up again.
   *
   * @param userId - The user's id; without it, every user's theme is forgotten.
   */
  invalidateUser(userId?: string): void {
    stores.get(this)?.user?.invalidate(userId)
  }
}

/** Ends the lookups in flight through `caches`, as the app shuts down; see {@link ResolverCache.abandon}. */
export function abandonLookups(caches: ThemeResolverCaches | undefined): void {
  caches?.guild?.abandon()
  caches?.user?.abandon()
}

/** Gives the `ThemeCache` an app's code injects the caches it clears. */
export function attachThemeCache(themeCache: ThemeCache, caches: ThemeResolverCaches | undefined): void {
  if (caches) stores.set(themeCache, caches)
  else stores.delete(themeCache)
}
