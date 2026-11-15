import { type AutocompleteInteraction, RESTJSONErrorCodes } from 'discord.js'
import { type Logger } from '@src/common/logger.js'
import { type CallStart } from '@src/core/handler-pipeline.js'
import { focusedOptionName, resolveCommandPaths } from '@src/util/interaction.util.js'

/** Discord's window to answer an autocomplete, counted from its creation. */
export const AUTOCOMPLETE_WINDOW_MS = 3000

/** Discord's window as a log line names it. */
export const AUTOCOMPLETE_WINDOW = `${AUTOCOMPLETE_WINDOW_MS / 1000} s`

/** How long an autocomplete handler may take to answer before it is named as nearly missing the window. */
export const SLOW_AUTOCOMPLETE_MS = 2000

/** An autocomplete call being handled: the handler that took it, when it arrived, and whether slow calls are named. */
export interface AutocompleteCall {
  handler: string
  start: CallStart
  warnSlow: boolean
}

// The autocomplete calls in progress, which the fallback's close of a menu reads when Discord refuses it as expired
const calls = new WeakMap<object, AutocompleteCall>()

/** Records that `handler` is handling `interaction`, so a late answer to it is reported with the handler's time. */
export function noteAutocompleteCall(interaction: AutocompleteInteraction, call: AutocompleteCall): void {
  calls.set(interaction, call)
}

/** The autocomplete call `interaction` is part of, if a handler claimed it. */
export function autocompleteCallOf(interaction: AutocompleteInteraction): AutocompleteCall | undefined {
  return calls.get(interaction)
}

/**
 * How long ago the call began, counted from the earlier of the interaction's creation and its arrival, as `@Defer`'s
 * auto mode counts, so a host clock running late can only make it read longer.
 */
export function autocompleteElapsed(interaction: AutocompleteInteraction, start: CallStart): number {
  const created = interaction.createdTimestamp
  const before = Number.isFinite(created) ? Math.max(0, start.at - created) : 0
  return before + (performance.now() - start.mono)
}

/**
 * The promise a handler's `respond()` gave, as the handler sees it: a `Promise` like any other, which notes whether the
 * handler read its outcome, by `await`, `then`, `catch`, `finally` or `Promise.all`, all of which go through `then`.
 */
class WatchedAnswer<T> extends Promise<T> {
  // Promises chained from it are plain ones
  static override get [Symbol.species]() {
    return Promise
  }
  /** Whether anything asked for the outcome. */
  observed = false
  override then<A = T, B = never>(
    onFulfilled?: ((value: T) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    this.observed = true
    return super.then(onFulfilled, onRejected)
  }
}

/** A `respond()` a handler called: its outcome, and whether the handler read it. */
export interface WatchedRespond {
  promise: Promise<unknown>
  observed: () => boolean
}

/**
 * Runs `run` while noting each `interaction.respond()` it calls in `answers`, in order, and gives them beside its
 * result; a caller that passes its own list has them also when `run` throws. discord.js marks the interaction
 * `responded` only once Discord has answered, which a handler need not wait for. `replaced` is set when the handler put
 * its own `respond` in place, which is then left there. An answer that is a thenable but not a promise is read once
 * more through `Promise.resolve`, so a lazy one that starts its work in `then` does it again if the handler also awaits
 * it.
 */
export async function watchRespond<T>(
  interaction: AutocompleteInteraction,
  run: () => Promise<T>,
  answers: WatchedRespond[] = [],
): Promise<{ result: T; answers: WatchedRespond[]; replaced: boolean }> {
  const own = Object.getOwnPropertyDescriptor(interaction, 'respond')
  const respond = interaction.respond
  const watcher = function (this: unknown, ...args: unknown[]) {
    const sent = Reflect.apply(respond, this, args) as unknown
    // Only a native promise can be watched; anything else is given back as it is, and counts as read
    if (!(sent instanceof Promise)) {
      const settled = Promise.resolve(sent)
      // The handler reads `sent` itself; this copy of its outcome is MeoCord's, never left unhandled
      Promise.prototype.then.call(settled, undefined, () => undefined)
      answers.push({ promise: settled, observed: () => true })
      return sent
    }
    const watched = new WatchedAnswer<unknown>((resolve, reject) => void sent.then(resolve, reject))
    // A failure nobody reads is reported by MeoCord once the call ends, not left unhandled
    Promise.prototype.then.call(watched, undefined, () => undefined)
    answers.push({ promise: sent, observed: () => watched.observed })
    return watched
  }
  Object.defineProperty(interaction, 'respond', { configurable: true, writable: true, value: watcher })
  const restore = () => {
    // A respond the handler put in place stays
    if (Object.getOwnPropertyDescriptor(interaction, 'respond')?.value !== watcher) return true
    if (own) Object.defineProperty(interaction, 'respond', own)
    else delete (interaction as { respond?: unknown }).respond
    return false
  }
  let result: T
  try {
    result = await run()
  } catch (error) {
    restore()
    throw error
  }
  return { result, answers, replaced: restore() }
}

/** Whether `error` is Discord's refusal of an answer to an expired interaction. */
export function isExpired(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === RESTJSONErrorCodes.UnknownInteraction
}

/** A duration as a log line shows it, in seconds to a tenth. */
export const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`

/** The command and option an autocomplete suggests choices for, as a member typed them: `/search query`. */
export function autocompleteSubject(interaction: AutocompleteInteraction): string {
  const focused = focusedOptionName(interaction)
  return `/${resolveCommandPaths(interaction)[0]}${focused === undefined ? '' : ` ${focused}`}`
}

/**
 * Reports that the call claiming `interaction` answered it too late: its handler's `respond()`, or MeoCord's close of
 * the menu, was refused as expired. Gives `false`, reporting nothing, for a call no handler claimed or one that doesn't
 * name slow calls, which the caller then reports as before.
 */
export function reportExpiredAutocomplete(interaction: AutocompleteInteraction, logger: Pick<Logger, 'warn'>): boolean {
  const call = calls.get(interaction)
  if (!call?.warnSlow) return false
  logger.warn(
    `Discord refused ${call.handler}'s choices for ${autocompleteSubject(interaction)} as expired, after ` +
      `${seconds(autocompleteElapsed(interaction, call.start))} by MeoCord's count, so the member saw no suggestions. ` +
      `Discord gives an autocomplete ${AUTOCOMPLETE_WINDOW}: cache what it searches, or search less.`,
  )
  return true
}
