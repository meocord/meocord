import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { createRsbuild } from '@rsbuild/core'
import { vi } from 'vitest'
import { createRsbuildConfig } from '@src/build/rsbuild-config.js'
import { jitiAliases, readMeoCordSourceConfig } from '@src/util/meocord-source-config.util.js'
import { prepareModifiedTsConfig } from '@src/util/tsconfig.util.js'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')
const projects: string[] = []
afterAll(() => projects.forEach(dir => rmSync(dir, { recursive: true, force: true })))

/**
 * A project with `src/config/settings.ts` and these tsconfig files. It installs the repository's typescript, 6, or a
 * stand-in for 7, whose main export has no compiler API.
 */
function project(files: Record<string, object>, typescript: 6 | 7 = 6): string {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'meocord-paths-')))
  projects.push(dir)
  mkdirSync(path.join(dir, 'src', 'config'), { recursive: true })
  mkdirSync(path.join(dir, 'node_modules'))
  if (typescript === 6) symlinkSync(path.join(repoRoot, 'node_modules', 'typescript'), path.join(dir, 'node_modules', 'typescript'), 'junction')
  else {
    mkdirSync(path.join(dir, 'node_modules', 'typescript'))
    writeFileSync(path.join(dir, 'node_modules', 'typescript', 'package.json'), JSON.stringify({ name: 'typescript', version: '7.0.2', main: 'index.js' }))
    writeFileSync(path.join(dir, 'node_modules', 'typescript', 'index.js'), 'module.exports = {}\n')
  }
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

const inherited = (typescript: 6 | 7 = 6) =>
  project(
    {
      'tsconfig.json': { extends: './config/tsconfig.base.json', include: ['src'] },
      'config/tsconfig.base.json': { compilerOptions: { paths: { '@src/*': ['../src/*'] } } },
    },
    typescript,
  )
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
    ['inherited through extends', () => inherited()],
    ['inherited through extends, in a project on TypeScript 7', () => inherited(7)],
    ['relative to baseUrl', fromBaseUrl],
    ['written with ${configDir}', configDir],
  ])('loads a meocord.config.ts that imports through paths %s', (_, make) => {
    const dir = make()

    expect(inProject(dir, () => readMeoCordSourceConfig())).toEqual({ config: { discordToken: 'from @src' } })
  })

  it.each([
    ['inherited through extends', () => inherited()],
    ['inherited through extends, in a project on TypeScript 7', () => inherited(7)],
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

  // A Windows target ends in `\\*`, which jiti's alias must lose as a POSIX one loses `/*`
  it.each([
    ['POSIX', { '@src/*': ['/bot/src/*'] }, { '@src': '/bot/src' }],
    ['Windows', { '@src/*': [path.win32.join('C:\\bot', 'src', '*')] }, { '@src': 'C:\\bot\\src' }],
  ])('gives jiti each alias without its star, from a %s path', (_, paths, aliases) => {
    expect(jitiAliases(paths)).toEqual(aliases)
  })
})

// The bundler reads the copy from the temp directory, so it has to name what tsc would from the project
describe("the build's tsconfig copy, read as tsc reads the project's", () => {
  const copyOf = (dir: string) => JSON.parse(readFileSync(inProject(dir, () => prepareModifiedTsConfig()), 'utf8'))
  const preset = { 'node_modules/@tsconfig/preset/package.json': { name: '@tsconfig/preset', version: '1.0.0' } }

  // Each preset declares a paths alias, which the copy carries resolved from the file that declares it
  const alias = { compilerOptions: { paths: { '@preset/*': ['./lib/*'] } } }
  it.each([
    ['a package, as its tsconfig.json', '@tsconfig/preset', {}, 'node_modules/@tsconfig/preset/tsconfig.json'],
    ["a package, as the file its package.json's tsconfig names", '@tsconfig/preset', { tsconfig: 'base.json' }, 'node_modules/@tsconfig/preset/base.json'],
    ['a file in a package, .json added', '@tsconfig/preset/strict', {}, 'node_modules/@tsconfig/preset/strict.json'],
    // As @total-typescript/tsconfig maps its subpaths
    ['a subpath its exports map to another file', '@tsconfig/preset/bundler/dom/app', { exports: { './bundler/dom/app': './bundler/dom.json' } }, 'node_modules/@tsconfig/preset/bundler/dom.json'],
    ['a subpath its exports map to a file in a folder of that name', '@tsconfig/preset/tsc', { exports: { './tsc': './tsc/dom/app.json' } }, 'node_modules/@tsconfig/preset/tsc/dom/app.json'],
  ])('extends %s, not the file its main names, and writes no extends', (_, extendsValue, manifest, file) => {
    const dir = project({
      'tsconfig.json': { extends: extendsValue },
      'node_modules/@tsconfig/preset/package.json': { name: '@tsconfig/preset', version: '1.0.0', main: 'index.js', ...manifest },
      [file]: alias,
    })

    const copy = copyOf(dir)

    expect(copy.extends).toBeUndefined()
    expect(copy.compilerOptions.paths).toEqual({ '@preset/*': [path.join(dir, path.dirname(file), 'lib', '*')] })
  })

  // tsc reads references from this file alone, leaving ${configDir} in them as written
  it('names each project reference from the project, as tsc does', () => {
    const dir = project({ 'tsconfig.json': { references: [{ path: './tsconfig.tools.json' }, { path: '${configDir}/packages/a' }] } })

    expect(copyOf(dir).references).toEqual([{ path: path.join(dir, 'tsconfig.tools.json') }, { path: path.join(dir, '${configDir}', 'packages', 'a') }])
  })

  // Its own and an extended file's, ${configDir} as the project and a relative one from the file that declares it
  it('makes baseUrl and the file lists absolute as tsc resolves them, through extends and ${configDir}', () => {
    const dir = project({
      'tsconfig.json': { extends: './config/tsconfig.base.json', compilerOptions: { baseUrl: '${configDir}/src' }, files: ['./src/main.ts'] },
      'config/tsconfig.base.json': { include: ['${configDir}/src'], exclude: ['../src/skip'] },
    })

    const copy = copyOf(dir)

    expect(copy.compilerOptions).toEqual({ baseUrl: path.join(dir, 'src') })
    expect(copy.files).toEqual([path.join(dir, 'src', 'main.ts')])
    expect(copy.include).toEqual([path.join(dir, 'src')])
    expect(copy.exclude).toEqual([path.join(dir, 'src', 'skip')])
  })

  // The bundler resolves with these alone; another option, which get-tsconfig may infer as an older TypeScript would,
  // could only mislead whatever else read the copy
  it('writes no compiler option but baseUrl and paths', () => {
    const dir = project({
      'tsconfig.json': { extends: './config/tsconfig.base.json', compilerOptions: { target: 'es2022', strict: true, outDir: './dist' } },
      'config/tsconfig.base.json': { compilerOptions: { module: 'nodenext', baseUrl: '../src', paths: { '@src/*': ['*'] }, rootDir: '../src' } },
    })

    expect(Object.keys(copyOf(dir).compilerOptions).sort()).toEqual(['baseUrl', 'paths'])
  })

  async function builds(dir: string): Promise<string> {
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(dir)
    try {
      const config = createRsbuildConfig({ mode: 'development', entry: path.join(dir, 'src', 'main.ts') })
      const rsbuild = await createRsbuild({ cwd: dir, config: { ...config, performance: { printFileSize: false } } })
      await rsbuild.build()
    } finally {
      cwd.mockRestore()
    }
    return readFileSync(path.join(dir, 'dist', 'main.js'), 'utf8')
  }

  it('builds an application that extends a package with no main and imports from a ${configDir} baseUrl', async () => {
    const dir = project({
      'tsconfig.json': { extends: '@tsconfig/preset', compilerOptions: { baseUrl: '${configDir}/src' } },
      ...preset,
      'node_modules/@tsconfig/preset/tsconfig.json': { compilerOptions: { experimentalDecorators: true } },
    })
    mkdirSync(path.join(dir, 'src', 'lib'))
    writeFileSync(path.join(dir, 'src', 'lib', 'thing.ts'), "export const thing = 'from lib'\n")
    writeFileSync(path.join(dir, 'src', 'main.ts'), "import { thing } from 'lib/thing'\nconsole.log(thing)\n")

    expect(await builds(dir)).toContain('from lib')
  }, 60_000)

  // The copy names no extends: Rspack reads one that isn't relative or starting with '/' as a package, so a Windows
  // absolute path, as a copy in the temp directory would carry, was never found
  it('builds an application whose tsconfig.json extends a file beside it and a package, with paths from each', async () => {
    const dir = project({
      'tsconfig.json': { extends: ['./config/tsconfig.base.json', '@tsconfig/preset'] },
      'config/tsconfig.base.json': { compilerOptions: { paths: { '@src/*': ['../src/*'] } } },
      ...preset,
      'node_modules/@tsconfig/preset/tsconfig.json': { compilerOptions: { paths: { '@src/*': ['../../../src/*'], '@preset/*': ['./lib/*'] } } },
    })
    mkdirSync(path.join(dir, 'node_modules', '@tsconfig', 'preset', 'lib'))
    writeFileSync(path.join(dir, 'node_modules', '@tsconfig', 'preset', 'lib', 'shared.ts'), "export const shared = 'from @preset'\n")
    writeFileSync(
      path.join(dir, 'src', 'main.ts'),
      "import { token } from '@src/config/settings'\nimport { shared } from '@preset/shared'\nconsole.log(token, shared)\n",
    )

    const bundle = await builds(dir)

    expect(bundle).toContain('from @src')
    expect(bundle).toContain('from @preset')
  }, 60_000)

  it('builds an application whose tsconfig.json references another project', async () => {
    const dir = project({
      'tsconfig.json': { compilerOptions: { paths: { '@src/*': ['./src/*'] } }, references: [{ path: './tsconfig.tools.json' }] },
      'tsconfig.tools.json': { compilerOptions: { composite: true }, include: ['tools'] },
    })

    expect(await builds(dir)).toContain('from @src')
  }, 60_000)
})
