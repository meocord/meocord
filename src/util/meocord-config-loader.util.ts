import path from 'path'
import { existsSync } from 'fs'
import { createRequire } from 'module'
import { type MeoCordConfig } from '@src/interface/index.js'
import { bundleEntry, isBuiltApplication } from '@src/util/bundle-entry.util.js'

let cachedConfig: MeoCordConfig | undefined
let configLoaded = false

/** Why the compiled config was not loaded: no file at the path, or one that failed to load. */
export type CompiledConfigProblem = { path: string } & ({ missing: true } | { missing: false; error: unknown })

let problem: CompiledConfigProblem | undefined

/**
 * Where the compiled config is: beside the built bundle in a built bot, however it was started, so a process manager
 * or a unit file without a working directory finds it; else `dist` under the working directory, as the CLI and tests
 * run.
 */
export function compiledConfigPath(): string {
  const entry = isBuiltApplication() ? bundleEntry() : undefined
  return entry ? path.join(path.dirname(entry), 'meocord.config.mjs') : path.resolve(process.cwd(), 'dist', 'meocord.config.mjs')
}

/**
 * Loads the configuration a built application runs with, `meocord.config.mjs`, and caches it.
 * Imports no transpiler, since the logger and the factory import this module into every bot.
 * @returns The configuration, or undefined when the compiled config is missing or fails to load;
 *   {@link compiledConfigProblem} then says which.
 */
export function loadMeoCordConfig(): MeoCordConfig | undefined {
  if (configLoaded) return cachedConfig

  configLoaded = true
  cachedConfig = loadCompiledConfig()
  return cachedConfig
}

/** Why {@link loadMeoCordConfig} returned no config, or undefined when it loaded one or has not run. */
export function compiledConfigProblem(): CompiledConfigProblem | undefined {
  return problem
}

/**
 * Why {@link loadMeoCordConfig} returned no config, naming the file it looked for and, for a missing one, where it was
 * started from. `MeoCordFactory.create` refuses with it, and the CLI stops with it before starting a bot that would.
 */
export function compiledConfigMessage(): string {
  const problem = compiledConfigProblem()
  if (problem && !problem.missing) {
    // One full stop, whether or not the reason ends with one
    const reason = (problem.error instanceof Error ? problem.error.message : String(problem.error)).replace(/\.$/, '')
    const missing = missingPackage(problem.error)
    const fix = missing ? `Install ${missing} in the project` : 'Fix meocord.config.ts'
    return `MeoCord config at ${problem.path} failed to load: ${reason}. ${fix}, then run \`meocord build\`.`
  }
  const where = problem?.path ?? 'meocord.config.mjs'
  return `MeoCord config not found at ${where} (working directory ${process.cwd()}). Run \`meocord build\`, and start the bot from the dist it writes.`
}

/**
 * The package a module-not-found error names, when it is a package rather than a file: `dotenv` for `dotenv/config`,
 * `@scope/name` for `@scope/name/sub`. Undefined for any other error, and for a relative or absolute path.
 */
function missingPackage(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code
  if (code !== 'ERR_MODULE_NOT_FOUND' && code !== 'MODULE_NOT_FOUND') return undefined
  const specifier = /Cannot find (?:package|module) '([^']+)'/.exec((error as Error).message)?.[1]
  if (!specifier || /^(?:\.|\/|[A-Za-z]:|file:)/.test(specifier)) return undefined
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

/**
 * `require` of an ES module, which Node supports cleanly from 22.13 and bun always has.
 * Synchronous, like the logger and the factory that call it.
 */
function loadCompiledConfig(): MeoCordConfig | undefined {
  const compiledPath = compiledConfigPath()
  if (!existsSync(compiledPath)) {
    problem = { path: compiledPath, missing: true }
    return undefined
  }

  try {
    // Called through a variable so a bundler does not try to resolve the path while building the
    // application; the file is only there once the build is done.
    const load = createRequire(import.meta.url)
    const loaded = load(compiledPath) as { default?: MeoCordConfig } & MeoCordConfig
    return loaded.default ?? loaded
  } catch (error) {
    // Kept, not printed: MeoCordFactory.create refuses with it, and the CLI stops with it rather than fall back
    problem = { path: compiledPath, missing: false, error }
    return undefined
  }
}
