import 'reflect-metadata'
import { type Container } from 'inversify'
import { type ThemeOverride } from '@src/interface/index.js'
import { sourcePrototype, stageClasses } from '@src/core/guard-runner.js'
import { makeInjectable } from '@src/util/injectable.util.js'
import {
  attachThemeCache,
  lookupLayers,
  resolverCaches,
  ThemeCache,
  type ThemeResolverCaches,
  type ThemeResolverOptions,
} from '@src/core/theme-resolvers.js'
import {
  ambientThemeVersion,
  claimAmbientTheme,
  defaultTheme,
  hasAmbientTheme,
  mergeTheme,
  ownsAmbientTheme,
  releaseAmbientTheme,
  type ResolvedTheme,
  setThemeOutsideCalls,
  themeLayersVersion,
  type ThemeScope,
  useTheme,
} from '@src/core/theme-scope.js'

/** Private metadata: the theme layer a class-level `@UseTheme` sets, kept on the class. */
export const CLASS_THEME = Symbol('class_theme')

/** Private metadata: the theme layer a method-level `@UseTheme` sets. */
export const METHOD_THEME = Symbol('method_theme')

/** Classes with a `@UseTheme`, on the class or one of its methods. */
export const THEMED_CLASSES = new WeakSet<object>()

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

const apps = new WeakMap<Container, AppThemes>()

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
  const resolvers = resolverCaches(resolverOptions)
  apps.set(container, { layer, varies, version: -1, ambientVersion: -1, app: defaultTheme(), scoped: undefined, resolvers, handlers: new WeakMap() })
  // The instance the app's code injects, whether bound here or already as a dependency of one of its classes
  if (!container.isBound(ThemeCache)) {
    makeInjectable(ThemeCache)
    container.bind(ThemeCache).toSelf().inSingletonScope()
  }
  attachThemeCache(container.get(ThemeCache), resolvers)
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
 * change. They do when the handlers can differ in theme. Otherwise a call reads the theme outside a call, so it
 * needs one unless that is its own theme: when the app owns it, or when no app does and the app's theme is MeoCord's
 * defaults.
 */
function rescope(container: Container, themes: AppThemes): void {
  themes.ambientVersion = ambientThemeVersion()
  const readsOwnTheme = ownsAmbientTheme(container) || (!hasAmbientTheme() && themes.app === defaultTheme())
  themes.scoped = themes.varies || !readsOwnTheme ? themes.app : undefined
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
    theme = mergeTheme(theme, Reflect.getOwnMetadata(CLASS_THEME, cls) as ThemeOverride | undefined)
  }
  const source = sourcePrototype(prototype, methodName)
  if (source) theme = mergeTheme(theme, Reflect.getOwnMetadata(METHOD_THEME, source, methodName) as ThemeOverride | undefined)
  byMethod.set(methodName, theme)
  return theme
}

/**
 * The theme scope a call runs in, or `undefined` when it needs none: its handlers share the theme read outside any
 * call, and no resolver applies. The scope holds the handler's theme, or the app's without a handler, with the call's
 * server's and user's themes over it; when those are still being looked up, `ready` settles once they are in the scope.
 */
export function beginCallTheme(
  container: Container,
  args: readonly unknown[],
  prototype?: object,
  methodName?: string,
): { scope: ThemeScope; ready?: Promise<void> } | undefined {
  const themes = current(container)
  if (!themes) return undefined
  const layers = themes.resolvers && lookupLayers(themes.resolvers, args)
  if (!layers && !themes.scoped) return undefined
  const base = themes.varies && prototype && methodName ? handlerTheme(themes, prototype, methodName) : themes.app
  if (!layers) return { scope: { theme: base } }
  if (!(layers instanceof Promise)) {
    const theme = mergeTheme(mergeTheme(base, layers[0]), layers[1])
    return theme === base && !themes.scoped ? undefined : { scope: { theme } }
  }
  // Until the server's and user's themes are found, the call has the handler's; the pipeline waits for them
  const scope: ThemeScope = { theme: base }
  const ready = layers.then(([guild, user]) => {
    scope.theme = mergeTheme(mergeTheme(base, guild), user)
  })
  return { scope, ready }
}

const clientApps = new WeakMap<object, Container>()

/** Records which app a client's interactions come to, so an answer outside any call can find its theme. */
export function registerClientTheme(client: object, container: Container): void {
  clientApps.set(client, container)
}

// An answer outside any call, as in a collector's callback, takes the theme of the app its interaction came to,
// with the server's and user's themes over it, from the same caches calls use
setThemeOutsideCalls(interaction => {
  const container = clientApps.get((interaction as { client?: object }).client ?? interaction)
  const themes = container && current(container)
  if (!themes) return useTheme()
  const layers = themes.resolvers && lookupLayers(themes.resolvers, [interaction])
  if (!layers) return themes.app
  if (layers instanceof Promise) return layers.then(([guild, user]) => mergeTheme(mergeTheme(themes.app, guild), user))
  return mergeTheme(mergeTheme(themes.app, layers[0]), layers[1])
})

/** Makes the app's theme the one read outside a call, unless another app in the process already has. */
export function claimAmbientAppTheme(container: Container): void {
  claimAmbientTheme(container, () => appTheme(container))
}

/** Gives up the app's theme as the one read outside a call: its start failed, or it has shut down. */
export function releaseAmbientAppTheme(container: Container): void {
  releaseAmbientTheme(container)
}
