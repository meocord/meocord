import path from 'path'
import { existsSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'fs'
import { hostname, tmpdir } from 'os'
import { createRequire } from 'module'
import { parseJsonc } from '@src/util/json.util.js'
import { projectPaths } from '@src/util/tsconfig-paths.util.js'

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

/**
 * Where a process id means this process's: the host name, and on Linux the PID namespace too, since two containers
 * can share a host name and a temp directory while each numbers its processes on its own.
 */
function thisHost(): string {
  const host = hostname().replace(/[^A-Za-z0-9.]/g, '_').slice(0, 64) || '_'
  try {
    const namespace = /\[(\d+)\]/.exec(readlinkSync('/proc/self/ns/pid'))?.[1]
    return namespace ? `${host}_${namespace}` : host
  } catch {
    return host
  }
}

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
 * Writes a copy of the project's tsconfig.json for the bundler and returns its path: comments and trailing commas
 * removed, paths made absolute (`paths` as {@link projectPaths} reads them), `noEmit` dropped. One file per call in this
 * process's directory, removed at exit; the project's file is never written.
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
  // `${configDir}` is the project, which the copy's own directory would otherwise stand for
  for (const key of ['include', 'exclude', 'files']) {
    if (Array.isArray(parsedConfig?.[key])) {
      parsedConfig[key] = parsedConfig[key].map((p: string) => path.resolve(cwd, p.replaceAll('${configDir}', cwd)))
    }
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

    // Remove `noEmit` option if it exists
    if ('noEmit' in parsedConfig.compilerOptions) {
      delete parsedConfig.compilerOptions.noEmit
    }
  }

  // The paths as tsc reads them, inherited ones included, written absolute so the copy in the temp directory keeps them
  const paths = projectPaths(cwd)
  if (paths) (parsedConfig.compilerOptions ??= {}).paths = paths

  const tempTsConfigPath = path.join(copiesDirectory(), `modified-tsconfig-${++copies}.json`)
  writeFileSync(tempTsConfigPath, JSON.stringify(parsedConfig, null, 2))
  return tempTsConfigPath
}
