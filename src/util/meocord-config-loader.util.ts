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
    problem = { path: compiledPath, missing: false, error }
    // The factory refuses with this too, but the CLI falls back to meocord.config.ts and would otherwise say nothing
    console.error(`[MeoCord] Failed to load ${compiledPath}: ${error instanceof Error ? error.message : error}`)
    return undefined
  }
}
