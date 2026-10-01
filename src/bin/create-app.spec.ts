import { vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { simpleGit } from 'simple-git'

vi.mock('@src/common/index.js', () => ({
  Logger: vi.fn(
    class {
      log = vi.fn()
      error = vi.fn()
      warn = vi.fn()
      debug = vi.fn()
      info = vi.fn()
      verbose = vi.fn()
    },
  ),
}))

const { prompts } = vi.hoisted(() => {
  const spinner = { start: vi.fn(), stop: vi.fn(), message: vi.fn() }
  return {
    prompts: {
      intro: vi.fn(),
      outro: vi.fn(),
      cancel: vi.fn(),
      select: vi.fn(),
      spinner: () => spinner,
      log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), message: vi.fn(), step: vi.fn(), success: vi.fn() },
    },
  }
})
vi.mock('@clack/prompts', () => prompts)

// The install, as a package manager leaves the app: a lockfile and node_modules
vi.mock('child_process', async importOriginal => {
  const { mkdirSync, writeFileSync } = await import('fs')
  const { join } = await import('path')
  return {
    ...(await importOriginal<typeof import('child_process')>()),
    execSync: vi.fn((_command: string, options: { cwd: string }) => {
      writeFileSync(join(options.cwd, 'bun.lock'), '{}\n')
      mkdirSync(join(options.cwd, 'node_modules', 'dep'), { recursive: true })
      return Buffer.from('')
    }),
  }
})

vi.mock('@src/util/package-manager.util.js', async importOriginal => ({
  ...(await importOriginal<typeof import('@src/util/package-manager.util.js')>()),
  detectInstalledPMs: () => ['bun'],
}))

import { MeoCordCLI } from '@src/bin/meocord.js'

const IDENTITY = '[user]\n  name = Test\n  email = test@example.com\n[init]\n  defaultBranch = main\n'
// As on a machine where git cannot guess an email, such as a fresh Linux container
const NO_IDENTITY = '[user]\n  useConfigOnly = true\n[init]\n  defaultBranch = main\n'

describe('meocord create', () => {
  const roots: string[] = []
  afterAll(() => roots.forEach(root => fs.rmSync(root, { recursive: true, force: true })))

  let root: string
  let exit: ReturnType<typeof vi.spyOn>

  /** Runs `create bot` in a directory of its own, with git configured only by `gitconfig`. */
  function sandbox(gitconfig: string) {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'meocord-create-')))
    roots.push(root)
    fs.writeFileSync(path.join(root, '.gitconfig'), gitconfig)
    for (const name of Object.keys(process.env)) if (name.startsWith('GIT_') || name === 'EMAIL') vi.stubEnv(name, undefined)
    for (const name of ['HOME', 'USERPROFILE', 'XDG_CONFIG_HOME']) vi.stubEnv(name, root)
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1')
    vi.spyOn(process, 'cwd').mockReturnValue(root)
  }

  beforeEach(() => {
    exit = vi.spyOn(process, 'exit').mockImplementation(code => {
      throw new Error(`process.exit(${code})`)
    })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('commits the lockfile the install wrote, with the rest of the app', async () => {
    sandbox(IDENTITY)

    await new MeoCordCLI().createApp('bot', { useBun: true })

    const git = simpleGit(path.join(root, 'bot'))
    expect((await git.raw(['ls-files'])).split('\n')).toContain('bun.lock')
    expect((await git.status()).isClean()).toBe(true)
    expect(exit).not.toHaveBeenCalled()
  })

  // The app is complete and installed by then; deleting it for a commit git could not make lost all of it
  it('keeps the app, and says what is left to do, when git cannot make the first commit', async () => {
    sandbox(NO_IDENTITY)

    await new MeoCordCLI().createApp('bot', { useBun: true })

    expect(fs.existsSync(path.join(root, 'bot', 'package.json'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'bot', 'bun.lock'))).toBe(true)
    expect(exit).not.toHaveBeenCalled()
    expect(prompts.log.warn).toHaveBeenCalledWith(expect.stringContaining('cd bot && git add -A && git commit -m "Initial commit"'))
    expect(prompts.outro).toHaveBeenCalled()
  })
})
