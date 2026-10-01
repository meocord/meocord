import { simpleGit, type SimpleGit } from 'simple-git'

/** What became of a new app's first commit. */
export type InitialCommit =
  | { outcome: 'committed' }
  /** The app sits inside another repository, which its files are left to. */
  | { outcome: 'inside-repository' }
  /** Git ran, but the commit did not: the repository holds the app's files, staged. */
  | { outcome: 'not-committed'; reason: string }
  /** Git could not make a repository, as when it is not installed. */
  | { outcome: 'no-repository'; reason: string }

/** The first line of what git said, which names the cause. */
const reasonOf = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).trim().split('\n')[0] ?? 'unknown error'

/**
 * Makes a new app's repository and first commit, after its install, so the lockfile is committed with the rest. Git
 * is a convenience here, not part of creating the app: no outcome throws, and the caller says what is left to do.
 */
export async function makeInitialCommit(
  appPath: string,
  gitAt: (dir: string) => SimpleGit = dir => simpleGit(dir),
): Promise<InitialCommit> {
  const git = gitAt(appPath)
  try {
    if (await git.checkIsRepo()) return { outcome: 'inside-repository' }
    await git.init()
  } catch (error) {
    return { outcome: 'no-repository', reason: reasonOf(error) }
  }
  try {
    await git.add(['-A'])
    await git.commit('Initial commit')
    return { outcome: 'committed' }
  } catch (error) {
    return { outcome: 'not-committed', reason: reasonOf(error) }
  }
}
