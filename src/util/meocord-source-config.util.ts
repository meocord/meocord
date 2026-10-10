import path from 'path'
import { existsSync, readFileSync } from 'fs'
import { createJiti } from 'jiti'
import { type MeoCordConfig } from '@src/interface/index.js'
import { parseJsonc } from '@src/util/json.util.js'

/**
 * Loads `meocord.config.ts` from source on every call, so a build always uses the current config
 * rather than the previous build's compiled copy. CLI-only, since it needs jiti to run TypeScript.
 */
export function loadMeoCordSourceConfig(): MeoCordConfig | undefined {
  const result = readMeoCordSourceConfig()
  if ('error' in result) {
    console.error(`[MeoCord] Failed to load config: ${result.error}`)
    return undefined
  }
  return result.config
}

/**
 * Loads `meocord.config.ts` from source, reporting a failure instead of logging it, for the CLI to stop
 * on. jiti's message names the file, line and column of a syntax error.
 *
 * @returns The config (undefined when the file does not exist), or the reason it could not be loaded.
 */
export function readMeoCordSourceConfig(): { config: MeoCordConfig | undefined } | { error: string } {
  const configPath = path.resolve(process.cwd(), 'meocord.config.ts')
  if (!existsSync(configPath)) return { config: undefined }

  try {
    const tsConfigPath = path.resolve(process.cwd(), 'tsconfig.json')
    const aliases: Record<string, string> = {}

    if (existsSync(tsConfigPath)) {
      const tsConfig = parseJsonc(readFileSync(tsConfigPath, 'utf-8'))
      const paths = tsConfig?.compilerOptions?.paths

      if (paths) {
        for (const [key, values] of Object.entries(paths)) {
          const aliasKey = key.replace('/*', '')
          aliases[aliasKey] = path.resolve(process.cwd(), (values as string[])[0].replace('/*', ''))
        }
      }
    }

    // The module as written, so an ES module with no default export is told apart from a CommonJS one
    const jiti = createJiti(import.meta.url, {
      interopDefault: false,
      alias: aliases,
      moduleCache: false,
    })

    return configOf(jiti(configPath))
  } catch (error) {
    return { error: loadError(error, process.cwd()) }
  }
}

/**
 * The config a loaded module gives: an ES module's default export, or what a CommonJS module assigns to
 * `module.exports`. An ES module with no default export has none.
 */
function configOf(loaded: unknown): { config: MeoCordConfig } | { error: string } {
  const module = loaded as Record<string, unknown> | null
  if (module?.__esModule !== true) return { config: loaded as MeoCordConfig }
  if ('default' in module) return { config: module.default as MeoCordConfig }
  const names = Object.keys(module)
  return { error: `it must export an object as its default export${names.length > 0 ? `, and exports only ${names.join(', ')}` : ''}` }
}

/**
 * Why the config failed to load, with the first place in the project it failed at when the message does not name one,
 * as for an error the config throws: jiti's message names the file, line and column of a syntax error.
 */
function loadError(error: unknown, root: string): string {
  const message = error instanceof Error ? error.message : String(error)
  const frame = error instanceof Error ? projectFrame(error.stack, root) : undefined
  return frame && !message.includes(frame) ? `${message}\n    at ${frame}` : message
}

/** The first stack frame in a file of the project's own, as `file:line:column` from the project. */
function projectFrame(stack: string | undefined, root: string): string | undefined {
  for (const line of stack?.split('\n').slice(1) ?? []) {
    const file = /\(?((?:[A-Za-z]:)?[\\/][^()]+?):(\d+):(\d+)\)?$/.exec(line.trim())
    if (!file) continue
    const [, location, row, column] = file
    if (!location.startsWith(root) || location.split(/[\\/]/).includes('node_modules')) continue
    return `${path.relative(root, location).split(path.sep).join('/')}:${row}:${column}`
  }
  return undefined
}
