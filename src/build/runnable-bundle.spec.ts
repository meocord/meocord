import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { createRsbuild, rspack } from '@rsbuild/core'
import { vi } from 'vitest'
import { createRsbuildConfig } from '@src/build/rsbuild-config.js'
import { freeCommonJsGlobals, nonEvalDevtool } from '@src/build/runnable-bundle.js'

describe('nonEvalDevtool', () => {
  it.each([
    ['eval-source-map', 'source-map'],
    ['eval-cheap-module-source-map', 'cheap-module-source-map'],
    ['eval-cheap-source-map', 'cheap-source-map'],
    ['eval-nosources-source-map', 'nosources-source-map'],
    ['eval', false],
  ])('builds %s as %s, and says why', (devtool, replacement) => {
    const replaced = nonEvalDevtool(devtool)

    expect(replaced?.devtool).toBe(replacement)
    expect(replaced?.message).toContain(`"${devtool}"`)
    expect(replaced?.message).toContain('import.meta')
  })

  it.each(['source-map', 'cheap-module-source-map', 'hidden-source-map', false, undefined])('leaves %s alone', devtool => {
    expect(nonEvalDevtool(devtool)).toBeUndefined()
  })
})

describe('freeCommonJsGlobals', () => {
  const transform = (code: string, compact = false) =>
    rspack.experiments.swc.transformSync(code, freeCommonJsGlobals(compact)).code

  // As a chunk has them: an ES module's probe in the top scope, a CommonJS module in its factory.
  const chunk = `import { createRequire } from 'node:module'
const load = createRequire(import.meta.url)
var freeExports = typeof exports == 'object' && exports && !exports.nodeType && exports
var freeModule = freeExports && typeof module == 'object' && module && !module.nodeType && module
var modules = {
  cjs(module, exports, require) {
    exports.kind = typeof exports
    module.exports.self = typeof module
    module.exports.options = { module: 1, exports: 2 }
  },
}
export { load, freeModule, modules }
`

  it('makes the free module and exports undefined, as in any ES module', () => {
    const output = transform(chunk)

    expect(output).toContain("var freeExports = typeof undefined == 'object' && undefined && !undefined.nodeType && undefined")
    expect(output).toContain("var freeModule = freeExports && typeof undefined == 'object' && undefined")
  })

  it('leaves a CommonJS factory its own module and exports, and every property named after them', () => {
    const output = transform(chunk)

    expect(output).toMatch(/cjs ?\(module, exports, require\)/)
    expect(output).toContain('exports.kind = typeof exports')
    expect(output).toContain('module.exports.self = typeof module')
    expect(output).toContain('module: 1')
    expect(output).toContain('exports: 2')
  })

  it('leaves import.meta and the imports alone', () => {
    const output = transform(chunk)

    expect(output).toContain('createRequire(import.meta.url)')
    expect(output).toContain("from 'node:module'")
  })

  it('prints a minified chunk as compactly as it was, and changes nothing else', () => {
    const minified = 'var a="object"==typeof exports&&exports;function f(e,t){t.x=typeof t}export{a,f};'

    expect(transform(minified, true)).toBe('var a="object"==typeof undefined&&undefined;function f(e,t){t.x=typeof t}export{a,f};')
  })
})

/**
 * A bundled build of an entry that imports an ES module probing for CommonJS, as lodash-es does, and a
 * CommonJS module, under an eval devtool set as an application's hook would set it; then run on Node
 * and on Bun, where the free probes would make the whole bundle CommonJS.
 */
describe('a bundled build with an ES module that probes for CommonJS, under an eval devtool', () => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'meocord-runnable-'))
  const bun = process.versions.bun ? process.execPath : 'bun'

  beforeAll(() => {
    const write = (file: string, content: string) => {
      mkdirSync(path.dirname(path.join(fixture, file)), { recursive: true })
      writeFileSync(path.join(fixture, file), content)
    }
    write('package.json', JSON.stringify({ name: 'runnable-spec', private: true, type: 'module' }))
    write('tsconfig.json', JSON.stringify({ compilerOptions: { target: 'es2022' } }))
    write('node_modules/esm-probe/package.json', JSON.stringify({ name: 'esm-probe', type: 'module', main: 'index.js' }))
    write(
      'node_modules/esm-probe/index.js',
      [
        "var freeExports = typeof exports == 'object' && exports && !exports.nodeType && exports",
        "var freeModule = freeExports && typeof module == 'object' && module && !module.nodeType && module",
        "export const runtime = freeModule ? 'commonjs' : 'esm'",
      ].join('\n'),
    )
    write('node_modules/cjs-dep/package.json', JSON.stringify({ name: 'cjs-dep', main: 'index.js' }))
    write('node_modules/cjs-dep/index.js', "module.exports = { kind: typeof module === 'object' ? 'commonjs' : 'lost' }\n")
    write(
      'src/main.ts',
      [
        "import { runtime } from 'esm-probe'",
        "import cjs from 'cjs-dep'",
        'console.log(JSON.stringify({ esm: runtime, cjs: cjs.kind, url: import.meta.url.startsWith("file:") }))',
      ].join('\n'),
    )
  })

  afterAll(() => {
    rmSync(fixture, { recursive: true, force: true })
  })

  async function build(mode: 'production' | 'development') {
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(fixture)
    try {
      const base = createRsbuildConfig({ mode, bundleDependencies: true, entry: path.join(fixture, 'src', 'main.ts') })
      // As an application's rsbuild hook sets a devtool of its own.
      base.tools = { ...base.tools, rspack: config => ({ ...config, devtool: 'eval-source-map' }) }
      const rsbuild = await createRsbuild({ cwd: fixture, config: { ...base, performance: { printFileSize: false } } })
      const { stats } = await rsbuild.build()
      return stats?.toJson({ all: false, warnings: true }).warnings?.map(warning => warning.message) ?? []
    } finally {
      cwd.mockRestore()
    }
  }

  const run = (runtime: string, args: string[]) =>
    JSON.parse(execFileSync(runtime, [...args, path.join(fixture, 'dist', 'main.js')], { cwd: fixture, encoding: 'utf8' }).trim())

  it.each(['production', 'development'] as const)('starts on Node and on Bun from a %s build, and says it replaced the devtool', async mode => {
    const warnings = await build(mode)

    expect(warnings.join('\n')).toContain('"eval-source-map" devtool')
    const expected = { esm: 'esm', cjs: 'commonjs', url: true }
    expect(run('node', [])).toEqual(expected)
    expect(run(bun, ['--no-install'])).toEqual(expected)
  })
}, 120_000)
