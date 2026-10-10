import { type Container, type ServiceIdentifier } from 'inversify'
import { type Client } from 'discord.js'
import { type LifecycleUnit } from '@src/core/lifecycle-order.js'
import { storeOperationsSettled } from '@src/core/cooldown-runner.js'
import { type OnReady, type OnShutdown, type ReadyInfo } from '@src/interface/index.js'
import { RunningCalls } from '@src/core/running-calls.js'

/** A unit whose `onReady` stage was reached, so its `onShutdown` runs when the app closes. */
export interface LifecycleEntry {
  name: string
  instance: Partial<OnReady & OnShutdown>
  /** The unit's token, and the tokens it injects. */
  token: unknown
  dependencies: readonly unknown[]
  /** The app's cooldown store, which shuts down, with what it injects, after the last call. */
  cooldownStore?: boolean
}

/** The entry of a unit whose instance is `instance`. */
export function lifecycleEntry(unit: LifecycleUnit, instance: Partial<OnReady & OnShutdown>): LifecycleEntry {
  return {
    name: unit.name,
    instance,
    token: unit.token,
    dependencies: unit.dependencies,
    ...(unit.cooldownStore && { cooldownStore: true }),
  }
}

/** What the ready hooks report as they run; the app logs each, a testing module collects the failures. */
export interface ReadyHooksReport {
  /** The unit could not be resolved, so its hooks do not run. */
  resolveFailed(unit: LifecycleUnit, error: unknown): void
  /** The unit's `onReady` threw or rejected. */
  hookFailed(unit: LifecycleUnit, error: unknown): void
  /** The unit's `onReady` is about to run although units it depends on failed. */
  dependsOnFailed?(unit: LifecycleUnit, failed: readonly LifecycleUnit[]): void
  /** The unit's `onReady` has run for `slowAfterMs`. */
  slow?(unit: LifecycleUnit): void
}

/** How the ready hooks run. */
export interface ReadyHooksOptions {
  /** Whether shutdown has begun, after which no further hook starts. */
  stopped?: () => boolean
  /** How long a hook runs before `report.slow` is called. */
  slowAfterMs?: number
  /** Called as each unit is done: resolved and readied, or failed. */
  settled?: (unit: LifecycleUnit) => void
  /** Called as a unit's `onReady` starts. */
  starting?: (unit: LifecycleUnit) => void
}

/**
 * The ready hooks' pass, which shutdown waits for before it reads which units to shut down, so a unit whose `onReady`
 * finishes meanwhile is shut down too. A pass that asks the app to stop, from an `onReady`, is not waited for.
 */
export class ReadyPass {
  private readonly passes = new RunningCalls()
  /** The unit whose `onReady` the pass runs. */
  private unit?: string

  /** Runs `pass`, the ready hooks, as the pass shutdown waits for. */
  run<T>(pass: () => Promise<T>): Promise<T> {
    return this.passes.run('onReady', pass)
  }

  /** Records the unit whose `onReady` starts, for {@link ReadyPass.running}. */
  readonly starting = (unit: LifecycleUnit): void => {
    this.unit = unit.name
  }

  /** Excuses the pass this runs in, as an `onReady` that stops the app does. */
  excuseCurrent(): void {
    this.passes.excuseCurrent()
  }

  /** Settles once the pass has, unless excused. */
  settled(): Promise<void> {
    return this.passes.settled()
  }

  /** The unit whose `onReady` a wait would still wait for, if any. */
  running(): string[] {
    return this.passes.running().length > 0 ? [this.unit ?? 'a unit'] : []
  }
}

/**
 * Resolves each unit and runs its `onReady` one at a time, in the units' dependency order. A failure is
 * reported and the next unit still runs. Each unit whose `onReady` settled, or that has none, is pushed
 * to `entries` as it finishes, so a shutdown that starts meanwhile closes exactly those.
 */
export async function runReadyHooks(
  container: Container,
  units: readonly LifecycleUnit[],
  client: Client<true>,
  info: ReadyInfo,
  entries: LifecycleEntry[],
  report: ReadyHooksReport,
  { stopped = () => false, slowAfterMs, settled, starting }: ReadyHooksOptions = {},
): Promise<void> {
  const failed = new Set<unknown>()
  // For each unit, the failed units it depends on, directly or through another dependency
  const failedUpstream = new Map<unknown, Set<LifecycleUnit>>()
  const byToken = new Map(units.map(unit => [unit.token, unit]))
  // The token each instance was first reached by: one instance two tokens reach, an alias or one value provided twice,
  // runs its hooks once
  const firstToken = new Map<object, unknown>()

  for (const unit of units) {
    if (stopped()) break
    const upstream = new Set<LifecycleUnit>()
    for (const dependency of unit.dependencies) {
      if (failed.has(dependency)) upstream.add(byToken.get(dependency)!)
      failedUpstream.get(dependency)?.forEach(failedUnit => upstream.add(failedUnit))
    }
    failedUpstream.set(unit.token, upstream)

    let instance: Partial<OnReady & OnShutdown>
    try {
      // A provided value may be anything, null included; only an object can carry hooks
      instance = (container.get(unit.token as ServiceIdentifier) as Partial<OnReady & OnShutdown> | null) ?? {}
    } catch (error) {
      failed.add(unit.token)
      report.resolveFailed(unit, error)
      settled?.(unit)
      continue
    }
    const first = firstToken.get(instance)
    if (first !== undefined) {
      // Failed or not as the token that ran its hooks did, for what depends on this one
      if (failed.has(first)) failed.add(unit.token)
      settled?.(unit)
      continue
    }
    firstToken.set(instance, unit.token)
    const entry = lifecycleEntry(unit, instance)
    // Only a unit whose onReady has settled, or that has none, is shut down: a stop mid-ready waits for the one still
    // starting, within its time, and skips those not reached yet
    if (typeof instance.onReady !== 'function') {
      entries.push(entry)
      settled?.(unit)
      continue
    }

    if (upstream.size > 0) report.dependsOnFailed?.(unit, [...upstream])
    starting?.(unit)

    const slow = slowAfterMs !== undefined && report.slow ? setTimeout(() => report.slow!(unit), slowAfterMs) : undefined
    try {
      await instance.onReady(client, info)
    } catch (error) {
      failed.add(unit.token)
      report.hookFailed(unit, error)
    } finally {
      clearTimeout(slow)
    }
    entries.push(entry)
    settled?.(unit)
  }
}

/**
 * Runs the entries' `onShutdown` hooks one at a time, in reverse, so a unit stops before those it
 * depends on. A failure is reported and the next hook still runs. An instance already in `ran` is not shut down again,
 * so one that two entries reach stops once.
 */
export async function runShutdownHooks(
  entries: readonly LifecycleEntry[],
  hookFailed: (name: string, error: unknown) => void,
  ran = new Set<object>(),
): Promise<void> {
  for (const { name, instance } of [...entries].reverse()) {
    if (typeof instance.onShutdown !== 'function' || ran.has(instance)) continue
    ran.add(instance)
    try {
      await instance.onShutdown()
    } catch (error) {
      hookFailed(name, error)
    }
  }
}

/** How a shutdown sequence reaches the calls it outlasts and reports what happened; the bot and a testing module each give theirs. */
export interface ShutdownSequence {
  /** Lets no new call start, and settles once the calls under way have. */
  drainCalls(): Promise<void>
  /** Whether the calls drain before every shutdown, not only one whose cooldown store side has an `onShutdown`. */
  drainAlways?: boolean
  /** The calls still running, which the warning names when the drain stops before they settle. */
  runningCalls?(): readonly string[]
  /** The ready hooks' pass, waited for, within the drain's time, before the entries are read. */
  readyPass?: Pick<ReadyPass, 'settled' | 'running'>
  /** How long the whole sequence is waited for, the drain included. */
  timeoutMs: number
  /** A unit's `onShutdown` threw or rejected. */
  hookFailed(name: string, error: unknown): void
  /** The drain or the hooks outlasted their time; shutdown goes on without them. */
  warn(message: string): void
}

/** The part of `timeoutMs` the drain leaves for the hooks: a quarter, at least 1 s, and never more than half. */
export function hooksReserveMs(timeoutMs: number): number {
  return Math.min(Math.max(timeoutMs / 4, 1_000), timeoutMs / 2)
}

/** A timer whose promise resolves with `value` after `ms`, and `cancel` to clear it. */
function after<T>(ms: number, value: T): { promise: Promise<T>; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined
  const promise = new Promise<T>(resolve => {
    timer = setTimeout(() => resolve(value), ms)
  })
  return { promise, cancel: () => clearTimeout(timer) }
}

/**
 * Shuts down the entries there are once an `onReady` in progress has settled, as a bot and a testing module both do.
 * The calls under way finish first, on every shutdown with `drainAlways`, and otherwise when the cooldown store, or
 * anything it injects directly or through another, has an `onShutdown`; then the store operations they started, so the
 * store's last writes and releases still reach it. The other hooks then run in reverse dependency order, and the store
 * and what it injects last.
 *
 * The whole sequence is waited for at most `timeoutMs`. The wait for the `onReady` and the drain stop early enough to
 * leave the hooks {@link hooksReserveMs}, with a warning naming what still runs, and the hooks run in the time left.
 */
export async function runShutdownSequence(
  container: Container,
  readEntries: () => readonly LifecycleEntry[],
  { drainCalls, drainAlways = false, runningCalls, readyPass, timeoutMs, hookFailed, warn }: ShutdownSequence,
): Promise<void> {
  const whole = after(timeoutMs, 'timeout' as const)
  const reserve = hooksReserveMs(timeoutMs)
  const drainEnds = after(timeoutMs - reserve, false)
  // At once on a shutdown that always drains, so no call starts while an onReady finishes
  let draining = drainAlways ? drainCalls().then(() => true) : undefined
  try {
    const readying = readyPass?.running() ?? []
    if (readying.length > 0 && !(await Promise.race([readyPass!.settled().then(() => true), drainEnds.promise]))) {
      warn(`onReady in ${readying.join(', ')} is still running after ${timeoutMs - reserve} ms; shutting down without waiting for it.`)
    }

    // Read once the onReady in progress has settled, so its unit is among them
    const entries = [...readEntries()]
    const byToken = new Map(entries.map(entry => [entry.token, entry]))
    // The store and everything it reaches through what it injects
    const storeSide = new Set<LifecycleEntry>()
    const reach = (entry: LifecycleEntry | undefined) => {
      if (!entry || storeSide.has(entry)) return
      storeSide.add(entry)
      for (const dependency of entry.dependencies) reach(byToken.get(dependency))
    }
    for (const entry of entries) if (entry.cooldownStore) reach(entry)
    const needsStore = [...storeSide].some(entry => typeof entry.instance.onShutdown === 'function')

    let drained = true
    if (needsStore) draining ??= drainCalls().then(() => true)
    if (draining) {
      drained = await Promise.race([draining, drainEnds.promise])
      if (!drained) {
        const running = runningCalls?.() ?? []
        warn(
          `Calls still running after ${timeoutMs - reserve} ms${running.length > 0 ? `: ${running.join(', ')}` : ''}; ` +
            `running the onShutdown hooks in the ${reserve} ms left.`,
        )
      }
    }
    drainEnds.cancel()

    const sequence = (async () => {
      // Only after the calls settled: a call still running may never let its store operations settle
      if (needsStore && drained) await storeOperationsSettled(container)
      // Nothing on the store's side injects anything outside it, so running it last keeps the reverse dependency order
      const ran = new Set<object>()
      await runShutdownHooks(entries.filter(entry => !storeSide.has(entry)), hookFailed, ran)
      await runShutdownHooks(entries.filter(entry => storeSide.has(entry)), hookFailed, ran)
    })()
    if ((await Promise.race([sequence, whole.promise])) === 'timeout') {
      warn(`onShutdown hooks did not finish within ${timeoutMs} ms; shutting down anyway.`)
    }
  } finally {
    drainEnds.cancel()
    whole.cancel()
  }
}

/** Settles once every promise in `calls` has, those added while waiting included. */
export async function callsSettled(calls: ReadonlySet<Promise<unknown>>): Promise<void> {
  while (calls.size > 0) await Promise.allSettled([...calls])
}
