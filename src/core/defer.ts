import 'reflect-metadata'
import { type InteractionResponse } from '@src/common/response/response-state.js'
import { perHandler, sourcePrototype } from '@src/core/guard-runner.js'
import { getAutocompleteHandlers, getMessageHandlers, getReactionHandlers } from '@src/decorator/controller.decorator.js'
import { getEventHandlers } from '@src/decorator/event.decorator.js'

/**
 * How `@Defer` acknowledges an interaction and locks a component's message.
 *
 * @group Types
 * @see {@link Defer}
 */
export interface DeferOptions {
  /**
   * Makes a command's deferred reply private.
   *
   * @defaultValue `false`
   */
  ephemeral?: boolean

  /**
   * Sends new messages without notifying: the first reply, when there was time to answer before deferring,
   * and follow-ups.
   *
   * @defaultValue `false`
   */
  suppressNotifications?: boolean

  /**
   * Which controls of a component's message to disable while the handler runs: every one, the one clicked, or
   * none, which also leaves out the loading view.
   *
   * @defaultValue `'all'`
   */
  disable?: 'all' | 'clicked' | 'none'

  /**
   * When to acknowledge: `'eager'` at once, or `'auto'` only if nothing answered after `after` milliseconds, so
   * a fast handler answers with a single reply. `'auto'` suits a handler that waits on I/O: a timer cannot fire
   * while synchronous work blocks the event loop.
   *
   * @defaultValue `'eager'`
   */
  mode?: 'eager' | 'auto'

  /**
   * How long `'auto'` waits before acknowledging, in milliseconds. It never waits past 2.5 seconds after the
   * interaction was created.
   *
   * @defaultValue `1500`
   */
  after?: number
}

/** How long `@Defer({ mode: 'auto' })` waits for an answer by default. */
export const AUTO_DEFER_AFTER_MS = 1500

/** The latest `'auto'` acknowledges, counted from the interaction's creation: Discord allows three seconds. */
export const AUTO_DEFER_LIMIT_MS = 2500

/** Private metadata: a handler's `@Defer` options. */
export const DEFER_OPTIONS = Symbol('defer_options')

/** The `@Defer` options of a handler, read where the handler is declared. */
export const handlerDefer = perHandler((prototype: object, methodName: string): DeferOptions | undefined => {
  const source = sourcePrototype(prototype, methodName)
  return source ? (Reflect.getOwnMetadata(DEFER_OPTIONS, source, methodName) as DeferOptions | undefined) : undefined
})

/** The kind of non-interaction handler a method is, if any: `@Defer` cannot apply to one. */
export function nonInteractionHandler(prototype: object, methodName: string): string | undefined {
  if (getMessageHandlers(prototype).some(handler => handler.method === methodName)) return 'message'
  if (getReactionHandlers(prototype).some(handler => handler.method === methodName)) return 'reaction'
  if (getAutocompleteHandlers(prototype).some(handler => handler.methodName === methodName)) return 'autocomplete'
  if (getEventHandlers(prototype).some(handler => handler.method === methodName)) return 'event'
  return undefined
}

/** The error for `@Defer` on a handler that cannot be deferred. */
export function deferMisuseError(className: string, methodName: string, kind: string): Error {
  return new Error(
    `${className}.${methodName}: @Defer is for interaction handlers, and this is ${kind === 'autocomplete' || kind === 'event' ? 'an' : 'a'} ${kind} ` +
      `handler. Remove @Defer from it.`,
  )
}

/**
 * `@Defer`'s first step: acknowledge now, or for `'auto'`, at the earlier of `receivedAt + after` and
 * `createdTimestamp + 2.5 s`, so a host clock running late can only acknowledge early; at `receivedAt + after`
 * for an interaction with no creation time.
 */
export async function startDefer(state: InteractionResponse, options: DeferOptions, receivedAt: number): Promise<void> {
  state.configure(options)
  if (options.mode !== 'auto') {
    await state.acknowledge({ ephemeral: options.ephemeral })
    return
  }
  // Without a creation time to count from, only the delay applies
  const created = state.interaction.createdTimestamp
  const limit = Number.isFinite(created) ? created + AUTO_DEFER_LIMIT_MS : Infinity
  const deadline = Math.min(receivedAt + (options.after ?? AUTO_DEFER_AFTER_MS), limit)
  state.scheduleAcknowledge(Math.max(0, deadline - Date.now()), { ephemeral: options.ephemeral })
}
