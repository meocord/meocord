import { execFile } from 'node:child_process'

/** What became of a new app's first commit. */
export type InitialCommit =
  | { outcome: 'committed' }
  /** The app sits inside another repository, which its files are left to. */
  | { outcome: 'inside-repository' }
  /** Git made the repository, but adding or committing the app's files failed. */
  | { outcome: 'not-committed'; reason: string }
  /** Git could not make a repository, as when it is not installed. */
  | { outcome: 'no-repository'; reason: string }

/** Runs git with `args` in `cwd` and resolves its standard output, or rejects with what git wrote to standard error. */
export type RunGit = (args: string[], cwd: string) => Promise<string>

/** Git exits with this when the directory is in no repository, among its other fatal errors. */
const FATAL = 128

/**
 * Runs `command` (git, unless a spec swaps it) with `env` and `prefix` before the arguments. Git runs in the C locale,
 * so what it prints, and the reasons reported from it, read the same on every machine.
 */
export const gitRunner =
  (env: NodeJS.ProcessEnv = process.env, command = 'git', prefix: string[] = []): RunGit =>
  (args, cwd) =>
    new Promise((resolve, reject) => {
      execFile(command, [...prefix, ...args], { cwd, env: { ...env, LC_ALL: 'C' } }, (error, stdout, stderr) =>
        error ? reject(Object.assign(error, { stderr: String(stderr) })) : resolve(String(stdout)),
      )
    })

/** The first line of what git said, which names the cause, or of the error when git could not start. */
function reasonOf(error: unknown): string {
  const stderr = (error as { stderr?: unknown } | null)?.stderr
  const text = typeof stderr === 'string' && stderr.trim() ? stderr : error instanceof Error ? error.message : String(error)
  return text.trim().split('\n')[0] || 'unknown error'
}

/** Whether `dir` is inside a work tree; any failure other than git's "not a git repository" rejects. */
async function insideRepository(git: RunGit, dir: string): Promise<boolean> {
  try {
    return (await git(['rev-parse', '--is-inside-work-tree'], dir)).trim() === 'true'
  } catch (error) {
    const { code, stderr } = error as { code?: unknown; stderr?: unknown }
    if (code === FATAL && /not a git repository/i.test(String(stderr ?? ''))) return false
    throw error
  }
}

/**
 * Makes a new app's repository and first commit, after its install, so the lockfile is committed with the rest. Git
 * is a convenience here, not part of creating the app: no outcome throws, and the caller says what is left to do.
 */
export async function makeInitialCommit(appPath: string, git: RunGit = gitRunner()): Promise<InitialCommit> {
  try {
    if (await insideRepository(git, appPath)) return { outcome: 'inside-repository' }
    await git(['init'], appPath)
  } catch (error) {
    return { outcome: 'no-repository', reason: reasonOf(error) }
  }
  try {
    await git(['add', '-A'], appPath)
    await git(['commit', '-m', 'Initial commit'], appPath)
    return { outcome: 'committed' }
  } catch (error) {
    return { outcome: 'not-committed', reason: reasonOf(error) }
  }
}
