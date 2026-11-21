import { type Container } from 'inversify'
import { injectedTokens } from '@src/core/guard-runner.js'
import { isAppClassToken, type LifecycleUnit } from '@src/core/lifecycle-order.js'
import { seconds } from '@src/core/autocomplete-timing.js'
import { responseOf, type Told, type WithdrawnReply } from '@src/common/response/response-state.js'
import { readQuietly } from '@src/util/quiet-reads.util.js'
import { shared } from '@src/util/shared-state.util.js'

/** How long an interaction without `@Defer` waits for the `onReady` hooks it depends on, leaving time to answer. */
export const READY_WAIT_INTERACTION_MS = 2000

/** How long an autocomplete waits for the `onReady` hooks it uses: it can't be acknowledged, and has to suggest. */
export const READY_WAIT_AUTOCOMPLETE_MS = 1000

/** What Discord has been told about an interaction, as its response state knows it. */
export interface ToldState {
  readonly told: Told
  toldChanged(): Promise<void>
}

/**
 * How long a wait for an interaction or an autocomplete may last; none waits until its hooks settle. `ms` counts from
 * `since`, the interaction's creation, or from the first wait's start when that is earlier or unknown. For an
 * interaction, `told` follows what Discord was told: while an acknowledgement or answer is scheduled or on its way, the
 * wait neither ends nor warns; once Discord has one, it has no bound; told nothing, the bound holds. `deferred` marks a
 * call whose handler has `@Defer`, for the warning's advice. `of` is the interaction bounded: its call and every theme
 * lookup for it waiting at once share one decision on the bound.
 */
export type ReadyBound =
  | { kind: 'interaction' | 'autocomplete'; ms: number; since?: number; told?: ToldState; deferred?: boolean; of?: object }
  | undefined

/** One call about to wait: the handler it runs, the classes it runs, and how long it may wait. */
export interface ReadyWait {
  /** The handler's class and method, which the cache of what it needs is keyed by. */
  controller: object
  methodName: string
  /** The classes the call runs: the handler's own, its stages and the presenter. Read once per handler. */
  classes: () => readonly unknown[]
  bound?: ReadyBound
  /** A theme lookup through `controller`, the app's theme resolver, rather than a handler's call. */
  lookup?: boolean
}

/** A call or a lookup waiting for the last unit it reaches to settle. */
interface Waiter {
  call: ReadyWait
  needed: readonly number[]
  place: number
  /** The call the wait belongs to, as the app tracks its running calls, for the line naming it if a stop drops it. */
  of?: object
  resolve: () => void
  /** Ends the wait with the stop's error: the call never starts. */
  reject: (error: Error) => void
  /** Takes it off its interaction's decision once its units settle first. */
  leave?: () => void
}

/**
 * A call a stop dropped before it started: the call as the app tracks it, the hook it waited for, when it has ended,
 * its observers told and an answer it made sent, and the deletion of the deferred reply `@Defer` made for it, once
 * under way.
 */
export interface DroppedCall {
  of?: object
  hook: string
  ended: Promise<void>
  deletion(): Promise<WithdrawnReply> | undefined
}

/** What the stop knows of a call it dropped: when the call has ended, and its deferred reply's deletion, once under way. */
interface StopRecord {
  ended: PromiseWithResolvers<void>
  deletion?: Promise<WithdrawnReply>
}

/** The errors {@link stoppedBeforeStart} made, told apart by identity alone, each with the record of the call it dropped. */
const stops = new WeakMap<Error, StopRecord>()

/** What a call the ready gate held when the app stopped ends with, as it never started, and what the stop knows of it. */
function stoppedBeforeStart(): { error: Error; ended: Promise<void>; deletion: () => Promise<WithdrawnReply> | undefined } {
  const error = new Error('The bot stopped before this call started.')
  const record: StopRecord = { ended: Promise.withResolvers<void>() }
  stops.set(error, record)
  return { error, ended: record.ended.promise, deletion: () => record.deletion }
}

/** The error a call ends with when the app stopped before it started, which {@link isStoppedBeforeStart} recognises. */
export function stoppedBeforeStartError(): Error {
  return stoppedBeforeStart().error
}

/** Whether `error` ended a call the ready gate held when the app stopped, so it never started. */
export function isStoppedBeforeStart(error: unknown): boolean {
  return error instanceof Error && stops.has(error)
}

/** Marks the call `error` dropped as ended, which the stop waits for, within the drain's time, before its hooks. */
export function droppedCallEnded(error: unknown): void {
  if (error instanceof Error) stops.get(error)?.ended.resolve()
}

/**
 * Notes the deletion of the deferred reply `@Defer` made for the call `error` dropped, claimed in the turn the stop
 * decides, which the stop waits for past the drain's end, out of its hooks' reserve, and whose failure it reports.
 */
export function droppedCallDeleting(error: unknown, deletion: Promise<WithdrawnReply>): void {
  const record = error instanceof Error ? stops.get(error) : undefined
  if (record) record.deletion = deletion
}

/** A call or a lookup waiting on its interaction's bound. */
interface Held {
  waiter: Waiter
  goAhead: () => void
}

/** One interaction's decision on its bound, which every call and lookup for it waiting at once follows. */
interface Decision {
  key: object
  /** What waits on it, in the order each came. */
  held: Set<Held>
  /** The interaction's first-answer deadline, held while something waits on the decision. */
  deadline: AnswerDeadline
}

/** Where the gate keeps what a theme lookup through the resolver waits for, beside the resolver's own handlers. */
const THEME_LOOKUP = ' theme lookup'

/**
 * How long a call of `type` waits for the hooks it uses: an interaction and an autocomplete have to answer within
 * Discord's three seconds; a message, a reaction and an event have no bound.
 */
export function readyWaitBound(type: string): ReadyBound {
  if (type === 'autocomplete') return { kind: 'autocomplete', ms: READY_WAIT_AUTOCOMPLETE_MS }
  if (type === 'interaction') return { kind: 'interaction', ms: READY_WAIT_INTERACTION_MS }
  return undefined
}

/** Settles once Discord has been told nothing and nothing is on its way; never once it has an answer. */
async function untold(state: ToldState): Promise<true> {
  for (;;) {
    if (state.told === 'nothing') return true
    // Each wait's own promise, released with it
    if (state.told === 'told') return new Promise<never>(() => undefined)
    await state.toldChanged()
  }
}

/**
 * The bound of a call of `type` for `first`, or of an answer to it: counted from the interaction's creation, and for
 * an interaction that can be answered, following what Discord has been told of it.
 */
export function readyBoundFor(type: string, first: unknown, deferred = false): ReadyBound {
  const bound = readyWaitBound(type)
  if (!bound) return undefined
  const interaction = first as { createdTimestamp?: unknown; isRepliable?: () => boolean } | undefined
  const created = interaction?.createdTimestamp
  const repliable = type === 'interaction' && typeof interaction?.isRepliable === 'function' && interaction.isRepliable() === true
  return {
    ...bound,
    ...(typeof first === 'object' && first !== null && { of: first }),
    ...(typeof created === 'number' && Number.isFinite(created) && { since: created }),
    ...(repliable && { told: responseOf(first as Parameters<typeof responseOf>[0]) }),
    ...(deferred && { deferred }),
  }
}

/**
 * An interaction's first-answer deadline: `bound` from its creation, which every wait before its first answer shares,
 * the hooks' and the theme's alike. Its timer runs while something holds it.
 */
export interface AnswerDeadline {
  /** Whether the bound counts from the first wait rather than the interaction's creation. */
  readonly fromWait: boolean
  /** Settles once the deadline has passed and Discord has been told nothing, and nothing is on its way. */
  readonly expired: Promise<unknown>
  /** Whether the deadline is past with Discord told nothing now: what a wait ending at this moment reads. */
  due(): boolean
  /** Whether a warning already named this interaction's wait, so another for it would repeat it. */
  warned: boolean
  /** Lets go of the deadline; once nothing holds it, its timer stops. */
  release(): void
}

/** When an interaction's deadline passes, set by its first wait and kept for every later one. */
interface DeadlineMoment {
  fromWait: boolean
  /** On the monotonic clock, so a host clock that jumps during a wait can't move it. */
  passesAt: number
}

/** The timer each interaction's waits share, while one holds it. */
interface SharedDeadline {
  key: object
  holders: number
  moment: DeadlineMoment
  told?: ToldState
  timer: ReturnType<typeof setTimeout>
  expired: Promise<unknown>
}

const moments = new WeakMap<object, DeadlineMoment>()
const deadlines = new WeakMap<object, SharedDeadline>()
/** The interactions a warning already named the wait of, kept past their deadlines' leases. */
const warnedWaits = new WeakSet<object>()

/**
 * The first-answer deadline of the interaction `bound` is for, held until released: the one its other waits hold, or a
 * new one. It passes `bound.ms` after the interaction's creation, or after now when that is later or unknown, so a host
 * clock running late can't lengthen it; for an interaction that can be answered, it expires once Discord has been told
 * nothing and nothing is on its way.
 */
export function answerDeadline(bound: NonNullable<ReadyBound>): AnswerDeadline {
  const key = bound.of ?? {}
  let shared = deadlines.get(key)
  if (!shared) {
    const { ms, since, told } = bound
    // Read from the wall clock once, at the interaction's first wait; a later wait counts to the same moment
    let moment = moments.get(key)
    if (!moment) {
      const fromWait = since === undefined || since > Date.now()
      moment = { fromWait, passesAt: performance.now() + (fromWait ? ms : Math.max(0, since + ms - Date.now())) }
      moments.set(key, moment)
    }
    const passed = Promise.withResolvers<void>()
    const timer = setTimeout(passed.resolve, Math.max(0, moment.passesAt - performance.now()))
    shared = { key, holders: 0, moment, ...(told && { told }), timer, expired: told ? passed.promise.then(() => untold(told)) : passed.promise }
    deadlines.set(key, shared)
  }
  const held = shared
  held.holders++
  let released = false
  return {
    fromWait: held.moment.fromWait,
    expired: held.expired,
    due: () => performance.now() >= held.moment.passesAt && (held.told === undefined || held.told.told === 'nothing'),
    get warned() {
      return warnedWaits.has(key)
    },
    set warned(value) {
      if (value) warnedWaits.add(key)
    },
    release() {
      if (released) return
      released = true
      if (--held.holders > 0) return
      clearTimeout(held.timer)
      if (deadlines.get(held.key) === held) deadlines.delete(held.key)
    },
  }
}

/** The bound of what `args` answers, read from its first argument: an autocomplete, another interaction, or none. */
export function readyBoundOf(args: readonly unknown[]): ReadyBound {
  // Any value can be a bound function's first argument, so only an interaction's own methods are called, read quietly:
  // a default-mode mock answers a method its class lacks with a placeholder
  const [first] = args as [{ isAutocomplete?: unknown; isRepliable?: unknown } | null | undefined]
  const kind = readQuietly(() =>
    typeof first?.isAutocomplete === 'function' && first.isAutocomplete() === true
      ? 'autocomplete'
      : typeof first?.isRepliable === 'function' && first.isRepliable() === true
        ? 'interaction'
        : undefined,
  )
  return kind && readyBoundFor(kind, first)
}

/**
 * Holds calls back until the `onReady` hooks of the units they use have settled, as `@MeoCord({ waitForReady: true })`
 * asks. The hooks settle one at a time in the units' order, and a unit's dependencies come before it, so a call waits
 * for the last unit, in that order, among those it reaches.
 */
export class ReadyGate {
  /** Each unit's place in the order the hooks run in. */
  private readonly places: Map<unknown, number>
  /** How many units, from the first, have settled. */
  private settledCount = 0
  /** Whether the hooks' pass has ended, settled or stopped, after which no call waits. */
  private open = false
  /** Whether every hook has run, so a close has nothing left to decide. */
  private ran = false
  private readonly waiters = new Set<Waiter>()
  /** The places of the units each handler reaches, in order, by class and method. */
  private readonly needs = new WeakMap<object, Map<string, readonly number[]>>()
  /** The units a bound has already warned about, each once. */
  private readonly warned = new Set<unknown>()
  /** The decision pending on each interaction's bound, while a call or a lookup for it waits. */
  private readonly decisions = new Map<object, Decision>()
  /** The calls a stop dropped, at the hooks' pass's end or at the close, which the close reports. */
  private readonly dropped: DroppedCall[] = []
  /** The close under way or done, which settles with the calls the stop dropped. */
  private closing?: Promise<readonly DroppedCall[]>

  constructor(
    private readonly units: readonly LifecycleUnit[],
    private readonly warn: (message: string) => void,
    /** The app's `themeFor` class, whose hooks every theme lookup waits for. */
    private readonly themeResolver?: object,
    /** The call a wait belongs to, as the app tracks its running calls. */
    private readonly callOf?: () => object | undefined,
  ) {
    this.places = new Map(units.map((unit, place) => [unit.token, place]))
  }

  /** Records that `unit` is done: its `onReady` settled or failed, or it has none. */
  settled(unit: LifecycleUnit): void {
    const place = this.places.get(unit.token)
    if (place === undefined) return
    this.settledCount = Math.max(this.settledCount, place + 1)
    for (const waiter of this.waiters) {
      if (waiter.place < this.settledCount) this.release(waiter)
    }
  }

  /**
   * Ends the wait for every call, now and later: the hooks' pass has run, or, when `stopped`, a stop ended it, and a
   * call still waiting needs a hook that will never run, so it is dropped at once.
   */
  finish(stopped = false): void {
    this.open = true
    this.ran = !stopped
    for (const waiter of [...this.waiters]) {
      if (stopped && this.hookAhead(waiter.needed)) this.dropWaiter(waiter)
      else this.release(waiter)
    }
  }

  /**
   * Closes the gate as a stop stops waiting for the calls: no call waits from now on, and those still held are
   * decided by the end of the event loop iteration's timers and I/O, before its immediates. Hooks that settle by then,
   * by another timer due in the same timers phase included, let their calls go ahead, and a held interaction whose
   * first-answer deadline is due goes ahead as its bound would; every other is dropped. Settles with every call the
   * stop dropped, at the pass's end or here, once they have been. A later close, such as a late value's shutdown,
   * settles with none: those calls are the first close's to wait for and report.
   */
  close(): Promise<readonly DroppedCall[]> {
    if (this.closing) return this.closing.then(() => [])
    this.open = true
    // Decided once the turn has run even with nothing held, so a call its hook released in it starts first
    this.closing =
      this.ran && this.waiters.size === 0
        ? Promise.resolve(this.dropped)
        : new Promise(resolve =>
            setImmediate(() => {
              // A bound that has passed with Discord told nothing is over, whichever timer the turn ran first
              for (const decision of [...this.decisions.values()]) if (decision.deadline.due()) this.decide(decision)
              this.dropAll()
              resolve(this.dropped)
            }),
          )
    return this.closing
  }

  /** Whether `call` would wait now: the hooks' pass is still running and a unit it reaches hasn't settled. */
  holds(call: ReadyWait): boolean {
    if (this.open) return false
    const last = this.neededBy(call).at(-1)
    return last !== undefined && last >= this.settledCount
  }

  /**
   * Settles once the units `call` reaches have settled, or its bound has passed, with a warning. The call and the theme
   * lookups for one interaction that wait at once share one decision on its bound, so all of them go ahead together,
   * the calls first, or none does.
   */
  async wait(call: ReadyWait): Promise<void> {
    if (!this.holds(call)) return
    const needed = this.neededBy(call)
    const reached = Promise.withResolvers<void>()
    const of = this.callOf?.()
    const waiter: Waiter = { call, needed, place: needed.at(-1)!, ...(of && { of }), resolve: reached.resolve, reject: reached.reject }
    this.waiters.add(waiter)
    if (!call.bound) return reached.promise
    const decision = this.decisionFor(call.bound)
    const goneAhead = Promise.withResolvers<void>()
    const held: Held = { waiter, goAhead: goneAhead.resolve }
    decision.held.add(held)
    waiter.leave = () => {
      decision.held.delete(held)
      // Its last waiter gone, the bound's timer has no one to decide for
      if (decision.held.size === 0) this.drop(decision)
    }
    await Promise.race([reached.promise, goneAhead.promise])
  }

  /** The decision pending on `bound`'s interaction, or a new one, due once its first-answer deadline expires. */
  private decisionFor(bound: NonNullable<ReadyBound>): Decision {
    // Every wait for one interaction reads the same bound: its kind, creation time and told state come from the
    // interaction itself; only `deferred` differs, which each wait's own warning reads
    const key = bound.of ?? {}
    const pending = this.decisions.get(key)
    if (pending) return pending
    const decision: Decision = { key, held: new Set(), deadline: answerDeadline(bound) }
    this.decisions.set(key, decision)
    void decision.deadline.expired.then(() => this.decide(decision))
    return decision
  }

  /**
   * Lets everything `decision` holds go ahead, the calls before the lookups, each warning once per hook, so the hook is
   * named by the call's warning with its advice. A wait that starts later decides afresh.
   */
  private decide(decision: Decision): void {
    this.drop(decision)
    // A stable sort keeps each kind in the order it came
    const held = [...decision.held].sort((a, b) => Number(a.waiter.call.lookup === true) - Number(b.waiter.call.lookup === true))
    decision.held.clear()
    for (const { waiter, goAhead } of held) {
      this.waiters.delete(waiter)
      if (this.warnLate(waiter.call, waiter.needed, decision.deadline.fromWait)) decision.deadline.warned = true
      goAhead()
    }
  }

  /** Drops every call and lookup still waiting: each ends with the stop's error, and lets go of its deadline. */
  private dropAll(): void {
    for (const waiter of [...this.waiters]) this.dropWaiter(waiter)
  }

  /** Ends `waiter` with the stop's error, noting a call for the line naming it. */
  private dropWaiter(waiter: Waiter): void {
    this.waiters.delete(waiter)
    // Off its decision first, so the deadline is let go of only once nothing waits on it
    waiter.leave?.()
    const { error, ended, deletion } = stoppedBeforeStart()
    // A lookup is no call: its answer goes on in the handler's theme, and nothing names it
    if (!waiter.call.lookup) this.dropped.push({ ...(waiter.of && { of: waiter.of }), hook: this.pendingHook(waiter.needed)?.name ?? 'a unit', ended, deletion })
    waiter.reject(error)
  }

  /**
   * Whether a hook not yet run lies before or among the units `needed` reaches: an `onReady` on a class, or a unit
   * whose hooks its token can't tell, such as a provided value.
   */
  private hookAhead(needed: readonly number[]): boolean {
    return this.units
      .slice(this.settledCount, needed.at(-1)! + 1)
      .some(({ token }) => typeof token !== 'function' || typeof (token as { prototype?: { onReady?: unknown } }).prototype?.onReady === 'function')
  }

  private drop(decision: Decision): void {
    decision.deadline.release()
    if (this.decisions.get(decision.key) === decision) this.decisions.delete(decision.key)
  }

  /**
   * Settles once the units the app's theme resolver reaches have, or the bound `bound` gives has passed, so no server's
   * or user's theme is looked up through it before its hooks have run; `undefined` when there is nothing to wait for,
   * without reading `bound`.
   */
  lookupReady(bound: () => ReadyBound): Promise<void> | undefined {
    const resolver = this.themeResolver
    if (!resolver) return undefined
    const call: ReadyWait = { controller: resolver, methodName: THEME_LOOKUP, classes: () => [resolver], lookup: true }
    // The bound is read only for a lookup that waits
    return this.holds(call) ? this.wait({ ...call, bound: bound() }) : undefined
  }

  private release(waiter: Waiter): void {
    this.waiters.delete(waiter)
    // Released by its hooks, it is no longer the bound's to decide
    waiter.leave?.()
    waiter.resolve()
  }

  /** The places of the units the call's classes reach, through what each injects, in order. */
  private neededBy({ controller, methodName, classes }: ReadyWait): readonly number[] {
    let byMethod = this.needs.get(controller)
    if (!byMethod) this.needs.set(controller, (byMethod = new Map()))
    let needed = byMethod.get(methodName)
    if (needed) return needed
    const places = new Set<number>()
    const seen = new Set<unknown>()
    const visit = (token: unknown) => {
      if (seen.has(token)) return
      seen.add(token)
      const place = this.places.get(token)
      if (place !== undefined) {
        places.add(place)
        this.units[place].dependencies.forEach(visit)
      } else if (isAppClassToken(token)) {
        // A stage, or a class made for each call, which has no hooks of its own but may inject a unit that does
        injectedTokens(token).forEach(visit)
      }
    }
    classes().forEach(visit)
    needed = [...places].sort((a, b) => a - b)
    byMethod.set(methodName, needed)
    return needed
  }

  /**
   * The hook that holds a call needing `needed`: the first unit not settled yet that has one, as far as its class tells,
   * whether the call uses it or it only runs before one the call uses.
   */
  private pendingHook(needed: readonly number[]): LifecycleUnit | undefined {
    const pending = this.units.slice(this.settledCount, needed.at(-1)! + 1)
    return pending.find(({ token }) => typeof (token as { prototype?: { onReady?: unknown } }).prototype?.onReady === 'function') ?? pending[0]
  }

  /** Warns, once per hook, that a call ran before the hook it waited for had settled; whether it warned. */
  private warnLate({ controller, methodName, bound, lookup }: ReadyWait, needed: readonly number[], fromWait: boolean): boolean {
    const unit = this.pendingHook(needed)
    if (!unit || this.warned.has(unit.token)) return false
    this.warned.add(unit.token)
    const name = (controller as { name?: string }).name
    const { kind, ms, deferred } = bound!
    const span = fromWait ? `after waiting ${seconds(ms)}` : `${seconds(ms)} after the interaction was created`
    if (lookup) {
      const waits = kind === 'interaction' ? 'an interaction Discord has been told nothing of' : 'an autocomplete'
      this.warn(`${name} looked up a theme before onReady in ${unit.name} had settled, ${span}, as long as ${waits} waits. Make onReady in ${unit.name} faster.`)
      return true
    }
    const handler = `${name}.${methodName}`
    if (kind === 'autocomplete') {
      this.warn(
        `${handler} ran before onReady in ${unit.name} had settled, ${span}, as long as an autocomplete waits. An ` +
          `autocomplete can't be deferred: have ${handler} suggest choices without what that hook prepares, or make it faster.`,
      )
    } else if (deferred) {
      // Under @Defer the bound holds only while Discord has been told nothing
      this.warn(
        `${handler} ran before onReady in ${unit.name} had settled, ${span}: Discord had been told nothing of it, as its ` +
          `@Defer acknowledgement failed or was cancelled with no answer sent, so it waited as long as one without @Defer. ` +
          `Make onReady in ${unit.name} faster.`,
      )
    } else {
      this.warn(
        `${handler} ran before onReady in ${unit.name} had settled, ${span}, as long as an interaction without @Defer ` +
          `waits. Add @Defer to ${handler} to have it wait for the hook, or make onReady in ${unit.name} faster.`,
      )
    }
    return true
  }
}

// The gate of each container whose app waits for its hooks
// One for both builds: the build that answers outside a call may not be the one whose factory set the gate
const gates = shared('readyGates', () => new WeakMap<Container, ReadyGate>())

/** Makes `container`'s calls wait for the hooks of `units`, until the gate's {@link ReadyGate.finish}. */
export function closeReadyGate(
  container: Container,
  units: readonly LifecycleUnit[],
  warn: (message: string) => void,
  themeResolver?: object,
  callOf?: () => object | undefined,
): ReadyGate {
  const gate = new ReadyGate(units, warn, themeResolver, callOf)
  gates.set(container, gate)
  return gate
}

/** The gate `container`'s calls wait at, if its app waits for its hooks and they have begun. */
export function readyGateOf(container: Container): ReadyGate | undefined {
  return gates.get(container)
}
