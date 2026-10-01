import { type CommandRegistrationConfig, type MeoCordConfig, type ShardingConfig } from '@src/interface/index.js'
import { timeoutProblem } from '@src/util/timer-limit.util.js'

/** What is wrong with a configuration: errors stop the command, warnings are only reported. */
export interface ConfigProblems {
  errors: string[]
  warnings: string[]
}

type Check = (value: unknown, key: string) => string | undefined

const describe = (value: unknown): string =>
  typeof value === 'string'
    ? `'${value}'`
    : typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : Array.isArray(value)
        ? 'an array'
        : value === null
          ? 'null'
          : typeof value

const optional =
  (check: Check): Check =>
  (value, key) =>
    value === undefined ? undefined : check(value, key)

const string: Check = (value, key) => (typeof value === 'string' ? undefined : `${key} must be a string (got ${describe(value)})`)
const boolean: Check = (value, key) => (typeof value === 'boolean' ? undefined : `${key} must be true or false (got ${describe(value)})`)
const func: Check = (value, key) => (typeof value === 'function' ? undefined : `${key} must be a function (got ${describe(value)})`)

const stringList =
  (what: string): Check =>
  (value, key) =>
    Array.isArray(value) && value.every(item => typeof item === 'string') ? undefined : `${key} must be an array of ${what} (got ${describe(value)})`

const oneOf =
  (...allowed: string[]): Check =>
  (value, key) =>
    allowed.includes(value as string)
      ? undefined
      : `${key} must be ${allowed.map(item => `'${item}'`).join(' or ')} (got ${describe(value)})`

/** An object with known keys; an unknown one is a warning, since it is most often a typo. */
function objectOf(shape: Record<string, Check>, problems: ConfigProblems): Check {
  return (value, key) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return `${key} must be an object (got ${describe(value)})`
    for (const [name, child] of Object.entries(value)) {
      const check = shape[name]
      if (!check) {
        problems.warnings.push(`${key}.${name} is not a MeoCord option, so it has no effect.`)
        continue
      }
      const error = check(child, `${key}.${name}`)
      if (error) problems.errors.push(error)
    }
    return undefined
  }
}

/** How each `commands` option is checked, typed so an option added to the interface needs a check here. */
const commandsShape: Record<keyof CommandRegistrationConfig, Check> = {
  // An unset environment variable leaves an id undefined; registration drops it and warns
  guilds: optional((value, key) =>
    Array.isArray(value) && value.every(item => item === undefined || typeof item === 'string')
      ? undefined
      : `${key} must be an array of guild ids (got ${describe(value)})`,
  ),
  developmentGuild: optional(string),
  register: optional(boolean),
  clearOther: optional(boolean),
}

/** How each `sharding` option is checked, typed as `commandsShape` is. */
const shardingShape: Record<keyof ShardingConfig, Check> = {
  mode: optional(oneOf('internal', 'process')),
  shards: optional((value, key) =>
    value === 'auto' || (typeof value === 'number' && Number.isInteger(value) && value > 0)
      ? undefined
      : `${key} must be 'auto' or a whole number of shards, 1 or more (got ${describe(value)})`,
  ),
  development: optional(boolean),
}

/**
 * The options `meocord.config.ts` may set, and how each is checked. Typed against `MeoCordConfig`, so a
 * new option cannot be added there without a check here.
 */
function configShape(problems: ConfigProblems): Record<keyof MeoCordConfig, Check> {
  return {
    appName: optional(string),
    discordToken: optional(string),
    bundleDependencies: optional(boolean),
    externals: optional((value, key) =>
      Array.isArray(value) && value.every(item => typeof item === 'string' || item instanceof RegExp)
        ? undefined
        : `${key} must be an array of package names or regular expressions (got ${describe(value)})`,
    ),
    optionalExternals: optional(stringList('package names')),
    rsbuild: optional(func),
    sourceMappedStacks: optional(boolean),
    shutdownTimeout: optional((value, key) => {
      const problem = timeoutProblem(value, { allowZero: true })
      return problem && `${key} ${problem}`
    }),
    logLevel: optional(oneOf('debug', 'log', 'warn', 'error', 'silent')),
    commands: optional(objectOf(commandsShape, problems)),
    sharding: optional(objectOf(shardingShape, problems)),
  }
}

/** The option names the validator checks, for the spec that keeps it in step with `MeoCordConfig`. */
export const CHECKED_CONFIG_KEYS: readonly string[] = Object.keys(configShape({ errors: [], warnings: [] }))

/** The `commands` option names the validator checks. */
export const CHECKED_COMMANDS_KEYS: readonly string[] = Object.keys(commandsShape)

/** The `sharding` option names the validator checks. */
export const CHECKED_SHARDING_KEYS: readonly string[] = Object.keys(shardingShape)

/**
 * Checks a loaded configuration's shape, so a wrong type fails at once with what to fix instead of
 * surfacing later as an odd build or runtime error.
 *
 * @returns Every error and warning found; the command should stop when there are errors.
 */
export function configProblems(config: unknown): ConfigProblems {
  const problems: ConfigProblems = { errors: [], warnings: [] }
  // jiti's interop proxy lists only `default` among its keys, while reading through to it.
  const loaded = (config as { default?: unknown } | null)?.default ?? config
  if (typeof loaded !== 'object' || loaded === null) {
    problems.errors.push(`it must export an object as its default export (got ${describe(loaded)})`)
    return problems
  }

  const shape = configShape(problems)
  for (const [name, value] of Object.entries(loaded)) {
    const check = shape[name as keyof MeoCordConfig]
    if (!check) {
      problems.warnings.push(`${name} is not a MeoCord option, so it has no effect.`)
      continue
    }
    const error = check(value, name)
    if (error) problems.errors.push(error)
  }
  return problems
}
