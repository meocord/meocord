import { execFileSync } from 'child_process'
import { cpSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'fs'
import path from 'path'
import { createRsbuild, type RsbuildConfig } from '@rsbuild/core'
import { vi } from 'vitest'
import { createRsbuildConfig } from '@src/build/rsbuild-config.js'

/**
 * Builds an application whose decorator options read `.env`, and runs it with plain node. The fixture
 * sits in a git-ignored directory in the repository, so the config's `dotenv` import resolves from this
 * package's node_modules as it would from an application's.
 */
const repoRoot = path.resolve(import.meta.dirname, '..', '..')
const fixture = path.join(repoRoot, '.rsbuild-pre-entry-spec')

// What `meocord build` compiles meocord.config.ts to, with a counter to see how often it is evaluated.
const COMPILED_CONFIG = `
import 'dotenv/config'
globalThis.configEvaluations = (globalThis.configEvaluations ?? 0) + 1
export default { discordToken: 'token' }
`

// Read at decoration time, as @MeoCord({...}) options are.
const APP = `
function Options(options: { greeting?: string }): ClassDecorator {
  return target => {
    Reflect.set(target, 'options', options)
  }
}

@Options({ greeting: process.env.GREETING })
export class App {}

export const greeting: string | null = Reflect.get(App, 'options').greeting ?? null
`

// Imports the application first, then loads the config the way MeoCordFactory.create does.
const MAIN = `
import { greeting } from './app'
import logo from './logo.png'
import { createRequire } from 'node:module'
import path from 'node:path'

const load = createRequire(import.meta.url)
load(path.resolve(process.cwd(), 'dist', 'meocord.config.mjs'))

console.log(
  JSON.stringify({
    greeting,
    evaluations: Reflect.get(globalThis, 'configEvaluations'),
    bundleEntry: Reflect.get(globalThis, Symbol.for('meocord.bundleEntry')),
    asset: logo,
  }),
)
`

interface RunResult {
  greeting: string | null
  evaluations: number
  bundleEntry: string
  asset: string
  /** The same build, its dist copied elsewhere and run from there, as a deploy does. */
  copied?: RunResult
}

/** Where a mode's dist is copied to: inside the fixture, which git ignores, and outside its dist. */
const copyOf = (mode: string) => path.join(fixture, `${mode}-copy`)

async function buildAndRun(mode: 'production' | 'development', adjust = (config: RsbuildConfig) => config): Promise<RunResult> {
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(fixture)
  try {
    const rsbuild = await createRsbuild({
      cwd: fixture,
      config: adjust({ ...createRsbuildConfig({ mode }), performance: { printFileSize: false } }),
    })
    await rsbuild.build()
  } finally {
    cwd.mockRestore()
  }

  const env = { ...process.env }
  delete env.GREETING
  const run = (dist: string) => {
    const output = execFileSync('node', [path.join(dist, 'main.js')], { cwd: fixture, env, encoding: 'utf8' })
    return JSON.parse(output.trim().split('\n').at(-1)!) as RunResult
  }
  // Copied before the other mode's build replaces dist
  rmSync(copyOf(mode), { recursive: true, force: true })
  cpSync(path.join(fixture, 'dist'), copyOf(mode), { recursive: true })
  return { ...run(path.join(fixture, 'dist')), copied: run(copyOf(mode)) }
}

beforeAll(() => {
  rmSync(fixture, { recursive: true, force: true })
  mkdirSync(path.join(fixture, 'src'), { recursive: true })
  mkdirSync(path.join(fixture, 'dist'), { recursive: true })
  writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({ name: 'pre-entry-spec', private: true, type: 'module' }))
  writeFileSync(
    path.join(fixture, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { experimentalDecorators: true, target: 'es2022' } }),
  )
  writeFileSync(path.join(fixture, '.env'), 'GREETING=from-dotenv\n')
  writeFileSync(path.join(fixture, 'dist', 'meocord.config.mjs'), COMPILED_CONFIG)
  writeFileSync(path.join(fixture, 'src', 'app.ts'), APP)
  writeFileSync(path.join(fixture, 'src', 'main.ts'), MAIN)
  writeFileSync(path.join(fixture, 'src', 'logo.png'), 'not really a png')
})

afterAll(() => {
  rmSync(fixture, { recursive: true, force: true })
})

// One build per mode, shared by the cases that read it: each build is the slow part, on Windows above all.
const runs = new Map<'production' | 'development', Promise<RunResult>>()
const runFor = (mode: 'production' | 'development') => runs.get(mode) ?? runs.set(mode, buildAndRun(mode)).get(mode)!

describe('the config pre-entry, built and run with node', () => {
  it.each(['production', 'development'] as const)('lets decorator options read .env in a %s build', async mode => {
    const result = await runFor(mode)

    expect(result.greeting).toBe('from-dotenv')
  })

  // The runtime loads the config again after the pre-entry; require's cache keeps that one evaluation.
  it.each(['production', 'development'] as const)('evaluates the config once in a %s build', async mode => {
    const result = await runFor(mode)

    expect(result.evaluations).toBe(1)
  })

  // CI, a laptop then rsync, or an image stage with another WORKDIR: the bundle runs from somewhere other than where it was built
  it.each(['production', 'development'] as const)('resolves an asset import beside the bundle, wherever dist was copied to, in a %s build', async mode => {
    const { asset, copied } = await runFor(mode)

    expect(path.normalize(asset)).toBe(path.join(fixture, 'dist', 'assets', 'logo.png'))
    expect(path.normalize(copied!.asset)).toBe(path.join(copyOf(mode), 'assets', 'logo.png'))
  })

  // A shard manager spawns this path; process.argv[1] may be a process manager's wrapper instead
  it('records the built bundle as its own path in a production build', async () => {
    const result = await runFor('production')

    expect(realpathSync(result.bundleEntry)).toBe(realpathSync(path.join(fixture, 'dist', 'main.js')))
  })

  it('is what makes the value available: without it, the options read undefined', async () => {
    const result = await buildAndRun('production', config => ({ ...config, source: { ...config.source, preEntry: [] } }))

    expect(result.greeting).toBeNull()
    expect(result.evaluations).toBe(1)
  })
}, 60_000)
