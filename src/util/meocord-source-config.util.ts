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

    const jiti = createJiti(import.meta.url, {
      interopDefault: true,
      alias: aliases,
      moduleCache: false,
    })

    return { config: jiti(configPath) as MeoCordConfig }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}
