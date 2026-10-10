import { existsSync, readFileSync } from 'fs'
import path from 'path'
import { parseJsonc } from '@src/util/json.util.js'
import { projectTypeScript } from '@src/util/project-typescript.util.js'

type Paths = Record<string, string[]>

/**
 * The project's tsconfig `paths`, each target an absolute path, as `tsc` reads them: through `extends`, from `baseUrl`,
 * and with `${configDir}`. Read with the project's own `typescript`; without one (`null`), from its tsconfig.json
 * alone. Undefined when there are none.
 */
export function projectPaths(cwd = process.cwd(), ts: typeof import('typescript') | null = projectTypeScript(cwd) ?? null): Paths | undefined {
  const configPath = path.join(cwd, 'tsconfig.json')
  if (!existsSync(configPath)) return undefined
  const { paths, base } = (ts && parsedPaths(ts, configPath)) || ownPaths(configPath, cwd)
  if (!paths) return undefined
  return Object.fromEntries(
    Object.entries(paths).map(([alias, targets]) => [alias, targets.map(target => path.resolve(base, target.replaceAll('${configDir}', cwd)))]),
  )
}

/** The paths TypeScript's own parse gives, and what they are relative to, or undefined when it cannot read the file. */
function parsedPaths(ts: typeof import('typescript'), configPath: string): { paths?: Paths; base: string } | undefined {
  let unreadable = false
  const host = { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => void (unreadable = true) }
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, host)
  if (!parsed || unreadable) return undefined
  // Without baseUrl, TypeScript reads paths from the file that declares them, which it records as pathsBasePath
  const { paths, baseUrl, pathsBasePath } = parsed.options as typeof parsed.options & { pathsBasePath?: string }
  return { paths, base: baseUrl ?? pathsBasePath ?? path.dirname(configPath) }
}

/** The paths the project's tsconfig.json declares itself, relative to its own baseUrl, else to the project. */
function ownPaths(configPath: string, cwd: string): { paths?: Paths; base: string } {
  const options = parseJsonc(readFileSync(configPath, 'utf-8'))?.compilerOptions ?? {}
  return { paths: options.paths, base: options.baseUrl ? path.resolve(cwd, options.baseUrl) : cwd }
}
