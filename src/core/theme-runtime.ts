import 'reflect-metadata'
import { type Container } from 'inversify'
import { Base } from 'discord.js'
import { type ThemeOverride } from '@src/interface/index.js'
import { stageClasses, stageOwners } from '@src/core/guard-runner.js'
import { makeInjectable } from '@src/util/injectable.util.js'
import {
  abandonLookups,
  attachThemeCache,
  stopLookups,
  cachedLayers,
  lookupsInFlight,
  lookupLayers,
  resolverCaches,
  ThemeCache,
  themeTargets,
  type ThemeResolverCaches,
  type ThemeTargets,
  type ThemeResolverOptions,
} from '@src/core/theme-resolvers.js'
import {
  ambientThemeVersion,
  claimAmbientTheme,
  defaultTheme,
  mergeTheme,
  ownsAmbientTheme,
  type RebuildTheme,
  releaseAmbientTheme,
  type ResolvedTheme,
  setRebuildOutsideCalls,
  setThemeOutsideCalls,
  themeLayersVersion,
  type ThemeScope,
  useTheme,
} from '@src/core/theme-scope.js'
import { META } from '@src/util/metadata-keys.js'
import { shared } from '@src/util/shared-state.util.js'
import { answerDeadline, isStoppedBeforeStart, type ReadyBound, readyBoundOf, readyGateOf } from '@src/core/ready-gate.js'
import { seconds } from '@src/core/autocomplete-timing.js'
import { Logger } from '@src/common/logger.js'

/** Classes with a `@UseTheme`, on the class or one of its methods, from either build of this version. */
export const THEMED_CLASSES = shared('themedClasses', () => new WeakSet<object>())

/** One app's themes: its own layer, and the resolved themes built from it. */
interface AppThemes {
  layer: ThemeOverride | undefined
  /** Whether a `@UseTheme` applies to any of the app's classes, so handlers can differ in theme. */
  varies: boolean
  /** The version of the layers beneath the app's that `app` and `handlers` were built on. */
  version: number
  /** The version of the app read outside a call that `scoped` was decided with. */
  ambientVersion: number
  app: ResolvedTheme
  /**
   * The theme a call of a handler without a `@UseTheme` is scoped to, or `undefined` when only `themeFor` may scope it.
   */
  scoped: ResolvedTheme | undefined
  /** The caches of the app's `themeFor`, when it sets a resolver. */
  resolvers: ThemeResolverCaches | undefined
  handlers: WeakMap<object, Map<string, ResolvedTheme>>
}

// One per process for this meocord version, so an app started through one build finds its theme from the other
const apps = shared('appThemes', () => new WeakMap<Container, AppThemes>())

/** The classes on `cls`'s prototype chain, itself first. */
function chainOf(cls: object): object[] {
  const chain: object[] = []
  for (let prototype = (cls as { prototype?: object }).prototype; prototype && prototype !== Object.prototype; prototype = Object.getPrototypeOf(prototype)) {
    chain.push(prototype.constructor)
  }
  return chain
}

/**
 * Records an app's theme and whether its handlers can differ in theme, at startup. `layer` is the app's
 * `@MeoCord({ theme })`, already checked and copied.
 */
export function configureThemes(
  container: Container,
  layer: ThemeOverride | undefined,
  classes: readonly object[],
  resolverOptions?: ThemeResolverOptions,
): void {
  const varies = classes.some(cls => chainOf(cls).some(link => THEMED_CLASSES.has(link)))
  const resolvers = resolverCaches(resolverOptions, cls => container.get(cls))
  apps.set(container, { layer, varies, version: -1, ambientVersion: -1, app: defaultTheme(), scoped: undefined, resolvers, handlers: new WeakMap() })
  // The instance the app's code injects, whether bound here or already as a dependency of one of its classes
  if (!container.isBound(ThemeCache)) {
    makeInjectable(ThemeCache)
    container.bind(ThemeCache).toSelf().inSingletonScope()
  }
  attachThemeCache(container.get(ThemeCache), resolvers)
}

/** Ends the theme lookups in flight for the app on `container`, as it shuts down: nothing they give later is logged or kept. */
export function abandonThemeLookups(container: Container): void {
  abandonLookups(apps.get(container)?.resolvers)
}

/**
 * Stops the app on `container` looking up themes, once its stop's shutdown has ended: a call then gets no server's or
 * user's theme, and the resolver is not asked. A failed start's undo is not a stop, so a retried start looks up as before.
 */
export function stopThemeLookups(container: Container): void {
  stopLookups(apps.get(container)?.resolvers)
}

/** Counts `classes`, whose handlers are prepared once the app's providers are made, among those a theme can vary by. */
export function prepareLateThemes(container: Container, classes: readonly object[]): void {
  const themes = apps.get(container)
  if (!themes || themes.varies || !classes.some(cls => chainOf(cls).some(link => THEMED_CLASSES.has(link)))) return
  themes.varies = true
  // Built again on its next read, with each handler's own theme
  themes.version = -1
}

/** The app's themes, built again when the layers beneath the app's have changed. */
function current(container: Container): AppThemes | undefined {
  const themes = apps.get(container)
  if (themes && themes.version !== themeLayersVersion()) {
    themes.version = themeLayersVersion()
    themes.app = mergeTheme(defaultTheme(), themes.layer)
    themes.handlers = new WeakMap()
    rescope(container, themes)
  } else if (themes && themes.ambientVersion !== ambientThemeVersion()) {
    rescope(container, themes)
  }
  return themes
}

/**
 * Decides whether the app's calls need a scope, again whenever the layers beneath it or the app read outside a call
 * change. They do when the handlers can differ in theme. Otherwise a call reads the theme outside a call, so it needs
 * one unless its app owns that theme: another app may claim it while the call runs, and the call keeps the theme it
 * started with.
 */
function rescope(container: Container, themes: AppThemes): void {
  themes.ambientVersion = ambientThemeVersion()
  themes.scoped = themes.varies || !ownsAmbientTheme(container) ? themes.app : undefined
}

/** The app's theme: MeoCord's defaults and the app's `@MeoCord({ theme })`, or the defaults for a container with none. */
export function appTheme(container: Container): ResolvedTheme {
  return current(container)?.app ?? defaultTheme()
}

/**
 * A handler's theme: the app's, then each class's `@UseTheme` from the furthest base class its stages reach, then the
 * method's.
 */
function handlerTheme(themes: AppThemes, prototype: object, methodName: string): ResolvedTheme {
  let byMethod = themes.handlers.get(prototype)
  if (!byMethod) themes.handlers.set(prototype, (byMethod = new Map()))
  let theme = byMethod.get(methodName)
  if (theme) return theme
  theme = themes.app
  // Base first, so a subclass's layer goes over its base class's
  for (const cls of stageClasses(prototype, methodName)) {
    theme = mergeTheme(theme, Reflect.getOwnMetadata(META.classTheme, cls) as ThemeOverride | undefined)
  }
  // The method's layer over its class's, and an override's over the method it overrides
  for (const owner of stageOwners(prototype, methodName)) {
    theme = mergeTheme(theme, Reflect.getOwnMetadata(META.methodTheme, owner, methodName) as ThemeOverride | undefined)
  }
  byMethod.set(methodName, theme)
  return theme
}

type Layers = ReturnType<typeof lookupLayers>
type FoundLayers = Exclude<Layers, Promise<unknown> | undefined>

const logger = new Logger('Theme')

/** What a wait for layers cut short at its interaction's first-answer deadline gives in their place. */
const CUT = Symbol('cut at the first-answer deadline')

/** The interaction a wait for layers answers, which bounds it: its bound, its targets, and what its warning names. */
interface WaitFor {
  bound: () => ReadyBound
  resolvers: ThemeResolverCaches
  targets: ThemeTargets
  /** The handler or the answer that waits, for the warning. */
  who: string
}

/** `read`'s value, read the first time it is asked for. */
function once<T>(read: () => T): () => T {
  let value: { of: T } | undefined
  return () => (value ??= { of: read() }).of
}

/**
 * The layers `pending` gives, or {@link CUT} once the first-answer deadline of the interaction `of` answers has
 * expired: past with Discord told nothing. Layers landing once it is past are cut too, whichever of the two comes
 * first within that moment. A wait with no deadline, as a message's, waits for the layers.
 */
function withinDeadline(pending: Promise<FoundLayers>, of: WaitFor | undefined): Promise<FoundLayers | typeof CUT> {
  const bound = of?.bound()
  if (!bound) return pending
  const deadline = answerDeadline(bound)
  const nameCut = lookupsInFlight(of!.resolvers, of!.targets)
  let over = false
  const end = (layers: FoundLayers | typeof CUT) => {
    over = true
    deadline.release()
    return layers
  }
  const cut = () => {
    const ended = end(CUT)
    // One line per lookup in flight, unless a warning already named this interaction's wait; only a line written names one
    const lookups = deadline.warned ? [] : nameCut()
    if (lookups.length > 0) {
      deadline.warned = true
      const span = deadline.fromWait ? `after ${seconds(bound.ms)}` : `${seconds(bound.ms)} after the interaction was created`
      const waits = bound.kind === 'interaction' ? 'an interaction Discord has been told nothing of' : 'an autocomplete'
      logger.warn(
        `${lookups.join(' and ')} had not answered ${span}, as long as ${waits} waits for its first answer, so ` +
          `${of!.who} went on without it. The lookup goes on and its result is kept for later calls: this is not a failure and starts no backoff.`,
      )
    }
    return ended
  }
  if (deadline.due()) return Promise.resolve(cut())
  return new Promise(resolve => {
    pending.then(layers => over || resolve(deadline.due() ? cut() : end(layers)))
    void deadline.expired.then(() => over || resolve(cut()))
  })
}

/**
 * The layers for `targets`: at once when the resolver needn't be waited for, else a promise of them, or of {@link CUT}
 * once the first-answer deadline of the interaction `of` answers ends the wait.
 */
function boundedLookup(resolvers: ThemeResolverCaches, targets: ThemeTargets, of: WaitFor | undefined): BoundedLayers {
  const layers = lookupLayers(resolvers, targets)
  return layers instanceof Promise ? withinDeadline(layers, of) : layers
}

type BoundedLayers = FoundLayers | undefined | Promise<FoundLayers | typeof CUT | undefined>

/**
 * The layers for `targets` once `after` settles, as a call under waitForReady starts its lookup only when its wait for
 * the hooks is over. The gate bounds that wait itself, so the deadline bounds only the lookup's.
 */
const lookedUpAfter = (resolvers: ThemeResolverCaches, targets: ThemeTargets, after: Promise<void>, of: WaitFor | undefined) =>
  after.then(
    () => boundedLookup(resolvers, targets, of),
    // A stop dropped the wait for the resolver's hooks: the resolver is never asked, and the theme is the handler's
    (error: unknown) => (isStoppedBeforeStart(error) ? CUT : Promise.reject(error)),
  )

/**
 * A scope of `base` with a call's server's and user's `layers` over it. Layers still being looked up replace its theme
 * once found, and the scope's `ready` settles then, so an answer made in it before waits for them.
 */
function layeredScope(base: ResolvedTheme, layers: BoundedLayers, rebuild: RebuildTheme | undefined): ThemeScope {
  if (!(layers instanceof Promise)) return { theme: mergeTheme(mergeTheme(base, layers?.[0]), layers?.[1]), rebuild }
  const scope: ThemeScope = { theme: base, rebuild }
  scope.ready = layers.then(found => {
    // Cut, the call keeps its handler's theme to its end, whatever lands later
    if (found !== CUT) scope.theme = mergeTheme(mergeTheme(base, found?.[0]), found?.[1])
  })
  return scope
}

/**
 * With `waitForReady`, what a theme lookup for `container`'s app waits for: its theme resolver's hooks, within `bound`;
 * `undefined` without the option, or once there is nothing left to wait for.
 */
const lookupReady = (container: Container, bound: () => ReadyBound) => readyGateOf(container)?.lookupReady(bound)

/**
 * How a function bound in a call of `base`, a handler's theme, builds the scope of a later call: `base` with the
 * server's and user's themes of that call's interaction, message or reaction over it.
 */
function rebuildOver(container: Container, resolvers: ThemeResolverCaches, base: ResolvedTheme): RebuildTheme {
  const rebuild: RebuildTheme = args => {
    const targets = themeTargets(args)
    if (targets.guildId === undefined && targets.userId === undefined) return undefined
    const bound = once(() => readyBoundOf(args))
    const of: WaitFor = { bound, resolvers, targets, who: 'a function bindTheme wraps' }
    const cached = cachedLayers(resolvers, targets)
    return scopeOver(resolvers, base, targets, cached === undefined ? undefined : lookupReady(container, bound), rebuild, cached, of)
  }
  return rebuild
}

/**
 * A scope of `base` whose server's and user's layers are looked up in a microtask, so whatever runs in the scope
 * synchronously, such as a call's observers' onStart or a bound function, runs before the resolver is asked. Layers
 * the resolver answers with a value are in the scope as that microtask ends; others replace its theme once found.
 */
function lookedUpScope(base: ResolvedTheme, lookup: () => BoundedLayers, rebuild: RebuildTheme | undefined): ThemeScope {
  const looked = Promise.withResolvers<void>()
  const scope: ThemeScope = { theme: base, rebuild, ready: looked.promise }
  queueMicrotask(() => {
    // Nothing here throws: the call's targets were read as the scope was made, and the cache settles all the resolver does
    const layers = lookup()
    if (layers instanceof Promise) {
      looked.resolve(layers.then(found => void (found !== CUT && (scope.theme = mergeTheme(mergeTheme(base, found?.[0]), found?.[1])))))
      return
    }
    scope.theme = mergeTheme(mergeTheme(base, layers?.[0]), layers?.[1])
    scope.ready = undefined
    looked.resolve()
  })
  return scope
}

/**
 * The scope of a call from `targets`: `base` with their server's and user's layers over it, looked up after `after`
 * when set. Layers all `cached` are in the scope at once; a lookup that has to ask the resolver asks it in a microtask.
 * A wait for layers ends by the first-answer deadline of the interaction `of` answers.
 */
function scopeOver(
  resolvers: ThemeResolverCaches,
  base: ResolvedTheme,
  targets: ThemeTargets,
  after: Promise<void> | undefined,
  rebuild: RebuildTheme | undefined,
  cached = cachedLayers(resolvers, targets),
  of?: WaitFor,
): ThemeScope {
  if (cached === undefined) return { theme: base, rebuild }
  if (after) return layeredScope(base, lookedUpAfter(resolvers, targets, after, of), rebuild)
  if (cached === 'uncached') return lookedUpScope(base, () => boundedLookup(resolvers, targets, of), rebuild)
  return layeredScope(base, cached.layers, rebuild)
}

/**
 * The theme scope a call runs in, or `undefined` when it needs none: its handlers share the theme read outside any
 * call, and no resolver applies. The scope holds the handler's theme, or the app's without a handler, with the call's
 * server's and user's themes over it; when those are still being looked up, `ready` settles once they are in the scope.
 * `event` names the event an `@On` or `@Once` call handles, for the user it names.
 */
export function beginCallTheme(
  container: Container,
  args: readonly unknown[],
  prototype?: object,
  methodName?: string,
  bound: () => ReadyBound = () => readyBoundOf(args),
  event?: string,
): { scope: ThemeScope; ready?: Promise<void> } | undefined {
  const themes = current(container)
  if (!themes) return undefined
  // Read once, for the gate and the deadline alike, and only by a call that waits
  if (themes.resolvers) bound = once(bound)
  // The call's server and user, read once: every lookup of its themes, now or once the hooks settle, takes them from here
  const targets = themes.resolvers && themeTargets(args, event)
  const cached = targets && cachedLayers(themes.resolvers!, targets)
  const looksUp = cached !== undefined
  // Only a call that looks something up waits at the gate, so no wait is left that nothing reads
  const after = looksUp ? lookupReady(container, bound) : undefined
  if (!looksUp && !themes.scoped) return undefined
  const base = themes.varies && prototype && methodName ? handlerTheme(themes, prototype, methodName) : themes.app
  const rebuild = themes.resolvers && rebuildOver(container, themes.resolvers, base)
  // Until the server's and user's themes are found, the call has the handler's; the pipeline waits for them, and an
  // answer made before that wait, as in an observer's onStart, waits itself
  const of: WaitFor | undefined = looksUp
    ? {
        bound,
        resolvers: themes.resolvers!,
        targets: targets!,
        who: prototype && methodName ? `${(prototype.constructor as { name?: string }).name}.${methodName}` : 'the answer to a call no handler takes',
      }
    : undefined
  const scope = looksUp ? scopeOver(themes.resolvers!, base, targets!, after, rebuild, cached, of) : { theme: base, rebuild }
  // With the theme the app owns outside calls, a function it binds rebuilds from the app's theme without this scope
  return scope.theme === base && !scope.ready && !themes.scoped ? undefined : { scope, ready: scope.ready }
}

const clientApps = shared('clientThemes', () => new WeakMap<object, Container>())

/** Records which app a client's interactions come to, so an answer outside any call can find its theme. */
export function registerClientTheme(client: object, container: Container): void {
  clientApps.set(client, container)
}

/** The container of the app a client belongs to: the bot's own, or a testing module's that ran a call on it. */
export function appOfClient(client: object): Container | undefined {
  return clientApps.get(client)
}

// An answer outside any call, as in a collector's callback, takes the theme of the app its interaction came to,
// with the server's and user's themes over it, from the same caches calls use
setThemeOutsideCalls(interaction => {
  const container = clientApps.get((interaction as { client?: object }).client ?? interaction)
  const themes = container && current(container)
  if (!themes) return useTheme()
  if (!themes.resolvers) return themes.app
  const bound = once(() => readyBoundOf([interaction]))
  const targets = themeTargets([interaction])
  if (cachedLayers(themes.resolvers, targets) === undefined) return themes.app
  const after = lookupReady(container!, bound)
  const of: WaitFor = { bound, resolvers: themes.resolvers, targets, who: 'an answer outside any call' }
  const layers = after ? lookedUpAfter(themes.resolvers, targets, after, of) : boundedLookup(themes.resolvers, targets, of)
  const over = (found: FoundLayers | typeof CUT | undefined) => (found === CUT ? themes.app : mergeTheme(mergeTheme(themes.app, found?.[0]), found?.[1]))
  return layers instanceof Promise ? layers.then(over) : over(layers)
})

// A function bound outside any call's scope rebuilds each call's theme from the app of its first argument's client
setRebuildOutsideCalls(args => {
  const [first] = args as [unknown]
  if (!first || typeof first !== 'object') return undefined
  // A structure's client, or one an object of the app's own holds; a key the object lacks is not read
  const client = first instanceof Base || 'client' in first ? (first as { client?: object }).client : undefined
  const container = clientApps.get(client ?? first)
  const themes = container && current(container)
  return themes?.resolvers && rebuildOver(container!, themes.resolvers, themes.app)(args)
})

/** Makes the app's theme the one read outside a call, unless another app in the process already has. */
export function claimAmbientAppTheme(container: Container): void {
  claimAmbientTheme(container, () => appTheme(container))
}

/** Gives up the app's theme as the one read outside a call: its start failed, or it has shut down. */
export function releaseAmbientAppTheme(container: Container): void {
  releaseAmbientTheme(container)
}
