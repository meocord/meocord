import 'reflect-metadata'
import { type Container } from 'inversify'
import { CooldownError, CommandNotFoundError, GuardDeniedError, MessageUsageError, UserError, ValidationError } from '@src/common/errors.js'
import { type ExecutionContext } from '@src/common/execution-context.js'
import { Logger } from '@src/common/logger.js'
import { type DispatchObserver, type DispatchOutcome, type DispatchResult } from '@src/interface/observer.interface.js'
import { bindShared } from '@src/core/interceptor-runner.js'
import { appliesTo } from '@src/core/stage-scope.js'
import { respond, type ResponsePhase } from '@src/common/response/response-state.js'
import { refuse } from '@src/util/refusal.util.js'
import { META } from '@src/util/metadata-keys.js'

/** Where a container keeps the observers its calls are reported to, in order. */
const OBSERVERS = Symbol('observers')

type ObserverClass = new (...args: any[]) => DispatchObserver

const logger = new Logger('Observer')

/** Throws unless every entry is an `@Observer` class, naming where it was listed. */
export function assertObservers(where: string, observers: readonly unknown[]): void {
  for (const observer of observers) {
    if (typeof observer !== 'function' || !Reflect.getMetadata(META.observerClass, observer)) {
      const name = typeof observer === 'function' ? observer.name : String(observer)
      throw refuse(new Error(`${where} takes classes decorated with @Observer(), not ${name}.`))
    }
  }
}

/** The observers `@MeoCord({ observers })` declares on an application class. */
export function appObservers(app: object): ObserverClass[] {
  const options = Reflect.getMetadata(META.appOptions, app) as { observers?: ObserverClass[] } | undefined
  return [...(options?.observers ?? [])]
}

/**
 * Binds each observer as a singleton, with its dependencies, and records them in order. A shared
 * observer cannot inject the per-call `ExecutionContext`.
 */
export function bindObservers(container: Container, observers: readonly ObserverClass[]): void {
  for (const observer of observers) bindShared(container, observer)
  container.bind<readonly ObserverClass[]>(OBSERVERS).toConstantValue([...observers])
}

function observersOf(container: Container): readonly ObserverClass[] {
  return container.isBound(OBSERVERS) ? container.get<readonly ObserverClass[]>(OBSERVERS) : []
}

/** Whether `container` has observers to tell about its calls. */
export function hasObservers(container: Container): boolean {
  return observersOf(container).length > 0
}

/** The observers told about a call of this type, in order: those whose `types` include it, or have none. */
function observersFor(container: Container, context: ExecutionContext): readonly ObserverClass[] {
  const type = context.getType()
  return observersOf(container).filter(observer => appliesTo(observer, type))
}

/** Names a call in a log line: its handler, or that none was reached. */
function describeCall(context: ExecutionContext): string {
  const controller = context.getController()
  return controller ? `${controller.name}.${context.getHandlerName()}` : 'a call no handler was reached for'
}

/**
 * Tells each observer with `onStart` that a call begins, in the order listed, without waiting for any.
 * One that throws or rejects is logged. The returned promise settles once every `onStart` has, and never
 * rejects, for a caller that wants to wait, as the testing module does.
 */
export function notifyStart(container: Container, context: ExecutionContext): Promise<void> {
  const pending: Promise<unknown>[] = []
  for (const observer of observersFor(container, context)) {
    const report = (error: unknown) =>
      logger.error(`Observer ${observer.name} threw while starting ${describeCall(context)}:`, error)
    try {
      const instance = container.get<DispatchObserver>(observer)
      if (typeof instance.onStart !== 'function') continue
      const started = instance.onStart(context) as unknown
      if (started instanceof Promise) pending.push(started.catch(report))
    } catch (error) {
      report(error)
    }
  }
  return Promise.all(pending).then(() => undefined)
}

/**
 * Where an interaction's answer stands: a repliable one's `ResponseState`, and an autocomplete answered
 * or not. `undefined` for anything that is not an interaction.
 */
export function responsePhaseOf(context: ExecutionContext): ResponsePhase | undefined {
  const interaction = context.getInteraction()
  if (!interaction) return undefined
  if (interaction.isAutocomplete()) return interaction.responded ? 'replied' : 'unanswered'
  return interaction.isRepliable() ? respond(interaction).state : undefined
}

/** How a call that threw `error` ended. */
export function outcomeOf(error: unknown): DispatchOutcome {
  if (error instanceof GuardDeniedError) return 'denied'
  if (error instanceof CooldownError) return 'cooldown'
  if (error instanceof ValidationError || error instanceof MessageUsageError) return 'invalid'
  if (error instanceof UserError) return 'refused'
  if (error instanceof CommandNotFoundError) return 'not-found'
  return 'error'
}

/**
 * Tells each observer about a settled call, one after another in the order listed. One that throws or
 * rejects is logged and the rest still run, so the promise never rejects.
 */
export async function notifyObservers(container: Container, context: ExecutionContext, result: DispatchResult): Promise<void> {
  for (const observer of observersFor(container, context)) {
    try {
      await container.get<DispatchObserver>(observer).onSettled(context, result)
    } catch (error) {
      logger.error(`Observer ${observer.name} threw while observing ${describeCall(context)}:`, error)
    }
  }
}
