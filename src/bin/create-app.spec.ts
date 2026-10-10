import { vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

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

// Git itself is initial-commit.helper.spec's; here, when create runs it, and that a commit git cannot make keeps the app
const { makeInitialCommit } = vi.hoisted(() => ({ makeInitialCommit: vi.fn() }))
vi.mock('@src/bin/helper/initial-commit.helper.js', () => ({ makeInitialCommit }))

import { appDirectoryName, MeoCordCLI } from '@src/bin/meocord.js'

describe('meocord create', () => {
  const roots: string[] = []
  afterAll(() => roots.forEach(root => fs.rmSync(root, { recursive: true, force: true })))

  let root: string
  let exit: ReturnType<typeof vi.spyOn>

  /** Gives the test a directory of its own to run create in. */
  function sandbox() {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'meocord-create-')))
    roots.push(root)
    vi.spyOn(process, 'cwd').mockReturnValue(root)
  }

  beforeEach(() => {
    exit = vi.spyOn(process, 'exit').mockImplementation(code => {
      throw new Error(`process.exit(${code})`)
    })
  })
  afterEach(() => vi.restoreAllMocks())

  // engines.node is >=22.13, so a 22 below that is older than the package installs on, not a pass
  it.each([
    ['22.12.0', true],
    ['22.13.0', false],
    ['23.0.0', false],
  ])('on Node %s, warns that it is below the supported minimum: %s', async (node, warns) => {
    sandbox()
    makeInitialCommit.mockResolvedValue({ outcome: 'committed' })
    const versions = process.versions
    Object.defineProperty(process, 'versions', { value: { ...versions, node }, configurable: true })
    prompts.log.warn.mockClear()

    try {
      await new MeoCordCLI().createApp('bot', { useBun: true })
    } finally {
      Object.defineProperty(process, 'versions', { value: versions, configurable: true })
    }

    const warned = prompts.log.warn.mock.calls.some(([text]) => String(text).includes('older than the supported minimum'))
    expect(warned).toBe(warns)
  })

  it('makes the first commit after the install, so the lockfile the install wrote is in it', async () => {
    sandbox()
    let lockfileWritten = false
    makeInitialCommit.mockImplementation(async (appPath: string) => {
      lockfileWritten = fs.existsSync(path.join(appPath, 'bun.lock'))
      return { outcome: 'committed' }
    })

    await new MeoCordCLI().createApp('bot', { useBun: true })

    expect(makeInitialCommit).toHaveBeenCalledWith(path.join(root, 'bot'))
    expect(lockfileWritten).toBe(true)
    expect(exit).not.toHaveBeenCalled()
  })

  // The app is complete and installed by then; deleting it for a commit git cannot make would lose all of it
  it('keeps the app, and says what is left to do, when git cannot make the first commit', async () => {
    sandbox()
    makeInitialCommit.mockResolvedValue({ outcome: 'not-committed', reason: 'Author identity unknown' })

    await new MeoCordCLI().createApp('bot', { useBun: true })

    expect(fs.existsSync(path.join(root, 'bot', 'package.json'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'bot', 'bun.lock'))).toBe(true)
    expect(exit).not.toHaveBeenCalled()
    expect(prompts.log.warn).toHaveBeenCalledWith(expect.stringContaining('cd bot && git add -A && git commit -m "Initial commit"'))
    expect(prompts.outro).toHaveBeenCalled()
  })

  // Accents fold before the camelCase split, so "CaféBot" is split as "CafeBot" is
  it.each([
    ['Café Bot', 'cafe-bot'],
    ['CaféBot', 'cafe-bot'],
    ['Ünïcödé', 'unicode'],
    ['Straße', 'strasse'],
    ['Smørrebrød', 'smorrebrod'],
    ['Łódź Æther', 'lodz-aether'],
    ['my_bot 2', 'my-bot-2'],
  ])('names the folder for %j %j', (name, folder) => {
    expect(appDirectoryName(name)).toBe(folder)
  })

  it('refuses a name with no Latin letters or digits, saying that is what it needs', async () => {
    sandbox()

    await expect(new MeoCordCLI().createApp('日本語ボット', { useBun: true })).rejects.toThrow('process.exit(1)')

    expect(prompts.cancel).toHaveBeenCalledWith(
      '"日本語ボット" needs a name with Latin letters or digits, such as my-bot: it names the app\'s directory.',
    )
  })
})

