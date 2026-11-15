import fs from 'fs'
import path from 'path'
import { type ChildProcess, spawn } from 'child_process'
import os from 'os'
import { createRequire } from 'module'
import { Logger } from '@src/common/index.js'
import { camelCase, kebabCase, startCase } from 'lodash-es'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const logger = new Logger('MeoCord')

/**
 * Converts a name to a PascalCase class name.
 * @throws Exits the process when the result is not a valid class name.
 */
export function toClassName(originalName: string): string {
  const className = startCase(camelCase(originalName)).replace(/\s/g, '')

  const classNameRegex = /^[A-Z][A-Za-z0-9]*$/
  if (!classNameRegex.test(className)) {
    logger.error(`Invalid class name "${originalName}". Must start with a letter and contain alphanumeric characters.`)
    process.exit(1)
  }

  return className
}

/**
 * Splits a name like `admin/ban` into its folders, its kebab-case file name, its class name from the whole
 * path (`AdminBan`), and its command name (`admin-ban`).
 * @throws Exits the process when the name is missing or invalid.
 */
export function validateAndFormatName(originalName?: string): {
  parts: string[]
  kebabCaseName: string
  className: string
  commandName: string
} {
  // Shared by every generator, so the messages name no kind of component
  if (!originalName) {
    logger.error('A name is required.')
    process.exit(1)
  }

  const parts = originalName.split('/')
  const fileName = parts.pop()
  if (!fileName) {
    logger.error(`Invalid name: "${originalName}".`)
    process.exit(1)
  }

  const kebabCaseName = kebabCase(fileName)
  // The whole path, so admin/ban and ban are AdminBan and Ban: two classes of one name would collide
  // under process sharding and in cooldown keys
  const className = toClassName([...parts, fileName].join(' '))

  return { parts, kebabCaseName, className, commandName: commandNameFor(parts, kebabCaseName) }
}

/**
 * The Discord command name a generated controller registers: the whole path, so `admin/ban` becomes
 * `admin-ban`, since command names are global to the application while files are kept apart by folder.
 */
export function commandNameFor(parts: string[], kebabCaseName: string): string {
  return [...parts.map(part => kebabCase(part)), kebabCaseName].filter(Boolean).join('-')
}

/**
 * Exits before a generator writes anything if any file it would write already exists, so a refusal
 * never leaves half a component behind or replaces an edited file.
 */
export function assertFilesAbsent(filePaths: string[]): void {
  const existing = filePaths.filter(filePath => fs.existsSync(filePath))
  if (existing.length === 0) return

  const names = existing.map(filePath => path.relative(process.cwd(), filePath)).join(', ')
  logger.error(
    `Refusing to overwrite ${existing.length === 1 ? 'an existing file' : 'existing files'}: ${names}. ` +
      'Nothing was generated. Choose another name, or move the existing file first.',
  )
  process.exit(1)
}

/** Creates a directory and its parents if it does not exist. */
export function createDirectoryIfNotExists(directory: string) {
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true })
  }
}

/**
 * Creates a file, and says whether it did. The write is exclusive, so an existing file is never replaced; a failed
 * write sets a non-zero exit code.
 */
export function generateFile(filePath: string, content: string): boolean {
  const relative = path.relative(process.cwd(), filePath)
  try {
    fs.writeFileSync(filePath, content, { flag: 'wx' })
  } catch (error) {
    process.exitCode = 1
    if ((error as NodeJS.ErrnoException)?.code === 'EEXIST') {
      logger.error(`${relative} already exists; left it untouched.`)
      return false
    }
    logger.error(`Failed to create ${relative}`, error)
    return false
  }
  logger.log(`Created ${relative}`)
  return true
}

/** Creates each file in order with {@link generateFile}, and returns the paths of those it created. */
export function writeFiles(files: readonly (readonly [filePath: string, content: string])[]): string[] {
  return files.filter(([filePath, content]) => generateFile(filePath, content)).map(([filePath]) => filePath)
}

/**
 * How long the project's ESLint may take across one command's runs, formatting the generated files and checking
 * src/app.ts. A typed config takes a few seconds; one that never finishes would otherwise hold `meocord generate`.
 */
export const ESLINT_TIMEOUT_MS = 60_000

/** How long a stopped ESLint has to exit on SIGTERM before it is killed, which nothing can refuse. */
export const ESLINT_KILL_GRACE_MS = 2_000

/** What a run of the project's ESLint that was stopped, or never started once one was, is reported as. */
const timedOut = (timeoutMs: number) => `ESLint did not finish within ${timeoutMs / 1000} s and was stopped`

/**
 * The time one command's ESLint runs share. A run is stopped when the time is up, so once one is stopped no other
 * starts.
 */
export class ESLintBudget {
  private readonly deadline: number

  constructor(readonly timeoutMs = ESLINT_TIMEOUT_MS) {
    this.deadline = Date.now() + timeoutMs
  }

  /** The time left for a run. */
  remaining(): number {
    return Math.max(0, this.deadline - Date.now())
  }

  /** What a run stopped, or not started, under this budget is reported as. */
  get stopped(): string {
    return timedOut(this.timeoutMs)
  }
}

/** How one run of the project's ESLint ended: with its exit code and what it printed to stderr, stopped, or not run. */
type ESLintRun = { code: number | null; stderr: string } | { stopped: true } | { failed: string }

/** The work to do before the process ends on SIGINT or SIGTERM, such as putting back a file or stopping ESLint. */
const onInterrupt = new Set<() => void>()

/** Runs every interrupt cleanup, then ends the process as the signal would have. */
function interrupted(signal: NodeJS.Signals): void {
  for (const cleanup of [...onInterrupt].reverse()) {
    try {
      cleanup()
    } catch {
      // The others still run, and the process still ends
    }
  }
  onInterrupt.clear()
  process.off('SIGINT', interrupted)
  process.off('SIGTERM', interrupted)
  process.kill(process.pid, signal)
}

/**
 * Runs `cleanup` if the process gets SIGINT or SIGTERM before the returned function is called, then ends the process as
 * the signal would have. Nothing can run on SIGKILL.
 */
export function cleanUpOnInterrupt(cleanup: () => void): () => void {
  if (onInterrupt.size === 0) {
    process.on('SIGINT', interrupted)
    process.on('SIGTERM', interrupted)
  }
  onInterrupt.add(cleanup)
  return () => {
    onInterrupt.delete(cleanup)
    if (onInterrupt.size > 0) return
    process.off('SIGINT', interrupted)
    process.off('SIGTERM', interrupted)
  }
}

/**
 * Runs the project's ESLint with `args` in the time `budget` leaves, stopping it with SIGTERM, then SIGKILL after
 * {@link ESLINT_KILL_GRACE_MS}. Its stdout is discarded and its stderr goes to a file, so it ends when ESLint itself
 * exits, even while a process its config started holds what it inherited.
 */
function runESLint(script: string, args: readonly string[], cwd: string, budget: ESLintBudget, stderrFile: string): Promise<ESLintRun> {
  const timeoutMs = budget.remaining()
  if (timeoutMs === 0) return Promise.resolve({ stopped: true })
  return new Promise(resolve => {
    let stderr: number
    let child: ChildProcess
    try {
      stderr = fs.openSync(stderrFile, 'w')
      try {
        child = spawn(process.execPath, [script, ...args], { cwd, stdio: ['ignore', 'ignore', stderr], windowsHide: true })
      } finally {
        fs.closeSync(stderr)
      }
    } catch (error) {
      return resolve({ failed: messageOf(error) })
    }
    let stopped = false
    let kill: NodeJS.Timeout | undefined
    const stop = setTimeout(() => {
      stopped = true
      child.kill('SIGTERM')
      kill = setTimeout(() => child.kill('SIGKILL'), ESLINT_KILL_GRACE_MS)
    }, timeoutMs)
    // On SIGINT or SIGTERM, ESLint goes with the command
    const release = cleanUpOnInterrupt(() => child.kill('SIGKILL'))
    const settle = (run: ESLintRun) => {
      clearTimeout(stop)
      clearTimeout(kill)
      release()
      resolve(run)
    }
    child.on('error', error => settle({ failed: error.message }))
    child.on('exit', code => settle(stopped ? { stopped: true } : { code, stderr: readText(stderrFile) }))
  })
}

/** A file's text, or none where it can't be read. */
function readText(file: string): string {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

/** An error's message. */
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Runs `work` with a folder of its own for ESLint's output files, removed after, or on SIGINT or SIGTERM. */
async function withOutputDir<T>(work: (dir: string) => Promise<T>): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meocord-eslint-'))
  const remove = () => fs.rmSync(dir, { recursive: true, force: true })
  const release = cleanUpOnInterrupt(remove)
  try {
    return await work(dir)
  } finally {
    release()
    remove()
  }
}

/**
 * Formats the written files with the project's own ESLint in one run, so its type information is built once, within
 * `budget`. A failed run, one stopped, or a rule the template breaks is warned about, never fatal; with no ESLint it
 * does nothing, rather than download one through `npx`.
 */
export async function formatGeneratedFiles(filePaths: readonly string[], budget = new ESLintBudget()): Promise<void> {
  const script = filePaths.length > 0 ? projectESLintScript() : undefined
  if (!script) return

  logger.log("Formatting with your project's ESLint...")
  const run = await withOutputDir(dir => runESLint(script, ['--fix', ...filePaths], process.cwd(), budget, path.join(dir, 'stderr.txt')))
  const failure =
    'stopped' in run
      ? `${budget.stopped}; run it on the files to format them.`
      : 'failed' in run
        ? firstLine(run.failed)
        : run.code === 0
          ? undefined
          : // ESLint exits 1 for problems left after fixing, and 2 when it could not run
            run.code === 1
            ? 'ESLint reports problems it could not fix; run it on the files to see them.'
            : (eslintFailure(run.stderr) ?? `ESLint exited with code ${run.code}`)
  if (failure !== undefined) logger.warn(`Could not format the generated files: ${failure}`)
}

/** The lines of `text` that say anything, trimmed. */
const linesOf = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)

/** The first line of `text` that says anything, which names the cause. */
const firstLine = (text: string): string | undefined => linesOf(text)[0]

/**
 * What ESLint says stopped it. A fatal error prints "Oops! Something went wrong! :(" and "ESLint: <version>" before
 * the cause, so the cause is the line after the version; other output names it on its first line.
 */
function eslintFailure(stderr: string): string | undefined {
  const lines = linesOf(stderr)
  const version = lines.findIndex(line => /^ESLint: \S+$/.test(line))
  if (version !== -1 && version + 1 < lines.length) return lines[version + 1]
  return lines.find(line => !line.startsWith('Oops! Something went wrong')) ?? lines[0]
}

/** One problem the project's ESLint reports, as its rule and message. */
export interface LintProblem {
  rule: string
  message: string
}

/** The errors the project's ESLint reports for a file, or why it could not say. */
export type LintResult = { errors: LintProblem[] } | { unchecked: string }

/**
 * Lints a file as it is on disk with the ESLint of the project at `root`, with no fixing, as the app's own lint does:
 * a typed config reads the file from disk whatever text it is given, so the file is linted where it is. The report is
 * read from a file only ESLint writes, so what a config prints does not mix with it. Gives its errors, or why it could
 * not run: no ESLint, a run that failed or could not be read, or one `budget` stopped or left no time for.
 */
export async function lintFile(filePath: string, root = process.cwd(), budget = new ESLintBudget()): Promise<LintResult> {
  const script = projectESLintScript(root)
  if (!script) return { unchecked: 'your project has no ESLint' }
  return withOutputDir(async dir => {
    const report = path.join(dir, 'report.json')
    const run = await runESLint(script, ['--format', 'json', '--output-file', report, filePath], root, budget, path.join(dir, 'stderr.txt'))
    if ('stopped' in run) return { unchecked: budget.stopped }
    if ('failed' in run) return { unchecked: `ESLint could not run (${firstLine(run.failed)})` }
    // ESLint exits 1 when it reports errors, and 2 when it could not run
    if (run.code !== 0 && run.code !== 1) return { unchecked: `ESLint could not run (${eslintFailure(run.stderr) ?? `exit code ${run.code}`})` }
    try {
      const results = JSON.parse(fs.readFileSync(report, 'utf8')) as { messages: { ruleId: string | null; message: string; severity: number }[] }[]
      const messages = results.flatMap(result => result.messages)
      return { errors: messages.filter(each => each.severity === ESLINT_ERROR).map(each => ({ rule: each.ruleId ?? '', message: each.message })) }
    } catch {
      return { unchecked: 'ESLint gave a report that could not be read' }
    }
  })
}

/** ESLint's severity for an error, which fails a lint, as against a warning. */
const ESLINT_ERROR = 2

/**
 * The project's own ESLint, as the script its package names for `eslint`, resolved from the project's root as Node
 * would, so one a workspace hoists to a parent folder is found. Run with this runtime rather than through
 * `node_modules/.bin`, whose Windows `.cmd` shim can't be spawned without a shell.
 */
export function projectESLintScript(root = process.cwd()): string | undefined {
  let manifest: string
  try {
    manifest = createRequire(path.join(root, 'package.json')).resolve('eslint/package.json')
  } catch {
    return undefined
  }
  try {
    const { bin } = JSON.parse(fs.readFileSync(manifest, 'utf8')) as { bin?: string | Record<string, string> }
    const script = typeof bin === 'string' ? bin : bin?.eslint
    return script ? path.resolve(path.dirname(manifest), script) : undefined
  } catch {
    return undefined
  }
}

/** Renders a builder template, replacing `{{className}}` and any `extra` placeholders. */
export function buildTemplate(className: string, templateFileName: string, extra: Record<string, string> = {}): string {
  const filePath = path.resolve(__dirname, '..', 'bin', 'builder-template', templateFileName)
  let template = fs.readFileSync(filePath, 'utf-8')

  for (const [key, value] of Object.entries({ className, ...extra })) {
    template = template.replaceAll(`{{${key}}}`, value)
  }

  return template
}

/** Renders a template file, replacing each `{{name}}` placeholder with its value. */
export function populateTemplate(filePath: string, variables: Record<string, string>): string {
  let template = fs.readFileSync(filePath, 'utf-8')
  for (const [key, value] of Object.entries(variables)) {
    template = template.replaceAll(`{{${key}}}`, value)
  }
  return template
}
