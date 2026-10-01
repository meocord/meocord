import fs from 'fs'
import os from 'os'
import path from 'path'
import { simpleGit } from 'simple-git'
import { makeInitialCommit } from '@src/bin/helper/initial-commit.helper.js'

const roots: string[] = []
afterAll(() => roots.forEach(root => fs.rmSync(root, { recursive: true, force: true })))

/** The variables git needs to start, on Windows too. */
const RUNS_GIT = new Set(['PATH', 'PATHEXT', 'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR'])

/** A directory of its own, with git configured only by `gitconfig`: no other user, system or ambient identity. */
function sandbox(gitconfig: string) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'meocord-initial-commit-')))
  roots.push(root)
  // The user's config is the sandbox's home's. Only what git needs to run passes from the suite's environment: the
  // rest, such as the EDITOR npm exports or the shell's GIT_* variables, could configure git, and simple-git refuses it
  fs.writeFileSync(path.join(root, '.gitconfig'), gitconfig)
  const env: Record<string, string | undefined> = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => RUNS_GIT.has(name.toUpperCase())),
  )
  Object.assign(env, { HOME: root, USERPROFILE: root, XDG_CONFIG_HOME: root, GIT_CONFIG_NOSYSTEM: '1' })
  const gitAt = (dir: string) => simpleGit(dir).env(env)
  // An app as its install leaves it: a lockfile, and node_modules, which the app's .gitignore leaves out
  const app = (dir: string) => {
    fs.mkdirSync(path.join(dir, 'node_modules', 'dep'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'package.json'), '{ "name": "bot" }\n')
    fs.writeFileSync(path.join(dir, 'bun.lock'), '{}\n')
    fs.writeFileSync(path.join(dir, '.gitignore'), '/node_modules\n')
    fs.writeFileSync(path.join(dir, 'node_modules', 'dep', 'index.js'), '\n')
    return dir
  }
  return { root, gitAt, app }
}

const IDENTITY = '[user]\n  name = Test\n  email = test@example.com\n[init]\n  defaultBranch = main\n'
// As on a machine where git cannot guess an email, such as a fresh Linux container
const NO_IDENTITY = '[user]\n  useConfigOnly = true\n[init]\n  defaultBranch = main\n'

// Each case runs git four to six times, and a loaded Windows runner has taken over 2 s for a case
describe('makeInitialCommit', { timeout: 20_000 }, () => {
  it('commits every file the app keeps, its lockfile included, and nothing it ignores', async () => {
    const { root, gitAt, app } = sandbox(IDENTITY)
    const dir = app(path.join(root, 'bot'))

    expect(await makeInitialCommit(dir, gitAt)).toEqual({ outcome: 'committed' })

    const git = gitAt(dir)
    expect((await git.raw(['ls-files'])).trim().split('\n').sort()).toEqual(['.gitignore', 'bun.lock', 'package.json'])
    expect((await git.status()).isClean()).toBe(true)
  })

  it('leaves the repository with the files staged when git cannot commit, and says why', async () => {
    const { root, gitAt, app } = sandbox(NO_IDENTITY)
    const dir = app(path.join(root, 'bot'))

    const result = await makeInitialCommit(dir, gitAt)

    expect(result).toEqual({ outcome: 'not-committed', reason: expect.stringMatching(/\S/) })
    expect((await gitAt(dir).raw(['diff', '--cached', '--name-only'])).trim().split('\n').sort()).toEqual([
      '.gitignore',
      'bun.lock',
      'package.json',
    ])
  })

  it('makes no repository inside an existing one, leaving the files to it', async () => {
    const { root, gitAt, app } = sandbox(IDENTITY)
    await gitAt(root).init()
    const dir = app(path.join(root, 'bot'))

    expect(await makeInitialCommit(dir, gitAt)).toEqual({ outcome: 'inside-repository' })
    expect(fs.existsSync(path.join(dir, '.git'))).toBe(false)
  })

  it('says why when git cannot run at all, as when it is not installed', async () => {
    const { root, app } = sandbox(IDENTITY)
    const dir = app(path.join(root, 'bot'))

    const result = await makeInitialCommit(dir, at => simpleGit({ baseDir: at, binary: 'meocord-no-such-git' }))

    expect(result).toEqual({ outcome: 'no-repository', reason: expect.stringMatching(/\S/) })
    expect(fs.existsSync(path.join(dir, '.git'))).toBe(false)
  })
})
