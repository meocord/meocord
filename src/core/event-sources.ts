import { type Container, type ServiceIdentifier } from 'inversify'
import { type EventHandlerMetadata, getEventHandlers } from '@src/decorator/event.decorator.js'
import { prepareEventHandler } from '@src/core/handler-pipeline.js'
import { isAppClassToken, type LifecycleUnit } from '@src/core/lifecycle-order.js'
import { isClassProvider, type ProviderMap } from '@src/core/providers.js'

type AnyClass = new (...args: any[]) => unknown
type Instance = Record<string, (...args: unknown[]) => unknown>

/** An instance whose `@On` and `@Once` handlers the app attaches. */
export interface EventSource {
  /** The instance's class, which names its handlers. */
  cls: AnyClass
  /** The handlers that run on it. */
  handlers: readonly EventHandlerMetadata[]
  /** The instance, resolved as an event arrives; none when it is another source's, which runs these handlers. */
  resolve(): Instance | undefined
}

/**
 * One source for each instance whose lifecycle hooks run, the cooldown store aside, in lifecycle order; read once the
 * providers are made, as a value's or a factory's class is its instance's. A class `prepared` lacks has its handlers
 * prepared here, and one a controller's would be refused for is left out, with `warn` naming the refusal.
 */
export function eventSources(
  container: Container,
  providers: ProviderMap,
  units: readonly LifecycleUnit[],
  prepared: readonly AnyClass[],
  warn: (text: string) => void,
): EventSource[] {
  // The tokens of each class the container makes, bound as itself or given as a provider's `useClass`
  const classTokens = new Map<AnyClass, unknown[]>()
  for (const { token, cooldownStore } of units) {
    const provider = providers.get(token)
    if (cooldownStore || (provider && !isClassProvider(provider)) || (!provider && !isAppClassToken(token))) continue
    const cls = (provider ? provider.useClass : token) as AnyClass
    classTokens.set(cls, [...(classTokens.get(cls) ?? []), token])
  }
  const names = new Map(prepared.map(cls => [cls.name, cls]))
  const handlers = new Map<AnyClass, readonly EventHandlerMetadata[]>()
  const handlersOf = (cls: AnyClass): readonly EventHandlerMetadata[] => {
    let found = handlers.get(cls)
    if (!found) {
      found = prepared.includes(cls) ? getEventHandlers(cls.prototype as object) : prepareClass(container, cls, names, warn)
      handlers.set(cls, found)
    }
    return found
  }

  const sources: EventSource[] = []
  const given = new Set<object>()
  for (const { token, cooldownStore } of units) {
    // The cooldown store is the app's infrastructure, never one of its classes, so no event reaches it
    if (cooldownStore) continue
    const provider = providers.get(token)
    if (!provider || isClassProvider(provider)) {
      const cls = (provider ? provider.useClass : token) as AnyClass
      const found = handlersOf(cls)
      if (found.length > 0) sources.push({ cls, handlers: found, resolve: () => container.get(token as ServiceIdentifier) as Instance })
      continue
    }
    // A value, or a factory's, made by now; one instance under several tokens is one source
    const instance: unknown = container.get(token as ServiceIdentifier)
    if (typeof instance !== 'object' || instance === null || given.has(instance)) continue
    given.add(instance)
    const cls = instance.constructor as AnyClass | undefined
    if (typeof cls !== 'function') continue
    const found = handlersOf(cls)
    if (found.length === 0) continue
    // A factory may return the instance the container made for a class unit, whose own source runs it; only units of
    // the instance's class are resolved, and each resolves on the event through its own source anyway
    const tokens = classTokens.get(cls) ?? []
    const owned = () => tokens.some(token => container.get(token as ServiceIdentifier) === instance)
    sources.push({ cls, handlers: found, resolve: () => (owned() ? undefined : (instance as Instance)) })
  }
  return sources
}

/** The handlers of `cls` that pass a controller's checks, warning of each other one and why it does not run. */
function prepareClass(container: Container, cls: AnyClass, names: Map<string, AnyClass>, warn: (text: string) => void): EventHandlerMetadata[] {
  const declared = getEventHandlers(cls.prototype as object)
  if (declared.length === 0) return []
  const other = names.get(cls.name)
  if (!other) names.set(cls.name, cls)
  // @Once tells classes apart by name, so this class's would share another's
  const sharesName = other !== undefined && other !== cls && declared.some(handler => handler.once)
  if (sharesName) {
    refused(
      warn,
      cls,
      `${cls.name}: two classes have this name; @Cooldown and @Once tell classes apart by name, so they would share their counts. Rename one of them.`,
      declared.filter(handler => handler.once),
    )
  }

  const errors = new Map<string, readonly Error[]>()
  return declared.filter(handler => {
    if (sharesName && handler.once) return false
    let found = errors.get(handler.method)
    if (!found) {
      found = prepareEventHandler(container, cls, handler.method)
      errors.set(handler.method, found)
      const onMethod = declared.filter(other => other.method === handler.method && !(sharesName && other.once))
      for (const error of found) refused(warn, cls, error.message, onMethod)
    }
    return found.length === 0
  })
}

function refused(warn: (text: string) => void, cls: AnyClass, reason: string, handlers: readonly EventHandlerMetadata[]): void {
  const labels = handlers.map(({ event, method, once }) => `@${once ? 'Once' : 'On'}('${event}') in ${cls.name}.${method}`)
  warn(`${reason} Until the next major version (5.0) refuses it at startup, ${labels.join(', ')} does not run.`)
}
