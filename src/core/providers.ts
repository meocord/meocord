import { type Container, type ServiceIdentifier } from 'inversify'
import { ExecutionContext } from '@src/common/execution-context.js'
import { injectedTokens, undecoratedConstructor, untypedParameter } from '@src/core/guard-runner.js'
import { meocordClassAdvice, meocordClasses } from '@src/core/meocord-classes.js'
import { isAppClassToken } from '@src/core/lifecycle-order.js'
import { makeInjectable } from '@src/util/injectable.util.js'
import {
  type ClassProvider,
  type FactoryProvider,
  type Provider,
  type ProviderToken,
  type ValueProvider,
} from '@src/interface/provider.interface.js'
import { refuse, startupError } from '@src/util/refusal.util.js'

/** The providers an app or a testing module binds, by the token each is bound under. */
export type ProviderMap = Map<unknown, Provider>

type AnyClass = new (...args: any[]) => unknown

export const isValueProvider = (provider: Provider): provider is ValueProvider => 'useValue' in provider
export const isClassProvider = (provider: Provider): provider is ClassProvider => 'useClass' in provider
export const isFactoryProvider = (provider: Provider): provider is FactoryProvider => 'useFactory' in provider

/** A token as logs and errors name it: a class by its name, a symbol by its description, a string quoted. */
export function tokenName(token: unknown): string {
  if (typeof token === 'function') return token.name || 'an anonymous class'
  if (typeof token === 'symbol') return token.description ? `Symbol(${token.description})` : 'a symbol'
  return `'${String(token)}'`
}

const isToken = (value: unknown): value is ProviderToken =>
  typeof value === 'function' || typeof value === 'string' || typeof value === 'symbol'

/**
 * Checks each provider's shape and indexes them by token, reporting each that cannot be bound, such as one with no
 * token, not exactly one of `useValue`, `useClass` and `useFactory`, one that injects `ExecutionContext`, or a token
 * provided twice, as a startup error; see `startupError`.
 */
export function providerMap(providers: readonly Provider[], where: string): ProviderMap {
  const map: ProviderMap = new Map()
  for (const provider of providers) {
    const entry = provider as Partial<ValueProvider & ClassProvider & FactoryProvider> | undefined
    // A class listed alone, as Nest takes one: say where a class goes instead
    if (typeof entry === 'function') {
      const name = tokenName(entry)
      const listing = where.includes('@MeoCord')
        ? 'list a service in @MeoCord({ services })'
        : 'a class a controller or service injects is bound for you, so it needs no listing'
      startupError(new Error(
        `${where}: ${name} is a class, not a provider: ${listing}. To put something in its place, write ` +
          `{ provide: ${name}, useValue } or { provide: ${name}, useClass }.`,
      ))
      continue
    }
    if (!entry || typeof entry !== 'object' || !isToken(entry.provide)) {
      startupError(new Error(`${where}: a provider has no token: set provide to a class, a string or a symbol.`))
      continue
    }
    const name = tokenName(entry.provide)
    const kinds = (['useValue', 'useClass', 'useFactory'] as const).filter(kind => kind in entry)
    if (kinds.length !== 1) {
      startupError(new Error(`${where}: the provider for ${name} needs exactly one of useValue, useClass and useFactory.`))
      continue
    }
    if ('useClass' in entry && typeof entry.useClass !== 'function') {
      startupError(new Error(`${where}: the provider for ${name} has a useClass that is not a class.`))
      continue
    }
    if ('useClass' in entry && injectedTokens(entry.useClass as AnyClass).includes(ExecutionContext)) {
      startupError(new Error(
        `${where}: the provider for ${name} uses ${tokenName(entry.useClass)}, which injects ExecutionContext, but it is ` +
          "made once and shared, so it would keep the first call's context for every later call. Inject " +
          'ExecutionContext only into guards.',
      ))
      continue
    }
    if ('useFactory' in entry) {
      if (typeof entry.useFactory !== 'function') {
        startupError(new Error(`${where}: the provider for ${name} has a useFactory that is not a function.`))
        continue
      }
      if (entry.inject !== undefined && !(Array.isArray(entry.inject) && entry.inject.every(isToken))) {
        startupError(new Error(`${where}: the provider for ${name} has an inject that is not a list of tokens.`))
        continue
      }
      if (entry.inject?.includes(ExecutionContext)) {
        startupError(new Error(
          `${where}: the provider for ${name} injects ExecutionContext, but its factory runs once and its value is ` +
            "shared, so it would keep the first call's context for every later call. Inject ExecutionContext only into guards.",
        ))
        continue
      }
    }
    if (map.has(entry.provide)) { startupError(new Error(`${where}: ${name} is provided twice.`)); continue }
    map.set(entry.provide, provider)
  }
  return map
}

/**
 * Binds one provider into `container` as a singleton. `bindClass` binds a class a provider depends
 * on, as the app binds its own, so a provided class or a factory's `inject` can name any class.
 */
export function bindProvider(container: Container, provider: Provider, bindClass: (cls: AnyClass) => void): void {
  const token = provider.provide as ServiceIdentifier
  if (isValueProvider(provider)) {
    container.bind(token).toConstantValue(provider.useValue)
    return
  }
  if (isClassProvider(provider)) {
    const cls = provider.useClass
    makeInjectable(cls)
    container.bind(token).to(cls).inSingletonScope()
    for (const dependency of injectedTokens(cls)) if (isAppClassToken(dependency)) bindClass(dependency)
    return
  }
  const { useFactory, inject = [] } = provider as FactoryProvider
  // Made once, as a singleton, but kept only once made: a factory that throws or rejects runs again on the next
  // resolve, so a start() after it failed tries it again. Resolves while one is pending share it.
  let kept: { value: unknown } | undefined
  container.bind(token).toDynamicValue(context => {
    if (kept) return kept.value
    // Resolved in dependency order before anything needs it, so each injected value is already made
    const made: unknown = useFactory(...inject.map(dependency => context.get(dependency as ServiceIdentifier)))
    // Any thenable, not only a native promise: a library's promise, or one from another realm
    if (typeof (made as { then?: unknown } | null | undefined)?.then !== 'function') {
      kept = { value: made }
      return made
    }
    const pending = Promise.resolve(made).then(
      value => {
        kept = { value }
        return value
      },
      (error: unknown) => {
        kept = undefined
        throw error
      },
    )
    kept = { value: pending }
    return pending
  })
  for (const dependency of inject) if (isAppClassToken(dependency)) bindClass(dependency)
}

/**
 * Reports a class or a factory that asks for a string or symbol token nothing binds, naming both, rather than failing
 * when the class is first resolved. A class token is bound on demand, so it is never missing.
 */
export function assertProvided(container: Container, providers: ProviderMap, classes: readonly AnyClass[], where: string): void {
  const missing = (token: unknown) => (typeof token === 'string' || typeof token === 'symbol') && !container.isBound(token)
  for (const cls of classes) {
    const token = injectedTokens(cls).find(missing)
    if (token !== undefined) {
      startupError(new Error(`${cls.name}: it injects ${tokenName(token)}, which nothing provides: add a provider for it to ${where}.`))
      continue
    }
  }
  for (const [provided, provider] of providers) {
    const dependencies = isFactoryProvider(provider)
      ? (provider.inject ?? [])
      : isClassProvider(provider)
        ? injectedTokens(provider.useClass)
        : []
    const token = dependencies.find(missing)
    if (token !== undefined) {
      startupError(new Error(
        `${tokenName(provided)}: its provider injects ${tokenName(token)}, which nothing provides: add a provider for it to ${where}.`,
      ))
      continue
    }
  }
}

/**
 * The classes the app constructs, found from `roots` through what each injects, before anything is
 * bound: a token a provider stands in for is not constructed as itself, so it is only followed when
 * it is its own `useClass`. Providers' classes and factory dependencies are roots too.
 */
export function reachableClasses(roots: readonly unknown[], providers: ProviderMap): AnyClass[] {
  const found: AnyClass[] = []
  const visit = (token: unknown) => {
    // MeoCord's own classes it makes itself, which no walk treats as the app's
    if (!isAppClassToken(token) || meocordClasses().includes(token) || found.includes(token)) return
    const provider = providers.get(token)
    if (provider && !(isClassProvider(provider) && provider.useClass === token)) return
    found.push(token)
    injectedTokens(token).forEach(visit)
  }
  for (const provider of providers.values()) {
    if (isClassProvider(provider)) visit(provider.useClass)
    if (isFactoryProvider(provider)) (provider.inject ?? []).forEach(visit)
  }
  roots.forEach(visit)
  return found
}

/**
 * Throws for the first of `classes` that cannot be created: one with no decorator whose constructor injects, or one
 * with a parameter of no runtime type and no `@Inject` token, naming the classes that inject it, the likely other half
 * when two classes import each other. Either way, rather than leaving inversify's error to point at compiler options.
 * `decorators` names the decorator each controller and stage class takes; any other class is a service.
 */
export function assertTypedParameters(classes: readonly AnyClass[], decorators: ReadonlyMap<unknown, string>): void {
  for (const cls of classes) {
    const instead = meocordClassAdvice(cls)
    if (instead && undecoratedConstructor(cls)) { startupError(new Error(`${cls.name}: MeoCord does not inject it; ${instead}.`)); continue }
    if (undecoratedConstructor(cls)) {
      const decorator = decorators.get(cls)
      startupError(new Error(
        `${cls.name}: its constructor takes parameters, but ${cls.name} has no decorator, so TypeScript recorded none of ` +
          `their types and it cannot be created. ${decorator ? `Decorate it with ${decorator}.` : 'Decorate it with @Service(), or give a class from a package a provider in @MeoCord({ providers }).'}`,
      ))
      continue
    }
    const index = untypedParameter(cls)
    if (index === -1) continue
    const injectors = classes.filter(other => other !== cls && injectedTokens(other).includes(cls)).map(other => other.name)
    const injectedBy =
      injectors.length === 0
        ? ''
        : ` (${injectors.length === 1 ? injectors[0] : `${injectors.slice(0, -1).join(', ')} and ${injectors.at(-1)}`} ` +
          `inject${injectors.length === 1 ? 's' : ''} ${cls.name})`
    startupError(new Error(
      `${cls.name}: parameter ${index + 1} of its constructor has no runtime type, so it cannot be created. Usually ` +
        `${cls.name} and a class it injects import each other${injectedBy}, or the parameter is typed with an ` +
        'interface or an `import type`. Move what they both need into a third service, or inject the parameter ' +
        'with @Inject(token).',
    ))
    continue
  }
}

/** For each container, the tokens MeoCord binds itself, each to the app's class it stands for, if any. */
const ownTokens = new WeakMap<Container, Map<unknown, unknown>>()

/**
 * Records `token` as one MeoCord binds itself, such as `CooldownStore`: never a unit of the app's own, though a class
 * may inject it. With `standsFor`, the app's class it resolves to, a unit that injects it depends on that class.
 */
export function bindsOwnToken(container: Container, token: unknown, standsFor?: unknown): void {
  let own = ownTokens.get(container)
  if (!own) ownTokens.set(container, (own = new Map()))
  own.set(token, standsFor)
}

/**
 * A dependency as the graph sees it: the app's class an own token stands for, when `follow`, else nothing, as for
 * another own token.
 */
function graphTokens(container: Container, dependency: unknown, follow: boolean): unknown[] {
  const own = ownTokens.get(container)
  if (!own?.has(dependency)) return [dependency]
  const standsFor = own.get(dependency)
  return follow && standsFor !== undefined ? [standsFor] : []
}

/** How a walk of the graph treats a token MeoCord binds itself. */
export interface GraphOptions {
  /**
   * Whether an injected own token leads to the app's class it stands for, as it does for the order lifecycle hooks
   * run in; `false` for which classes are the app's own, which an own token never adds to. Defaults to `true`.
   */
  followOwnTokens?: boolean
}

/**
 * What must exist before `token`: a factory's `inject`, a provided or bound class's constructor
 * dependencies, nothing for a value. Only the app's classes and provided tokens count; a token MeoCord binds itself
 * counts as the app's class it stands for, if any, when `followOwnTokens`, and as nothing otherwise.
 */
export function tokenDependencies(
  container: Container,
  providers: ProviderMap,
  token: unknown,
  { followOwnTokens = true }: GraphOptions = {},
): unknown[] {
  const provider = providers.get(token)
  const dependencies = provider
    ? isFactoryProvider(provider)
      ? (provider.inject ?? [])
      : isClassProvider(provider)
        ? injectedTokens(provider.useClass)
        : []
    : isAppClassToken(token)
      ? injectedTokens(token)
      : []
  return dependencies
    .flatMap(dependency => graphTokens(container, dependency, followOwnTokens))
    .filter(dependency => (providers.has(dependency) || isAppClassToken(dependency)) && container.isBound(dependency as ServiceIdentifier))
}

/**
 * The bound tokens reachable from `roots`, each after everything it depends on: the order factories
 * are resolved and lifecycle hooks run in. Tokens with no dependency between them keep the roots' order.
 */
export function resolutionOrder(
  container: Container,
  providers: ProviderMap,
  roots: readonly unknown[],
  options: GraphOptions = {},
): unknown[] {
  const ordered: unknown[] = []
  const seen = new Set<unknown>()
  // The tokens being visited, outermost first: one met again among them closes a cycle
  const path: unknown[] = []
  const visit = (token: unknown) => {
    const back = path.indexOf(token)
    if (back !== -1) throw refuse(cycleError([...path.slice(back), token]))
    if (seen.has(token)) return
    seen.add(token)
    path.push(token)
    tokenDependencies(container, providers, token, options).forEach(visit)
    path.pop()
    ordered.push(token)
  }
  roots.forEach(visit)
  return ordered
}

/** The error for tokens that inject each other, naming the cycle from where it was entered back to it. */
function cycleError(cycle: readonly unknown[]): Error {
  return new Error(
    `${cycle.map(tokenName).join(' → ')}: each is made before what injects it, so none of them can be made. Move what ` +
      'they share into a provider of its own.',
  )
}

/** The error for a factory that threw or rejected, naming its token and carrying the original as `cause`. */
export function providerFailure(token: unknown, error: unknown): Error {
  const reason = error instanceof Error ? error.message : String(error)
  return new Error(`The factory providing ${tokenName(token)} failed: ${reason}`, { cause: error })
}

/** How a startup that makes the providers learns that the app is stopping, and tells which factory it waits for. */
export interface StartupControl {
  /** Whether the app is stopping, after which nothing more is made. */
  stopped(): boolean
  /** The factory now awaited, by its token's name, or `undefined` once none is. */
  pending(name: string | undefined): void
}

/**
 * Runs every factory in `order`, awaiting those that return a promise, so each value is made before
 * anything that injects it is resolved. Rejects with {@link providerFailure} for the first that fails. With `control`,
 * it makes no further value once the app is stopping.
 */
export async function resolveProviders(
  container: Container,
  providers: ProviderMap,
  order: readonly unknown[],
  control?: StartupControl,
): Promise<void> {
  for (const token of order) {
    const provider = providers.get(token)
    if (!provider || !isFactoryProvider(provider)) continue
    if (control?.stopped()) return
    control?.pending(tokenName(token))
    try {
      await container.getAsync(token as ServiceIdentifier)
    } catch (error) {
      throw providerFailure(token, error)
    } finally {
      control?.pending(undefined)
    }
  }
}
