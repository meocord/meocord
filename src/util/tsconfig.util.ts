import path from 'path'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { hostname, tmpdir } from 'os'
import { createRequire } from 'module'
import { parseJsonc } from '@src/util/json.util.js'

/**
 * An `extends` made to work from another directory: a relative path made absolute, and a package
 * resolved from the project's `node_modules`, or kept as it is when it cannot be found there.
 */
function resolveExtends(value: string | string[], cwd: string): string | string[] {
  const projectRequire = createRequire(path.join(cwd, 'tsconfig.json'))
  const resolve = (entry: string) => {
    if (entry.startsWith('.') || path.isAbsolute(entry)) return path.resolve(cwd, entry)
    try {
      return projectRequire.resolve(entry)
    } catch {
      return entry
    }
  }
  return Array.isArray(value) ? value.map(resolve) : resolve(value)
}

// The directory this process writes its copies in, and how many it has written there
let copiesDir: string | undefined
let copies = 0

// A copies directory is named `meocord-tsconfig-<host>-<pid>-<random>`, for the process that made it. The host is
// cut short, as a full domain name would take the name past what a file system allows.
const COPIES_DIR = /^meocord-tsconfig-([^-]+)-(\d+)-/
const thisHost = () => hostname().replace(/[^A-Za-z0-9.]/g, '_').slice(0, 64) || '_'

// Only "no such process" is dead: a process another user owns refuses the signal with EPERM, and is alive
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

/**
 * Removes the copies directories of this host's processes that have ended without removing their own, as one killed
 * or crashed does before its exit hook runs. Another host's directory, in a temp directory machines or containers
 * share, is left alone: its process can't be checked from here.
 */
function removeAbandonedCopies(tempDir: string, host: string): void {
  let entries: string[]
  try {
    entries = readdirSync(tempDir)
  } catch {
    return
  }
  for (const entry of entries) {
    const owner = COPIES_DIR.exec(entry)
    if (!owner || owner[1] !== host || isRunning(Number(owner[2]))) continue
    try {
      rmSync(path.join(tempDir, entry), { recursive: true, force: true })
    } catch {
      // Another user's, which this process may not remove
    }
  }
}

/**
 * The directory this process writes its tsconfig copies in: one for the process, removed as it exits, so a watch
 * session that copies the file on every reload leaves one directory and one exit hook, not one per copy. Another
 * process, such as a second build at once, has a directory of its own. Making it first removes any left by a process
 * that never reached its exit hook.
 */
function copiesDirectory(): string {
  if (copiesDir) return copiesDir
  const host = thisHost()
  removeAbandonedCopies(tmpdir(), host)
  const dir = mkdtempSync(path.join(tmpdir(), `meocord-tsconfig-${host}-${process.pid}-`))
  process.once('exit', () => rmSync(dir, { recursive: true, force: true }))
  copiesDir = dir
  return dir
}

/**
 * Writes a copy of the project's `tsconfig.json` for the bundler to a temporary file, with comments
 * and trailing commas removed, paths made absolute as TypeScript reads them (a `paths` target from
 * `baseUrl` when there is one) and `noEmit` removed. The project's file is never changed. Each call
 * gets a file of its own in this process's directory, removed when the process exits, so builds
 * running at once never share or overwrite the file.
 * @returns The absolute path to the temporary tsconfig.
 * @throws When `tsconfig.json` is missing or cannot be parsed.
 */
export function prepareModifiedTsConfig(): string {
  const tsConfigPath = path.resolve(process.cwd(), 'tsconfig.json')

  // Ensure tsconfig.json exists
  if (!existsSync(tsConfigPath)) {
    throw new Error(`tsconfig.json not found in: ${process.cwd()}`)
  }

  const tsConfigContent = readFileSync(tsConfigPath, 'utf-8')

  let parsedConfig: any
  try {
    // TypeScript allows comments and trailing commas; the project's file itself is only read, never written
    parsedConfig = parseJsonc(tsConfigContent)
  } catch (error) {
    throw new Error(
      `Could not parse tsconfig.json in ${process.cwd()}: ${error instanceof Error ? error.message : String(error)}. ` +
        `Fix the JSON, then build again.`,
    )
  }

  // The copy lives in the temp directory, so every path in it is made absolute from the project
  const cwd = process.cwd()
  if (parsedConfig?.extends) parsedConfig.extends = resolveExtends(parsedConfig.extends, cwd)
  for (const key of ['include', 'exclude', 'files']) {
    if (Array.isArray(parsedConfig?.[key])) parsedConfig[key] = parsedConfig[key].map((p: string) => path.resolve(cwd, p))
  }

  // Process compilerOptions
  if (parsedConfig?.compilerOptions) {
    const pathOptions = ['outDir', 'rootDir', 'baseUrl', 'tsBuildInfoFile']

    // Convert relative paths to absolute paths in `compilerOptions`
    pathOptions.forEach(option => {
      if (parsedConfig.compilerOptions[option]) {
        parsedConfig.compilerOptions[option] = path.resolve(process.cwd(), parsedConfig.compilerOptions[option])
      }
    })

    if (Array.isArray(parsedConfig.compilerOptions.typeRoots)) {
      parsedConfig.compilerOptions.typeRoots = parsedConfig.compilerOptions.typeRoots.map((p: string) => path.resolve(cwd, p))
    }

    // A `paths` target is relative to baseUrl when there is one, made absolute above, and else to the project
    if (parsedConfig.compilerOptions.paths) {
      const base: string = parsedConfig.compilerOptions.baseUrl ?? cwd
      Object.keys(parsedConfig.compilerOptions.paths).forEach(alias => {
        parsedConfig.compilerOptions.paths[alias] = parsedConfig.compilerOptions.paths[alias].map((p: string) =>
          path.resolve(base, p),
        )
      })
    }

    // Remove `noEmit` option if it exists
    if ('noEmit' in parsedConfig.compilerOptions) {
      delete parsedConfig.compilerOptions.noEmit
    }
  }

  const tempTsConfigPath = path.join(copiesDirectory(), `modified-tsconfig-${++copies}.json`)
  writeFileSync(tempTsConfigPath, JSON.stringify(parsedConfig, null, 2))
  return tempTsConfigPath
}
