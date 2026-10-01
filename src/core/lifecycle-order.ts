import { type Container } from 'inversify'
import { Client } from 'discord.js'
import { injectedTokens } from '@src/core/guard-runner.js'

type LifecycleClass = new (...args: any[]) => any

/**
 * The runtime's global constructors, such as the `Object` an interface-typed parameter records, or `String` and
 * `Promise`. Read from data properties only, since a global getter, such as Node's `localStorage`, can warn when read.
 */
const BUILT_INS: ReadonlySet<unknown> = new Set(
  Object.getOwnPropertyNames(globalThis).flatMap(name => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name)
    return descriptor && 'value' in descriptor && typeof descriptor.value === 'function' ? [descriptor.value] : []
  }),
)

/**
 * Whether a token a class injects is one of the app's own classes: not the Discord client, bound as a
 * value, and not one of the runtime's global constructors.
 */
export function isAppClassToken(token: unknown): token is LifecycleClass {
  return typeof token === 'function' && token !== Client && !BUILT_INS.has(token)
}

/**
 * The bound classes `cls` injects, by constructor type or `@inject` token: the classes whose hooks
 * run before its own.
 */
export function lifecycleDependencies(container: Container, cls: LifecycleClass): LifecycleClass[] {
  return injectedTokens(cls).filter(
    (token): token is LifecycleClass => isAppClassToken(token) && container.isBound(token),
  )
}

/** One thing whose lifecycle hooks run: a class or a provided token, its name for logs, and what it depends on. */
export interface LifecycleUnit {
  token: unknown
  name: string
  dependencies: unknown[]
}

/** The units for a list of classes already in dependency order, as the app runs them without providers. */
export function classUnits(container: Container, classes: readonly LifecycleClass[]): LifecycleUnit[] {
  return classes.map(cls => ({ token: cls, name: cls.name, dependencies: lifecycleDependencies(container, cls) }))
}
