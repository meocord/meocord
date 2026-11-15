import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import path from 'path'
import { type Rspack } from '@rsbuild/core'
import { bundledModuleFiles } from '@src/build/native-addons.js'

/** The file in `dist` that says what the last build read, written by every build. */
export const BUILD_RECORD_FILE = 'meocord.build.json'

/**
 * How long a start or a register spends comparing the record with the source before it gives up, silently: the check
 * only warns, so it never holds up a start for long.
 */
export const STALE_CHECK_BUDGET_MS = 200

/**
 * Read by the build for module resolution through a copy in the temp directory, which the bundler sees instead, so it
 * is recorded by name, with each file it extends.
 */
const TSCONFIG = 'tsconfig.json'

/**
 * The lockfiles a package manager writes. A build with `bundleDependencies` copies installed packages into `dist`, so
 * an upgrade, which changes the lockfile, makes it old; a build without reads them from `node_modules` as it runs.
 */
const LOCKFILES = ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb']

/** How much of a file is hashed between checks of the time budget, so one large file can't hold a start past it. */
const HASH_CHUNK_BYTES = 1024 * 1024

/** A source file as the build read it: its path from the project root with `/`, size, mtime and SHA-256. */
export interface RecordedFile {
  path: string
  size: number
  mtimeMs: number
  sha256: string
}

/** The build mode a record was written by. */
export type BuildMode = 'production' | 'development'

/** What `dist/meocord.build.json` holds: the mode, and the files the application build and the config build read. */
export interface BuildRecord {
  mode: BuildMode
  app: RecordedFile[]
  config: RecordedFile[]
}

/** A package's manifest, which resolving an import reads whether or not the bundle imports the file itself. */
const PACKAGE_MANIFEST = 'package.json'

/**
 * The files a compilation, or each of a multi-compilation's, depended on. A `package.json` counts only when the bundle
 * imports it: one the resolver merely read, say for its `imports`, would make an edit to `scripts` look like a change.
 */
export function fileDependenciesOf(stats: Rspack.Stats | Rspack.MultiStats | undefined): string[] {
  if (!stats) return []
  const files = ('stats' in stats ? stats.stats : [stats]).flatMap(({ compilation }) => [...compilation.fileDependencies])
  if (!files.some(file => path.basename(file) === PACKAGE_MANIFEST)) return files
  const imported = new Set(bundledModuleFiles(stats))
  return files.filter(file => path.basename(file) !== PACKAGE_MANIFEST || imported.has(file))
}

/**
 * The project's own source among a build's file dependencies: under its root, outside `node_modules` and `dist`, each
 * once, as a path from the root with `/`, so a `dist` built on one platform compares on another.
 *
 * @param paths - The platform's path functions; a spec passes `path.win32` to check Windows paths anywhere.
 */
export function sourceFiles(dependencies: Iterable<string>, root: string, paths: typeof path = path): string[] {
  const files = new Set<string>()
  for (const file of dependencies) {
    const relative = paths.relative(root, file)
    if (!relative || relative.startsWith('..') || paths.isAbsolute(relative)) continue
    const segments = relative.split(paths.sep)
    if (segments.includes('node_modules') || segments[0] === 'dist') continue
    files.add(segments.join('/'))
  }
  return [...files].sort()
}

/**
 * A file's SHA-256, read a chunk at a time; undefined when `now()` passes `deadline` between chunks, which gives up on
 * a file too large to hash in the time left.
 */
function sha256Of(file: string, deadline = Number.POSITIVE_INFINITY, now: () => number = () => 0): string | undefined {
  const hash = createHash('sha256')
  const chunk = Buffer.allocUnsafe(HASH_CHUNK_BYTES)
  const descriptor = fs.openSync(file, 'r')
  try {
    for (;;) {
      if (now() > deadline) return undefined
      const read = fs.readSync(descriptor, chunk, 0, chunk.length, null)
      if (read === 0) return hash.digest('hex')
      hash.update(chunk.subarray(0, read))
    }
  } finally {
    fs.closeSync(descriptor)
  }
}

/** Text with its JSON comments and trailing commas taken out, as tsconfig files allow them, strings left as they are. */
function withoutJsonExtensions(text: string): string {
  const STRING = '("(?:\\\\.|[^"\\\\])*")'
  return text
    .replace(new RegExp(`${STRING}|//[^\\n]*|/\\*[\\s\\S]*?\\*/`, 'g'), (_match, string?: string) => string ?? '')
    .replace(new RegExp(`${STRING}|,(\\s*[}\\]])`, 'g'), (match, string?: string, close?: string) => string ?? close ?? match)
}

/**
 * `tsconfig.json` and each file it extends by a path, in the order `tsc` reads them, as paths from the root with `/`.
 * One it extends from a package lives in `node_modules`, which is not recorded. A file that can't be read ends the chain.
 */
export function tsconfigChain(root: string): string[] {
  const chain: string[] = []
  const pending = [path.join(root, TSCONFIG)]
  while (pending.length > 0) {
    const file = pending.shift()!
    if (chain.includes(file) || !fs.existsSync(file)) continue
    chain.push(file)
    let extended: unknown
    try {
      extended = (JSON.parse(withoutJsonExtensions(fs.readFileSync(file, 'utf8'))) as { extends?: unknown }).extends
    } catch {
      continue
    }
    for (const target of [extended].flat()) {
      if (typeof target !== 'string' || !/^(\.{1,2}[\\/]|\/|[a-zA-Z]:)/.test(target)) continue
      const resolved = path.resolve(path.dirname(file), target)
      pending.push(fs.existsSync(resolved) || resolved.endsWith('.json') ? resolved : `${resolved}.json`)
    }
  }
  return sourceFiles(chain, root)
}

/** Each file as it is now; one that can't be read, such as a dependency since deleted, is left out. */
function describe(root: string, files: readonly string[]): RecordedFile[] {
  return files.flatMap(file => {
    const full = path.join(root, ...file.split('/'))
    try {
      const { size, mtimeMs } = fs.statSync(full)
      return [{ path: file, size, mtimeMs, sha256: sha256Of(full)! }]
    } catch {
      return []
    }
  })
}

/** The record in `dist`, or undefined when there is none or it can't be read. */
export function readBuildRecord(root: string): BuildRecord | undefined {
  try {
    const record = JSON.parse(fs.readFileSync(path.join(root, 'dist', BUILD_RECORD_FILE), 'utf8')) as Partial<BuildRecord>
    if ((record.mode !== 'production' && record.mode !== 'development') || !Array.isArray(record.app) || !Array.isArray(record.config)) return undefined
    return record as BuildRecord
  } catch {
    return undefined
  }
}

/**
 * Records what one of the two builds read, `app` or `config`, in the build's mode: the other part is kept when the
 * record is of the same mode, and dropped otherwise. The application part takes `tsconfig.json` and the files it
 * extends too, and with `bundleDependencies` the project's lockfiles. A record that can't be written is skipped: it
 * only feeds a warning.
 */
export function recordBuild(
  root: string,
  mode: BuildMode,
  part: 'app' | 'config',
  dependencies: Iterable<string>,
  { bundleDependencies = false }: { bundleDependencies?: boolean } = {},
): void {
  const files = sourceFiles(dependencies, root)
  if (part === 'app') {
    const lockfiles = bundleDependencies ? LOCKFILES.filter(file => fs.existsSync(path.join(root, file))) : []
    for (const file of [...tsconfigChain(root), ...lockfiles]) if (!files.includes(file)) files.push(file)
  }
  const previous = readBuildRecord(root)
  const record: BuildRecord = {
    mode,
    app: previous?.mode === mode ? previous.app : [],
    config: previous?.mode === mode ? previous.config : [],
  }
  record[part] = describe(root, files)
  try {
    fs.mkdirSync(path.join(root, 'dist'), { recursive: true })
    fs.writeFileSync(path.join(root, 'dist', BUILD_RECORD_FILE), `${JSON.stringify(record, null, 2)}\n`)
  } catch {
    // Without a record, a later start says nothing
  }
}

/** What a start or a register finds: a development build where it runs production, or the first source file changed. */
export type Staleness = { development: true } | { changed: string }

/** How {@link stalenessOf} keeps time: a clock in milliseconds and the budget it may spend. */
export interface StalenessBudget {
  now: () => number
  budgetMs: number
}

const DEFAULT_BUDGET: StalenessBudget = { now: () => performance.now(), budgetMs: STALE_CHECK_BUDGET_MS }

/**
 * Compares the record in `dist` with the source, as git's index does: a file of the recorded size and mtime is taken
 * as unchanged without a read, and any other is hashed. Stops at the first file whose content differs. Undefined, so
 * nothing is said, when there is no readable record, nothing differs, no recorded file is present (a deployment of
 * `dist` alone), an I/O error occurs, or the budget runs out, between files or partway through hashing one: a check
 * cut short says nothing. A path that leaves the project is not read.
 *
 * As with git, an edit that keeps a file's size and has its mtime put back, as a tool restoring timestamps does, is
 * taken as no change.
 *
 * @param mode - The mode the command runs: a development record is reported as such only when it runs production.
 */
export function stalenessOf(root: string, mode: BuildMode, { now, budgetMs } = DEFAULT_BUDGET): Staleness | undefined {
  const started = now()
  const record = readBuildRecord(root)
  if (!record) return undefined
  if (record.mode === 'development' && mode === 'production') return { development: true }
  try {
    const deadline = started + budgetMs
    for (const file of [...record.app, ...record.config]) {
      if (now() > deadline) return undefined
      if (leavesProject(file.path)) continue
      const full = path.join(root, ...file.path.split('/'))
      if (!fs.existsSync(full)) continue
      const { size, mtimeMs } = fs.statSync(full)
      if (size === file.size && mtimeMs === file.mtimeMs) continue
      const digest = sha256Of(full, deadline, now)
      if (digest === undefined) return undefined
      if (digest !== file.sha256) return { changed: file.path }
    }
  } catch {
    return undefined
  }
  return undefined
}

/** Whether a recorded path climbs out of the project or starts at a root, as no record a build writes does. */
const leavesProject = (file: string) => file.split('/').includes('..') || file.startsWith('/') || /^[a-zA-Z]:/.test(file)

/** The command a stale check runs for: `start --prod`, or `register`. */
export type StaleCommand = 'start' | 'register'

/**
 * The warning for what {@link stalenessOf} found, naming what the command does with the build it has.
 *
 * @param mode - The mode the command runs, whose build the warning suggests.
 */
export function stalenessMessage(staleness: Staleness, command: StaleCommand, mode: BuildMode = 'production'): string {
  if ('development' in staleness) {
    const what = command === 'start' ? 'start' : 'register from'
    return `dist holds a development build, from meocord start --dev or build --dev. Add --build to ${what} a production one.`
  }
  const what = command === 'start' ? 'start --prod runs the previous build' : "register sends the previous build's commands"
  return `dist was built before ${staleness.changed} changed, so ${what}. Add --build, or run meocord build ${mode === 'production' ? '--prod' : '--dev'} first.`
}
