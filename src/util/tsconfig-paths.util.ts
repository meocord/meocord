import { existsSync } from 'fs'
import path from 'path'
import { createPathsMatcher, parseTsconfig, type TsConfigJsonResolved } from 'get-tsconfig'

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
  return absolutePaths(configPath, parseTsconfig(configPath))
}

/** A parsed tsconfig's `paths`, each target absolute, as {@link projectPaths} gives them. */
function absolutePaths(configPath: string, config: TsConfigJsonResolved): Paths | undefined {
  const paths = config.compilerOptions?.paths
  // The matcher resolves each target from the file that declares it, or from baseUrl, as tsc does
  const match = createPathsMatcher({ path: configPath, config })
  if (!paths || !match) return undefined
  // Resolved, so each is the platform's own absolute path: get-tsconfig writes Windows paths with forward slashes
  return Object.fromEntries(
    Object.keys(paths).map(alias => [alias, match(alias.replace('*', STAR)).map(target => path.resolve(target).replace(STAR, '*'))]),
  )
}

/** The top-level lists of files and globs. */
const FILE_LISTS = ['include', 'exclude', 'files'] as const

/** What {@link resolutionTsconfig} gives: the parts of a tsconfig the bundler resolves modules with, each path absolute. */
export interface ResolutionTsconfig {
  compilerOptions: { baseUrl?: string; paths?: Paths }
  include?: string[]
  exclude?: string[]
  files?: string[]
}

/**
 * The project's tsconfig as the bundler resolves modules with it, written as one file with no `extends`: `baseUrl`
 * and `paths` as `tsc` reads them through `extends` (`paths` as {@link projectPaths} gives them), and `include`,
 * `exclude` and `files`, each absolute, from the file that declares it and with `${configDir}` as the project. Rspack's
 * resolver reads no other compiler option, so no other is written: one inferred by a TypeScript other than the
 * project's can't reach the copy. Undefined when there is no tsconfig.json.
 */
export function resolutionTsconfig(cwd = process.cwd()): ResolutionTsconfig | undefined {
  const configPath = path.join(cwd, 'tsconfig.json')
  if (!existsSync(configPath)) return undefined
  const resolved = parseTsconfig(configPath)
  const absolute = (entry: unknown) => path.resolve(cwd, String(entry))
  const tsconfig: ResolutionTsconfig = { compilerOptions: {} }
  const baseUrl = resolved.compilerOptions?.baseUrl
  if (typeof baseUrl === 'string') tsconfig.compilerOptions.baseUrl = absolute(baseUrl)
  const paths = absolutePaths(configPath, resolved)
  if (paths) tsconfig.compilerOptions.paths = paths
  for (const key of FILE_LISTS) {
    const value = resolved[key]
    if (Array.isArray(value)) tsconfig[key] = value.map(absolute)
  }
  return tsconfig
}
