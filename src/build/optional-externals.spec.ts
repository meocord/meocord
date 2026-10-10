import { execFileSync, spawnSync } from 'child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { stripVTControlCharacters } from 'util'
import { createRsbuild } from '@rsbuild/core'
import { vi } from 'vitest'
import { createRsbuildConfig } from '@src/build/rsbuild-config.js'

/**
 * Bundles an application whose dependency, debug, probes for supports-color inside a try, as most
 * bundled bots do through axios. The fixture sits in a git-ignored directory in the repository, so
 * debug resolves from this package's node_modules; supports-color is not installed there.
 */
const repoRoot = path.resolve(import.meta.dirname, '..', '..')
const fixture = path.join(repoRoot, '.rsbuild-optional-spec')

const MAIN = `
import debug from 'debug'

debug('bot')('started')
console.log('started')
`

/** The messages of the warnings the last build reported, without the colours a CI terminal adds. */
let warnings: string[] = []

async function build(externals: { optionalExternals?: string[]; externals?: string[] }, entry = 'main.ts'): Promise<string> {
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(fixture)
  try {
    const rsbuild = await createRsbuild({
      cwd: fixture,
      config: {
        ...createRsbuildConfig({ mode: 'production', bundleDependencies: true, entry: path.join(fixture, 'src', entry), ...externals }),
        performance: { printFileSize: false },
      },
    })
    rsbuild.onAfterBuild(({ stats }) => {
      warnings = (stats?.toJson({ all: false, warnings: true }).warnings ?? []).map(warning => stripVTControlCharacters(warning.message))
    })
    await rsbuild.build()
  } finally {
    cwd.mockRestore()
  }
  return readFileSync(path.join(fixture, 'dist', 'main.js'), 'utf8')
}

/** Runs the bundle from a directory with no node_modules anywhere above it, as a deployed dist is. */
function runAlone(): ReturnType<typeof spawnSync> {
  const alone = mkdtempSync(path.join(tmpdir(), 'meocord-optional-'))
  try {
    cpSync(path.join(fixture, 'dist'), alone, { recursive: true })
    writeFileSync(path.join(alone, 'package.json'), JSON.stringify({ type: 'module' }))
    return spawnSync('node', [path.join(alone, 'main.js')], { cwd: alone, encoding: 'utf8' })
  } finally {
    rmSync(alone, { recursive: true, force: true })
  }
}

beforeAll(() => {
  rmSync(fixture, { recursive: true, force: true })
  mkdirSync(path.join(fixture, 'src'), { recursive: true })
  writeFileSync(
    path.join(fixture, 'package.json'),
    JSON.stringify({ name: 'optional-spec', private: true, type: 'module', dependencies: { debug: '*' } }),
  )
  writeFileSync(path.join(fixture, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'es2022' } }))
  writeFileSync(path.join(fixture, 'src', 'main.ts'), MAIN)
  writeFileSync(path.join(fixture, 'src', 'esm-main.ts'), "import 'supports-color'\nconsole.log('started')\n")
  // The spec relies on it: a bundle that imported supports-color would find it here otherwise
  expect(() => execFileSync('node', ['-e', "require.resolve('supports-color')"], { cwd: fixture, stdio: 'pipe' })).toThrow()
})

afterAll(() => {
  rmSync(fixture, { recursive: true, force: true })
})

describe('optionalExternals, built and run with node', () => {
  it('keeps the require where debug calls it, with no import hoisted to the top', async () => {
    const output = await build({ optionalExternals: ['supports-color'] })

    // A require (minified to a short name) in a module debug loads inside its try, never an import
    expect(output).toMatch(/\b\w+\(["']supports-color["']\)/)
    expect(output).not.toMatch(/from\s*["']supports-color["']/)
  })

  it('starts without supports-color installed', async () => {
    await build({ optionalExternals: ['supports-color'] })

    const run = runAlone()

    expect(run.status).toBe(0)
    expect(run.stdout).toContain('started')
  })

  it('warns about nothing', async () => {
    await build({ optionalExternals: ['supports-color'] })

    expect(warnings).toEqual([])
  })

  // Listed in externals instead, a CommonJS require stays a require where debug calls it, inside its try
  it('starts with a package debug requires listed in externals instead, as a require does', async () => {
    const output = await build({ externals: ['supports-color'] })

    expect(output).toMatch(/\b\w+\(["']supports-color["']\)/)
    expect(output).not.toMatch(/import\(["']supports-color["']\)|from\s*["']supports-color["']/)
    expect(runAlone()).toMatchObject({ status: 0, stdout: expect.stringContaining('started') })
  })

  // An ESM import of an external is a dynamic import where its importer runs, which fails when the package is missing
  it('fails at startup for a package the application imports, listed in externals and missing', async () => {
    const output = await build({ externals: ['supports-color'] }, 'esm-main.ts')

    expect(output).toMatch(/import\(["']supports-color["']\)/)
    const run = runAlone()
    expect(run.status).not.toBe(0)
    expect(run.stderr).toContain('supports-color')
    expect(run.stdout).not.toContain('started')
  })
}, 120_000)

describe('supports-color missing and not in optionalExternals', () => {
  it("replaces the bundler's raw warning with one naming optionalExternals", async () => {
    await build({})

    expect(warnings.join('\n')).not.toContain("Can't resolve")
    expect(warnings).toEqual([expect.stringMatching(/⚠ debug tries to load supports-color, .*optionalExternals: \['supports-color'\]/)])
  })

  it('still starts without it', async () => {
    await build({})

    const run = runAlone()

    expect(run.status).toBe(0)
    expect(run.stdout).toContain('started')
  })
}, 120_000)
