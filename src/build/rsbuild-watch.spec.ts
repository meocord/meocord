import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { createRsbuild } from '@rsbuild/core'
import { vi } from 'vitest'
import { createRsbuildConfig } from '@src/build/rsbuild-config.js'

/** Longer than the window in which a watcher takes a file written just before it started for a change. */
const SETTLE_MS = 2500

let fixture: string

beforeEach(() => {
  fixture = realpathSync(mkdtempSync(path.join(tmpdir(), 'meocord-watch-spec-')))
  mkdirSync(path.join(fixture, 'src'))
  writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({ name: 'watch-spec', private: true, type: 'module' }))
  writeFileSync(path.join(fixture, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'es2022' } }))
  writeFileSync(path.join(fixture, 'src', 'main.ts'), "console.log('watched')\n")
  writeFileSync(path.join(fixture, 'meocord.config.ts'), 'export default {}\n')
})

afterEach(() => {
  rmSync(fixture, { recursive: true, force: true })
})

/**
 * Runs a development watch build of the fixture after compiling its config, as `start --dev` does, calls `during` once
 * the first build is done, and counts builds.
 */
async function countWatchBuilds(during: () => void = () => {}): Promise<number> {
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(fixture)
  let builds = 0
  try {
    const configEntry = path.join(fixture, 'meocord.config.ts')
    const configBase = createRsbuildConfig({ mode: 'development', entry: configEntry })
    const config = await createRsbuild({
      cwd: fixture,
      config: {
        ...configBase,
        source: { ...configBase.source, entry: { 'meocord.config': configEntry } },
        output: { ...configBase.output, distPath: { root: path.join(fixture, 'dist', '.config') } },
        performance: { printFileSize: false },
      },
    })
    await config.build()

    const rsbuild = await createRsbuild({
      cwd: fixture,
      config: { ...createRsbuildConfig({ mode: 'development' }), performance: { printFileSize: false } },
    })
    rsbuild.onAfterBuild(() => {
      builds++
    })
    const watching = await rsbuild.build({ watch: true })
    during()
    await new Promise(resolve => setTimeout(resolve, SETTLE_MS))
    await watching.close()
  } finally {
    cwd.mockRestore()
  }
  return builds
}

describe('a development watch build', () => {
  it('builds once, and never again for the tsconfig MeoCord writes for it', async () => {
    expect(await countWatchBuilds()).toBe(1)
  })

  it('builds again when a source file changes', async () => {
    const builds = await countWatchBuilds(() => writeFileSync(path.join(fixture, 'src', 'main.ts'), "console.log('changed')\n"))

    expect(builds).toBe(2)
  })
}, 30_000)
