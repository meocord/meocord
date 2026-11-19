// Tracks the timers framework code arms, for specs of a stop; no entry point imports this file, so it never ships

/** A timer framework code armed, by the source file that armed it. */
interface Armed {
  file: string
  delay: number
  live: boolean
}

/** One framework timer a spec runs at a point of its choosing. */
interface Interceptor {
  match: (file: string, delay: number) => boolean
  wrap: (run: () => void) => () => void
}

const realSetTimeout = globalThis.setTimeout
const realClearTimeout = globalThis.clearTimeout
const armed = new Map<unknown, Armed>()
let interceptors: Interceptor[] = []

/** The framework file a stack names first, outside the specs and this file. */
function armedFrom(stack = ''): string | undefined {
  for (const line of stack.split('\n').slice(2)) {
    const file = /\/src\/((?:core|common|testing)\/[\w.-]+\.ts)/.exec(line)?.[1]
    if (file && !file.endsWith('.spec.ts')) return file
  }
}

/**
 * Wraps the global timers so each one framework code arms is tracked by the file that armed it, until
 * {@link untrackFrameworkTimers}. Fake timers installed afterwards replace the wrapper and restore it.
 */
export function trackFrameworkTimers(): void {
  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
    const file = armedFrom(new Error().stack)
    const ms = Number(delay ?? 0)
    let entry: Armed | undefined
    let run = () => {
      if (entry) entry.live = false
      callback(...args)
    }
    const hit = file === undefined ? -1 : interceptors.findIndex(({ match }) => match(file, ms))
    if (hit >= 0) run = interceptors.splice(hit, 1)[0].wrap(run)
    const handle = realSetTimeout(run, delay)
    if (file) armed.set(handle, (entry = { file, delay: ms, live: true }))
    return handle
  }) as typeof setTimeout
  globalThis.clearTimeout = ((handle: Parameters<typeof clearTimeout>[0]) => {
    const entry = armed.get(handle)
    if (entry) entry.live = false
    realClearTimeout(handle)
  }) as typeof clearTimeout
}

/** Puts the global timers back. */
export function untrackFrameworkTimers(): void {
  globalThis.setTimeout = realSetTimeout
  globalThis.clearTimeout = realClearTimeout
}

/** Forgets the timers tracked and the interceptors not yet used, between tests. */
export function forgetFrameworkTimers(): void {
  armed.clear()
  interceptors = []
}

/** The ready gate's, the theme lookups' and the lifecycle's timers still armed, by file and delay: a stop leaves none. */
export function timersLeftByStop(): string[] {
  return [...armed.values()].filter(t => t.live && /^core\/(ready-gate|theme-[\w-]+|lifecycle-hooks)\.ts$/.test(t.file)).map(t => `${t.file} ${t.delay}ms`)
}

/** The next framework timer `match` takes runs `wrap(callback)` in place of its callback. */
export function interceptFrameworkTimer(match: Interceptor['match'], wrap: Interceptor['wrap']): void {
  interceptors.push({ match, wrap })
}

/** Where an action runs relative to a timer's callback: before it, in it after, in a microtask after, in a later turn. */
export const CALLBACK_ORDERS = ['before the callback', 'in the callback, after it', 'in a microtask queued after it', 'in a later turn'] as const

/** Runs `act` at `order` relative to the callback of the next framework timer `match` takes. */
export function actAround(match: Interceptor['match'], order: (typeof CALLBACK_ORDERS)[number], act: () => void): void {
  interceptFrameworkTimer(match, run => () => {
    if (order === 'before the callback') act()
    run()
    if (order === 'in the callback, after it') act()
    if (order === 'in a microtask queued after it') queueMicrotask(act)
    if (order === 'in a later turn') setImmediate(act)
  })
}

/** Resolves after `ms` on the real clock, untracked. */
export const sleep = (ms: number): Promise<void> => new Promise(resolve => realSetTimeout(resolve, ms))
/** Runs `act` after `ms` on the real clock, untracked. */
export const after = (ms: number, act: () => void): void => void realSetTimeout(act, ms)
