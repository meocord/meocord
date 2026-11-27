import { spawnSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { ESLint, type Linter } from 'eslint'
import meocordESLint from '../meocord.eslint.mjs'

// A bot linted with `meocord/eslint` as a package of a workspace, by ESLint's own CLI in a process of its own, so ESLint
// loads the bot's config file as it does for a user: .ts through jiti on Node and natively on Bun, the others natively
const repo = path.resolve(import.meta.dirname, '..')
const eslintBin = path.join(repo, 'node_modules', 'eslint', 'bin', 'eslint.js')

const compilerOptions = { strict: true, module: 'ESNext', moduleResolution: 'Bundler', paths: { '@src/*': ['./src/*'] } }
// A generated app's three tsconfigs: specs only in tsconfig.test.json, the `@src/*` alias in the one the others extend
const TSCONFIGS = {
  'tsconfig.json': { compilerOptions, include: ['src/**/*.ts'], exclude: ['src/**/*.spec.ts'] },
  'tsconfig.test.json': { extends: './tsconfig.json', include: ['src/**/*.ts'], exclude: [] },
  // The tooling files a generated app lints, its eslint.config.ts among them
  'tsconfig.eslint.json': { extends: './tsconfig.json', include: ['eslint.config.ts'] },
}
const SOURCES = {
  // Two services that import each other by the alias, which only the bot's tsconfig resolves
  'alpha.ts': "import { Bravo } from '@src/bravo'\n\nexport class Alpha {\n  constructor(readonly bravo: Bravo) {}\n}\n",
  'bravo.ts': "import { Alpha } from '@src/alpha'\n\nexport class Bravo {\n  constructor(readonly alpha: Alpha) {}\n}\n",
  // A promise nothing awaits, which only a typed rule reports, in a source and in a spec only tsconfig.test.json includes
  'dropped.ts': 'export async function run(): Promise<void> {\n  fail()\n}\n\nasync function fail(): Promise<void> {}\n',
  'dropped.spec.ts': 'export async function check(): Promise<void> {\n  fail()\n}\n\nasync function fail(): Promise<void> {}\n',
}
const ESM_CONFIG = "import meocordESLint from 'meocord/eslint'\n\nexport default [...meocordESLint]\n"
const CONFIGS: Record<string, string> = {
  'eslint.config.ts': ESM_CONFIG,
  'eslint.config.cjs': "module.exports = [...require('meocord/eslint')]\n",
  'eslint.config.mjs': ESM_CONFIG,
  // A .js config in a "type": "module" package is an ES module
  'eslint.config.js': ESM_CONFIG,
}
// Where a package manager installs the bot's packages: hoisted to the workspace root, or beside the bot alone
const LAYOUTS = { npm: '', pnpm: path.join('packages', 'bot') }

const workspaces: string[] = []
afterAll(() => workspaces.forEach(root => fs.rmSync(root, { recursive: true, force: true })))

function workspace(layout: keyof typeof LAYOUTS, config: string): string {
  // The real path: macOS links its temp folder, and ESLint reports files where the link points
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'meocord-eslint-workspace-')))
  workspaces.push(root)
  const bot = path.join(root, 'packages', 'bot')
  fs.mkdirSync(path.join(bot, 'src'), { recursive: true })
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'repo', private: true, workspaces: ['packages/*'] }))
  fs.writeFileSync(path.join(bot, 'package.json'), JSON.stringify({ name: 'bot', private: true, type: 'module' }))
  for (const [name, tsconfig] of Object.entries(TSCONFIGS)) fs.writeFileSync(path.join(bot, name), JSON.stringify(tsconfig))
  for (const [name, text] of Object.entries(SOURCES)) fs.writeFileSync(path.join(bot, 'src', name), text)
  fs.writeFileSync(path.join(bot, config), CONFIGS[config])
  // meocord itself and the resolver its cycle check loads, linked as the package manager installs them
  const modules = path.join(root, LAYOUTS[layout], 'node_modules')
  fs.mkdirSync(modules, { recursive: true })
  fs.symlinkSync(repo, path.join(modules, 'meocord'), 'junction')
  const resolver = 'eslint-import-resolver-typescript'
  fs.symlinkSync(path.join(repo, 'node_modules', resolver), path.join(modules, resolver), 'junction')
  return root
}

interface Lint { fatal: string[]; floating: string[]; cycles: string[] }

function lint(root: string, from: 'root' | 'bot'): Lint {
  const cwd = from === 'root' ? root : path.join(root, 'packages', 'bot')
  const output = path.join(root, 'lint.json')
  const target = from === 'root' ? path.join('packages', 'bot') : '.'
  // The runtime running this suite, Node or Bun, runs ESLint too
  const run = spawnSync(process.execPath, [eslintBin, target, '--format', 'json', '--output-file', output], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NODE_OPTIONS: '' },
  })
  if (!fs.existsSync(output)) throw new Error(`ESLint wrote no results (exit ${run.status}):\n${run.stderr}${run.stdout}`)
  const results = JSON.parse(fs.readFileSync(output, 'utf8')) as {
    filePath: string
    messages: { ruleId: string | null; fatal?: boolean; message: string }[]
  }[]
  const where = (rule: (id: string | null, fatal?: boolean) => boolean) =>
    results.flatMap(result =>
      result.messages.filter(message => rule(message.ruleId, message.fatal)).map(message => `${path.basename(result.filePath)}: ${message.message}`),
    )
  return {
    fatal: where((_id, fatal) => fatal === true),
    floating: where(id => id === '@typescript-eslint/no-floating-promises').map(line => line.split(':')[0]),
    cycles: where(id => id === 'import-x/no-cycle').map(line => line.split(':')[0]),
  }
}

describe.each(Object.keys(LAYOUTS) as (keyof typeof LAYOUTS)[])('a bot of a %s workspace', layout => {
  describe.each(Object.keys(CONFIGS))('with %s', config => {
    const root = workspace(layout, config)

    // Typed rules read the bot's own tsconfigs, and the cycle check resolves the alias they declare
    it.each(['root', 'bot'] as const)("lints with the bot's tsconfigs from the workspace %s", from => {
      expect(lint(root, from)).toEqual({
        fatal: [],
        floating: ['dropped.spec.ts', 'dropped.ts'],
        cycles: ['alpha.ts', 'bravo.ts'],
      })
    })
  })
})

describe('a tsconfigRootDir the app sets', () => {
  // The bot's tsconfigs in a folder of their own, which only the app's own root finds
  it('wins over the folder of its eslint.config.*', async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'meocord-eslint-root-')))
    workspaces.push(root)
    const configs = path.join(root, 'config')
    fs.mkdirSync(path.join(root, 'src'), { recursive: true })
    fs.mkdirSync(configs)
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'bot', private: true, type: 'module' }))
    fs.writeFileSync(path.join(root, 'eslint.config.js'), 'export default []\n')
    const options = { strict: true, module: 'ESNext', moduleResolution: 'Bundler' }
    for (const name of Object.keys(TSCONFIGS)) {
      fs.writeFileSync(path.join(configs, name), JSON.stringify({ compilerOptions: options, include: ['../src/**/*.ts'] }))
    }
    fs.writeFileSync(path.join(root, 'src', 'dropped.ts'), SOURCES['dropped.ts'])

    const eslint = new ESLint({
      cwd: root,
      overrideConfigFile: true,
      overrideConfig: [...(meocordESLint as Linter.Config[]), { files: ['**/*.ts'], languageOptions: { parserOptions: { tsconfigRootDir: configs } } }],
    })
    const [result] = await eslint.lintFiles([path.join(root, 'src', 'dropped.ts')])

    expect(result.messages.filter(message => message.fatal || message.ruleId === '@typescript-eslint/no-floating-promises').map(message => message.ruleId)).toEqual([
      '@typescript-eslint/no-floating-promises',
    ])
  })
})
