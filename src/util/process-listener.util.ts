/** Brands a process listener MeoCord adds, in any copy or version of it, so its others tell it from the application's. */
const MEOCORD_LISTENER = Symbol.for('meocord.processListener')

/** The process events MeoCord listens for to report an error nothing else handles. */
export type CrashEvent = 'uncaughtException' | 'unhandledRejection'

/**
 * Marks `listener` as MeoCord's own and returns it. A failed shard's hold on its errors (`endFailedShard`) stays
 * unmarked: it owns the exit until its manager has the reason, so MeoCord's other listeners stand aside for it.
 */
export function meocordListener<L extends (...args: never[]) => void>(listener: L): L {
  Object.defineProperty(listener, MEOCORD_LISTENER, { value: true })
  return listener
}

/** How many listeners for `event` MeoCord added. */
export function meocordListenerCount(event: CrashEvent): number {
  return process.listeners(event).filter(isMeoCordListener).length
}

/** How many listeners for `event` the application added: every one but MeoCord's own. */
export function appListenerCount(event: CrashEvent): number {
  return process.listeners(event).filter(listener => !isMeoCordListener(listener)).length
}

function isMeoCordListener(listener: (...args: never[]) => unknown): boolean {
  return (listener as unknown as Record<symbol, unknown>)[MEOCORD_LISTENER] === true
}
