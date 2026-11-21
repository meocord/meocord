import { vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// Which commands load the bundler: each evaluation of @rsbuild/core is counted, from a fresh module registry per command

const bundler = { evaluations: 0 }

/** Stops a command where it would exit, so nothing after it runs. */
class Exited extends Error {}

vi.mock('@src/common/index.js', () => ({
  Logger: class {
    log = vi.fn()
    error = vi.fn()
    warn = vi.fn()
    debug = vi.fn()
    info = vi.fn()
    verbose = vi.fn()
  },
}))

// Starting or registering stops at spawning the application
vi.mock('node:child_process', async importOriginal => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: vi.fn(() => {
    throw new Error('the application is not spawned here')
  }),
}))

vi.mock('@clack/prompts', async importOriginal => ({
  ...(await importOriginal<typeof import('@clack/prompts')>()),
  intro: vi.fn(),
  cancel: vi.fn(),
}))

vi.mock('@src/util/meocord-cli.util.js', async importOriginal => ({
  ...(await importOriginal<typeof import('@src/util/meocord-cli.util.js')>()),
  ensureReady: vi.fn(async () => undefined),
}))

vi.mock('@src/util/common.util.js', async importOriginal => ({
  ...(await importOriginal<typeof import('@src/util/common.util.js')>()),
  compileAndValidateConfig: vi.fn(async () => ({})),
  validateRunConfig: vi.fn(async () => ({})),
  validateDiscordToken: vi.fn(async () => undefined),
}))

vi.mock('@src/util/meocord-source-config.util.js', () => ({ loadMeoCordSourceConfig: () => ({}) }))

let project: string

beforeEach(() => {
  vi.resetModules()
  bundler.evaluations = 0
  // Registered per test, so each fresh registry evaluates it again. A command that builds stops at the bundler
  vi.doMock('@rsbuild/core', () => {
    bundler.evaluations++
    return {
      createRsbuild: async () => {
        throw new Error('the bundler stands in for a build here')
      },
    }
  })
  project = mkdtempSync(path.join(tmpdir(), 'meocord-bundler-load-'))
  writeFileSync(path.join(project, 'tsconfig.json'), '{}')
  writeFileSync(path.join(project, 'meocord.config.ts'), 'export default {}\n')
  mkdirSync(path.join(project, 'dist'))
  writeFileSync(path.join(project, 'dist', 'main.js'), '')
  // The app create is given already exists, so create stops at its first check
  mkdirSync(path.join(project, 'my-bot'))
  vi.spyOn(process, 'cwd').mockReturnValue(project)
  vi.spyOn(process, 'exit').mockImplementation(() => {
    throw new Exited()
  })
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(project, { recursive: true, force: true })
})

/** Runs one command line through a CLI loaded afresh, and gives how many times it loaded the bundler. */
async function evaluationsFor(argv: string[]): Promise<number> {
  const { MeoCordCLI } = await import('@src/bin/meocord.js')
  const program = new MeoCordCLI().program().exitOverride()
  await program.parseAsync(['node', 'meocord', ...argv]).catch(() => undefined)
  // A load the command started without awaiting it counts too
  await vi.dynamicImportSettled()
  return bundler.evaluations
}

describe('the bundler', () => {
  it.each([
    ['start --prod', ['start', '--prod']],
    ['register', ['register']],
    ['create', ['create', 'my-bot']],
    ['generate', ['generate', 'controller']],
    ['show', ['show', '--license']],
    ['--help', ['--help']],
    ['--version', ['--version']],
  ])('is not loaded by %s', async (_name, argv) => {
    expect(await evaluationsFor(argv)).toBe(0)
  })

  it.each([
    ['build', ['build', '--prod']],
    ['start --dev', ['start', '--dev']],
    ['start, which is the development path', ['start']],
    ['start --build --prod', ['start', '--build', '--prod']],
    ['register --build', ['register', '--build']],
  ])('is loaded by %s', async (_name, argv) => {
    expect(await evaluationsFor(argv)).toBe(1)
  })
})
