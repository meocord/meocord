import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { vi } from 'vitest'

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

const { MeoCordCLI } = await import('@src/bin/meocord.js')

/**
 * Builds small applications with `meocord build`, as the CLI does, and runs their dist. They sit in a git-ignored
 * directory in the repository, so the config's `dotenv` import resolves from this package's node_modules.
 */
const root = path.join(path.resolve(import.meta.dirname, '..', '..'), '.rsbuild-dist-spec')

/** A package of the application's: files by name, `index.js` its entry. */
type Files = Record<string, string>

const AT_LOAD: Files = { 'index.js': 'export const atLoad = process.env.AT_LOAD\n', 'sub.js': 'export const sub = "sub"\n' }
// What a napi-rs package does when its binary is for another platform: it throws as it is imported
const ADDON: Files = { 'index.js': 'throw new Error("Cannot find native binding.")\n', 'addon.node': 'not really a binary' }

/** Writes an application at `name` that imports `imports`, with these packages installed and this config. */
function app(name: string, config: string, packages: Record<string, Files>, imports: string): string {
  const dir = path.join(root, name)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(path.join(dir, 'src'), { recursive: true })
  mkdirSync(path.join(dir, 'dist'), { recursive: true })
  for (const [pkg, files] of Object.entries(packages)) {
    const pkgDir = path.join(dir, 'node_modules', pkg)
    mkdirSync(pkgDir, { recursive: true })
    writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: pkg, version: '1.0.0', type: 'module', main: 'index.js' }))
    for (const [file, content] of Object.entries(files)) writeFileSync(path.join(pkgDir, file), content)
  }
  // dotenv resolves from this package's node_modules; listed, so a regular build keeps it out of the bundle
  const dependencies = { dotenv: '*', ...Object.fromEntries(Object.keys(packages).map(pkg => [pkg, '1.0.0'])) }
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, private: true, type: 'module', dependencies }))
  writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { experimentalDecorators: true, target: 'es2022' } }))
  writeFileSync(path.join(dir, '.env'), 'AT_LOAD=from-dotenv\n')
  writeFileSync(path.join(dir, 'meocord.config.ts'), configSource(config))
  writeFileSync(path.join(dir, 'src', 'main.ts'), `${imports}\n`)
  return dir
}

/** A config that loads .env, as an application's does. */
const configSource = (config: string) => `import 'dotenv/config'\nexport default ${config}\n`

/** Builds as `meocord build --prod` does: the application, then the config the bot loads with require(). */
async function build(dir: string, config?: string): Promise<void> {
  if (config) writeFileSync(path.join(dir, 'meocord.config.ts'), configSource(config))
  vi.spyOn(process, 'cwd').mockReturnValue(dir)
  const exit = vi.spyOn(process, 'exit').mockImplementation(code => {
    throw new Error(`the build exited with ${code}`)
  })
  try {
    const cli = new MeoCordCLI()
    await cli.build('production')
    await cli.compileConfig({ mode: 'production' })
  } finally {
    vi.mocked(process.cwd).mockRestore()
    exit.mockRestore()
  }
}

function run(dir: string, runtime = 'node') {
  const env = { ...process.env }
  delete env.AT_LOAD
  const args = runtime === 'bun' ? ['--no-env-file', 'dist/main.js'] : ['dist/main.js']
  return spawnSync(runtime, args, { cwd: dir, env, encoding: 'utf8' })
}

beforeAll(() => rmSync(root, { recursive: true, force: true }))
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('a built application', () => {
  it.each(['node', 'bun'])('gives a package it imports the values .env sets as the package loads, under %s', async runtime => {
    const dir = path.join(root, 'load-order')
    if (!existsSync(path.join(dir, 'dist', 'main.js'))) {
      app('load-order', "{ discordToken: 'token' }", { 'at-load': AT_LOAD }, "import { atLoad } from 'at-load'\nconsole.log(`at load: ${atLoad}`)")
      await build(dir)
    }

    expect(run(dir, runtime).stdout).toContain('at load: from-dotenv')
  })

  it("stops on another platform with MeoCord's message, before a native addon loads", async () => {
    const dir = app('platform', '{ bundleDependencies: true }', { addon: ADDON }, "import 'addon'")
    await build(dir)
    const other = process.platform === 'linux' ? 'darwin' : 'linux'
    writeFileSync(path.join(dir, 'dist', 'meocord.platform.json'), JSON.stringify({ platform: other, arch: process.arch }))

    const result = run(dir)

    expect(result.stderr).toContain(`this build carries native addons compiled for ${other}-${process.arch}`)
    expect(result.stderr).not.toContain('Cannot find native binding')
    expect(result.status).toBe(1)
  })

  it('removes what a self-contained build packed when the next build is not one', async () => {
    const dir = app('repack', '{ bundleDependencies: true }', { addon: ADDON }, "import 'addon'")
    await build(dir)
    expect(readdirSync(path.join(dir, 'dist'))).toEqual(expect.arrayContaining(['node_modules', 'package.json', 'meocord.platform.json']))

    await build(dir, '{}')

    expect(readdirSync(path.join(dir, 'dist')).sort()).toEqual(['main.js', 'main.js.map', 'meocord.config.mjs'])
  })

  it('packs the package of an external that names a file inside it', async () => {
    const dir = app('subpath', "{ bundleDependencies: true, externals: ['at-load/sub.js'] }", { 'at-load': AT_LOAD }, "import { sub } from 'at-load/sub.js'\nconsole.log(sub)")
    await build(dir)

    expect(existsSync(path.join(dir, 'dist', 'node_modules', 'at-load', 'sub.js'))).toBe(true)
    expect(run(dir).stdout).toContain('sub')
  })
}, 120_000)
