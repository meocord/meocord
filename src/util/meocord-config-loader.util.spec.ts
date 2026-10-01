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

  // MeoCordFactory.create reports it, once; the loader runs earlier, for the logger, and stays quiet
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

  // Started from elsewhere, a bot told only to build again had nothing to go on
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

  // The logger and the factory import this module, so a bot bundled with bundleDependencies
  // carries whatever it imports. jiti would be most of a minimal bot's bundle.
  it('imports no transpiler', () => {
    const source = readFileSync(path.join(import.meta.dirname, 'meocord-config-loader.util.ts'), 'utf8')
    const imports = [...source.matchAll(/^import .* from '([^']+)'/gm)].map(match => match[1])

    expect(imports).not.toContain('jiti')
    // bundle-entry imports only node:fs
    expect(imports.filter(specifier => specifier.startsWith('@src/'))).toEqual(['@src/interface/index.js', '@src/util/bundle-entry.util.js'])
  })
})
