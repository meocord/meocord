import { type Container } from 'inversify'
import { injectedTokens } from '@src/core/guard-runner.js'
import { isAppClassToken, type LifecycleUnit } from '@src/core/lifecycle-order.js'
import { seconds } from '@src/core/autocomplete-timing.js'
import { responseOf, type Told } from '@src/common/response/response-state.js'
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
 * `since`, the interaction's creation, or from the wait's start when that is earlier or unknown. For an interaction,
 * `told` follows what Discord was told: while an acknowledgement or answer is scheduled or on its way, the wait neither
 * ends nor warns; once Discord has one, it has no bound; told nothing, the bound holds. `deferred` marks a call whose
 * handler has `@Defer`, for the warning's advice. `ahead` settles when the call a lookup belongs to has gone ahead at
 * its own bound, which the lookup then follows, without a warning of its own.
 */
export type ReadyBound =
  | { kind: 'interaction' | 'autocomplete'; ms: number; since?: number; told?: ToldState; deferred?: boolean; ahead?: Promise<void> }
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
    ...(typeof created === 'number' && Number.isFinite(created) && { since: created }),
    ...(repliable && { told: responseOf(first as Parameters<typeof responseOf>[0]) }),
    ...(deferred && { deferred }),
  }
}

/** The bound of what `args` answers, read from its first argument: an autocomplete, another interaction, or none. */
export function readyBoundOf(args: readonly unknown[]): ReadyBound {
  // Any value can be a bound function's first argument, so only an interaction's own methods are called
  const [first] = args as [{ isAutocomplete?: unknown; isRepliable?: unknown } | null | undefined]
  if (typeof first?.isAutocomplete === 'function' && first.isAutocomplete() === true) return readyBoundFor('autocomplete', first)
  return typeof first?.isRepliable === 'function' && first.isRepliable() === true ? readyBoundFor('interaction', first) : undefined
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
  private readonly waiters = new Set<{ place: number; resolve: () => void }>()
  /** The places of the units each handler reaches, in order, by class and method. */
  private readonly needs = new WeakMap<object, Map<string, readonly number[]>>()
  /** The units a bound has already warned about, each once. */
  private readonly warned = new Set<unknown>()

  constructor(
    private readonly units: readonly LifecycleUnit[],
    private readonly warn: (message: string) => void,
    /** The app's `themeFor` class, whose hooks every theme lookup waits for. */
    private readonly themeResolver?: object,
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

  /** Ends the wait for every call, now and later: the hooks' pass has run, or a stop ended it. */
  finish(): void {
    this.open = true
    for (const waiter of this.waiters) this.release(waiter)
  }

  /** Whether `call` would wait now: the hooks' pass is still running and a unit it reaches hasn't settled. */
  holds(call: ReadyWait): boolean {
    if (this.open) return false
    const last = this.neededBy(call).at(-1)
    return last !== undefined && last >= this.settledCount
  }

  /**
   * Settles once the units `call` reaches have settled, or its bound has passed, with a warning; `true` when it went
   * ahead before they had.
   */
  async wait(call: ReadyWait): Promise<boolean> {
    if (!this.holds(call)) return false
    const needed = this.neededBy(call)
    const last = needed.at(-1)!
    const waiter: { place: number; resolve: () => void } = { place: last, resolve: () => undefined }
    const reached = new Promise<void>(resolve => {
      waiter.resolve = resolve
      this.waiters.add(waiter)
    })
    if (!call.bound) return reached.then(() => false)
    const { ms, since, told, ahead } = call.bound
    // From the interaction's creation, or from now when that is earlier, so a host clock running late can't lengthen it
    const fromWait = since === undefined || since > Date.now()
    const left = fromWait ? ms : Math.max(0, since + ms - Date.now())
    let timer: ReturnType<typeof setTimeout> | undefined
    const passed = new Promise<true>(resolve => {
      timer = setTimeout(() => resolve(true), left)
    })
    // For an interaction, due only once the bound has passed with nothing told and nothing on its way
    const due = told ? passed.then(() => untold(told)) : passed
    const late = await Promise.race([reached.then(() => false as const), due, ...(ahead ? [ahead.then(() => 'with its call' as const)] : [])])
    clearTimeout(timer)
    if (!late) return false
    this.waiters.delete(waiter)
    // The call it belongs to has warned, if the hook was not named already
    if (late !== 'with its call') this.warnLate(call, needed, fromWait)
    return true
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
    return this.holds(call) ? this.wait({ ...call, bound: bound() }).then(() => undefined) : undefined
  }

  private release(waiter: { resolve: () => void }): void {
    this.waiters.delete(waiter as never)
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

  /** Warns, once per hook, that a call ran before the hook it waited for had settled. */
  private warnLate({ controller, methodName, bound, lookup }: ReadyWait, needed: readonly number[], fromWait: boolean): void {
    // The hook that holds the call: the first unit not settled yet that has one, as far as its class tells, whether the
    // call uses it or it only runs before one the call uses
    const pending = this.units.slice(this.settledCount, needed.at(-1)! + 1)
    const unit = pending.find(({ token }) => typeof (token as { prototype?: { onReady?: unknown } }).prototype?.onReady === 'function') ?? pending[0]
    if (!unit || this.warned.has(unit.token)) return
    this.warned.add(unit.token)
    const name = (controller as { name?: string }).name
    const { kind, ms, deferred } = bound!
    const span = fromWait ? `after waiting ${seconds(ms)}` : `${seconds(ms)} after the interaction was created`
    if (lookup) {
      const waits = kind === 'interaction' ? 'an interaction Discord has been told nothing of' : 'an autocomplete'
      this.warn(`${name} looked up a theme before onReady in ${unit.name} had settled, ${span}, as long as ${waits} waits. Make onReady in ${unit.name} faster.`)
      return
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
): ReadyGate {
  const gate = new ReadyGate(units, warn, themeResolver)
  gates.set(container, gate)
  return gate
}

/** The gate `container`'s calls wait at, if its app waits for its hooks and they have begun. */
export function readyGateOf(container: Container): ReadyGate | undefined {
  return gates.get(container)
}
