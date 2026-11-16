import { type Container } from 'inversify'
import { injectedTokens } from '@src/core/guard-runner.js'
import { isAppClassToken, type LifecycleUnit } from '@src/core/lifecycle-order.js'
import { seconds } from '@src/core/autocomplete-timing.js'
import { responseOf, type Told } from '@src/common/response/response-state.js'
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
  place: number
  resolve: () => void
  /** Takes it off its interaction's decision once its units settle first. */
  leave?: () => void
}

/** A call or a lookup waiting on its interaction's bound. */
interface Held {
  call: ReadyWait
  needed: readonly number[]
  waiter: Waiter
  goAhead: () => void
}

/** One interaction's decision on its bound, which every call and lookup for it waiting at once follows. */
interface Decision {
  key: object
  /** What waits on it, in the order each came. */
  held: Set<Held>
  /** Whether the bound counts from the first wait rather than the interaction's creation, for the warning. */
  fromWait: boolean
  timer?: ReturnType<typeof setTimeout>
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
  private readonly waiters = new Set<Waiter>()
  /** The places of the units each handler reaches, in order, by class and method. */
  private readonly needs = new WeakMap<object, Map<string, readonly number[]>>()
  /** The units a bound has already warned about, each once. */
  private readonly warned = new Set<unknown>()
  /** The decision pending on each interaction's bound, while a call or a lookup for it waits. */
  private readonly decisions = new WeakMap<object, Decision>()

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
   * Settles once the units `call` reaches have settled, or its bound has passed, with a warning. The call and the theme
   * lookups for one interaction that wait at once share one decision on its bound, so all of them go ahead together,
   * the calls first, or none does.
   */
  async wait(call: ReadyWait): Promise<void> {
    if (!this.holds(call)) return
    const needed = this.neededBy(call)
    const waiter: Waiter = { place: needed.at(-1)!, resolve: () => undefined }
    const reached = new Promise<void>(resolve => {
      waiter.resolve = resolve
      this.waiters.add(waiter)
    })
    if (!call.bound) return reached
    const decision = this.decisionFor(call.bound)
    const goneAhead = Promise.withResolvers<void>()
    const held: Held = { call, needed, waiter, goAhead: goneAhead.resolve }
    decision.held.add(held)
    waiter.leave = () => {
      decision.held.delete(held)
      // Its last waiter gone, the bound's timer has no one to decide for
      if (decision.held.size === 0) this.drop(decision)
    }
    await Promise.race([reached, goneAhead.promise])
  }

  /**
   * The decision pending on `bound`'s interaction, or a new one: due once the bound has passed, counted from the
   * interaction's creation, or from now when that is earlier or unknown so a host clock running late can't lengthen
   * it, and for an interaction, once Discord has been told nothing and nothing is on its way.
   */
  private decisionFor(bound: NonNullable<ReadyBound>): Decision {
    // Every wait for one interaction reads the same bound: its kind, creation time and told state come from the
    // interaction itself; only `deferred` differs, which each wait's own warning reads
    const key = bound.of ?? {}
    const pending = this.decisions.get(key)
    if (pending) return pending
    const { ms, since, told } = bound
    const fromWait = since === undefined || since > Date.now()
    const decision: Decision = { key, held: new Set(), fromWait }
    this.decisions.set(key, decision)
    const passed = new Promise<void>(resolve => {
      decision.timer = setTimeout(resolve, fromWait ? ms : Math.max(0, since + ms - Date.now()))
    })
    void (told ? passed.then(() => untold(told)) : passed).then(() => this.decide(decision))
    return decision
  }

  /**
   * Lets everything `decision` holds go ahead, the calls before the lookups, each warning once per hook, so the hook is
   * named by the call's warning with its advice. A wait that starts later decides afresh.
   */
  private decide(decision: Decision): void {
    this.drop(decision)
    // A stable sort keeps each kind in the order it came
    const held = [...decision.held].sort((a, b) => Number(a.call.lookup === true) - Number(b.call.lookup === true))
    decision.held.clear()
    for (const { call, needed, waiter, goAhead } of held) {
      this.waiters.delete(waiter)
      this.warnLate(call, needed, decision.fromWait)
      goAhead()
    }
  }

  private drop(decision: Decision): void {
    clearTimeout(decision.timer)
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
