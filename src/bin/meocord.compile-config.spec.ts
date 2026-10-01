import { vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'

const { builds } = vi.hoisted(() => ({
  // Each build writes its output, then waits until the test lets it finish
  builds: [] as { tag: string; release: () => void }[],
}))

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

vi.mock('@src/util/meocord-source-config.util.js', () => ({ loadMeoCordSourceConfig: () => ({}) }))

vi.mock('@rsbuild/core', () => ({
  createRsbuild: async ({ config }: { config: { output: { distPath: { root: string } } } }) => ({
    build: async () => {
      const tag = `build ${builds.length + 1}`
      mkdirSync(config.output.distPath.root, { recursive: true })
      writeFileSync(path.join(config.output.distPath.root, 'meocord.config.mjs'), tag)
      await new Promise<void>(release => builds.push({ tag, release }))
    },
  }),
}))

const { MeoCordCLI } = await import('@src/bin/meocord.js')

describe('compileConfig', () => {
  let project: string
  let exit: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    builds.length = 0
    project = mkdtempSync(path.join(tmpdir(), 'meocord-compile-'))
    writeFileSync(path.join(project, 'meocord.config.ts'), 'export default {}\n')
    writeFileSync(path.join(project, 'tsconfig.json'), '{}')
    vi.spyOn(process, 'cwd').mockReturnValue(project)
    exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(project, { recursive: true, force: true })
  })

  const dist = () => path.join(project, 'dist')
  const until = async (count: number) => vi.waitFor(() => expect(builds.length).toBe(count))

  it('moves the compiled config into dist and leaves no staging behind', async () => {
    const compile = new MeoCordCLI().compileConfig({ mode: 'development' })
    await until(1)
    builds[0].release()
    await compile

    expect(readFileSync(path.join(dist(), 'meocord.config.mjs'), 'utf-8')).toBe('build 1')
    expect(readdirSync(dist())).toEqual(['meocord.config.mjs'])
    expect(exit).not.toHaveBeenCalled()
  })

  // Such as the development watcher rebuilding while `meocord build` runs
  it('lets two overlapping compiles each finish, without clobbering each other', async () => {
    const first = new MeoCordCLI().compileConfig({ mode: 'development' })
    await until(1)
    const second = new MeoCordCLI().compileConfig({ mode: 'development' })
    await until(2)

    builds[0].release()
    await first
    expect(readFileSync(path.join(dist(), 'meocord.config.mjs'), 'utf-8')).toBe('build 1')

    builds[1].release()
    await second
    expect(readFileSync(path.join(dist(), 'meocord.config.mjs'), 'utf-8')).toBe('build 2')
    expect(readdirSync(dist())).toEqual(['meocord.config.mjs'])
    expect(exit).not.toHaveBeenCalled()
  })

  it('keeps the last good config, and no staging, when a compile fails', async () => {
    mkdirSync(dist())
    writeFileSync(path.join(dist(), 'meocord.config.mjs'), 'last good')
    const cli = new MeoCordCLI()
    const compile = cli.compileConfig({ mode: 'development' })
    await until(1)
    rmSync(path.join(dist(), readdirSync(dist()).find(name => name.startsWith('.meocord-config'))!), { recursive: true })
    builds[0].release()
    await compile

    expect(readFileSync(path.join(dist(), 'meocord.config.mjs'), 'utf-8')).toBe('last good')
    expect(readdirSync(dist())).toEqual(['meocord.config.mjs'])
    expect(exit).toHaveBeenCalledWith(1)
    expect(existsSync(path.join(dist(), '.meocord-config'))).toBe(false)
  })
})
