import { vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'

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

interface PackingCli { packDependencies: (config: object, natives: Map<string, unknown>) => void; logger: { info: ReturnType<typeof vi.fn> } }

describe('packing dependencies into dist', () => {
  let project: string

  beforeEach(() => {
    project = mkdtempSync(path.join(tmpdir(), 'meocord-pack-'))
    mkdirSync(path.join(project, 'dist'))
    vi.spyOn(process, 'cwd').mockReturnValue(project)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(project, { recursive: true, force: true })
  })

  it.each([
    [['left-pad'], 'dist/node_modules holds 1 package; nothing else to install.'],
    [['left-pad', 'right-pad'], 'dist/node_modules holds 2 packages; nothing else to install.'],
  ])('counts the packages it copies for %j', (externals, message) => {
    for (const name of externals) {
      mkdirSync(path.join(project, 'node_modules', name), { recursive: true })
      writeFileSync(path.join(project, 'node_modules', name, 'package.json'), JSON.stringify({ name, version: '1.0.0' }))
    }
    const cli = new MeoCordCLI() as unknown as PackingCli

    cli.packDependencies({ externals }, new Map())

    expect(cli.logger.info).toHaveBeenCalledWith(message)
  })
})
