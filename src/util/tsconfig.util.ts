import path from 'path'
import { existsSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'fs'
import { hostname, tmpdir } from 'os'
import { parseJsonc } from '@src/util/json.util.js'
import { resolutionTsconfig } from '@src/util/tsconfig-paths.util.js'

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
 * Writes a copy of the project's tsconfig.json for the bundler and returns its path. The copy is for module resolution
 * only: what {@link resolutionTsconfig} gives, with no `extends`, and the project's own references. One file per call
 * in this process's directory, removed at exit; the project's file is never written.
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

  // The copy lives in the temp directory and is for module resolution alone: what the bundler resolves with, every path
  // absolute and no `extends` left, since the bundler's own lookup of one can't read a Windows absolute path
  const cwd = process.cwd()
  const copy: Record<string, unknown> = { ...resolutionTsconfig(cwd) }
  // Project references, which tsc reads from this file alone and resolves from the project, `${configDir}` as written
  if (Array.isArray(parsedConfig?.references)) {
    copy.references = parsedConfig.references.map((reference: { path?: unknown }) =>
      typeof reference?.path === 'string' ? { ...reference, path: path.resolve(cwd, reference.path) } : reference,
    )
  }

  const tempTsConfigPath = path.join(copiesDirectory(), `modified-tsconfig-${++copies}.json`)
  writeFileSync(tempTsConfigPath, JSON.stringify(copy, null, 2))
  return tempTsConfigPath
}
