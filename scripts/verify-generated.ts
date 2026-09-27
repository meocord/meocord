/**
 * Generates an application and every component with the built CLI, installs it from the packed
 * framework, and runs the application's own checks: both tsconfigs, tests, coverage, both builds and
 * lint without `--fix`. Run after `bun run build`; packing covers the `files` list and `exports` map.
 */

import { spawnSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { ControllerType } from '../src/enum/controller.enum.js'
import { builtCli, cleanEnv, installedCliOf, outputOf, pack as packInto, renderApp, repoRoot } from './lib/packed-app.js'

/**
 * Outside the repository, so module resolution cannot climb into the repository's node_modules and
 * find a package the application forgot to declare.
 */
const workDir = mkdtempSync(path.join(tmpdir(), 'meocord-verify-'))
const appDir = path.join(workDir, 'app')

/** The CLI as the application installed it, from the packed tarball. */
const installedCli = installedCliOf(appDir)

const stepEnv = cleanEnv()

/**
 * Runs a command, printing one line on success and the command's full output on failure. `silent` fails it
 * for printing anything at all, as a warning a tool prints outside its own count would otherwise pass.
 */
function run(label: string, command: string, args: string[], cwd: string, { quiet = false, silent = false } = {}): void {
  const started = performance.now()
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: stepEnv })
  const seconds = ((performance.now() - started) / 1000).toFixed(1)
  const where = `${[command, ...args].join(' ')}, in ${path.relative(workDir, cwd) || '.'}`

  if (result.status !== 0) {
    const output = outputOf(result)
    throw new Error(`${label} failed (${where}):\n\n` + (output || String(result.error ?? `exit code ${result.status}`)))
  }
  if (silent && outputOf(result)) throw new Error(`${label} printed output where a clean run prints none (${where}):\n\n${outputOf(result)}`)

  if (!quiet) console.log(`  ok  ${label} (${seconds}s)`)
}

/** Runs a script or bin of the application the way `bun run` does, honouring each bin's shebang. */
function inApp(label: string, ...args: string[]): void {
  run(label, process.execPath, ['run', ...args], appDir)
}

/** Every file under a directory, skipping installed and built output. Symlinks are not followed. */
function filesIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === 'node_modules' || entry.name === 'dist') return []
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? filesIn(full) : [full]
  })
}

/** Packs the framework into the work directory. */
function pack(): string {
  const started = performance.now()
  const tarball = packInto(workDir)
  console.log(`  ok  pack the framework (${((performance.now() - started) / 1000).toFixed(1)}s)`)
  return tarball
}

/**
 * Runs the built CLI once per argument list, reported as one step.
 *
 * Always before the project has node_modules: a generator formats what it writes with the project's
 * own `eslint --fix` when it finds one, which would hide the lint failures this check looks for.
 */
function generate(label: string, cwd: string, commands: string[][]): void {
  if (existsSync(path.join(cwd, 'node_modules'))) throw new Error(`${label}: generate before installing`)

  const started = performance.now()
  for (const args of commands) run(`${label}: meocord ${args.join(' ')}`, process.execPath, [builtCli, ...args], cwd, { quiet: true })
  console.log(`  ok  ${label}: ${commands.length} generated (${((performance.now() - started) / 1000).toFixed(1)}s)`)
}

/** Renders the application template and points its framework dependency at the packed build. */
function createApp(tarball: string): void {
  renderApp(appDir, tarball)
}

/**
 * Runs every generator inside the application, so its lint, tsconfigs and tests cover the
 * generated guards, interceptors, filters, pipes, services and controllers too.
 */
function generateComponents(): void {
  // Each kind under three names, one nested under a folder named like another: a generated component
  // must never collide with another, nor with the samples the template ships
  const commands = ['Generated', 'second', 'admin/second'].flatMap(name => [
    ...Object.values(ControllerType).map(type => ['g', 'co', type, name]),
    ['g', 's', name],
    ['g', 'gu', name],
    ['g', 'i', name],
    ['g', 'f', name],
    ['g', 'pi', name],
    ['g', 'ob', name],
  ])
  generate('components in the application', appDir, commands)
  run('install the application', process.execPath, ['install'], appDir)
  if (!existsSync(installedCli)) throw new Error(`The packed framework has no CLI at ${path.relative(appDir, installedCli)}`)
}

/**
 * Generates every controller type under one name shape in a project of its own, and typechecks it.
 * Each shape stands alone: flat names write the top-level builder, which would let a nested
 * controller's wrong import to it resolve. The project borrows the application's installed packages.
 */
function verifyShape(label: string, name: string): void {
  const dir = path.join(workDir, label)
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify({ name: label, type: 'module', private: true }, null, 2)}\n`)
  const tsconfig = {
    extends: '../app/tsconfig.test.json',
    compilerOptions: { rootDir: '.', paths: { '@src/*': ['./src/*'] } },
    include: ['src/**/*.ts'],
    exclude: ['node_modules'],
  }
  writeFileSync(path.join(dir, 'tsconfig.json'), `${JSON.stringify(tsconfig, null, 2)}\n`)

  generate(`${label} controllers`, dir, Object.values(ControllerType).map(type => ['g', 'co', type, name]))
  symlinkSync(path.join(appDir, 'node_modules'), path.join(dir, 'node_modules'), 'dir')
  run(`typecheck ${label} controllers`, process.execPath, ['run', 'tsc', '-p', 'tsconfig.json'], dir)
}

/** Every class a generated or sample file exports under `dir`, with its `@src` import path, by file suffix. */
function exportedClasses(dir: string, suffix: string): { name: string; from: string }[] {
  return filesIn(path.join(appDir, 'src', dir))
    .filter(file => file.endsWith(suffix))
    .map(file => ({
      name: readFileSync(file, 'utf8').match(/^export class (\w+)/m)![1],
      from: `@src/${path.relative(path.join(appDir, 'src'), file).split(path.sep).join('/').replace(/\.ts$/, '')}`,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Lists every controller and observer in the application, as its developer would after generating them,
 * with a spec that its routes are apart and that it builds; and imports an image and a Markdown file, as
 * the README shows. The application's own checks then cover all of it.
 */
function registerComponents(): void {
  const controllers = exportedClasses('controllers', '.controller.ts')
  const observers = exportedClasses('observers', '.observer.ts')
  const imports = [...controllers, ...observers].map(({ name, from }) => `import { ${name} } from '${from}'`).join('\n')
  writeFileSync(
    path.join(appDir, 'src', 'app.ts'),
    `import { GatewayIntentBits, Partials } from 'discord.js'\nimport { MeoCord } from 'meocord/decorator'\n${imports}\n\n` +
      `@MeoCord({\n  controllers: [${controllers.map(({ name }) => name).join(', ')}],\n  observers: [${observers.map(({ name }) => name).join(', ')}],\n` +
      `  clientOptions: {\n    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMessageReactions, GatewayIntentBits.MessageContent],\n` +
      `    partials: [Partials.Message, Partials.Reaction],\n  },\n})\nexport default class App {}\n`,
  )
  writeFileSync(
    path.join(appDir, 'src', 'app.spec.ts'),
    `import { findRouteConflicts, MeoCordTestingModule } from 'meocord/testing'\nimport App from '@src/app'\n${controllers.map(({ name, from }) => `import { ${name} } from '${from}'`).join('\n')}\n\n` +
      `describe('App', () => {\n  it('routes every component apart', () => {\n    expect(findRouteConflicts(App)).toEqual([])\n  })\n\n` +
      `  it('builds with every controller, its message patterns apart', () => {\n    expect(() =>\n      MeoCordTestingModule.create({ app: App, controllers: [${controllers.map(({ name }) => name).join(', ')}] }).compile(),\n    ).not.toThrow()\n  })\n})\n`,
  )
  mkdirSync(path.join(appDir, 'src', 'assets'), { recursive: true })
  writeFileSync(path.join(appDir, 'src', 'assets', 'logo.png'), Buffer.from('89504e470d0a1a0a', 'hex'))
  writeFileSync(path.join(appDir, 'src', 'assets', 'notes.md'), '# Notes\n')
  // Type-only, so tsc checks the imports against src/types/assets.d.ts and vitest never loads the files
  writeFileSync(
    path.join(appDir, 'src', 'assets.spec.ts'),
    `type Logo = typeof import('@src/assets/logo.png').default\ntype Notes = typeof import('@src/assets/notes.md').default\n\n` +
      `describe('asset imports', () => {\n  it('give an image as its path and Markdown as its text', () => {\n    expectTypeOf<Logo>().toEqualTypeOf<string>()\n    expectTypeOf<Notes>().toEqualTypeOf<string>()\n  })\n})\n`,
  )
  // Written by a script rather than by hand, so formatted as a developer's editor would
  run('format the registered application', process.execPath, ['run', 'prettier', '--write', 'src/app.ts', 'src/app.spec.ts', 'src/assets.spec.ts'], appDir, { quiet: true })
  console.log(`  ok  register ${controllers.length} controllers and ${observers.length} observers, and import assets`)
}

/**
 * Checks the template's asset declarations sit beside Rsbuild's own, for an application that also
 * references them: the same modules declared twice must still typecheck.
 */
function verifyAssetTypesBesideRsbuild(): void {
  const file = path.join(appDir, 'src', 'rsbuild-env.d.ts')
  writeFileSync(file, '/// <reference types="@rsbuild/core/types" />\n')
  try {
    inApp('tsc beside @rsbuild/core/types', 'tsc', '-p', 'tsconfig.json')
  } finally {
    rmSync(file)
  }
}

/**
 * Plants files no spec imports, as an application grows them: a decorated service and a plain module with
 * type annotations. Coverage reads every file it includes, tested or not, so both have to be readable there.
 */
function plantUntestedFiles(): void {
  mkdirSync(path.join(appDir, 'src', 'services', 'untested'), { recursive: true })
  writeFileSync(
    path.join(appDir, 'src', 'services', 'untested', 'ledger.service.ts'),
    `import { Service } from 'meocord/decorator'\n\n@Service()\nexport class LedgerService {\n  private readonly entries: number[] = []\n\n` +
      `  add(amount: number): number {\n    this.entries.push(amount)\n    return this.entries.reduce((sum, entry) => sum + entry, 0)\n  }\n}\n`,
  )
  mkdirSync(path.join(appDir, 'src', 'utils'), { recursive: true })
  writeFileSync(
    path.join(appDir, 'src', 'utils', 'format.ts'),
    `export interface Amount {\n  value: number\n  currency: string\n}\n\nexport const formatAmount = ({ value, currency }: Amount): string => \`\${value.toFixed(2)} \${currency}\`\n`,
  )
  console.log('  ok  plant a decorated service and a typed module that no spec imports')
}

/** The application's own checks. */
function runAppScripts(): void {
  // Without --noEmit: the tsconfigs set it, and a user running plain `tsc` must not find
  // compiled files -- a meocord.config.js above all -- written beside their sources.
  const before = new Set(filesIn(appDir))
  inApp('tsc -p tsconfig.json', 'tsc', '-p', 'tsconfig.json')
  inApp('tsc -p tsconfig.test.json', 'tsc', '-p', 'tsconfig.test.json')
  const emitted = filesIn(appDir).filter(file => !before.has(file))
  if (emitted.length > 0) throw new Error(`tsc wrote files into the application: ${emitted.join(', ')}`)

  inApp('test', 'test')
  inApp('test:coverage', 'test:coverage')
  inApp('build --dev', 'build:dev')
  inApp('build --prod', 'build:prod')
  if (!existsSync(path.join(appDir, 'dist', 'main.js'))) throw new Error('build --prod wrote no dist/main.js')

  // Without --fix, since generated code has to pass lint as written, and with no warnings allowed, from a rule
  // or printed by a plugin: a new user's first `bun run lint` shows either. Last, so it also proves the lint
  // config skips the coverage report and build output written above.
  run('eslint, without --fix', process.execPath, ['run', 'eslint', '--max-warnings=0'], appDir, { silent: true })
}

/**
 * Runs a spec that logs, after the builds have left a dist/meocord.config.mjs: a test must not load .env
 * through it, since the compiled config imports dotenv. Tests load .env only when their setup does.
 */
function verifyTestsKeepEnvOut(): void {
  const envFile = path.join(appDir, '.env')
  const spec = path.join(appDir, 'src', 'env-probe.spec.ts')
  if (!existsSync(path.join(appDir, 'dist', 'meocord.config.mjs'))) throw new Error('The builds wrote no dist/meocord.config.mjs')
  const envBefore = existsSync(envFile) ? readFileSync(envFile, 'utf8') : undefined
  writeFileSync(envFile, `${envBefore ?? ''}PROBE_VAR=from-dotenv\n`)
  writeFileSync(
    spec,
    `import { Logger } from 'meocord/common'\n\nit('leaves .env unloaded when it logs', () => {\n` +
      `  expect(process.env.PROBE_VAR).toBeUndefined()\n  new Logger().log('probe')\n  expect(process.env.PROBE_VAR).toBeUndefined()\n})\n`,
  )
  try {
    inApp('a spec that logs after a build leaves .env unloaded', 'vitest', 'run', 'src/env-probe.spec.ts')
  } finally {
    rmSync(spec)
    if (envBefore === undefined) rmSync(envFile)
    else writeFileSync(envFile, envBefore)
  }
}

/**
 * Augments the app's theme as a user would, in the src/types/theme.d.ts the template ships, and reads the role
 * through useTheme(), type-checked against the packed build: a bundling change that moved the theme's interfaces
 * where an augmentation cannot reach them would pass the framework's own tests, which import from src.
 */
function verifyThemeAugmentation(): void {
  const declarations = path.join(appDir, 'src', 'types', 'theme.d.ts')
  const probe = path.join(appDir, 'src', 'theme-probe.ts')
  const shipped = readFileSync(declarations, 'utf8')
  writeFileSync(
    declarations,
    `import 'meocord/interface'\nimport { type ColorResolvable } from 'discord.js'\n\n` +
      `declare module 'meocord/interface' {\n  interface ThemeColors {\n    vip: ColorResolvable\n  }\n}\n`,
  )
  writeFileSync(
    probe,
    `import { useTheme } from 'meocord/common'\nimport { type RootTheme } from 'meocord/interface'\n\n` +
      `export const vip = useTheme().colors.vip\nexport const root: RootTheme = { colors: { vip: '#FFD700' } }\n` +
      `// @ts-expect-error vip has no default, so the root theme must set it\nexport const missing: RootTheme = {}\n`,
  )
  try {
    inApp('an augmented theme role, read through useTheme()', 'tsc', '-p', 'tsconfig.json')
  } finally {
    rmSync(probe)
    writeFileSync(declarations, shipped)
  }
}

/** Reads the deprecated Theme, which the app's lint reports as a warning naming what replaces it, and nothing else. */
function verifyDeprecatedWarning(): void {
  const file = path.join(appDir, 'src', 'deprecated-probe.ts')
  writeFileSync(file, `import { Theme } from 'meocord/common'\n\nexport const primary = Theme.primaryColor\n`)
  try {
    const result = spawnSync(process.execPath, ['run', 'eslint', '--format', 'json', 'src/deprecated-probe.ts'], {
      cwd: appDir,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      env: stepEnv,
    })
    const messages = (JSON.parse(result.stdout) as { messages: { ruleId: string | null; severity: number; message: string }[] }[])
      .flatMap(report => report.messages)
    const deprecated = messages.filter(message => message.ruleId === '@typescript-eslint/no-deprecated' && message.severity === 1)
    if (deprecated.length === 0 || deprecated.length !== messages.length || !deprecated.some(({ message }) => message.includes('useTheme'))) {
      throw new Error(
        `eslint should warn that Theme is deprecated, naming useTheme(), and nothing else:\n` +
          messages.map(message => `  ${message.ruleId}: ${message.message}`).join('\n'),
      )
    }
  } finally {
    rmSync(file)
  }
  console.log('  ok  eslint warns on the deprecated Theme, naming useTheme()')
}

/**
 * Plants two services that import each other through `@src` and checks the application's lint warns on
 * both, with no error: the resolver has to follow the alias for the cycle to be seen at all.
 */
function verifyCycleWarning(): void {
  const dir = path.join(appDir, 'src', 'services', 'cycle')
  const service = (name: string, other: string) =>
    `import { Service } from 'meocord/decorator'\nimport { ${other} } from '@src/services/cycle/${other.toLowerCase()}.service'\n\n` +
    `@Service()\nexport class ${name} {\n  constructor(readonly ${other.toLowerCase()}: ${other}) {}\n}\n`
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'first.service.ts'), service('First', 'Second'))
  writeFileSync(path.join(dir, 'second.service.ts'), service('Second', 'First'))
  try {
    const result = spawnSync(process.execPath, ['run', 'eslint', '--format', 'json', 'src/services/cycle'], {
      cwd: appDir,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      env: stepEnv,
    })
    const messages = (JSON.parse(result.stdout) as { messages: { ruleId: string | null; severity: number; message: string }[] }[])
      .flatMap(report => report.messages)
    // By its text too: the rule reports an import it cannot resolve under its own name
    const cycles = messages.filter(
      message =>
        message.ruleId === 'import-x/no-cycle' && message.severity === 1 && message.message.startsWith('Dependency cycle'),
    )
    const others = messages.filter(message => !cycles.includes(message))
    if (cycles.length !== 2 || others.length > 0) {
      throw new Error(
        `eslint should warn once per file on two services that import each other, and nothing else:\n` +
          messages.map(message => `  ${message.ruleId}: ${message.message}`).join('\n'),
      )
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  console.log('  ok  eslint warns on two services that import each other')
}

/**
 * Checks the CLI's interpreter line is `#!/usr/bin/env <prog>`, the only form npm's `cmd-shim`
 * turns into a `.cmd` that Windows can run.
 */
function verifyShebang(): void {
  const [interpreter] = readFileSync(installedCli, 'utf8').split('\n', 1)

  if (interpreter !== '#!/usr/bin/env node') {
    throw new Error(`CLI interpreter line is "${interpreter}", which npm cannot shim on Windows.`)
  }

  console.log('  ok  CLI interpreter line is shimmable on Windows')
}

function cleanUp(): void {
  rmSync(workDir, { recursive: true, force: true })
}

function main(): void {
  if (!existsSync(builtCli)) {
    console.error(`Built CLI not found at ${path.relative(repoRoot, builtCli)}. Run "bun run build" first.`)
    cleanUp()
    process.exit(1)
  }

  // An interrupted run would otherwise leave a full install behind in the temp directory.
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      cleanUp()
      process.exit(130)
    })
  }

  const started = performance.now()
  try {
    console.log(`Verifying a generated application in ${workDir}\n`)
    createApp(pack())
    generateComponents()
    registerComponents()
    plantUntestedFiles()
    console.log('')
    runAppScripts()
    verifyTestsKeepEnvOut()
    verifyAssetTypesBesideRsbuild()
    verifyThemeAugmentation()
    verifyDeprecatedWarning()
    verifyCycleWarning()
    console.log('')
    // A nested name moves the controller and its builder together, so the import
    // between them has to move with them.
    verifyShape('flat', 'Sample')
    verifyShape('nested', 'admin/nested')
    verifyShebang()

    console.log(`\nThe generated application passes its own checks (${((performance.now() - started) / 1000).toFixed(0)}s).`)
  } catch (error) {
    console.error(`\n${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  } finally {
    cleanUp()
  }
}

main()
