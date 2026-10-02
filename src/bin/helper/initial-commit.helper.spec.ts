import fs from 'fs'
import os from 'os'
import path from 'path'
import { gitRunner, makeInitialCommit } from '@src/bin/helper/initial-commit.helper.js'

const roots: string[] = []
afterAll(() => roots.forEach(root => fs.rmSync(root, { recursive: true, force: true })))

/** The variables git needs to start, on Windows too. */
const RUNS_GIT = new Set(['PATH', 'PATHEXT', 'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR'])

/** A directory of its own, with git configured only by `gitconfig`: no other user, system or ambient identity. */
function sandbox(gitconfig: string) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'meocord-initial-commit-')))
  roots.push(root)
  // The user's config is the sandbox's home's. Only what git needs to run passes from the suite's environment: the
  // rest, such as the shell's GIT_* variables, could configure git
  fs.writeFileSync(path.join(root, '.gitconfig'), gitconfig)
  const env: NodeJS.ProcessEnv = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => RUNS_GIT.has(name.toUpperCase())),
  )
  Object.assign(env, { HOME: root, USERPROFILE: root, XDG_CONFIG_HOME: root, GIT_CONFIG_NOSYSTEM: '1' })
  const git = gitRunner(env)
  // An app as its install leaves it: a lockfile, and node_modules, which the app's .gitignore leaves out
  const app = (dir: string) => {
    fs.mkdirSync(path.join(dir, 'node_modules', 'dep'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'package.json'), '{ "name": "bot" }\n')
    fs.writeFileSync(path.join(dir, 'bun.lock'), '{}\n')
    fs.writeFileSync(path.join(dir, '.gitignore'), '/node_modules\n')
    fs.writeFileSync(path.join(dir, 'node_modules', 'dep', 'index.js'), '\n')
    return dir
  }
  return { root, env, git, app }
}

const IDENTITY = '[user]\n  name = Test\n  email = test@example.com\n[init]\n  defaultBranch = main\n'
// As on a machine where git cannot guess an email, such as a fresh Linux container
const NO_IDENTITY = '[user]\n  useConfigOnly = true\n[init]\n  defaultBranch = main\n'

// Each case runs git up to six times, and a loaded Windows runner can take over 2 s for a case
describe('makeInitialCommit', { timeout: 20_000 }, () => {
  it('commits every file the app keeps, its lockfile included, and nothing it ignores', async () => {
    const { root, git, app } = sandbox(IDENTITY)
    const dir = app(path.join(root, 'bot'))

    expect(await makeInitialCommit(dir, git)).toEqual({ outcome: 'committed' })

    expect((await git(['ls-files'], dir)).trim().split('\n').sort()).toEqual(['.gitignore', 'bun.lock', 'package.json'])
    expect((await git(['status', '--porcelain'], dir)).trim()).toBe('')
    expect((await git(['log', '--format=%s'], dir)).trim()).toBe('Initial commit')
  })

  it('leaves the repository with the files staged when git cannot commit, and says why', async () => {
    const { root, git, app } = sandbox(NO_IDENTITY)
    const dir = app(path.join(root, 'bot'))

    const result = await makeInitialCommit(dir, git)

    // git's own reason, not the runner's "Command failed" line
    expect(result).toEqual({ outcome: 'not-committed', reason: expect.not.stringMatching(/^Command failed/) })
    expect((await git(['diff', '--cached', '--name-only'], dir)).trim().split('\n').sort()).toEqual([
      '.gitignore',
      'bun.lock',
      'package.json',
    ])
  })

  it('makes no repository inside an existing one, leaving the files to it', async () => {
    const { root, git, app } = sandbox(IDENTITY)
    await git(['init'], root)
    const dir = app(path.join(root, 'bot'))

    expect(await makeInitialCommit(dir, git)).toEqual({ outcome: 'inside-repository' })
    expect(fs.existsSync(path.join(dir, '.git'))).toBe(false)
  })

  it('says why when git cannot run at all, as when it is not installed', async () => {
    const { root, env, app } = sandbox(IDENTITY)
    const dir = app(path.join(root, 'bot'))

    const result = await makeInitialCommit(dir, gitRunner(env, 'meocord-no-such-git'))

    expect(result).toEqual({ outcome: 'no-repository', reason: expect.stringMatching(/\S/) })
    expect(fs.existsSync(path.join(dir, '.git'))).toBe(false)
  })

  it('runs git with LC_ALL=C whatever locale the environment sets', async () => {
    const printLocale = gitRunner({ LC_ALL: 'de_DE.UTF-8' }, process.execPath, ['-e', 'process.stdout.write(process.env.LC_ALL ?? "")'])

    expect(await printLocale([], os.tmpdir())).toBe('C')
  })
})
