import { existsSync } from 'fs'
import path from 'path'
import { createPathsMatcher, parseTsconfig } from 'get-tsconfig'

type Paths = Record<string, string[]>

// Stands in for a pattern's `*` while its targets are worked out, then is put back
const STAR = '__meocord_paths_star__'

/**
 * The project's tsconfig `paths`, each target an absolute path, as `tsc` reads them: through `extends`, from `baseUrl`,
 * and with `${configDir}`. Read with get-tsconfig, whatever TypeScript the project installed. Undefined when there are
 * none.
 */
export function projectPaths(cwd = process.cwd()): Paths | undefined {
  const configPath = path.join(cwd, 'tsconfig.json')
  if (!existsSync(configPath)) return undefined
  const tsconfig = { path: configPath, config: parseTsconfig(configPath) }
  const paths = tsconfig.config.compilerOptions?.paths
  // The matcher resolves each target from the file that declares it, or from baseUrl, as tsc does
  const match = createPathsMatcher(tsconfig)
  if (!paths || !match) return undefined
  // Resolved, so each is the platform's own absolute path: get-tsconfig writes Windows paths with forward slashes
  return Object.fromEntries(
    Object.keys(paths).map(alias => [alias, match(alias.replace('*', STAR)).map(target => path.resolve(target).replace(STAR, '*'))]),
  )
}
