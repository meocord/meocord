// Tracks the timers framework code arms, for specs of a stop; no entry point imports this file, so it never ships

/** A timer framework code armed, by the source file that armed it. */
interface Armed {
  file: string
  /** The delay the code asked for. */
  delay: number
  live: boolean
  /** Where it was armed in the order of everything tracked. */
  seq: number
  /** Where its callback began in that order, if it has fired. */
  firedSeq?: number
  /** When its callback began, on the real clock, if it has fired. */
  firedAt?: number
}

/** A read of performance.now() framework code made, and what it read. */
interface ClockRead {
  file: string
  at: number
  seq: number
}

/** One framework timer a spec runs at a point of its choosing. */
interface Interceptor {
  match: (file: string, delay: number) => boolean
  wrap: (run: () => void) => () => void
}

const realSetTimeout = globalThis.setTimeout
const realClearTimeout = globalThis.clearTimeout
const realNow = performance.now.bind(performance)
const armed = new Map<unknown, Armed>()
const reads: ClockRead[] = []
let interceptors: Interceptor[] = []
/** The next place in the order of arming, firing and clock reads tracked. */
let order = 0

/** The framework file a stack names first, outside the specs and this file. */
function armedFrom(stack = ''): string | undefined {
  for (const line of stack.split('\n').slice(2)) {
    const file = /\/src\/((?:core|common|testing)\/[\w.-]+\.ts)/.exec(line)?.[1]
    if (file && !file.endsWith('.spec.ts')) return file
  }
}

/**
 * Wraps the global timers and performance.now() so each timer framework code arms, and each clock read it makes, is
 * tracked by its file, until {@link untrackFrameworkTimers}. Fake timers installed afterwards replace the wrapper.
 */
export function trackFrameworkTimers(): void {
  Object.defineProperty(performance, 'now', {
    configurable: true,
    writable: true,
    value: () => {
      const at = realNow()
      const file = armedFrom(new Error().stack)
      if (file) reads.push({ file, at, seq: order++ })
      return at
    },
  })
  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
    const file = armedFrom(new Error().stack)
    const ms = Number(delay ?? 0)
    let entry: Armed | undefined
    let run = () => {
      if (entry) {
        entry.live = false
        entry.firedSeq = order++
        entry.firedAt = realNow()
      }
      callback(...args)
    }
    const hit = file === undefined ? -1 : interceptors.findIndex(({ match }) => match(file, ms))
    if (hit >= 0) run = interceptors.splice(hit, 1)[0].wrap(run)
    const handle = realSetTimeout(run, delay)
    if (file) armed.set(handle, (entry = { file, delay: ms, live: true, seq: order++ }))
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
  delete (performance as { now?: unknown }).now
}

/** Forgets the timers tracked and the interceptors not yet used, between tests. */
export function forgetFrameworkTimers(): void {
  armed.clear()
  reads.length = 0
  interceptors = []
}

/** The ready gate's, the theme lookups' and the lifecycle's timers still armed, by file and delay: a stop leaves none. */
export function timersLeftByStop(): string[] {
  return [...armed.values()].filter(t => t.live && /^core\/(ready-gate|theme-[\w-]+|lifecycle-hooks)\.ts$/.test(t.file)).map(t => `${t.file} ${t.delay}ms`)
}

/** The timers `file` armed since the last {@link forgetFrameworkTimers}, in the order it armed them. */
export function frameworkTimersOf(file: string): readonly Readonly<Armed>[] {
  return [...armed.values()].filter(timer => timer.file === file)
}

/**
 * How early a timer may fire: Node and libuv keep timers on a whole-millisecond clock, so one can fire up to 1 ms
 * before its delay has passed on performance.now(). A stop waits for the drain's own time left only when its
 * drain-end timer fired that early, so that wait's delay is always under it.
 */
export const TIMER_EARLY_MS = 1

/** The place in the order of arming, firing and clock reads tracked that comes next: a mark a spec takes. */
export const nextInOrder = (): number => order++

/** What a stop's shutdown sequence asked of the clock and the timers, as `core/lifecycle-hooks.ts` made the calls. */
export interface StopRecord {
  /** The drain-end timer. */
  drain: Readonly<Armed>
  /** The sequence's first clock read: when it began. */
  startedAt: number
  /** When it took the drain's time to be up, from the read just after it armed the drain-end timer. */
  drainDeadline: number
  /** When it decided which calls it dropped: its first clock read once the drain-end timer fired. */
  decidedAt?: number
  /** The deletion deadlines it armed once the drain-end timer fired, past the wait for the drain's own time left. */
  deadlines: Readonly<Armed>[]
  /** The clock read the sequence made just before it armed `timer`: the "now" its delay was computed from. */
  readBefore: (timer: Readonly<Armed>) => ClockRead | undefined
  /** Its last clock read: the one its figures come from, if it read the clock after the decision. */
  last?: ClockRead
}

const LIFECYCLE = 'core/lifecycle-hooks.ts'
/** How far apart two delays computed from the same clock reads may come out, in floating-point arithmetic. */
const SAME_DELAY_MS = 1e-6

/** The record of the stop whose drain-end timer was armed for `drainMs`, or nothing if none was. */
export function stopRecord(drainMs: number): StopRecord | undefined {
  const timers = [...armed.values()].filter(timer => timer.file === LIFECYCLE)
  const clock = reads.filter(read => read.file === LIFECYCLE)
  const drain = timers.find(timer => timer.delay === drainMs)
  const startedAt = clock.filter(read => read.seq < (drain?.seq ?? -1)).at(-1)?.at
  const deadlineRead = clock.find(read => read.seq > (drain?.seq ?? Infinity))
  if (!drain || startedAt === undefined || !deadlineRead) return undefined
  const drainDeadline = deadlineRead.at + drainMs
  const fired = drain.firedSeq
  const afterFiring = fired === undefined ? [] : clock.filter(read => read.seq > fired)
  const decidedAt = afterFiring[0]?.at
  // The wait for the drain's own time left is the one timer asked for that, up to rounding
  const leftOfDrain = decidedAt === undefined ? Number.NaN : drainDeadline - decidedAt
  const deadlines = timers.filter(timer => fired !== undefined && timer.seq > fired && !(Math.abs(timer.delay - leftOfDrain) < SAME_DELAY_MS))
  return {
    drain,
    startedAt,
    drainDeadline,
    decidedAt,
    deadlines,
    readBefore: timer => clock.filter(read => read.seq < timer.seq).at(-1),
    last: afterFiring.length > 1 ? afterFiring.at(-1) : undefined,
  }
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
