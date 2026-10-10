import path from 'path'
import { existsSync } from 'fs'
import { createJiti } from 'jiti'
import { type MeoCordConfig } from '@src/interface/index.js'
import { comparablePath, framePath } from '@src/util/source-path.util.js'
import { projectPaths } from '@src/util/tsconfig-paths.util.js'

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
    // Each alias to its first target, as the build reads the same paths
    const aliases = Object.fromEntries(
      Object.entries(projectPaths() ?? {}).map(([alias, [target]]) => [alias.replace(/\/\*$/, ''), target.replace(/\/\*$/, '')]),
    )

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
  // A module that exports nothing, as an empty file, is an empty config, whose values come from the environment
  const names = Object.keys(module)
  if (names.length === 0) return { config: {} as MeoCordConfig }
  return { error: `it must export an object as its default export, and exports only ${names.join(', ')}` }
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

// A stack frame's location, `file:line:column`, alone or in parentheses after the function: a path or a file:// URL
const FRAME_LOCATION = /\(?((?:file:\/\/)?(?:\/?[A-Za-z]:)?[\\/][^()]+?):(\d+):(\d+)\)?$/

/**
 * The first stack frame in a file of the project's own, as `file:line:column` from the project. On Windows a frame's
 * file can be a file:// URL, or written with forward slashes or a lower-case drive, so each is compared as a path.
 */
export function projectFrame(stack: string | undefined, root: string, windows = process.platform === 'win32'): string | undefined {
  const paths = windows ? path.win32 : path.posix
  const base = comparablePath(paths.join(paths.resolve(root), paths.sep), windows)
  for (const line of stack?.split('\n').slice(1) ?? []) {
    const frame = FRAME_LOCATION.exec(line.trim())
    if (!frame) continue
    const [, location, row, column] = frame
    const file = paths.resolve(framePath(location, windows))
    if (!comparablePath(file, windows).startsWith(base) || file.split(paths.sep).includes('node_modules')) continue
    return `${paths.relative(root, file).split(paths.sep).join('/')}:${row}:${column}`
  }
  return undefined
}
