import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'fs'
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
  // A watcher takes a file written just before it starts for a change, as it does MeoCord's tsconfig copy, so the fixture
  // is dated well before, as a project's files are. An mtime in the future would make it build once the clock passes it.
  const earlier = new Date(Date.now() - 10_000)
  for (const file of ['package.json', 'tsconfig.json', 'src/main.ts', 'meocord.config.ts', 'src', '.']) {
    utimesSync(path.join(fixture, file), earlier, earlier)
  }
})

afterEach(() => {
  rmSync(fixture, { recursive: true, force: true })
})

/** How long a test waits for a build it expects, as a bound on a slow machine, never as a window to count in. */
const BUILD_TIMEOUT_MS = 30_000

/**
 * Starts a development watch build of the fixture after compiling its config, as `start --dev` does. `rebuilds` lists,
 * for each build after the first, the files the watcher reported changed, relative to the fixture; `untilBuilds`
 * resolves once that many builds, the first included, are done.
 */
async function watchBuilds() {
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(fixture)
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
  const runs: string[][] = []
  rsbuild.onAfterCreateCompiler(({ compiler }) => {
    if ('compilers' in compiler) throw new Error('expected a single compiler')
    // Every run after the first names the files that made it run
    compiler.hooks.watchRun.tap('watch-spec', ({ modifiedFiles, removedFiles }) => {
      const changed = [...(modifiedFiles ?? []), ...(removedFiles ?? [])]
      runs.push(changed.map(file => path.relative(fixture, file).split(path.sep).join('/')).sort())
    })
  })
  let builds = 0
  const waiters = new Set<() => void>()
  rsbuild.onAfterBuild(() => {
    builds++
    for (const waiter of waiters) waiter()
  })
  const watching = await rsbuild.build({ watch: true })

  const untilBuilds = (count: number, timeoutMs = BUILD_TIMEOUT_MS) =>
    new Promise<boolean>(resolve => {
      const check = () => {
        if (builds < count) return
        waiters.delete(check)
        clearTimeout(timer)
        resolve(true)
      }
      const timer = setTimeout(() => {
        waiters.delete(check)
        resolve(false)
      }, timeoutMs)
      waiters.add(check)
      check()
    })

  return {
    rebuilds: () => runs.slice(1),
    untilBuilds,
    close: async () => {
      await watching.close()
      cwd.mockRestore()
    },
  }
}

const settle = () => new Promise(resolve => setTimeout(resolve, SETTLE_MS))

describe('a development watch build', () => {
  it('builds once, and never again for the tsconfig MeoCord writes for it', async () => {
    const watch = await watchBuilds()
    try {
      expect(await watch.untilBuilds(1)).toBe(true)
      // What is asserted is the absence of a rebuild, which only a wait longer than the watcher's window can show
      await settle()
      expect(watch.rebuilds()).toEqual([])
    } finally {
      await watch.close()
    }
  })

  // A watcher may report one edit more than once, so what is asserted is what each rebuild was for, not how many ran
  it('builds again when a source file changes, and only for that file', async () => {
    const watch = await watchBuilds()
    try {
      expect(await watch.untilBuilds(1)).toBe(true)
      writeFileSync(path.join(fixture, 'src', 'main.ts'), "console.log('changed')\n")

      expect(await watch.untilBuilds(2)).toBe(true)
      await settle()
      const rebuilds = watch.rebuilds()
      expect(rebuilds.length).toBeGreaterThan(0)
      for (const changed of rebuilds) expect(changed).toEqual(['src/main.ts'])
    } finally {
      await watch.close()
    }
  })
}, 60_000)
