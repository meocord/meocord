import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { vi } from 'vitest'
import { BUNDLE_ENTRY_KEY } from '@src/util/bundle-entry.util.js'

let project: string

/** A fresh copy of the module, so its cache starts empty. */
async function freshLoader() {
  vi.resetModules()
  return import('@src/util/meocord-config-loader.util.js')
}

beforeEach(() => {
  project = mkdtempSync(path.join(tmpdir(), 'meocord-config-'))
  vi.spyOn(process, 'cwd').mockReturnValue(project)
})

afterEach(() => {
  vi.restoreAllMocks()
  Reflect.deleteProperty(globalThis, BUNDLE_ENTRY_KEY)
  rmSync(project, { recursive: true, force: true })
})

function writeCompiledConfig(source: string) {
  mkdirSync(path.join(project, 'dist'), { recursive: true })
  writeFileSync(path.join(project, 'dist', 'meocord.config.mjs'), source)
}

/** Text as a regular expression matches it, character for character. */
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

describe('loadMeoCordConfig', () => {
  it('loads the default export of dist/meocord.config.mjs', async () => {
    writeCompiledConfig(`export default { appName: 'Compiled', discordToken: 'token' }\n`)
    const { loadMeoCordConfig } = await freshLoader()

    expect(loadMeoCordConfig()).toEqual({ appName: 'Compiled', discordToken: 'token' })
  })

  // The source is the CLI's to read. A bot has no transpiler for it, and in production no source.
  it('does not read meocord.config.ts, even when there is no compiled config', async () => {
    writeFileSync(path.join(project, 'meocord.config.ts'), `export default { appName: 'Source' }\n`)
    const { loadMeoCordConfig } = await freshLoader()

    expect(loadMeoCordConfig()).toBeUndefined()
  })

  // MeoCordFactory.create reports it, once; the loader runs earlier, in the pre-entry and for the logger, and stays quiet
  it('keeps why a compiled config failed to load, prints nothing, and returns undefined', async () => {
    writeCompiledConfig(`throw new Error('broken config')\n`)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { loadMeoCordConfig } = await freshLoader()

    expect(loadMeoCordConfig()).toBeUndefined()
    expect(error).not.toHaveBeenCalled()
  })

  it('loads once and returns the cached result after', async () => {
    writeCompiledConfig(`export default { appName: 'First' }\n`)
    const { loadMeoCordConfig } = await freshLoader()
    const first = loadMeoCordConfig()
    writeCompiledConfig(`export default { appName: 'Second' }\n`)

    expect(loadMeoCordConfig()).toBe(first)
  })

  // pm2 without a cwd, a unit file without WorkingDirectory, or `cd dist && node main.js`
  it('finds a built bot\'s config beside its bundle, wherever the bot was started from', async () => {
    writeCompiledConfig(`export default { appName: 'Beside' }\n`)
    Reflect.set(globalThis, BUNDLE_ENTRY_KEY, path.join(project, 'dist', 'main.js'))
    vi.spyOn(process, 'cwd').mockReturnValue(tmpdir())
    const { loadMeoCordConfig, compiledConfigProblem } = await freshLoader()

    expect(loadMeoCordConfig()).toEqual({ appName: 'Beside' })
    expect(compiledConfigProblem()).toBeUndefined()
  })

  // Started from elsewhere, a bot has to say where it looked and where it was started to say what is wrong
  it('says whether a config was missing or failed to load, and where it looked', async () => {
    const compiled = path.join(project, 'dist', 'meocord.config.mjs')
    const missing = await freshLoader()
    expect(missing.loadMeoCordConfig()).toBeUndefined()
    expect(missing.compiledConfigProblem()).toEqual({ path: compiled, missing: true })
    expect(missing.compiledConfigMessage()).toBe(
      `MeoCord config not found at ${compiled} (working directory ${project}). Run \`meocord build\`, and start the bot from the dist it writes.`,
    )

    // A reason that ends with a full stop of its own still gives one
    writeCompiledConfig(`throw new Error('dotenv is not installed.')\n`)
    const failed = await freshLoader()
    expect(failed.loadMeoCordConfig()).toBeUndefined()
    expect(failed.compiledConfigProblem()).toEqual({ path: compiled, missing: false, error: expect.objectContaining({ message: 'dotenv is not installed.' }) })
    expect(failed.compiledConfigMessage()).toBe(
      `MeoCord config at ${compiled} failed to load: dotenv is not installed. Fix meocord.config.ts, then run \`meocord build\`.`,
    )
  })

  // A package the config imports that is not installed is fixed by installing it, not by editing the config
  it('names a package the compiled config imports that is not installed, and says to install it', async () => {
    const compiled = path.join(project, 'dist', 'meocord.config.mjs')
    writeCompiledConfig(`import '@meocord-missing/probe/config'\nexport default {}\n`)
    const failed = await freshLoader()

    expect(failed.loadMeoCordConfig()).toBeUndefined()
    expect(failed.compiledConfigMessage()).toMatch(
      new RegExp(`^MeoCord config at ${escapeRegExp(compiled)} failed to load: .*@meocord-missing/probe.*\\. Install @meocord-missing/probe in the project, then run \`meocord build\`\\.$`, 's'),
    )
  })

  // Node and Bun both name the module that imports a missing package, here one installed in the project
  it('names the installed package that imports a missing one', async () => {
    const needs = path.join(project, 'node_modules', '@meocord-probe', 'needs')
    mkdirSync(needs, { recursive: true })
    writeFileSync(path.join(needs, 'package.json'), JSON.stringify({ name: '@meocord-probe/needs', type: 'module', main: 'index.js' }))
    writeFileSync(path.join(needs, 'index.js'), `import 'meocord-missing-dependency'\nexport default 1\n`)
    writeCompiledConfig(`import '@meocord-probe/needs'\nexport default {}\n`)
    const failed = await freshLoader()

    expect(failed.loadMeoCordConfig()).toBeUndefined()
    expect(failed.compiledConfigMessage()).toMatch(
      /\. Install meocord-missing-dependency, which @meocord-probe\/needs imports, in the project, then run `meocord build`\.$/,
    )
  })

  // A "#" specifier is the project's own import map, which Bun reports as a package it cannot find
  it('keeps the fix-the-config wording for a subpath import, which is no package to install', async () => {
    writeCompiledConfig(
      `const error = new Error("Cannot find package '#internal' imported from " + import.meta.filename)\n` +
        `error.code = 'ERR_MODULE_NOT_FOUND'\nthrow error\n`,
    )
    const failed = await freshLoader()

    expect(failed.loadMeoCordConfig()).toBeUndefined()
    expect(failed.compiledConfigMessage()).toMatch(/Fix meocord\.config\.ts, then run `meocord build`\.$/)
  })

  it('keeps the fix-the-config wording for a file of its own the compiled config cannot find', async () => {
    writeCompiledConfig(`import './missing-local.mjs'\nexport default {}\n`)
    const failed = await freshLoader()

    expect(failed.loadMeoCordConfig()).toBeUndefined()
    expect(failed.compiledConfigMessage()).toMatch(/Fix meocord\.config\.ts, then run `meocord build`\.$/)
  })

  // The logger and the factory import this module, so a bot bundled with bundleDependencies
  // carries whatever it imports. jiti would be most of a minimal bot's bundle.
  it('imports no transpiler', () => {
    const source = readFileSync(path.join(import.meta.dirname, 'meocord-config-loader.util.ts'), 'utf8')
    const imports = [...source.matchAll(/^import .* from '([^']+)'/gm)].map(match => match[1])

    expect(imports).not.toContain('jiti')
    // bundle-entry imports only node:fs
    expect(imports.filter(specifier => /^(@src\/|\.)/.test(specifier))).toEqual(['@src/interface/index.js', './bundle-entry.util.js'])
  })
})
