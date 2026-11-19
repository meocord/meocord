import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { vi } from 'vitest'
import { runtimeBinary } from '@src/spec-runtimes.js'

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

function run(dir: string, runtime: 'node' | 'bun' = 'node') {
  const env = { ...process.env }
  delete env.AT_LOAD
  const args = runtime === 'bun' ? ['--no-env-file', 'dist/main.js'] : ['dist/main.js']
  return spawnSync(runtimeBinary(runtime), args, { cwd: dir, env, encoding: 'utf8' })
}

beforeAll(() => rmSync(root, { recursive: true, force: true }))
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('a built application', () => {
  it.each(['node', 'bun'] as const)('gives a package it imports the values .env sets as the package loads, under %s', async runtime => {
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

    expect(readdirSync(path.join(dir, 'dist')).sort()).toEqual(['main.js', 'main.js.map', 'meocord.build.json', 'meocord.config.mjs'])
  })

  it('packs the package of an external that names a file inside it', async () => {
    const dir = app('subpath', "{ bundleDependencies: true, externals: ['at-load/sub.js'] }", { 'at-load': AT_LOAD }, "import { sub } from 'at-load/sub.js'\nconsole.log(sub)")
    await build(dir)

    expect(existsSync(path.join(dir, 'dist', 'node_modules', 'at-load', 'sub.js'))).toBe(true)
    expect(run(dir).stdout).toContain('sub')
  })
}, 120_000)

/** Writes a package at `dir`: its package.json fields and its files. */
function writePackage(dir: string, fields: Record<string, unknown>, files: Files): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify(fields))
  for (const [file, content] of Object.entries(files)) writeFileSync(path.join(dir, file), content)
}

/**
 * A native package of `version`, an addon beside JavaScript that reports its version and which file of it loaded: an
 * `exports` with an entry for import and for require, and a `./feature` subpath. `conditions` narrows the entries.
 */
function writeNative(dir: string, name: string, version: string, conditions: ('import' | 'require')[] = ['import', 'require']): void {
  const files = { import: ['./esm.js', './feature.js'], require: ['./cjs.cjs', './feature.cjs'] }
  const entry = (index: number) => Object.fromEntries(conditions.map(condition => [condition, files[condition][index]]))
  writePackage(
    dir,
    { name, version, type: 'module', exports: { '.': entry(0), './feature': entry(1) } },
    {
      'addon.node': 'not really a binary',
      'esm.js': `export const version = '${version}'\nexport const format = 'esm'\n`,
      'cjs.cjs': `exports.version = '${version}'\nexports.format = 'cjs'\n`,
      'feature.js': `export const feature = 'feature ${version} esm'\n`,
      'feature.cjs': `exports.feature = 'feature ${version} cjs'\n`,
    },
  )
}

/** A plain package that imports `natpkg` and its subpath, as an ES module. */
const WRAP_ESM: Files = {
  'index.js': `import { version, format } from 'natpkg'\nimport { feature } from 'natpkg/feature'\nexport const report = \`wrap-esm \${version} \${format}, \${feature}\`\n`,
}
/** A plain package that requires `natpkg` and its subpath, as CommonJS. */
const WRAP_CJS: Files = {
  'index.js': `const { version, format } = require('natpkg')\nconst { feature } = require('natpkg/feature')\nexports.report = \`wrap-cjs \${version} \${format}, \${feature}\`\n`,
}
const REPORTS = `import { version, format } from 'natpkg'
import { report as esm } from 'wrap-esm'
import { report as cjs } from 'wrap-cjs'
console.log(\`root \${version} \${format}\`)
console.log(esm)
console.log(cjs)`

/** Runs dist with the application's node_modules moved away, so every package comes from dist. */
function runFromDist(dir: string, runtime: 'node' | 'bun') {
  renameSync(path.join(dir, 'node_modules'), path.join(dir, 'node_modules.away'))
  try {
    return run(dir, runtime)
  } finally {
    renameSync(path.join(dir, 'node_modules.away'), path.join(dir, 'node_modules'))
  }
}

/** Every file under `dir`, by its path with `/` between parts, with its contents. */
function treeOf(dir: string): Record<string, string> {
  const tree: Record<string, string> = {}
  const walk = (at: string) => {
    for (const entry of readdirSync(at, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const file = path.join(at, entry.name)
      if (entry.isDirectory()) walk(file)
      else tree[path.relative(dir, file).split(path.sep).join('/')] = readFileSync(file, 'utf8')
    }
  }
  walk(dir)
  return tree
}

const otherCopies = (dir: string) => {
  const place = path.join(dir, 'dist', 'node_modules', '.meocord')
  return existsSync(place) ? readdirSync(place).sort() : []
}

describe('a self-contained build of a native addon installed more than once', () => {
  it.each(['node', 'bun'] as const)(
    'gives each importer its own copy from dist, for an import, a require and a subpath, under %s',
    async runtime => {
      const dir = path.join(root, 'two-versions')
      if (!existsSync(path.join(dir, 'dist', 'main.js'))) {
        app('two-versions', '{ bundleDependencies: true }', {}, REPORTS)
        const modules = path.join(dir, 'node_modules')
        writeNative(path.join(modules, 'natpkg'), 'natpkg', '1.0.0')
        writePackage(path.join(modules, 'wrap-esm'), { name: 'wrap-esm', version: '1.0.0', type: 'module', main: 'index.js' }, WRAP_ESM)
        writePackage(path.join(modules, 'wrap-cjs'), { name: 'wrap-cjs', version: '1.0.0', type: 'commonjs', main: 'index.js' }, WRAP_CJS)
        // One version, installed twice: two copies at two places
        writeNative(path.join(modules, 'wrap-esm', 'node_modules', 'natpkg'), 'natpkg', '2.0.0')
        writeNative(path.join(modules, 'wrap-cjs', 'node_modules', 'natpkg'), 'natpkg', '2.0.0')
        await build(dir)
      }

      const { stdout, status } = runFromDist(dir, runtime)

      expect(stdout.split('\n')).toEqual(
        expect.arrayContaining(['root 1.0.0 esm', 'wrap-esm 2.0.0 esm, feature 2.0.0 esm', 'wrap-cjs 2.0.0 cjs, feature 2.0.0 cjs']),
      )
      expect(status).toBe(0)
      expect(otherCopies(dir)).toEqual([expect.stringMatching(/^natpkg-2\.0\.0-[0-9a-f]{8}$/), expect.stringMatching(/^natpkg-2\.0\.0-[0-9a-f]{8}$/)])
    },
  )

  it("gives a scoped package's other copy a place that does not nest", async () => {
    const dir = app('scoped', '{ bundleDependencies: true }', {}, "import { version } from '@scope/nat'\nimport { report } from 'wrap-esm'\nconsole.log(`root ${version}`)\nconsole.log(report)")
    const modules = path.join(dir, 'node_modules')
    writeNative(path.join(modules, '@scope', 'nat'), '@scope/nat', '1.0.0')
    writePackage(path.join(modules, 'wrap-esm'), { name: 'wrap-esm', version: '1.0.0', type: 'module', main: 'index.js' }, {
      'index.js': "import { version } from '@scope/nat'\nexport const report = `wrap-esm ${version}`\n",
    })
    writeNative(path.join(modules, 'wrap-esm', 'node_modules', '@scope', 'nat'), '@scope/nat', '2.0.0')
    await build(dir)

    expect(runFromDist(dir, 'node').stdout.split('\n')).toEqual(expect.arrayContaining(['root 1.0.0', 'wrap-esm 2.0.0']))
    expect(otherCopies(dir)).toEqual([expect.stringMatching(/^@scope\+nat-2\.0\.0-[0-9a-f]{8}$/)])
  })

  it('gives each other copy the same place when the project is built from another directory', async () => {
    const placesIn = async (name: string) => {
      const dir = app(name, '{ bundleDependencies: true }', {}, "import { version } from 'natpkg'\nimport { report } from 'wrap-esm'\nconsole.log(`root ${version}`)\nconsole.log(report)")
      const modules = path.join(dir, 'node_modules')
      writeNative(path.join(modules, 'natpkg'), 'natpkg', '1.0.0')
      writePackage(path.join(modules, 'wrap-esm'), { name: 'wrap-esm', version: '1.0.0', type: 'module', main: 'index.js' }, {
        'index.js': "import { version } from 'natpkg'\nexport const report = `wrap-esm ${version}`\n",
      })
      writeNative(path.join(modules, 'wrap-esm', 'node_modules', 'natpkg'), 'natpkg', '2.0.0')
      await build(dir)
      return otherCopies(dir)
    }

    const here = await placesIn('checkout-one')
    expect(here).toHaveLength(1)
    expect(await placesIn(path.join('elsewhere', 'checkout-two'))).toEqual(here)
  })

  it('packs the same dist whichever import the bundler meets first, when no copy is at the root', async () => {
    const packed = async (name: string, order: string[]) => {
      const imports = order.map(wrap => `import { report as ${wrap.replace('-', '')} } from '${wrap}'`)
      const dir = app(name, '{ bundleDependencies: true }', {}, [...imports, ...order.map(wrap => `console.log(${wrap.replace('-', '')})`)].join('\n'))
      writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, private: true, type: 'module', dependencies: { dotenv: '*', 'wrap-a': '1.0.0', 'wrap-b': '1.0.0' } }))
      for (const [wrap, version] of [['wrap-a', '1.0.0'], ['wrap-b', '2.0.0']]) {
        const modules = path.join(dir, 'node_modules', wrap)
        writePackage(modules, { name: wrap, version: '1.0.0', type: 'module', main: 'index.js', dependencies: { natpkg: version } }, {
          'index.js': `import { version } from 'natpkg'\nexport const report = \`${wrap} \${version}\`\n`,
        })
        writeNative(path.join(modules, 'node_modules', 'natpkg'), 'natpkg', version)
      }
      await build(dir)
      return { tree: treeOf(path.join(dir, 'dist', 'node_modules')), stdout: runFromDist(dir, 'node').stdout.split('\n').sort() }
    }

    const forward = await packed('no-root-forward', ['wrap-a', 'wrap-b'])
    const backward = await packed('no-root-backward', ['wrap-b', 'wrap-a'])

    expect(forward.stdout).toEqual(expect.arrayContaining(['wrap-a 1.0.0', 'wrap-b 2.0.0']))
    expect(Object.keys(forward.tree)).toContain('natpkg/package.json')
    expect(JSON.parse(forward.tree['natpkg/package.json']).version).toBe('1.0.0')
    expect(backward).toEqual(forward)
  })

  // Under pnpm each native package resolves its own copy of a shared dependency, and only one can sit at the top
  it('packs the same dist whichever native package the bundler meets first, when they need two versions of one dependency', async () => {
    const packed = async (name: string, order: string[]) => {
      const imports = order.map(nat => `import { version as ${nat.replace('-', '')} } from '${nat}'`)
      const dir = app(name, '{ bundleDependencies: true }', {}, [...imports, `console.log(${order.map(nat => nat.replace('-', '')).join(', ')})`].join('\n'))
      const modules = path.join(dir, 'node_modules')
      for (const [nat, depVersion] of [['nat-a', '1.0.0'], ['nat-b', '2.0.0']]) {
        const store = path.join(modules, '.pnpm', `${nat}@1.0.0`, 'node_modules')
        writePackage(path.join(store, nat), { name: nat, version: '1.0.0', type: 'module', main: 'index.js', dependencies: { dep: depVersion } }, {
          'index.js': "export { version } from 'dep'\n",
          'addon.node': 'not really a binary',
        })
        writePackage(path.join(store, 'dep'), { name: 'dep', version: depVersion, type: 'module', main: 'index.js' }, {
          'index.js': `export const version = '${depVersion}'\n`,
        })
        symlinkSync(path.join(store, nat), path.join(modules, nat), 'junction')
      }
      await build(dir)
      return treeOf(path.join(dir, 'dist', 'node_modules'))
    }

    const forward = await packed('two-deps-forward', ['nat-a', 'nat-b'])
    const backward = await packed('two-deps-backward', ['nat-b', 'nat-a'])

    expect(JSON.parse(forward['dep/package.json']).version).toBe('1.0.0')
    expect(JSON.parse(forward['nat-b/node_modules/dep/package.json']).version).toBe('2.0.0')
    expect(backward).toEqual(forward)
  })

  it("packs one copy for pnpm's links to one store copy", async () => {
    const dir = app('pnpm-links', '{ bundleDependencies: true }', {}, "import { version } from 'natpkg'\nimport { report } from 'wrap-esm'\nconsole.log(`root ${version}`)\nconsole.log(report)")
    const modules = path.join(dir, 'node_modules')
    const store = path.join(modules, '.pnpm', 'natpkg@1.0.0', 'node_modules', 'natpkg')
    writeNative(store, 'natpkg', '1.0.0')
    symlinkSync(store, path.join(modules, 'natpkg'), 'junction')
    writePackage(path.join(modules, 'wrap-esm'), { name: 'wrap-esm', version: '1.0.0', type: 'module', main: 'index.js' }, {
      'index.js': "import { version } from 'natpkg'\nexport const report = `wrap-esm ${version}`\n",
    })
    mkdirSync(path.join(modules, 'wrap-esm', 'node_modules'))
    symlinkSync(store, path.join(modules, 'wrap-esm', 'node_modules', 'natpkg'), 'junction')
    await build(dir)

    expect(runFromDist(dir, 'node').stdout.split('\n')).toEqual(expect.arrayContaining(['root 1.0.0', 'wrap-esm 1.0.0']))
    expect(otherCopies(dir)).toEqual([])
  })

  it('stops the build, naming the copy and the request, when the copy has no file for it', async () => {
    const dir = app('no-entry', '{ bundleDependencies: true }', {}, "import { version } from 'natpkg'\nimport { report } from 'wrap-cjs'\nconsole.log(version, report)")
    const modules = path.join(dir, 'node_modules')
    writeNative(path.join(modules, 'natpkg'), 'natpkg', '1.0.0')
    writePackage(path.join(modules, 'wrap-cjs'), { name: 'wrap-cjs', version: '1.0.0', type: 'commonjs', main: 'index.js' }, {
      'index.js': "exports.report = require('natpkg').version\n",
    })
    writeNative(path.join(modules, 'wrap-cjs', 'node_modules', 'natpkg'), 'natpkg', '2.0.0', ['import'])
    // The bundler prints why its build failed itself
    const printed: unknown[] = []
    const capture = (...args: unknown[]) => void printed.push(...args)
    vi.spyOn(console, 'log').mockImplementation(capture)
    vi.spyOn(console, 'error').mockImplementation(capture)

    await expect(build(dir)).rejects.toThrow('the build exited with 1')

    expect(printed.map(String).join('\n')).toContain(
      `natpkg resolves to a second installed copy of natpkg, 2.0.0 in ${path.join('node_modules', 'wrap-cjs', 'node_modules', 'natpkg')}, ` +
        'and the bundler resolves a require of it to no file of that copy',
    )
  })
}, 120_000)
