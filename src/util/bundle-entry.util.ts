import { existsSync, realpathSync } from 'node:fs'

/** Where the built bundle's pre-entry records the bundle's own path. */
export const BUNDLE_ENTRY_KEY = Symbol.for('meocord.bundleEntry')

/** Where the built bundle's pre-entry records the mode the bundle was built in. */
export const BUILD_MODE_KEY = Symbol.for('meocord.buildMode')

/**
 * The file a shard process runs: the built bundle, as its pre-entry recorded it, else the script this
 * process was started with; undefined when there is none, as for code run with `node -e` outside a built bundle.
 */
export function bundleEntry(): string | undefined {
  const recorded = (globalThis as Record<symbol, unknown>)[BUNDLE_ENTRY_KEY]
  if (typeof recorded === 'string') return recorded
  const started = process.argv[1]
  return started && existsSync(started) ? realpathSync(started) : undefined
}

/** Whether this process runs a built application, whose pre-entry records the bundle. */
export function isBuiltApplication(): boolean {
  return typeof (globalThis as Record<symbol, unknown>)[BUNDLE_ENTRY_KEY] === 'string'
}

/** The mode the running bundle was built in, as its pre-entry recorded it; undefined outside a built application. */
export function buildMode(): string | undefined {
  const recorded = (globalThis as Record<symbol, unknown>)[BUILD_MODE_KEY]
  return typeof recorded === 'string' ? recorded : undefined
}
