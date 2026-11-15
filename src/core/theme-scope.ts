import { AsyncLocalStorage } from 'node:async_hooks'
import { type DeepReadonly, type MeoCordTheme, type ThemeOverride } from '@src/interface/index.js'
import { DEFAULT_THEME } from '@src/core/theme-defaults.js'
import { shared } from '@src/util/shared-state.util.js'

/** A resolved theme: every role present, frozen, since one theme is shared by every call it applies to. */
export type ResolvedTheme = DeepReadonly<MeoCordTheme>

/** The theme of the call in progress. A per-server or per-user theme still being looked up replaces it once found. */
export interface ThemeScope {
  theme: ResolvedTheme
  /**
   * For a bound function's call, which no pipeline waits for: settles once a per-server or per-user theme still being
   * looked up is in `theme`, so an answer can wait for it.
   */
  ready?: Promise<void>
  /**
   * The scope a function bound in this call runs a later call in: the handler's theme with the server's and user's
   * themes over it of whatever the call's `args` name, such as an interaction, a message, a reaction or a member, or
   * `undefined` when `args` name neither.
   */
  rebuild?: RebuildTheme
}

/**
 * Builds the theme scope of a call with `args` for a bound function, from the server and user they name, as a handler's
 * call is themed, or gives `undefined` when `args` name no server or user.
 */
export type RebuildTheme = (args: readonly unknown[]) => ThemeScope | undefined

// One per process for this meocord version, so a call's theme reads the same from its ES module and CommonJS builds
const scope = shared('themeScope', () => new AsyncLocalStorage<ThemeScope>())

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object') return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * Freezes the plain objects and arrays in a theme, at every depth: the parts {@link copyLayer} copied. Anything else,
 * such as a class instance or a `Map` an app keeps in a group of its own, is the app's and is left as it is.
 */
function deepFreeze<T>(value: T): T {
  if ((Array.isArray(value) || isPlainObject(value)) && !Object.isFrozen(value)) {
    for (const inner of Object.values(value)) deepFreeze(inner)
    Object.freeze(value)
  }
  return value
}

/**
 * A copy of a layer an app gave, so freezing a theme built on it never freezes the app's own objects: plain objects
 * and arrays are copied at every depth, anything else is kept as it is.
 */
export function copyLayer<T>(layer: T): T {
  if (Array.isArray(layer)) return layer.map(copyLayer) as T
  if (!isPlainObject(layer)) return layer
  return Object.fromEntries(Object.entries(layer).map(([key, value]) => [key, copyLayer(value)])) as T
}

/**
 * One layer over another: plain objects merge key by key, anything else replaces, and `undefined` never does. A
 * part the layer leaves alone is shared with `base`, which is already frozen.
 */
function mergeInto(base: unknown, layer: unknown): unknown {
  if (layer === undefined) return base
  if (!isPlainObject(base) || !isPlainObject(layer)) return layer
  const merged: Record<string, unknown> = { ...base }
  // Defined rather than assigned, so a key such as __proto__ from JSON stays a key rather than setting the prototype
  for (const key of Object.keys(layer)) {
    Object.defineProperty(merged, key, { value: mergeInto(base[key], layer[key]), enumerable: true, writable: true, configurable: true })
  }
  return merged
}

/** Whether a layer holds no value: only plain objects, empty or holding nothing but `undefined` and more of them. */
const setsNothing = (layer: unknown): boolean =>
  layer === undefined || (isPlainObject(layer) && Object.values(layer).every(setsNothing))

const merges = new WeakMap<object, WeakMap<object, ResolvedTheme>>()

/**
 * `layer` over `theme`, frozen, and made once per pair: the same two give the same object. `layer` must be one
 * {@link copyLayer} made, since the result shares and freezes its parts.
 */
export function mergeTheme(theme: ResolvedTheme, layer: ThemeOverride | undefined): ResolvedTheme {
  // A layer that sets nothing, such as {} or { colors: {} }, leaves the theme as it is, the same object
  if (layer === undefined || setsNothing(layer)) return theme
  let byLayer = merges.get(theme)
  if (!byLayer) merges.set(theme, (byLayer = new WeakMap()))
  let merged = byLayer.get(layer)
  if (!merged) byLayer.set(layer, (merged = deepFreeze(mergeInto(theme, layer) as ResolvedTheme)))
  return merged
}

/**
 * The theme state outside a call, one for both builds of this version so either reads what the other set: the defaults
 * with what the deprecated `Theme` statics set beneath every theme, the app whose theme is read outside a call, and how
 * an answer outside a call finds its theme.
 */
const state = shared('themeState', () => ({
  defaults: DEFAULT_THEME as ResolvedTheme,
  legacyVersion: 0,
  ambient: undefined as { owner: object; theme: () => ResolvedTheme } | undefined,
  ambientVersion: 0,
  themeOutsideCalls: undefined as ((interaction: object) => ResolvedTheme | Promise<ResolvedTheme>) | undefined,
  rebuildOutsideCalls: undefined as RebuildTheme | undefined,
}))

/** MeoCord's defaults, with what the deprecated `Theme` statics set over them. */
export function defaultTheme(): ResolvedTheme {
  return state.defaults
}

/** The number of times the legacy layer has changed, so a theme built on an older one is built again. */
export function themeLayersVersion(): number {
  return state.legacyVersion
}

/** Sets the layer the deprecated `Theme` statics write, merged over MeoCord's defaults. */
export function setLegacyThemeLayer(layer: ThemeOverride | undefined): void {
  state.defaults = mergeTheme(DEFAULT_THEME as ResolvedTheme, layer === undefined ? undefined : copyLayer(layer))
  state.legacyVersion++
}

/** The number of times the app read outside a call has changed, so each app decides again whether its calls need a scope. */
export function ambientThemeVersion(): number {
  return state.ambientVersion
}

/**
 * Makes an app's theme the one read outside a call, when no other app has: a bot runs one app, and code it runs
 * outside a handler, such as a scheduled job, then reads that app's theme. A second app in the same process keeps
 * its theme to its own calls.
 */
export function claimAmbientTheme(owner: object, theme: () => ResolvedTheme): boolean {
  if (state.ambient && state.ambient.owner !== owner) return false
  if (!state.ambient) state.ambientVersion++
  state.ambient = { owner, theme }
  return true
}

/** Gives up the theme read outside a call, when `owner` has it: its start failed, or it has shut down. */
export function releaseAmbientTheme(owner: object): void {
  if (state.ambient?.owner !== owner) return
  state.ambient = undefined
  state.ambientVersion++
}

/** Whether `owner` is the app whose theme is read outside a call. */
export function ownsAmbientTheme(owner: object): boolean {
  return state.ambient?.owner === owner
}

/** Runs `fn` with `theme` as the theme of the call, for everything it runs, awaits or starts. */
export function runWithTheme<T>(theme: ResolvedTheme, fn: () => T): T {
  return scope.run({ theme }, fn)
}

/**
 * Runs `fn` outside any call's theme: for app code MeoCord runs on a call's behalf, such as a theme resolver, whose
 * pooled connections and timers would otherwise keep the call's scope alive.
 */
export function outsideThemeScope<T>(fn: () => T): T {
  return scope.exit(fn)
}

/** Runs `fn` in `themeScope`, whose theme may be replaced while it runs, as a per-server theme is found. */
export function runInThemeScope<T>(themeScope: ThemeScope, fn: () => T): T {
  return scope.run(themeScope, fn)
}

/** Sets how an answer outside any call finds its theme: from the interaction's app, server and user. */
export function setThemeOutsideCalls(resolve: (interaction: object) => ResolvedTheme | Promise<ResolvedTheme>): void {
  state.themeOutsideCalls = resolve
}

/**
 * Sets how a function bound outside a call's scope builds the scope of each call: from the app of the client its first
 * argument carries, with the themes of the server and user the arguments name.
 */
export function setRebuildOutsideCalls(rebuild: RebuildTheme): void {
  state.rebuildOutsideCalls = rebuild
}

/**
 * The theme an answer to `interaction` uses: the running call's, or, outside any call, as in a collector's callback,
 * the theme of the app the interaction came to, with its server's and user's themes over it.
 */
export function themeForInteraction(interaction: object): ResolvedTheme | Promise<ResolvedTheme> {
  const call = scope.getStore()
  if (call) return call.ready ? call.ready.then(() => call.theme) : call.theme
  return state.themeOutsideCalls?.(interaction) ?? useTheme()
}

/**
 * The theme of the running call, with every role present.
 *
 * Read it wherever a call runs: in a handler, in a service or presenter it calls, and in work it starts, such as a
 * timer's follow-up. Outside a call, it is the theme of the app the process runs, from when its start begins until the
 * start fails or the app has shut down, its `onShutdown` hooks included, and MeoCord's defaults otherwise; it never
 * throws.
 *
 * @remarks
 * The theme is MeoCord's defaults, then the app's theme, then each `@UseTheme` from the controller's base class down
 * to the handler (as far up as `inheritStages` lets a class inherit), then `@MeoCord`'s `themeFor`: the server's theme,
 * then the user's, each over the layers before it. It reads the call through `AsyncLocalStorage`, and its objects and
 * arrays are frozen, since it is shared by every call it applies to; a class instance or a `Map` in it is not.
 *
 * @returns The resolved theme, with every role present.
 *
 * @example
 * ```ts
 * @Command('save', CommandType.SLASH)
 * async save(interaction: ChatInputCommandInteraction) {
 *   const { colors, emojis } = useTheme()
 *   await respond(interaction).send({ embeds: [{ description: `${emojis.success} Saved`, color: resolveColor(colors.success) }] })
 * }
 * ```
 *
 * @group Responses
 */
export function useTheme(): ResolvedTheme {
  return scope.getStore()?.theme ?? state.ambient?.theme() ?? state.defaults
}

/**
 * Makes a function run in the handler's theme, rebuilt for the server and user each call's arguments name.
 *
 * Wrap a listener a handler registers in it, such as a collector's `collect` callback or a `client.on(...)` handler.
 * Such a listener runs in its emitter's context, so without it a `useTheme()` inside reads the theme outside any call.
 * Timers and promises the handler starts keep its theme without it.
 *
 * Each call's theme is built as a handler's call is: the app's theme, the `@UseTheme` layers of the handler that
 * bound it, then `@MeoCord`'s `themeFor` for the server and the user its arguments name, as an interaction, a message,
 * a reaction or a member does. Every member who clicks a collector's button is answered in their own server's and
 * user's theme. A theme `themeFor` is still looking up replaces the handler's once found, so `respond()` waits for it
 * and `useTheme()` reads the handler's until then. A call whose arguments name neither a server nor a user, such as a
 * collector's `end`, runs in the whole theme of the call that bound it.
 *
 * @param fn - The function to run in the handler's theme; `this` and its arguments are passed through.
 * @returns A function that runs `fn` in that theme, and returns what `fn` returns.
 *
 * @example
 * ```ts
 * @MessageHandler('poll')
 * async poll(message: Message) {
 *   const collector = message.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60_000 })
 *   collector.on('collect', bindTheme(async (click: ButtonInteraction) => {
 *     await respond(click).send({ embeds: [{ description: 'Picked' }] }) // the clicker's theme, @UseTheme included
 *   }))
 * }
 * ```
 *
 * @group Responses
 */
export function bindTheme<F extends (...args: any[]) => unknown>(fn: F): F {
  const call = scope.getStore()
  const theme = useTheme()
  // Without a call's scope the handler's theme is the app's, which the outside rebuild starts from
  const rebuild = call ? call.rebuild : state.rebuildOutsideCalls
  return function (this: unknown, ...args: unknown[]) {
    return scope.run(rebuild?.(args) ?? { theme, rebuild }, () => fn.apply(this, args))
  } as F
}
