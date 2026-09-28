import { type ExecutionContext } from '@src/common/execution-context.js'

/**
 * How a dispatched call ended, as a {@link DispatchObserver} is told.
 *
 * - `'ran'`: it settled without an error. An interceptor that answers without calling `next.handle()`,
 *   from a cache for instance, counts too.
 * - `'denied'`: a guard returned `false` or threw `GuardDeniedError`.
 * - `'cooldown'`: a `@Cooldown` refused it with `CooldownError`.
 * - `'invalid'`: the user's input doesn't fit: `@Validate` refused it with `ValidationError`, or a message
 *   named a command it doesn't fit, a `MessageUsageError`: a word of the wrong type, a param left out, a flag the
 *   command lacks, a command sent where it doesn't work, or a parent's words alone.
 * - `'refused'`: a `UserError` told the user what to fix, such as too few coins: their mistake, not a
 *   fault of the bot.
 * - `'error'`: anything else was thrown, by the handler, a pipe, an interceptor or a guard.
 * - `'not-found'`: an interaction no handler matches and nothing else answers, such as a button whose
 *   customId no pattern routes, or an autocomplete no `@Autocomplete` claims.
 *
 * @group Types
 * @see {@link DispatchResult}
 */
export type DispatchOutcome = 'ran' | 'denied' | 'cooldown' | 'invalid' | 'refused' | 'error' | 'not-found'

/**
 * What a {@link DispatchObserver} is told about a call once it has settled.
 *
 * @group Types
 * @see {@link DispatchObserver}
 */
export interface DispatchResult {
  /** How the call ended. */
  outcome: DispatchOutcome
  /** When dispatch received the call, in milliseconds since the Unix epoch. */
  startedAt: number
  /**
   * How long the call took, in milliseconds from `performance.now()`: from dispatch until the filters
   * and the fallback had answered, so it includes an error's answer.
   */
  durationMs: number
  /**
   * The guard class that denied the call, whether it returned `false` or threw `GuardDeniedError`.
   * Only with the outcome `'denied'`, and not for a `GuardDeniedError` the handler threw itself.
   */
  deniedBy?: abstract new (...args: any[]) => unknown
  /**
   * Where the interaction's answer stood once the call settled: `'replied'`, `'deferred'` (deferred and
   * never followed up, which leaves the user waiting) or `'unanswered'`. An autocomplete is `'replied'`
   * once it answered. Only for interactions; `undefined` for messages, reactions and events.
   */
  response?: 'replied' | 'deferred' | 'unanswered'
  /** The error the call ended with, for `'denied'` by `GuardDeniedError`, `'cooldown'`, `'invalid'`, `'refused'`, `'error'` and most `'not-found'`. */
  error?: unknown
  /** Whether an exception filter or the built-in fallback answered the error. `false` without an error. */
  handled: boolean
}

/**
 * Observes every call MeoCord dispatches, as it starts and once it has settled, for metrics and audit logs.
 *
 * Implement it on a class marked with {@link Observer}. It hears about commands, components, modals,
 * autocomplete, message, reaction and event handlers, and interactions no handler matches and nothing else
 * answers; a message no handler matches is not a call. For work inside a call, such as a span around a query,
 * use an interceptor.
 *
 * @remarks
 * An observer cannot change a call: the call waits for neither method, one that throws is logged, and the
 * other observers still run. One instance is resolved from the container, so it injects services, and its
 * `onReady` and `onShutdown` hooks run with theirs; it cannot inject `ExecutionContext`, which both methods
 * receive. `@Observer({ types })` limits it to some kinds of call.
 *
 * @pipeline observers-start in `onStart`, before anything else runs
 * @pipeline observers-settled in `onSettled`, once the call has settled
 * @group Types
 * @see {@link Observer}
 * @see {@link DispatchResult}
 */
export interface DispatchObserver {
  /**
   * Receives a call as it begins, before `@Defer` and the guards, for a call that reached a handler; an
   * interaction no handler matches gets only `onSettled`. It is not waited for, and one that throws is
   * logged. `onSettled` for the same call receives the same context object, so a `WeakMap` keyed by it
   * pairs the two.
   *
   * For spans around work inside the handler, such as a database query under the command's span, use an
   * interceptor: an observer sees the call from outside, and nothing that runs within it.
   *
   * @param context - The call's context.
   */
  onStart?(context: ExecutionContext): void

  /**
   * Receives one settled call.
   *
   * @param context - The call's context: its handler, arguments and metadata. For an interaction no
   *   handler matched, it has no controller or handler.
   * @param result - How the call ended, and how long it took.
   */
  onSettled(context: ExecutionContext, result: DispatchResult): void | Promise<void>
}
