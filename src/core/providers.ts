import { type Container, type ServiceIdentifier } from 'inversify'
import { ExecutionContext } from '@src/common/execution-context.js'
import { injectedTokens, singletonContextError, untypedParameter } from '@src/core/guard-runner.js'
import { isAppClassToken } from '@src/core/lifecycle-order.js'
import { makeInjectable } from '@src/util/injectable.util.js'
import {
  type ClassProvider,
  type FactoryProvider,
  type Provider,
  type ProviderToken,
  type ValueProvider,
} from '@src/interface/provider.interface.js'
import { refuse } from '@src/util/refusal.util.js'

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
 * Checks each provider's shape and indexes them by token, throwing on the first that cannot be bound:
 * no token, not exactly one of `useValue`, `useClass` and `useFactory`, or a token provided twice.
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
      throw refuse(new Error(
        `${where}: ${name} is a class, not a provider: ${listing}. To put something in its place, write ` +
          `{ provide: ${name}, useValue } or { provide: ${name}, useClass }.`,
      ))
    }
    if (!entry || typeof entry !== 'object' || !isToken(entry.provide)) {
      throw refuse(new Error(`${where}: a provider has no token: set provide to a class, a string or a symbol.`))
    }
    const name = tokenName(entry.provide)
    const kinds = (['useValue', 'useClass', 'useFactory'] as const).filter(kind => kind in entry)
    if (kinds.length !== 1) {
      throw refuse(new Error(`${where}: the provider for ${name} needs exactly one of useValue, useClass and useFactory.`))
    }
    if ('useClass' in entry && typeof entry.useClass !== 'function') {
      throw refuse(new Error(`${where}: the provider for ${name} has a useClass that is not a class.`))
    }
    if ('useFactory' in entry) {
      if (typeof entry.useFactory !== 'function') {
        throw refuse(new Error(`${where}: the provider for ${name} has a useFactory that is not a function.`))
      }
      if (entry.inject !== undefined && !(Array.isArray(entry.inject) && entry.inject.every(isToken))) {
        throw refuse(new Error(`${where}: the provider for ${name} has an inject that is not a list of tokens.`))
      }
    }
    if (map.has(entry.provide)) throw refuse(new Error(`${where}: ${name} is provided twice.`))
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
    if (injectedTokens(cls).includes(ExecutionContext)) throw refuse(singletonContextError(cls))
    makeInjectable(cls)
    container.bind(token).to(cls).inSingletonScope()
    for (const dependency of injectedTokens(cls)) if (isAppClassToken(dependency)) bindClass(dependency)
    return
  }
  const { useFactory, inject = [] } = provider as FactoryProvider
  // Resolved in dependency order before anything needs it, so each injected value is already made
  container
    .bind(token)
    .toDynamicValue(context => useFactory(...inject.map(dependency => context.get(dependency as ServiceIdentifier))))
    .inSingletonScope()
  for (const dependency of inject) if (isAppClassToken(dependency)) bindClass(dependency)
}

/**
 * Throws when a class or a factory asks for a string or symbol token that nothing binds, naming both,
 * rather than failing when the class is first resolved. A class token is bound on demand, so it is
 * never missing.
 */
export function assertProvided(container: Container, providers: ProviderMap, classes: readonly AnyClass[], where: string): void {
  const missing = (token: unknown) => (typeof token === 'string' || typeof token === 'symbol') && !container.isBound(token)
  for (const cls of classes) {
    const token = injectedTokens(cls).find(missing)
    if (token !== undefined) {
      throw refuse(new Error(`${cls.name}: it injects ${tokenName(token)}, which nothing provides: add a provider for it to ${where}.`))
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
      throw refuse(new Error(
        `${tokenName(provided)}: its provider injects ${tokenName(token)}, which nothing provides: add a provider for it to ${where}.`,
      ))
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
    if (!isAppClassToken(token) || found.includes(token)) return
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
 * Throws for the first of `classes` with a constructor parameter nothing can inject: one with no
 * runtime type and no `@Inject` token. It names the classes among `classes` that inject it, the likely
 * other half when two classes import each other, rather than leaving inversify's error to point at
 * the compiler options.
 */
export function assertTypedParameters(classes: readonly AnyClass[]): void {
  for (const cls of classes) {
    const index = untypedParameter(cls)
    if (index === -1) continue
    const injectors = classes.filter(other => other !== cls && injectedTokens(other).includes(cls)).map(other => other.name)
    const injectedBy =
      injectors.length === 0
        ? ''
        : ` (${injectors.length === 1 ? injectors[0] : `${injectors.slice(0, -1).join(', ')} and ${injectors.at(-1)}`} ` +
          `inject${injectors.length === 1 ? 's' : ''} ${cls.name})`
    throw refuse(new Error(
      `${cls.name}: parameter ${index + 1} of its constructor has no runtime type, so it cannot be created. Usually ` +
        `${cls.name} and a class it injects import each other${injectedBy}, or the parameter is typed with an ` +
        'interface or an `import type`. Move what they both need into a third service, or inject the parameter ' +
        'with @Inject(token).',
    ))
  }
}

/**
 * What must exist before `token`: a factory's `inject`, a provided or bound class's constructor
 * dependencies, nothing for a value. Only the app's classes and provided tokens count.
 */
export function tokenDependencies(container: Container, providers: ProviderMap, token: unknown): unknown[] {
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
  return dependencies.filter(
    dependency => (providers.has(dependency) || isAppClassToken(dependency)) && container.isBound(dependency as ServiceIdentifier),
  )
}

/**
 * The bound tokens reachable from `roots`, each after everything it depends on: the order factories
 * are resolved and lifecycle hooks run in. Tokens with no dependency between them keep the roots' order.
 */
export function resolutionOrder(container: Container, providers: ProviderMap, roots: readonly unknown[]): unknown[] {
  const ordered: unknown[] = []
  const seen = new Set<unknown>()
  const visit = (token: unknown) => {
    if (seen.has(token)) return
    seen.add(token)
    tokenDependencies(container, providers, token).forEach(visit)
    ordered.push(token)
  }
  roots.forEach(visit)
  return ordered
}

/** The error for a factory that threw or rejected, naming its token and carrying the original as `cause`. */
export function providerFailure(token: unknown, error: unknown): Error {
  const reason = error instanceof Error ? error.message : String(error)
  return new Error(`The factory providing ${tokenName(token)} failed: ${reason}`, { cause: error })
}

/**
 * Runs every factory in `order`, awaiting those that return a promise, so each value is made before
 * anything that injects it is resolved. Rejects with {@link providerFailure} for the first that fails.
 */
export async function resolveProviders(container: Container, providers: ProviderMap, order: readonly unknown[]): Promise<void> {
  for (const token of order) {
    const provider = providers.get(token)
    if (!provider || !isFactoryProvider(provider)) continue
    try {
      await container.getAsync(token as ServiceIdentifier)
    } catch (error) {
      throw providerFailure(token, error)
    }
  }
}
