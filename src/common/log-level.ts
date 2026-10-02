import { loadMeoCordConfig } from '@src/util/meocord-config-loader.util.js'
import { isBuiltApplication } from '@src/util/bundle-entry.util.js'
import { type MeoCordConfig } from '@src/interface/index.js'

/** A `logLevel`: the least severe line `Logger` prints. */
export type LogLevel = NonNullable<MeoCordConfig['logLevel']>

/** The environment variable that sets the level for one run, over `logLevel` in meocord.config.ts. */
export const LOG_LEVEL_ENV = 'MEOCORD_LOG_LEVEL'

/** Each level's rank: a line prints when its rank is at least the level's. `silent` outranks every line. */
export const LOG_LEVEL_RANK: Readonly<Record<LogLevel, number>> = { debug: 0, log: 1, warn: 2, error: 3, silent: 4 }

const isLogLevel = (value: unknown): value is LogLevel => typeof value === 'string' && Object.hasOwn(LOG_LEVEL_RANK, value)

let threshold: number | undefined
let rejectedEnv: string | undefined

/**
 * The rank a line needs to print. Resolved on first use and kept, so logging reads neither the
 * environment nor the config again: `MEOCORD_LOG_LEVEL`, then `logLevel`, then `debug` in development
 * and `log` otherwise. `logLevel` applies to the built bot only; the CLI and tests would otherwise read
 * it from whatever `dist` a previous build left.
 */
export function logThreshold(): number {
  if (threshold === undefined) {
    // The config first: loading it runs its dotenv call, which may set the variable
    const configured = isBuiltApplication() ? loadMeoCordConfig()?.logLevel : undefined
    const raw = process.env[LOG_LEVEL_ENV]
    // An environment variable is often written in capitals, DEBUG for debug
    const fromEnv = raw?.toLowerCase()
    rejectedEnv = raw && !isLogLevel(fromEnv) ? raw : undefined
    const level = isLogLevel(fromEnv) ? fromEnv : isLogLevel(configured) ? configured : process.env.NODE_ENV === 'development' ? 'debug' : 'log'
    threshold = LOG_LEVEL_RANK[level]
  }
  return threshold
}

/**
 * An unknown `MEOCORD_LOG_LEVEL` the last resolution ignored, handed out once so the logger can warn
 * about it; undefined afterwards.
 */
export function takeRejectedLogLevel(): string | undefined {
  const rejected = rejectedEnv
  rejectedEnv = undefined
  return rejected
}

/** Forgets the resolved level, so the next line resolves it again: for specs that change the environment. */
export function resetLogLevel(): void {
  threshold = undefined
  rejectedEnv = undefined
}
