import { type Container, type ServiceIdentifier } from 'inversify'
import { type Client } from 'discord.js'
import { type LifecycleUnit } from '@src/core/lifecycle-order.js'
import { type OnReady, type OnShutdown, type ReadyInfo } from '@src/interface/index.js'

/** A unit whose `onReady` stage was reached, so its `onShutdown` runs when the app closes. */
export interface LifecycleEntry {
  name: string
  instance: Partial<OnReady & OnShutdown>
  /** The app's cooldown store, which shuts down after the last call. */
  cooldownStore?: boolean
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
  { stopped = () => false, slowAfterMs, settled }: ReadyHooksOptions = {},
): Promise<void> {
  const failed = new Set<unknown>()
  // For each unit, the failed units it depends on, directly or through another dependency
  const failedUpstream = new Map<unknown, Set<LifecycleUnit>>()
  const byToken = new Map(units.map(unit => [unit.token, unit]))

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
    const entry: LifecycleEntry = { name: unit.name, instance, ...(unit.cooldownStore && { cooldownStore: true }) }
    // Only a unit whose onReady has settled, or that has none, is shut down: a stop mid-ready skips
    // the one still starting, and those not reached yet
    if (typeof instance.onReady !== 'function') {
      entries.push(entry)
      settled?.(unit)
      continue
    }

    if (upstream.size > 0) report.dependsOnFailed?.(unit, [...upstream])

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
 * depends on. A failure is reported and the next hook still runs.
 */
export async function runShutdownHooks(entries: readonly LifecycleEntry[], hookFailed: (name: string, error: unknown) => void): Promise<void> {
  for (const { name, instance } of [...entries].reverse()) {
    if (typeof instance.onShutdown !== 'function') continue
    try {
      await instance.onShutdown()
    } catch (error) {
      hookFailed(name, error)
    }
  }
}
