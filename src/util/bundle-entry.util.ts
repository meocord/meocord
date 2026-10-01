import { existsSync, realpathSync } from 'node:fs'

/** Where the built bundle's pre-entry records the bundle's own path. */
export const BUNDLE_ENTRY_KEY = Symbol.for('meocord.bundleEntry')

/**
 * The file a shard process runs: the built bundle, as its pre-entry recorded it, else the script this
 * process was started with; undefined when there is none, as for `node -e "import('./dist/main.js')"`.
 */
export function bundleEntry(): string | undefined {
  const recorded = (globalThis as Record<symbol, unknown>)[BUNDLE_ENTRY_KEY]
  // A development build fixes import.meta.url at build time, so there it names the pre-entry's source
  if (typeof recorded === 'string' && !recorded.endsWith('load-config.pre-entry.js')) return recorded
  const started = process.argv[1]
  return started && existsSync(started) ? realpathSync(started) : undefined
}

/** Whether this process runs a built application, whose pre-entry records the bundle. */
export function isBuiltApplication(): boolean {
  return typeof (globalThis as Record<symbol, unknown>)[BUNDLE_ENTRY_KEY] === 'string'
}
