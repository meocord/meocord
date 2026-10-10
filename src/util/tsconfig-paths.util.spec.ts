import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import ts from 'typescript'
import { createRsbuild } from '@rsbuild/core'
import { vi } from 'vitest'
import { createRsbuildConfig } from '@src/build/rsbuild-config.js'
import { readMeoCordSourceConfig } from '@src/util/meocord-source-config.util.js'
import { projectPaths } from '@src/util/tsconfig-paths.util.js'
import { prepareModifiedTsConfig } from '@src/util/tsconfig.util.js'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')
const projects: string[] = []
afterAll(() => projects.forEach(dir => rmSync(dir, { recursive: true, force: true })))

/** A project with `src/config/settings.ts` and these tsconfig files, which installs the repository's typescript. */
function project(files: Record<string, object>): string {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'meocord-paths-')))
  projects.push(dir)
  mkdirSync(path.join(dir, 'src', 'config'), { recursive: true })
  mkdirSync(path.join(dir, 'node_modules'))
  symlinkSync(path.join(repoRoot, 'node_modules', 'typescript'), path.join(dir, 'node_modules', 'typescript'), 'junction')
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'paths', private: true, type: 'module' }))
  writeFileSync(path.join(dir, 'src', 'config', 'settings.ts'), "export const token = 'from @src'\n")
  writeFileSync(path.join(dir, 'src', 'main.ts'), "import { token } from '@src/config/settings'\nconsole.log(token)\n")
  writeFileSync(path.join(dir, 'meocord.config.ts'), "import { token } from '@src/config/settings'\nexport default { discordToken: token }\n")
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    writeFileSync(path.join(dir, file), JSON.stringify(content))
  }
  return dir
}

const inherited = () =>
  project({
    'tsconfig.json': { extends: './config/tsconfig.base.json', include: ['src'] },
    'config/tsconfig.base.json': { compilerOptions: { paths: { '@src/*': ['../src/*'] } } },
  })
const fromBaseUrl = () => project({ 'tsconfig.json': { compilerOptions: { baseUrl: './src', paths: { '@src/*': ['*'] } } } })
const configDir = () =>
  project({ 'tsconfig.json': { compilerOptions: { paths: { '@src/*': ['${configDir}/src/*'] } }, include: ['${configDir}/src'] } })

function inProject<T>(dir: string, run: () => T): T {
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(dir)
  try {
    return run()
  } finally {
    cwd.mockRestore()
  }
}

describe('tsconfig paths, read as tsc reads them', () => {
  it.each([
    ['inherited through extends', inherited],
    ['relative to baseUrl', fromBaseUrl],
    ['written with ${configDir}', configDir],
  ])('loads a meocord.config.ts that imports through paths %s', (_, make) => {
    const dir = make()

    // The module as jiti gives it, its default export the config, or why it could not be loaded
    expect(inProject(dir, () => readMeoCordSourceConfig())).toMatchObject({ config: { default: { discordToken: 'from @src' } } })
  })

  it.each([
    ['inherited through extends', inherited],
    ['written with ${configDir}', configDir],
  ])("gives the build's tsconfig copy the paths %s, made absolute from the project", (_, make) => {
    const dir = make()

    const copy = JSON.parse(readFileSync(inProject(dir, () => prepareModifiedTsConfig()), 'utf8'))

    expect(copy.compilerOptions.paths).toEqual({ '@src/*': [path.join(dir, 'src', '*')] })
  })

  it('makes a ${configDir} include the project, not the directory the copy is written in', () => {
    const dir = configDir()

    const copy = JSON.parse(readFileSync(inProject(dir, () => prepareModifiedTsConfig()), 'utf8'))

    expect(copy.include).toEqual([path.join(dir, 'src')])
  })

  it('builds an application that imports through ${configDir} paths', async () => {
    const dir = configDir()

    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(dir)
    try {
      const config = createRsbuildConfig({ mode: 'development', entry: path.join(dir, 'src', 'main.ts') })
      const rsbuild = await createRsbuild({ cwd: dir, config: { ...config, performance: { printFileSize: false } } })
      await expect(rsbuild.build()).resolves.toBeDefined()
    } finally {
      cwd.mockRestore()
    }
    expect(readFileSync(path.join(dir, 'dist', 'main.js'), 'utf8')).toContain('from @src')
  }, 60_000)

  it("reads the project's tsconfig.json alone without typescript installed", () => {
    const dir = inherited()

    expect(projectPaths(dir, ts)).toEqual({ '@src/*': [path.join(dir, 'src', '*')] })
    expect(projectPaths(dir, null)).toBeUndefined()
  })
})
