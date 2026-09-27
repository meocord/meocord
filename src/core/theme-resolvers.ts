import { Logger } from '@src/common/logger.js'
import { type ThemeOverride, type ThemeResolvers } from '@src/interface/index.js'
import { themeProblems } from '@src/core/theme-validation.js'
import { copyLayer, outsideThemeScope } from '@src/core/theme-scope.js'

/** How long a resolver's result is kept, in seconds, unless `themeCache.ttlSeconds` says otherwise. */
export const DEFAULT_THEME_TTL_SECONDS = 300
/** How many servers' results are kept, unless `themeCache.maxGuilds` says otherwise. */
export const DEFAULT_THEME_MAX_GUILDS = 10_000
/** How many users' results are kept, unless `themeCache.maxUsers` says otherwise. */
export const DEFAULT_THEME_MAX_USERS = 50_000
/** How long a call waits for a resolver, unless `themeForTimeoutMs` says otherwise. */
export const DEFAULT_THEME_FOR_TIMEOUT_MS = 1_000
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

/** How `@MeoCord` configures its resolvers' caches. */
export interface ThemeResolverOptions {
  resolvers: ThemeResolvers
  cache?: { ttlSeconds?: number; maxGuilds?: number; maxUsers?: number }
  timeoutMs?: number
}

type Kind = 'guild' | 'user'

const logger = new Logger('Theme')

/** A resolver that did not answer in time. */
class ThemeLookupTimeout extends Error {}

/** One resolver's results, by server or user id: each kept until it expires, the oldest dropped past the limit. */
class ResolverCache {
  private readonly entries = new Map<string, { layer: ThemeOverride | undefined; expiresAt: number }>()
  /** The lookup in flight for each id, shared by every call that asks meanwhile. */
  private readonly pending = new Map<string, { token: object; result: Promise<ThemeOverride | undefined> }>()
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

  /** The layer for `id` as of `now`: at once when it is cached, else a promise of it that never rejects. */
  lookup(id: string, now: number): ThemeOverride | undefined | Promise<ThemeOverride | undefined> {
    const entry = this.entries.get(id)
    if (entry) {
      if (entry.expiresAt > now) return entry.layer
      this.entries.delete(id)
    }
    const inFlight = this.pending.get(id)
    if (inFlight) return inFlight.result
    const token = {}
    const result = this.fetch(id, token)
    this.pending.set(id, { token, result })
    return result
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

  private async fetch(id: string, token: object): Promise<ThemeOverride | undefined> {
    let layer: ThemeOverride | undefined
    let keepMs = this.ttlMs
    try {
      layer = this.accept(id, await this.within(id))
      this.recovered(id)
    } catch (error) {
      this.failed(id, error)
      layer = undefined
      keepMs = THEME_FAILURE_BACKOFF_MS
    }
    // Kept only when no invalidation came while it was looked up
    if (this.pending.get(id)?.token === token) {
      this.pending.delete(id)
      this.entries.delete(id)
      this.entries.set(id, { layer, expiresAt: performance.now() + keepMs })
      while (this.entries.size > this.max) this.entries.delete(this.entries.keys().next().value!)
    }
    return layer
  }

  /** The resolver's result, or a rejection when it throws, rejects or passes the timeout. */
  private within(id: string): Promise<unknown> {
    // Outside the call's theme, which the resolver has no use for and whatever it starts would otherwise keep
    const attempt = Promise.resolve().then(() => outsideThemeScope(() => this.resolve(id)))
    // A rejection after the timeout has nobody left to hear it
    attempt.catch(() => undefined)
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ThemeLookupTimeout()), this.timeoutMs)
      timer.unref?.()
    })
    return Promise.race([attempt, timeout]).finally(() => clearTimeout(timer))
  }

  /**
   * A result as a layer: copied, then checked; one with problems is left out, with a warning once per id. `null`,
   * as a database gives for a missing row, is no theme, as `undefined` is.
   */
  private accept(id: string, result: unknown): ThemeOverride | undefined {
    if (result === undefined || result === null) return undefined
    const layer = copyLayer(result) as ThemeOverride
    const problems = themeProblems(layer, `themeFor.${this.kind} for ${this.kind} ${id}`)
    if (problems.length === 0) {
      this.warned.delete(id)
      return layer
    }
    if (!this.warned.has(id)) {
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
    const cause = error instanceof ThemeLookupTimeout ? `did not answer within ${this.timeoutMs} ms` : String((error as Error)?.message ?? error)
    const reason = error instanceof ThemeLookupTimeout ? cause : `failed: ${cause}`
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

/** The caches for an app's `themeFor`, or `undefined` when it sets no resolver. */
export function resolverCaches(options: ThemeResolverOptions | undefined): ThemeResolverCaches | undefined {
  const { guild, user } = options?.resolvers ?? {}
  if (!guild && !user) return undefined
  const ttlMs = (options?.cache?.ttlSeconds ?? DEFAULT_THEME_TTL_SECONDS) * 1000
  const timeoutMs = options?.timeoutMs ?? DEFAULT_THEME_FOR_TIMEOUT_MS
  return {
    ...(guild && { guild: new ResolverCache('guild', id => guild({ guild: { id } }), options?.cache?.maxGuilds ?? DEFAULT_THEME_MAX_GUILDS, ttlMs, timeoutMs) }),
    ...(user && { user: new ResolverCache('user', id => user({ user: { id } }), options?.cache?.maxUsers ?? DEFAULT_THEME_MAX_USERS, ttlMs, timeoutMs) }),
  }
}

const idOf = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)

/**
 * The server and user a call comes from: an interaction's or a message's server and its user or author; a
 * reaction's message's server and the user who reacted, which a reaction handler gets second; an event argument's
 * server and user, when it has them.
 */
export function themeTargets(args: readonly unknown[]): { guildId?: string; userId?: string } {
  const [first, second] = args as [Record<string, any> | undefined, Record<string, any> | undefined]
  if (!first || typeof first !== 'object') return {}
  const guildId = idOf(first.guildId) ?? idOf(first.guild?.id) ?? idOf(first.message?.guildId)
  const userId = idOf(first.user?.id) ?? idOf(first.author?.id) ?? idOf(second?.user?.id)
  return { guildId, userId }
}

/**
 * The layers the call's server and user give, in that order: at once when every one is cached, else a promise of
 * them that never rejects. `undefined` when the call has neither a server nor a user a resolver is set for.
 */
export function lookupLayers(
  caches: ThemeResolverCaches,
  args: readonly unknown[],
): [ThemeOverride | undefined, ThemeOverride | undefined] | Promise<[ThemeOverride | undefined, ThemeOverride | undefined]> | undefined {
  const { guildId, userId } = themeTargets(args)
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

const stores = new WeakMap<ThemeCache, ThemeResolverCaches>()

/**
 * An app's cache of the themes `@MeoCord({ themeFor })` looked up, by server and by user. Inject it to clear a
 * result once the theme it came from changes, so the next call looks it up again rather than waiting for the result
 * to expire. Each app has its own.
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

/** Gives the `ThemeCache` an app's code injects the caches it clears. */
export function attachThemeCache(themeCache: ThemeCache, caches: ThemeResolverCaches | undefined): void {
  if (caches) stores.set(themeCache, caches)
  else stores.delete(themeCache)
}
