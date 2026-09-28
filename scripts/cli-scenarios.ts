/**
 * Runs the real CLI, installed from the packed build, through scenarios that must succeed and scenarios
 * that must fail clearly: each asserts the exit code and what the output says, and that no process is
 * left running. Run after `bun run build`.
 * `--tier fast` (the default) needs no network after one install. `--tier slow` adds an npm install,
 * the bun runtime, bundled builds, sharding and signals; it reaches Discord, where an invalid token
 * is refused. `--windows` runs the subset whose paths and shims differ there; `--only <text>` filters by name.
 */

import { spawn, spawnSync } from 'child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs'
import { createServer, type Server } from 'http'
import { type AddressInfo } from 'net'
import { tmpdir } from 'os'
import path from 'path'
import { ControllerType } from '../src/enum/controller.enum.js'
import { startFakeDiscord } from './lib/fake-discord.js'
import { cleanEnv, installedCliOf, mustRun, outputOf, pack, renderApp } from './lib/packed-app.js'

type Tier = 'fast' | 'slow'
type Runtime = 'node' | 'bun'

/** One CLI run and what it must produce. */
interface Scenario {
  name: string
  tier: Tier
  /** Also run by `--windows`, the subset where Windows paths and shims differ. */
  windows?: boolean
  /** Runs only on these platforms. */
  platforms?: NodeJS.Platform[]
  /** Where it runs: the app bun installed, the app npm installed, an empty directory, or the directory holding the apps. */
  cwd?: 'app' | 'npm-app' | 'empty' | 'parent'
  /** Files written before it runs, relative to cwd; `null` deletes. Restored afterwards. */
  files?: Record<string, string | null>
  /** The CLI's arguments. */
  argv?: string[]
  /** A command run instead of the CLI, such as a package script or the built bundle. */
  command?: string[]
  runtime?: Runtime
  env?: NodeJS.ProcessEnv
  /** CLI runs that must succeed first, such as the build a bundle is run from. */
  before?: string[][]
  /** Paths, relative to cwd, moved away while it runs. */
  hides?: string[]
  /**
   * A signal sent once the output shows `after`: to the whole process group, as a terminal's Ctrl+C is,
   * or to the CLI alone, as Docker, pm2 and systemd send one. `repeatAfterMs` sends it again that much later.
   */
  signal?: { name: NodeJS.Signals; after: string; times?: number; to?: 'group' | 'cli'; repeatAfterMs?: number }
  /** Files changed while it runs, each once the output shows `after` `times` times; restored afterwards. */
  edits?: { after: string; times?: number; files: Record<string, (current: string) => string> }[]
  /** Runs a local Discord, given to the app in `DISCORD_API_ENV`, whose gateway answers IDENTIFY that late. */
  discord?: { readyDelayMs: number }
  timeoutMs?: number
  expect: {
    code: number
    /** Text the output must contain. */
    says?: string[]
    /** Text the output must not contain. */
    never?: string[]
    /** How many times each text must appear in the output. */
    counts?: Record<string, number>
    /** Paths, relative to cwd, that must exist afterwards. */
    creates?: string[]
    /** Paths, relative to cwd, that must not exist afterwards. */
    leaves?: string[]
    /** Text each path, relative to cwd, must contain afterwards. */
    contains?: Record<string, string[]>
    /** Whether the run must leave the directory's files as they were, outside node_modules and dist. */
    writesNothing?: boolean
    /** Paths, relative to cwd, whose content must be what it was before the run. */
    keeps?: string[]
  }
}

// Resolved, because the application finds itself through its resolved working directory, and the
// check for processes left running matches the paths they were started with
const workDir = realpathSync(mkdtempSync(path.join(tmpdir(), 'meocord-cli-')))
const appDir = path.join(workDir, 'app')
const npmAppDir = path.join(workDir, 'npm-app')
const emptyDir = path.join(workDir, 'empty')
const hiddenDir = path.join(workDir, 'hidden')

const validConfig = readFileSync(path.join(import.meta.dirname, '..', 'src', 'bin', 'app-template', 'meocord.config.ts.template'), 'utf8').replace(
  '{{displayName}}',
  'Generated Check',
)

const config = (body: string) => `export default ${body}\n`

/** The template's configuration with `options` set where it suggests sharding. */
const configWith = (options: string) => validConfig.replace("// sharding: { shards: 'auto' },", options)

/** A token Discord refuses, so a login or registration fails the way a wrong token does. */
const INVALID_TOKEN_ENV = 'DISCORD_TOKEN=not-a-real-token\n'
/** What the bot logs when Discord refuses INVALID_TOKEN_ENV's token. */
const REFUSED_TOKEN = 'Discord refused the bot token'

/** An entry that exits with code 3 before logging in, as a startup error in the app's own code does. */
const selfExitingMain = `console.log('Leaving before logging in')\nprocess.exitCode = 3\n`

const templateMain = readFileSync(path.join(import.meta.dirname, '..', 'src', 'bin', 'app-template', 'src', 'main.ts.template'), 'utf8')

/** The template's configuration with its dependencies bundled, and an eval devtool set as a hook sets one. */
const evalBundledConfig = configWith('bundleDependencies: true,').replace(
  '    return config',
  "    config.output = { ...config.output, sourceMap: { js: 'eval-source-map' } }\n    return config",
)

/** The template's entry, first using lodash-es, an ES module that probes for CommonJS with `typeof exports`. */
const lodashMain = `import { camelCase } from 'lodash-es'\nconsole.log(\`lodash-es: \${camelCase('bundled module')}\`)\n${templateMain}`

/**
 * The template's entry, first using packages that make errors the way much of npm does: follow-redirects,
 * which axios loads, and node-fetch 2 give Error.captureStackTrace an object built by a function rather than
 * a class; ioredis's errors are classes; depd sets a stack hook of its own for a moment to find its caller.
 */
const errorMakersMain = `import axios from 'axios'
import depd from 'depd'
import { ReplyError } from 'ioredis'
import { FetchError } from 'node-fetch'

const firstLine = (error: Error) => error.stack?.split('\\n')[0]
depd('stack-probe')('a deprecation, located through a stack hook of its own')
console.log(\`error makers: axios \${typeof axios.get}, \${firstLine(new FetchError('probe', 'system'))}, \${firstLine(new ReplyError('ERR probe'))}\`)
${templateMain}`

/** Names for each generator: a nested one ends like a flat one, and its class name carries its folder. */
const generatedNames = [
  { name: 'Generated', dir: '', className: 'Generated', file: 'generated' },
  { name: 'second', dir: '', className: 'Second', file: 'second' },
  { name: 'admin/second', dir: 'admin/', className: 'AdminSecond', file: 'second' },
]
const pascal = (kebab: string) => kebab.replace(/(^|-)([a-z])/g, (_, _dash, letter: string) => letter.toUpperCase())

/** Every generator run for two of each kind of component. */
const generateTwoOfEach = generatedNames.flatMap(({ name }) => [
  ...Object.values(ControllerType).map(type => ['g', 'co', type, name]),
  ...['s', 'gu', 'i', 'f', 'pi', 'ob'].map(kind => ['g', kind, name]),
])

/** The template's app.ts with every generated controller and observer listed beside the samples. */
const appWithGenerated = (() => {
  const controllers = generatedNames.flatMap(({ dir, className, file }) =>
    Object.values(ControllerType).map(type => ({
      name: `${className}${pascal(type)}Controller`,
      from: `@src/controllers/${type}/${dir}${file}.${type}.controller`,
    })),
  )
  const observers = generatedNames.map(({ dir, className, file }) => ({ name: `${className}Observer`, from: `@src/observers/${dir}${file}.observer` }))
  const template = readFileSync(path.join(import.meta.dirname, '..', 'src', 'bin', 'app-template', 'src', 'app.ts.template'), 'utf8')
  const imports = [...controllers, ...observers].map(({ name, from }) => `import { ${name} } from '${from}'`).join('\n')
  return `${imports}\n${template}`
    .replace('  controllers: [\n', `  controllers: [\n${controllers.map(({ name }) => `    ${name},\n`).join('')}`)
    .replace('  presenter: AppPresenter,\n', `  presenter: AppPresenter,\n  observers: [${observers.map(({ name }) => name).join(', ')}],\n`)
})()

/** Where the stalled API listens: it accepts requests and never answers them. */
const STALLED_API_ENV = 'MEOCORD_SCENARIO_STALLED_API'

/**
 * An application whose login never completes, its REST requests sent to the stalled API: it is up, with
 * its signal handlers installed, and needs no token that works.
 */
const stalledApp = `import { MeoCord } from 'meocord/decorator'

@MeoCord({ controllers: [], clientOptions: { intents: [], rest: { api: process.env.${STALLED_API_ENV} } } })
export default class App {}
`

/** Where a scenario's local Discord listens; see `Scenario.discord`. */
const DISCORD_API_ENV = 'MEOCORD_SCENARIO_DISCORD_API'

/** An application that logs in to the scenario's local Discord, with an onReady hook that says it ran. */
const readyApp = `import { MeoCord } from 'meocord/decorator'
import { ReadyService } from '@src/ready.service'

@MeoCord({ controllers: [], services: [ReadyService], clientOptions: { intents: [], rest: { api: process.env.${DISCORD_API_ENV} } } })
export default class App {}
`
const readyService = `import { Service } from 'meocord/decorator'
import { type OnReady } from 'meocord/interface'

@Service()
export class ReadyService implements OnReady {
  onReady() {
    console.log('Ready hook ran')
  }
}
`

/** What a config looks like halfway through an edit: it no longer parses. */
const HALF_WRITTEN = '\nexport const halfWritten = {\n'

/** A change to a file that leaves what it does as it was. */
const touched = (current: string) => `${current}\n`
/** A template file of the generated app, to change one line of. */
const templateFile = (file: string) =>
  readFileSync(path.join(import.meta.dirname, '..', 'src', 'bin', 'app-template', `${file}.template`), 'utf8')

/** A customId pattern whose param shares its segment with a literal, which @Command refuses as the class loads. */
const refusedPatternButton = templateFile('src/controllers/button/sample.button.controller.ts').replace(
  "'button-with/{ownerId}'",
  "'button-with-{ownerId}'",
)
const REFUSED_PATTERN = 'SampleButtonController.handleButtonWithId: Invalid pattern "button-with-{ownerId}"'

/** A message pattern with words after its rest param, which MeoCordFactory.create refuses. */
const refusedMessagePattern = templateFile('src/controllers/message/sample.message.controller.ts').replace(
  "@MessageHandler('baka')",
  "@MessageHandler('baka {rest...} {x}')",
)
const REFUSED_MESSAGE_PATTERN = "SampleMessageController.baka: @MessageHandler('baka {rest...} {x}')"

/** An entry that leaves bootstrap's rejection unhandled, as a hand-written main.ts may. */
const unhandledMain = `import App from '@src/app'
import { MeoCordFactory } from 'meocord/core'

async function bootstrap() {
  await MeoCordFactory.create(App).start()
}

void bootstrap()
`

/**
 * An entry that has MeoCord refuse a pattern it catches, which starts the reporting, then leaves a rejection of its
 * own unhandled: an Error, or a string, and heard by a listener of its own, or not.
 */
const rejectingMain = (reason: 'error' | 'string' | 'refusal', own: boolean) => `import { route } from 'meocord/common'

try {
  route('item-{id}')
} catch {
  console.log('Refused a pattern and caught it')
}
${own ? "process.on('unhandledRejection', reason => console.log(`The app heard: ${String(reason)}`))\n" : ''}
async function bootstrap() {
  ${
    reason === 'refusal'
      ? "route('a bug in bootstrap/{id}-x')"
      : `throw ${reason === 'error' ? "new Error('a bug in bootstrap')" : "'a bug in bootstrap'"}`
  }
}

void bootstrap()
`

/** A bun test file whose one test expects MeoCordFactory.create to refuse the app. */
const refusedAppTest = `import { expect, test } from 'bun:test'
import { Controller, MeoCord, MessageHandler } from 'meocord/decorator'
import { MeoCordFactory } from 'meocord/core'

@Controller()
class BadMessages {
  @MessageHandler('x {rest...} {y}')
  async m() {}
}

@MeoCord({ controllers: [BadMessages], clientOptions: { intents: [] } })
class BadApp {}

test('refuses the app', () => {
  expect(() => MeoCordFactory.create(BadApp)).toThrow('must be last')
})
`

/** What a runtime prints for an error it reports itself, which a refusal never needs. */
const RAW_REPORT = ['node_modules/meocord/dist', 'Node.js v', 'Error during startup']

/** An entry that ignores the signals that stop a bot, as one stuck in its shutdown does. */
const ignoringMain = `for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => console.log(\`Ignored \${signal}\`))
console.log('Ignoring stop signals')
setInterval(() => {}, 60_000)
`

/** The template's entry, first reporting whether a package another one loads when it can was found. */
const probingMain = `import optionalProbe from 'optional-probe'\nconsole.log(\`optional probe: \${optionalProbe}\`)\n${templateMain}`

/** Installed packages: one that loads another inside a try, as debug loads supports-color, and that other. */
const optionalProbe = {
  'node_modules/optional-probe/package.json': JSON.stringify({ name: 'optional-probe', version: '1.0.0', main: 'index.js' }),
  'node_modules/optional-probe/index.js':
    "let found = 'without color'\ntry {\n  found = require('optional-color')\n} catch {}\nmodule.exports = found\n",
}
const optionalColor = {
  'node_modules/optional-color/package.json': JSON.stringify({ name: 'optional-color', version: '1.0.0', main: 'index.js' }),
  'node_modules/optional-color/index.js': "module.exports = 'with color'\n",
}

/** An installed package that probes for supports-color inside a try, as debug does. */
const colorProbe = {
  'node_modules/color-probe/package.json': JSON.stringify({ name: 'color-probe', version: '1.0.0', main: 'index.js' }),
  'node_modules/color-probe/index.js': "let color = 'none'\ntry {\n  color = require('supports-color')\n} catch {}\nmodule.exports = color\n",
}

/** The binary a runtime is launched with. */
function runtimeBinary(runtime: Runtime): string {
  if (runtime === 'bun') return process.versions.bun ? process.execPath : 'bun'
  return 'node'
}

const dirOf = (scenario: Scenario) => ({ app: appDir, 'npm-app': npmAppDir, empty: emptyDir, parent: workDir })[scenario.cwd ?? 'app']

/** The installed CLI a scenario runs: its own app's, or the bun-installed one outside an app. */
const cliOf = (scenario: Scenario) => installedCliOf(scenario.cwd === 'npm-app' ? npmAppDir : appDir)

/** Writes a scenario's files, returning what restores the directory afterwards. */
function applyFiles(dir: string, files: Record<string, string | null> = {}): () => void {
  // A directory deleted, such as dist, is build output and stays deleted
  const saved = Object.keys(files)
    .map(file => path.join(dir, file))
    .filter(full => !existsSync(full) || !statSync(full).isDirectory())
    .map(full => ({ full, before: existsSync(full) ? readFileSync(full, 'utf8') : null }))
  for (const [file, content] of Object.entries(files)) {
    const full = path.join(dir, file)
    if (content === null) rmSync(full, { recursive: true, force: true })
    else {
      mkdirSync(path.dirname(full), { recursive: true })
      writeFileSync(full, content)
    }
  }
  return () => {
    for (const { full, before } of saved) {
      if (before === null) rmSync(full, { recursive: true, force: true })
      else writeFileSync(full, before)
    }
  }
}

/** Every file under a directory, skipping installed and built output. */
function filesIn(dir: string, root = dir): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === 'node_modules' || entry.name === 'dist') return []
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? filesIn(full, root) : [path.relative(root, full)]
  })
}

/** The processes whose command line names a path inside `dir`; none on Windows, where it is not checked. */
function processesIn(dir: string): { pid: number; command: string }[] {
  if (process.platform === 'win32') return []
  const ps = spawnSync('ps', ['-A', '-o', 'pid=,args='], { encoding: 'utf8' })
  return ps.stdout
    .split('\n')
    .filter(line => line.includes(dir + path.sep))
    .map(line => {
      const [, pid, command] = /^\s*(\d+)\s+(.*)$/.exec(line) ?? []
      return { pid: Number(pid), command }
    })
    .filter(({ pid }) => pid > 0 && pid !== process.pid)
}

/** The processes still running in `dir` once a run has had a moment to finish; they are killed. */
async function leftRunning(dir: string): Promise<string[]> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const left = processesIn(dir)
    if (left.length === 0) return []
    if (attempt < 29) await new Promise(resolve => setTimeout(resolve, 100))
    else {
      for (const { pid } of left) process.kill(pid, 'SIGKILL')
      return left.map(({ command }) => command)
    }
  }
  return []
}

interface Run {
  status: number | null
  output: string
  error?: string
}

/**
 * Runs a command in its own process group, sending the scenario's signal to the group once the output
 * shows what it waits for. Resolves when the command itself exits, even if a child it started holds
 * the output open.
 */
function run(command: string, args: string[], dir: string, scenario: Scenario): Promise<Run> {
  const posix = process.platform !== 'win32'
  const child = spawn(command, args, {
    cwd: dir,
    env: cleanEnv(scenario.env),
    detached: posix,
    shell: !posix && ['npm', 'npx'].includes(command),
  })
  const toGroup = (signal: NodeJS.Signals) => {
    try {
      if (posix) process.kill(-child.pid!, signal)
      else child.kill(signal)
    } catch {
      // Already gone
    }
  }

  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk))
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk))

  return new Promise(resolve => {
    let error: string | undefined
    const timeoutMs = scenario.timeoutMs ?? 120_000
    const timeout = setTimeout(() => {
      error = `did not finish within ${timeoutMs / 1000}s`
      toGroup('SIGKILL')
    }, timeoutMs)

    const { signal } = scenario
    const send = () => {
      if (!signal) return
      if (signal.to === 'cli') child.kill(signal.name)
      else toGroup(signal.name)
    }
    const shown = (text: string, times = 1) => outputOf({ stdout, stderr }).split(text).length - 1 >= times
    const edits = [...(scenario.edits ?? [])]
    let signalled = false
    const watcher =
      (signal || edits.length > 0) &&
      setInterval(() => {
        for (const edit of edits.filter(pending => shown(pending.after, pending.times))) {
          edits.splice(edits.indexOf(edit), 1)
          for (const [file, change] of Object.entries(edit.files)) {
            writeFileSync(path.join(dir, file), change(readFileSync(path.join(dir, file), 'utf8')))
          }
        }
        if (!signal || signalled || !shown(signal.after, signal.times)) return
        signalled = true
        // A moment for the process to settle, as a person pressing Ctrl+C gives it
        setTimeout(() => {
          send()
          if (signal.repeatAfterMs !== undefined) setTimeout(send, signal.repeatAfterMs)
        }, 1_000)
      }, 100)

    child.on('error', spawnError => (error = spawnError.message))
    child.on('exit', status => {
      clearTimeout(timeout)
      if (watcher) clearInterval(watcher)
      setTimeout(() => resolve({ status, output: outputOf({ stdout, stderr }), error }), 200)
    })
  })
}

/** Runs one scenario, returning what went wrong, or nothing when it behaved. */
async function check(scenario: Scenario): Promise<string[]> {
  const dir = dirOf(scenario)
  const restore = applyFiles(dir, scenario.files)
  const createdBefore = new Set((scenario.expect.creates ?? []).filter(file => existsSync(path.join(dir, file))))
  const filesBefore = new Set(filesIn(dir))
  const kept = new Map((scenario.expect.keeps ?? []).map(file => [file, readFileSync(path.join(dir, file), 'utf8')]))
  const runtime = runtimeBinary(scenario.runtime ?? 'node')
  const hidden: { from: string; to: string }[] = []
  const edited = (scenario.edits ?? []).flatMap(edit => Object.keys(edit.files))
  const restoreEdited = applyFiles(dir, Object.fromEntries(edited.map(file => [file, readFileSync(path.join(dir, file), 'utf8')])))
  const discord = scenario.discord && (await startFakeDiscord(scenario.discord))
  if (discord) scenario = { ...scenario, env: { ...scenario.env, [DISCORD_API_ENV]: discord.api } }

  try {
    for (const argv of scenario.before ?? []) {
      mustRun(`meocord ${argv.join(' ')}`, runtime, [cliOf(scenario), ...argv], dir, cleanEnv(scenario.env))
    }
    for (const file of scenario.hides ?? []) {
      const moved = { from: path.join(dir, file), to: path.join(hiddenDir, file) }
      mkdirSync(path.dirname(moved.to), { recursive: true })
      renameSync(moved.from, moved.to)
      hidden.push(moved)
    }

    const [command, ...args] = scenario.command ?? [runtime, cliOf(scenario), ...(scenario.argv ?? [])]
    const result = await run(command, args, dir, scenario)
    const { output } = result
    const problems: string[] = []

    if (result.error) problems.push(result.error)
    if (result.status !== scenario.expect.code) problems.push(`exited ${result.status}, expected ${scenario.expect.code}`)
    for (const left of await leftRunning(workDir)) problems.push(`left running: ${left}`)
    // Compared with forward slashes: the CLI prints paths with the platform's own separator.
    const said = output.replace(/\\/g, '/')
    for (const text of scenario.expect.says ?? []) if (!said.includes(text)) problems.push(`does not say "${text}"`)
    for (const text of scenario.expect.never ?? []) if (said.includes(text)) problems.push(`says "${text}"`)
    for (const [text, times] of Object.entries(scenario.expect.counts ?? {})) {
      const seen = said.split(text).length - 1
      if (seen !== times) problems.push(`says "${text}" ${seen} times, expected ${times}`)
    }
    for (const file of scenario.expect.creates ?? []) {
      if (createdBefore.has(file) || !existsSync(path.join(dir, file))) problems.push(`did not create ${file}`)
    }
    for (const file of scenario.expect.leaves ?? []) if (existsSync(path.join(dir, file))) problems.push(`created ${file}`)
    for (const [file, texts] of Object.entries(scenario.expect.contains ?? {})) {
      const content = existsSync(path.join(dir, file)) ? readFileSync(path.join(dir, file), 'utf8') : ''
      for (const text of texts) if (!content.includes(text)) problems.push(`${file} does not contain "${text}"`)
    }
    for (const [file, content] of kept) {
      if (!existsSync(path.join(dir, file)) || readFileSync(path.join(dir, file), 'utf8') !== content) problems.push(`changed ${file}`)
    }
    if (scenario.expect.writesNothing) {
      const written = filesIn(dir).filter(file => !filesBefore.has(file))
      if (written.length > 0) problems.push(`wrote ${written.join(', ')}`)
    }

    if (problems.length > 0) problems.push(`output:\n${output.replace(/^/gm, '      ')}`)
    return problems
  } finally {
    await discord?.close()
    restoreEdited()
    for (const { from, to } of hidden) renameSync(to, from)
    // Anything the run wrote goes, so the next scenario starts from the same app.
    for (const file of filesIn(dir)) if (!filesBefore.has(file)) rmSync(path.join(dir, file), { force: true })
    restore()
  }
}

const scenarios: Scenario[] = [
  // Framework information
  { name: 'prints its version', tier: 'fast', argv: ['--version'], expect: { code: 0, says: ['4.'] } },
  { name: 'lists its commands', tier: 'fast', argv: ['--help'], expect: { code: 0, says: ['create', 'build', 'start', 'register', 'generate'] } },
  { name: 'refuses an unknown command, with help', tier: 'fast', argv: ['frobnicate'], expect: { code: 1, says: ["unknown command 'frobnicate'"] } },
  { name: 'shows the license', tier: 'fast', argv: ['show', '--license'], expect: { code: 0, says: ['MIT License'] } },
  {
    name: 'says how to use show without a flag',
    tier: 'fast',
    argv: ['show'],
    expect: { code: 1, says: ['meocord show --license', 'meocord show --warranty'], never: ['Options:', 'Display information'] },
  },

  // Help: every command and argument described, and no empty sections
  ...[
    [],
    ['create'],
    ['build'],
    ['start'],
    ['register'],
    ['show'],
    ['generate'],
    ...['controller', 'service', 'guard', 'interceptor', 'filter', 'pipe', 'observer'].map(kind => ['generate', kind]),
  ].map(
    (command): Scenario => ({
      name: `${['meocord', ...command].join(' ')} --help describes every command and argument`,
      tier: 'fast',
      argv: [...command, '--help'],
      expect: { code: 0, says: ['MeoCord Copyright'], never: ['No description provided', 'No available choices'] },
    }),
  ),

  // Starting and registering without a build
  {
    name: 'start --prod without a build says to build',
    tier: 'fast',
    files: { '.env': 'DISCORD_TOKEN=abc\n', dist: null },
    argv: ['start', '--prod'],
    expect: { code: 1, says: ['main.js) not found', 'build'] },
  },
  {
    name: 'register without a build says to build',
    tier: 'fast',
    files: { '.env': 'DISCORD_TOKEN=abc\n', dist: null },
    argv: ['register'],
    expect: { code: 1, says: ['main.js) not found', 'meocord register --build'] },
  },

  // Configuration
  {
    name: 'build without meocord.config.ts says it is missing',
    tier: 'fast',
    windows: true,
    files: { 'meocord.config.ts': null },
    argv: ['build', '--prod'],
    expect: { code: 1, says: ['meocord.config.ts', 'missing'] },
  },
  {
    name: 'build does not need a token',
    tier: 'fast',
    files: { '.env': 'DISCORD_TOKEN=\n', 'meocord.config.ts': validConfig, dist: null },
    argv: ['build', '--prod'],
    expect: { code: 0, creates: ['dist/main.js'] },
  },
  {
    name: 'start --prod without a token says where the token comes from',
    tier: 'fast',
    files: { '.env': 'DISCORD_TOKEN=\n' },
    argv: ['start', '--prod'],
    expect: { code: 1, says: ['Discord token is missing', 'discordToken', 'meocord.config.ts', '.env'] },
  },
  {
    name: 'a bundled build names optionalExternals for a missing supports-color, instead of a raw resolve warning',
    tier: 'fast',
    files: {
      ...colorProbe,
      'node_modules/supports-color': null,
      'src/main.ts': `import colorProbe from 'color-probe'\nconsole.log(colorProbe)\n${templateMain}`,
      'meocord.config.ts': configWith('bundleDependencies: true,'),
      dist: null,
    },
    argv: ['build', '--prod'],
    expect: {
      code: 0,
      says: ['color-probe tries to load supports-color', "optionalExternals: ['supports-color']"],
      never: ["Can't resolve"],
      creates: ['dist/main.js'],
    },
  },
  {
    name: 'an unknown MEOCORD_LOG_LEVEL is reported once, and the build goes on',
    tier: 'fast',
    env: { MEOCORD_LOG_LEVEL: 'loud' },
    files: { dist: null },
    argv: ['build', '--prod'],
    expect: { code: 0, says: ['MEOCORD_LOG_LEVEL is "loud", which is not a log level'], creates: ['dist/main.js'] },
  },
  {
    name: "the CLI's own lines ignore the logLevel a previous build left in dist",
    tier: 'fast',
    files: { '.env': 'DISCORD_TOKEN=\n', 'meocord.config.ts': configWith("logLevel: 'silent',"), dist: null },
    before: [['build', '--prod']],
    argv: ['build', '--prod'],
    expect: { code: 0, says: ['Production build completed successfully'], creates: ['dist/main.js'] },
  },
  {
    name: 'the built bot prints from its logLevel',
    tier: 'fast',
    files: { '.env': 'DISCORD_TOKEN=\n', 'meocord.config.ts': configWith("logLevel: 'error',"), dist: null },
    before: [['build', '--prod']],
    argv: ['start', '--prod'],
    expect: { code: 1, says: ['Discord token is missing'], never: ['Starting application'] },
  },
  {
    name: 'build refuses a config of the wrong shape, listing every problem',
    tier: 'fast',
    windows: true,
    files: {
      'meocord.config.ts': config(
        "{ discordToken: 'x', sharding: { mode: 'bogus' }, commands: { guilds: 'not-a-list' }, optionalExternals: 'sharp' }",
      ),
      dist: null,
    },
    argv: ['build', '--prod'],
    expect: {
      code: 1,
      says: [
        'meocord.config.ts',
        "sharding.mode must be 'internal' or 'process' (got 'bogus')",
        'commands.guilds must be an array of guild ids',
        'optionalExternals must be an array of package names',
      ],
      never: ['Building production version'],
      leaves: ['dist/main.js'],
    },
  },
  {
    name: 'start and register refuse a config of the wrong shape too',
    tier: 'fast',
    files: { 'meocord.config.ts': config("{ discordToken: 'x', shutdownTimeout: 'soon' }") },
    argv: ['register'],
    expect: { code: 1, says: ['shutdownTimeout must be a number of milliseconds'] },
  },
  {
    name: 'build warns about a key it does not know, and builds',
    tier: 'fast',
    files: { 'meocord.config.ts': config("{ discordToken: 'x', bundleDependancies: true }"), dist: null },
    argv: ['build', '--prod'],
    expect: { code: 0, says: ['bundleDependancies', 'not a MeoCord option'], creates: ['dist/main.js'] },
  },
  {
    name: 'a config with a syntax error stops the build, naming the line',
    tier: 'fast',
    windows: true,
    files: { 'meocord.config.ts': "export default { discordToken: 'x',\n", dist: null },
    argv: ['build', '--prod'],
    expect: { code: 1, says: ['meocord.config.ts:2'], never: ['Building production version'], leaves: ['dist/meocord.config.mjs'] },
  },
  {
    name: 'a config that fails to compile leaves the last compiled one in place',
    tier: 'fast',
    files: {
      'meocord.config.ts': "import './does-not-exist'\nexport default { discordToken: 'x' }\n",
      'dist/meocord.config.mjs': "export default { discordToken: 'last good' }\n",
    },
    argv: ['build', '--prod'],
    expect: { code: 1, keeps: ['dist/meocord.config.mjs'] },
  },

  // Generators: every kind, and the alias of each
  ...[
    ['service', 's', 'service'],
    ['guard', 'gu', 'guard'],
    ['interceptor', 'i', 'interceptor'],
    ['filter', 'f', 'filter'],
    ['pipe', 'pi', 'pipe'],
    ['observer', 'ob', 'observer'],
  ].flatMap(([command, alias, kind]): Scenario[] => [
    {
      name: `generate ${command} writes the file and its spec`,
      tier: 'fast',
      argv: ['generate', command, 'Probe'],
      expect: { code: 0, creates: [`src/${kind}s/probe.${kind}.ts`, `src/${kind}s/probe.${kind}.spec.ts`] },
    },
    {
      name: `g ${alias} is generate ${command}, nested`,
      tier: 'fast',
      windows: true,
      argv: ['g', alias, 'admin/probe'],
      expect: { code: 0, creates: [`src/${kind}s/admin/probe.${kind}.ts`] },
    },
  ]),
  {
    name: 'g co slash writes the controller, its spec and its builder',
    tier: 'fast',
    windows: true,
    argv: ['g', 'co', 'slash', 'Probe'],
    expect: {
      code: 0,
      creates: ['src/controllers/slash/probe.slash.controller.ts', 'src/controllers/slash/probe.slash.controller.spec.ts', 'src/controllers/slash/builders/probe.builder.ts'],
    },
  },
  {
    name: 'g co context-menu --message writes a message command, and a handler typed for it',
    tier: 'fast',
    argv: ['g', 'co', 'context-menu', 'Quote', '--message'],
    expect: {
      code: 0,
      creates: ['src/controllers/context-menu/quote.context-menu.controller.ts', 'src/controllers/context-menu/builders/quote.builder.ts'],
      contains: {
        'src/controllers/context-menu/builders/quote.builder.ts': ['.setType(ApplicationCommandType.Message)'],
        'src/controllers/context-menu/quote.context-menu.controller.ts': ['handleQuote(interaction: MessageContextMenuCommandInteraction)'],
      },
    },
  },
  {
    name: 'g co context-menu writes a user command by default',
    tier: 'fast',
    argv: ['g', 'co', 'context-menu', 'Profile'],
    expect: {
      code: 0,
      creates: ['src/controllers/context-menu/profile.context-menu.controller.ts'],
      contains: {
        'src/controllers/context-menu/builders/profile.builder.ts': ['.setType(ApplicationCommandType.User)'],
        'src/controllers/context-menu/profile.context-menu.controller.ts': ['handleProfile(interaction: UserContextMenuCommandInteraction)'],
      },
    },
  },
  {
    name: 'generate refuses --message for a controller that is not a context menu',
    tier: 'fast',
    argv: ['g', 'co', 'button', 'Probe', '--message'],
    expect: { code: 1, says: ['--message applies to context-menu controllers only.'], writesNothing: true },
  },
  {
    name: 'g co button writes no builder',
    tier: 'fast',
    argv: ['g', 'co', 'button', 'Probe'],
    expect: { code: 0, creates: ['src/controllers/button/probe.button.controller.ts'], leaves: ['src/controllers/button/builders'] },
  },
  {
    name: 'generate refuses to overwrite, naming the files, and writes nothing',
    tier: 'fast',
    windows: true,
    files: { 'src/services/taken.service.ts': '// mine\n' },
    argv: ['g', 's', 'Taken'],
    expect: { code: 1, says: ['Refusing to overwrite', 'src/services/taken.service.ts'], writesNothing: true },
  },
  {
    name: 'generate refuses a name that is not a class name',
    tier: 'fast',
    windows: true,
    argv: ['g', 'co', 'slash', '!!!'],
    expect: { code: 1, says: ['Invalid class name "!!!"'], writesNothing: true },
  },
  ...['../escape', '../../escape', '/tmp/escape', 'C:/escape'].map(
    (name): Scenario => ({
      name: `generate refuses the path ${name}`,
      tier: 'fast',
      windows: true,
      argv: ['g', 's', name],
      expect: { code: 1, says: ['inside src/services/', 'admin/ban'], writesNothing: true },
    }),
  ),
  {
    name: 'generate takes a backslash as a folder separator on Windows',
    tier: 'fast',
    windows: true,
    platforms: ['win32'],
    argv: ['g', 's', 'admin\\probe'],
    expect: { code: 0, creates: ['src/services/admin/probe.service.ts'] },
  },
  {
    name: "generate outside a project says to run it from the project's root",
    tier: 'fast',
    windows: true,
    cwd: 'empty',
    argv: ['g', 's', 'Loose'],
    expect: { code: 1, says: ["from your project's root"], writesNothing: true },
  },
  {
    name: 'generate refuses an unknown controller type, listing the types',
    tier: 'fast',
    argv: ['g', 'co', 'wizard', 'Probe'],
    expect: { code: 1, says: ["'wizard' is invalid", 'button', 'primary-entry-point'] },
  },

  // Create: what it refuses before installing anything
  {
    name: 'create refuses a directory that exists',
    tier: 'fast',
    windows: true,
    cwd: 'parent',
    argv: ['create', 'app', '--use-bun'],
    expect: { code: 1, says: ['Directory "app" already exists'] },
  },
  {
    name: 'create refuses a name with no letters or digits',
    tier: 'fast',
    windows: true,
    cwd: 'parent',
    argv: ['create', '!!!', '--use-bun'],
    expect: { code: 1, says: ['needs a name', 'my-bot'], never: ['already exists'] },
  },

  // Slow: an app npm installed, run through its own package scripts and the meocord bin
  {
    name: 'an app npm installed builds through its build:prod script',
    tier: 'slow',
    cwd: 'npm-app',
    files: { dist: null },
    command: ['npm', 'run', 'build:prod'],
    expect: { code: 0, creates: ['dist/main.js', 'dist/meocord.config.mjs'] },
  },
  {
    name: 'an app npm installed starts through its start:prod script, and stops at a refused token',
    tier: 'slow',
    cwd: 'npm-app',
    files: { '.env': INVALID_TOKEN_ENV },
    command: ['npm', 'run', 'start:prod', '--', '--build'],
    expect: { code: 1, says: ['Starting bot', REFUSED_TOKEN] },
  },
  // What a host that runs `npm start` does after its build step
  {
    name: 'npm start in an app npm installed starts the production build, and stops at a refused token',
    tier: 'slow',
    cwd: 'npm-app',
    files: { '.env': INVALID_TOKEN_ENV, dist: null },
    before: [['build', '--prod']],
    command: ['npm', 'start'],
    expect: { code: 1, says: ['Starting bot', REFUSED_TOKEN], never: ['watch mode'] },
  },
  {
    name: 'bun run start in an app bun installed starts the production build, and stops at a refused token',
    tier: 'slow',
    files: { '.env': INVALID_TOKEN_ENV, dist: null },
    before: [['build', '--prod']],
    command: ['bun', 'run', 'start'],
    expect: { code: 1, says: ['Starting bot', REFUSED_TOKEN], never: ['watch mode'] },
  },
  {
    name: 'npm start without a token says where the token comes from',
    tier: 'slow',
    cwd: 'npm-app',
    files: { '.env': 'DISCORD_TOKEN=\n', dist: null },
    before: [['build', '--prod']],
    command: ['npm', 'start'],
    expect: { code: 1, says: ['Discord token is missing', '.env'], never: ['Starting bot'] },
  },

  {
    name: 'two of every generated component, listed beside the samples, build and start without a routing warning',
    tier: 'slow',
    files: { '.env': INVALID_TOKEN_ENV, 'src/app.ts': appWithGenerated, dist: null },
    before: generateTwoOfEach,
    argv: ['start', '--prod', '--build'],
    timeoutMs: 120_000,
    expect: {
      code: 1,
      says: ['Production build completed', 'Starting bot', REFUSED_TOKEN],
      never: ['match the same messages', 'can match the same customId', 'refuses to start'],
    },
  },

  // Slow: the bun runtime, which the CLI runs the application on too
  {
    name: 'on bun, start --prod --build builds, starts, and stops at a refused token',
    tier: 'slow',
    runtime: 'bun',
    files: { '.env': INVALID_TOKEN_ENV, dist: null },
    argv: ['start', '--prod', '--build'],
    expect: {
      code: 1,
      says: ['Production build completed', 'Starting bot', REFUSED_TOKEN, 'Reset Token'],
      // The raw error is logged at debug level only; main.ts does not log it again
      never: ['[ERROR] Error during startup', '[ERROR] [MeoCordApp] Login failed'],
      creates: ['dist/main.js'],
    },
  },
  {
    name: 'on bun, register --build says Discord refused the token and where to get one',
    tier: 'slow',
    runtime: 'bun',
    files: { '.env': INVALID_TOKEN_ENV, dist: null },
    argv: ['register', '--build'],
    expect: { code: 1, says: [REFUSED_TOKEN, 'Reset Token'], never: ['Could not read the application'] },
  },
  {
    name: 'start --prod hides debug lines by default',
    tier: 'slow',
    files: { '.env': INVALID_TOKEN_ENV },
    before: [['build', '--prod']],
    argv: ['start', '--prod'],
    expect: { code: 1, says: [REFUSED_TOKEN], never: ['[DEBUG]'] },
  },
  {
    name: 'MEOCORD_LOG_LEVEL=debug shows debug lines in production',
    tier: 'slow',
    files: { '.env': INVALID_TOKEN_ENV },
    env: { MEOCORD_LOG_LEVEL: 'debug' },
    before: [['build', '--prod']],
    argv: ['start', '--prod'],
    expect: { code: 1, says: [REFUSED_TOKEN, '[DEBUG]', 'Login failed'] },
  },
  {
    name: 'register says Discord refused the token and where to get one',
    tier: 'slow',
    files: { '.env': INVALID_TOKEN_ENV },
    before: [['build', '--prod']],
    argv: ['register'],
    expect: { code: 1, says: [REFUSED_TOKEN, 'Reset Token'], never: ['Could not read the application'] },
  },

  // Slow: a bundled build runs where no node_modules is installed, as a deployed dist does
  {
    name: 'with bundleDependencies, the build runs with node_modules gone',
    tier: 'slow',
    files: { '.env': INVALID_TOKEN_ENV, 'meocord.config.ts': configWith('bundleDependencies: true,'), dist: null },
    before: [['build', '--prod']],
    hides: ['node_modules'],
    command: ['node', 'dist/main.js'],
    expect: { code: 1, says: ['Starting bot', REFUSED_TOKEN], never: ['ERR_MODULE_NOT_FOUND', 'Cannot find'] },
  },
  ...(['node', 'bun'] as const).map(
    (runtime): Scenario => ({
      name: `with bundleDependencies and an eval devtool from the hook, a bundle using lodash-es starts on ${runtime}`,
      tier: 'slow',
      files: { '.env': INVALID_TOKEN_ENV, 'src/main.ts': lodashMain, 'meocord.config.ts': evalBundledConfig, dist: null },
      before: [['build', '--prod']],
      hides: ['node_modules'],
      command: runtime === 'bun' ? [runtimeBinary('bun'), '--no-install', 'dist/main.js'] : ['node', 'dist/main.js'],
      expect: {
        code: 1,
        says: ['lodash-es: bundledModule', 'Starting bot', REFUSED_TOKEN],
        never: ['SyntaxError', 'CommonJS'],
      },
    }),
  ),
  ...(['node', 'bun'] as const).flatMap(runtime =>
    [true, false].map(
      (bundled): Scenario => ({
        name: `${bundled ? 'bundled' : 'unbundled'}, packages that make errors with Error.captureStackTrace load and the bot starts on ${runtime}`,
        tier: 'slow',
        files: {
          '.env': INVALID_TOKEN_ENV,
          'src/main.ts': errorMakersMain,
          'meocord.config.ts': bundled ? configWith('bundleDependencies: true,') : validConfig,
          dist: null,
        },
        before: [['build', '--prod']],
        hides: bundled ? ['node_modules'] : [],
        command: runtime === 'bun' ? [runtimeBinary('bun'), '--no-install', 'dist/main.js'] : ['node', 'dist/main.js'],
        expect: {
          code: 1,
          // Bun heads such stacks "Error", with the hook or without it; Node names the error's type
          says: [
            'error makers: axios function',
            ...(runtime === 'node' ? ['FetchError: probe', 'ReplyError: ERR probe'] : ['Error: ERR probe']),
            'Starting bot',
            REFUSED_TOKEN,
          ],
          never: ['First argument must be an Error object'],
        },
      }),
    ),
  ),
  {
    name: 'with bundleDependencies, a development build starts on bun',
    tier: 'slow',
    files: { '.env': INVALID_TOKEN_ENV, 'src/main.ts': lodashMain, 'meocord.config.ts': configWith('bundleDependencies: true,'), dist: null },
    before: [['build', '--dev']],
    hides: ['node_modules'],
    command: [runtimeBinary('bun'), '--no-install', 'dist/main.js'],
    expect: { code: 1, says: ['lodash-es: bundledModule', REFUSED_TOKEN], never: ['SyntaxError', 'CommonJS'] },
  },
  {
    name: 'an eval devtool from the hook is built as its non-eval twin, with a warning saying why',
    tier: 'slow',
    files: { 'meocord.config.ts': evalBundledConfig, dist: null },
    argv: ['build', '--prod'],
    expect: { code: 0, says: ['"eval-source-map" devtool', 'import.meta', '"source-map" instead'], creates: ['dist/main.js.map'] },
  },
  {
    name: 'an optionalExternals package that is installed is copied into dist and found there',
    tier: 'slow',
    files: {
      ...optionalProbe,
      ...optionalColor,
      '.env': INVALID_TOKEN_ENV,
      'src/main.ts': probingMain,
      'meocord.config.ts': configWith("bundleDependencies: true,\n  optionalExternals: ['optional-color'],"),
      dist: null,
    },
    before: [['build', '--prod']],
    hides: ['node_modules'],
    command: ['node', 'dist/main.js'],
    expect: {
      code: 1,
      says: ['optional probe: with color', REFUSED_TOKEN],
      creates: ['dist/node_modules/optional-color/package.json'],
    },
  },
  {
    name: 'an optionalExternals package that is missing leaves the bundle running without it',
    tier: 'slow',
    files: {
      ...optionalProbe,
      'node_modules/optional-color': null,
      '.env': INVALID_TOKEN_ENV,
      'src/main.ts': probingMain,
      'meocord.config.ts': configWith("bundleDependencies: true,\n  optionalExternals: ['optional-color'],"),
      dist: null,
    },
    before: [['build', '--prod']],
    hides: ['node_modules'],
    command: ['node', 'dist/main.js'],
    expect: {
      code: 1,
      says: ['optional probe: without color', REFUSED_TOKEN],
      leaves: ['dist/node_modules/optional-color'],
    },
  },

  // Slow: process sharding
  {
    name: 'process sharding stops at a refused token before spawning a shard',
    tier: 'slow',
    files: { '.env': INVALID_TOKEN_ENV, 'meocord.config.ts': configWith("sharding: { mode: 'process', shards: 2 },"), dist: null },
    argv: ['start', '--prod', '--build'],
    timeoutMs: 60_000,
    expect: { code: 1, says: [REFUSED_TOKEN, 'Reset Token'], never: ['Shard 0', 'Could not register the commands'] },
  },
  {
    name: 'process sharding stops every shard at a refused token, instead of restarting them',
    tier: 'slow',
    files: {
      '.env': INVALID_TOKEN_ENV,
      'meocord.config.ts': configWith("sharding: { mode: 'process', shards: 2 },").replace('commands: {', 'commands: {\n    register: false,'),
      dist: null,
    },
    argv: ['start', '--prod', '--build'],
    timeoutMs: 60_000,
    expect: { code: 1, says: ['Shard 0 cannot log in (TokenInvalid)', REFUSED_TOKEN, 'Stopping every shard'], never: ['restarting it'] },
  },

  // Slow: stop signals, sent to the whole process group as a terminal's Ctrl+C is, or to the CLI alone
  // as Docker, pm2 and systemd send them. Either way the bot shuts down through its own path, once.
  // A restart of start --dev is one sequence: the old bot stops, even mid-login, and one new bot starts
  ...(['node', 'bun'] as const).flatMap((runtime): Scenario[] => [
    {
      name: `start --dev on ${runtime} restarts once for a change made while the bot logs in`,
      tier: runtime === 'node' ? 'fast' : 'slow',
      platforms: ['linux', 'darwin'],
      runtime,
      files: { '.env': INVALID_TOKEN_ENV, 'src/app.ts': readyApp, 'src/ready.service.ts': readyService },
      discord: { readyDelayMs: 3_000 },
      argv: ['start', '--dev'],
      edits: [{ after: 'Starting bot', files: { 'src/ready.service.ts': touched } }],
      signal: { name: 'SIGINT', after: 'Ready hook ran' },
      timeoutMs: 60_000,
      expect: {
        code: 0,
        counts: {
          'Starting bot': 2,
          'The bot was still logging in': 1,
          'Bot is online!': 1,
          'Ready hook ran': 1,
          'Bot has shut down': 2,
        },
        never: ['modified-tsconfig.json'],
      },
    },
    {
      name: `start --dev on ${runtime} rebuilds once for an edit to tsconfig.json, and never for its own copy`,
      tier: runtime === 'node' ? 'fast' : 'slow',
      platforms: ['linux', 'darwin'],
      runtime,
      files: { '.env': INVALID_TOKEN_ENV, 'src/app.ts': readyApp, 'src/ready.service.ts': readyService },
      discord: { readyDelayMs: 0 },
      argv: ['start', '--dev'],
      edits: [{ after: 'Ready hook ran', files: { 'tsconfig.json': touched } }],
      signal: { name: 'SIGINT', after: 'Ready hook ran', times: 2 },
      timeoutMs: 60_000,
      expect: {
        code: 0,
        counts: { 'tsconfig.json change detected': 1, 'Starting bot': 2, 'Ready hook ran': 2 },
        never: ['modified-tsconfig.json'],
      },
    },
    {
      name: `start --dev on ${runtime} keeps watching through a meocord.config.ts that does not compile, and reloads once it does`,
      tier: runtime === 'node' ? 'fast' : 'slow',
      platforms: ['linux', 'darwin'],
      runtime,
      files: { '.env': INVALID_TOKEN_ENV, 'src/app.ts': readyApp, 'src/ready.service.ts': readyService },
      discord: { readyDelayMs: 0 },
      argv: ['start', '--dev'],
      edits: [
        { after: 'Ready hook ran', files: { 'meocord.config.ts': current => `${current}${HALF_WRITTEN}` } },
        { after: 'Failed to compile meocord.config.ts', files: { 'meocord.config.ts': current => current.replace(HALF_WRITTEN, '') } },
      ],
      signal: { name: 'SIGINT', after: 'Ready hook ran', times: 2 },
      timeoutMs: 60_000,
      expect: {
        code: 0,
        counts: { 'Failed to compile meocord.config.ts': 1, 'MeoCord config change detected': 2, 'Ready hook ran': 2 },
      },
    },
    {
      name: `start --prod on ${runtime} stops at once on Ctrl+C while the bot logs in`,
      tier: runtime === 'node' ? 'fast' : 'slow',
      platforms: ['linux', 'darwin'],
      runtime,
      files: { '.env': INVALID_TOKEN_ENV, 'src/app.ts': readyApp, 'src/ready.service.ts': readyService, dist: null },
      discord: { readyDelayMs: 10_000 },
      argv: ['start', '--prod', '--build'],
      signal: { name: 'SIGINT', after: 'Starting bot' },
      timeoutMs: 60_000,
      expect: {
        code: 0,
        says: ['Shutting down bot', 'The bot was still logging in', 'Bot has shut down'],
        never: ['Bot is online!', 'Ready hook ran', 'Application started'],
      },
    },
  ]),
  {
    name: 'bun test passes a test that expects MeoCordFactory.create to refuse the app, and exits 0',
    tier: 'slow',
    platforms: ['linux', 'darwin'],
    files: { 'src/refused-app.test.ts': refusedAppTest, dist: null },
    before: [['build', '--prod']],
    command: ['bun', 'test', 'src/refused-app.test.ts'],
    timeoutMs: 60_000,
    expect: { code: 0, says: ['1 pass', '0 fail'], never: ['[ERROR]'] },
  },
  // Each stop is tested in both phases, reached by what the output shows rather than by timing: online, once the local
  // Discord's READY has run the ready hook, and mid-login, against an API that never answers
  // A refusal as the application loads reads as one line and exits 1, a decorator's or MeoCordFactory.create's alike
  ...(['node', 'bun'] as const).flatMap((runtime): Scenario[] => [
    {
      name: `start --prod on ${runtime} reports a decorator it refuses as one line, and exits 1`,
      tier: runtime === 'node' ? 'fast' : 'slow',
      platforms: ['linux', 'darwin'],
      runtime,
      files: { '.env': INVALID_TOKEN_ENV, 'src/controllers/button/sample.button.controller.ts': refusedPatternButton, dist: null },
      argv: ['start', '--prod', '--build'],
      timeoutMs: 60_000,
      expect: { code: 1, says: [REFUSED_PATTERN], never: [...RAW_REPORT, 'Starting bot'] },
    },
    {
      name: `start --prod on ${runtime} reports what MeoCordFactory.create refuses as one line, and exits 1`,
      tier: runtime === 'node' ? 'fast' : 'slow',
      platforms: ['linux', 'darwin'],
      runtime,
      files: { '.env': INVALID_TOKEN_ENV, 'src/controllers/message/sample.message.controller.ts': refusedMessagePattern, dist: null },
      argv: ['start', '--prod', '--build'],
      timeoutMs: 60_000,
      expect: { code: 1, says: [REFUSED_MESSAGE_PATTERN], never: [...RAW_REPORT, 'Starting bot'] },
    },
    {
      name: `start --prod on ${runtime} reports a refusal a main.ts leaves unhandled once, and exits 1`,
      tier: runtime === 'node' ? 'fast' : 'slow',
      platforms: ['linux', 'darwin'],
      runtime,
      files: {
        '.env': INVALID_TOKEN_ENV,
        'src/main.ts': unhandledMain,
        'src/controllers/message/sample.message.controller.ts': refusedMessagePattern,
        dist: null,
      },
      argv: ['start', '--prod', '--build'],
      timeoutMs: 60_000,
      expect: { code: 1, counts: { [REFUSED_MESSAGE_PATTERN]: 1 }, never: [...RAW_REPORT, 'Bun v'] },
    },
    ...(
      [
        ['an Error', 'error'],
        ['a string', 'string'],
      ] as const
    ).flatMap(([label, reason]): Scenario[] => [
      {
        name: `start --prod on ${runtime} leaves ${label} rejection after a refusal to the runtime's own report`,
        tier: runtime === 'node' ? 'fast' : 'slow',
        platforms: ['linux', 'darwin'],
        runtime,
        files: { '.env': INVALID_TOKEN_ENV, 'src/main.ts': rejectingMain(reason, false), dist: null },
        argv: ['start', '--prod', '--build'],
        timeoutMs: 60_000,
        // The code and the report the runtime gives with no listener of MeoCord's
        expect: { code: 1, says: ['a bug in bootstrap', runtime === 'node' ? 'Node.js v' : 'Bun v'], never: ['[ERROR]'] },
      },
      {
        name: `start --prod on ${runtime} leaves ${label} rejection after a refusal to the app's own listener`,
        tier: runtime === 'node' ? 'fast' : 'slow',
        platforms: ['linux', 'darwin'],
        runtime,
        files: { '.env': INVALID_TOKEN_ENV, 'src/main.ts': rejectingMain(reason, true), dist: null },
        argv: ['start', '--prod', '--build'],
        timeoutMs: 60_000,
        expect: { code: 0, counts: { 'The app heard: ': 1 }, says: ['a bug in bootstrap'], never: ['[ERROR]'] },
      },
    ]),
    {
      name: `start --prod on ${runtime} leaves a rejected refusal to the app's own listener, as the other runtime does`,
      tier: runtime === 'node' ? 'fast' : 'slow',
      platforms: ['linux', 'darwin'],
      runtime,
      files: { '.env': INVALID_TOKEN_ENV, 'src/main.ts': rejectingMain('refusal', true), dist: null },
      argv: ['start', '--prod', '--build'],
      timeoutMs: 60_000,
      expect: { code: 0, counts: { 'The app heard: ': 1 }, says: ['Invalid pattern "a bug in bootstrap/{id}-x"'], never: ['[ERROR]'] },
    },
    {
      name: `start --dev on ${runtime} reports a decorator it refuses as one line, and keeps watching`,
      tier: runtime === 'node' ? 'fast' : 'slow',
      platforms: ['linux', 'darwin'],
      runtime,
      files: { '.env': INVALID_TOKEN_ENV, 'src/controllers/button/sample.button.controller.ts': refusedPatternButton },
      argv: ['start', '--dev'],
      signal: { name: 'SIGINT', after: 'waiting for changes' },
      timeoutMs: 60_000,
      expect: { code: 0, says: [REFUSED_PATTERN, 'The application exited with code 1; waiting for changes.'], never: RAW_REPORT },
    },
  ]),
  ...(
    [
      ['Ctrl+C', { name: 'SIGINT', to: 'group' }],
      ['SIGINT to the CLI alone', { name: 'SIGINT', to: 'cli' }],
      ['SIGTERM to the CLI alone', { name: 'SIGTERM', to: 'cli' }],
    ] as const
  ).flatMap(([label, signal]) =>
    (
      [
        {
          phase: 'once the bot is online',
          app: { 'src/app.ts': readyApp, 'src/ready.service.ts': readyService },
          discord: { readyDelayMs: 0 },
          after: 'Ready hook ran',
          says: [] as string[],
          never: ['still logging in'],
        },
        {
          phase: 'while the bot logs in',
          app: { 'src/app.ts': stalledApp },
          discord: undefined,
          after: 'Starting bot',
          says: ['The bot was still logging in'],
          never: ['Bot is online!'],
        },
      ] as const
    ).flatMap(({ phase, app, discord, after, says, never }): Scenario[] => [
      {
        name: `${label} stops start --prod and shuts the bot down ${phase}`,
        tier: 'slow',
        platforms: ['linux', 'darwin'],
        files: { '.env': INVALID_TOKEN_ENV, ...app, dist: null },
        discord,
        argv: ['start', '--prod', '--build'],
        signal: { ...signal, after },
        timeoutMs: 60_000,
        expect: { code: 0, says: ['Shutting down bot', ...says, 'Bot has shut down'], never: [...never] },
      },
      {
        name: `${label} shuts every shard down in process sharding ${phase}`,
        tier: 'slow',
        platforms: ['linux', 'darwin'],
        files: {
          '.env': INVALID_TOKEN_ENV,
          ...app,
          // Registration off, so the refused token stops the shards rather than the manager before them
          'meocord.config.ts': configWith("sharding: { mode: 'process', shards: 2 },\n  shutdownTimeout: 1000,").replace(
            'commands: {',
            'commands: {\n    register: false,',
          ),
          dist: null,
        },
        discord,
        argv: ['start', '--prod', '--build'],
        // Every shard reaches the phase before the stop
        signal: { ...signal, after, times: 2 },
        timeoutMs: 60_000,
        expect: {
          code: 0,
          says: ['Shutting down the shards', ...says, 'Bot has shut down', 'Every shard has shut down'],
          counts: { 'Bot has shut down': 2 },
          never: ['Stopping every shard now', ...never],
        },
      },
      {
        name: `${label} stops start --dev and the bot it watches ${phase}`,
        tier: 'slow',
        platforms: ['linux', 'darwin'],
        files: { '.env': INVALID_TOKEN_ENV, ...app },
        discord,
        argv: ['start', '--dev'],
        signal: { ...signal, after },
        timeoutMs: 60_000,
        expect: { code: 0, says: ['Starting watch mode', ...says, 'Bot has shut down'], never: [...never] },
      },
    ]),
  ),
  {
    name: 'Ctrl+C stops start --dev once the application has exited on its own',
    tier: 'slow',
    platforms: ['linux', 'darwin'],
    // An exit a code change can fix, so the session keeps watching until the signal
    files: { '.env': INVALID_TOKEN_ENV, 'src/main.ts': selfExitingMain },
    argv: ['start', '--dev'],
    signal: { name: 'SIGINT', after: 'waiting for changes' },
    timeoutMs: 60_000,
    expect: { code: 0, says: ['Starting watch mode', 'The application exited with code 3; waiting for changes.'] },
  },
  {
    name: 'start --dev ends with 1 when the bot cannot log in, as no code change fixes that',
    tier: 'slow',
    platforms: ['linux', 'darwin'],
    files: { '.env': INVALID_TOKEN_ENV },
    argv: ['start', '--dev'],
    timeoutMs: 60_000,
    expect: {
      code: 1,
      says: [REFUSED_TOKEN, 'The bot could not log in, and no code change fixes that; stopping watch mode.'],
      never: ['waiting for changes'],
    },
  },
  {
    name: 'a signal repeated after the window kills an application that does not stop, and exits 1',
    tier: 'slow',
    platforms: ['linux', 'darwin'],
    files: { '.env': INVALID_TOKEN_ENV, 'src/main.ts': ignoringMain, dist: null },
    before: [['build', '--prod']],
    argv: ['start', '--prod'],
    signal: { name: 'SIGTERM', to: 'cli', after: 'Ignoring stop signals', repeatAfterMs: 1_500 },
    timeoutMs: 60_000,
    expect: { code: 1, says: ['Ignored SIGTERM'] },
  },
]

/** Stops before anything is installed: a typo in the arguments must not pass by running nothing. */
function refuse(message: string): never {
  console.error(message)
  rmSync(workDir, { recursive: true, force: true })
  process.exit(1)
}

async function main(): Promise<void> {
  const valueOf = (flag: string) => (process.argv.includes(flag) ? (process.argv[process.argv.indexOf(flag) + 1] ?? '') : undefined)
  const tierArg = valueOf('--tier')
  if (tierArg !== undefined && !['fast', 'slow', 'all'].includes(tierArg)) {
    refuse(`Unknown tier "${tierArg}": use --tier fast, slow or all.`)
  }
  const tiers: Tier[] = tierArg === 'all' ? ['fast', 'slow'] : [(tierArg as Tier | undefined) ?? 'fast']
  const only = valueOf('--only')
  if (only === '') refuse('--only needs part of a scenario name.')
  const windowsOnly = process.argv.includes('--windows')
  const runnable = scenarios.filter(
    scenario =>
      tiers.includes(scenario.tier) &&
      (!windowsOnly || scenario.windows) &&
      (!scenario.platforms || scenario.platforms.includes(process.platform)),
  )
  const selected = runnable.filter(scenario => !only || scenario.name.includes(only))
  if (selected.length === 0) {
    refuse(
      only
        ? `No scenario in ${tiers.join(' and ')} matches "${only}". The scenarios are:\n  ${runnable.map(({ name }) => name).join('\n  ')}`
        : `No scenario in ${tiers.join(' and ')} runs here.`,
    )
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      rmSync(workDir, { recursive: true, force: true })
      process.exit(130)
    })
  }

  const started = performance.now()
  try {
    console.log(`Running ${selected.length} CLI scenarios in ${workDir}\n`)
    mkdirSync(emptyDir)
    const tarball = pack(workDir)
    renderApp(appDir, tarball)
    // lodash-es, for the bundled scenarios: an ES module that probes for CommonJS, as many do.
    mustRun('add lodash-es to the application', process.execPath, ['add', 'lodash-es@^4.18.1'], appDir)
    // Packages that make errors with Error.captureStackTrace, for the scenarios that load them under the stack hook
    mustRun('add error-making packages to the application', process.execPath, ['add', 'axios@^1.20.0', 'depd@^2.0.0', 'ioredis@^6.0.0', 'node-fetch@^2.7.0'], appDir)
    mustRun('install the application', process.execPath, ['install'], appDir)
    cpSync(path.join(appDir, '.env.example'), path.join(appDir, '.env'))
    if (selected.some(scenario => scenario.cwd === 'npm-app')) {
      renderApp(npmAppDir, tarball, 'npm')
      mustRun('install the application with npm', 'npm', ['install', '--no-audit', '--no-fund'], npmAppDir)
      cpSync(path.join(npmAppDir, '.env.example'), path.join(npmAppDir, '.env'))
    }

    // Keeps a login waiting, so a bot is up and handling signals without a token that works
    const stalledApi = createServer()
    await new Promise<void>(resolve => stalledApi.listen(0, '127.0.0.1', resolve))
    process.env[STALLED_API_ENV] = `http://127.0.0.1:${(stalledApi.address() as AddressInfo).port}/api`
    stallServer = stalledApi

    let failed = 0
    for (const scenario of selected) {
      const scenarioStarted = performance.now()
      const problems = await check(scenario)
      const seconds = ((performance.now() - scenarioStarted) / 1000).toFixed(1)
      if (problems.length === 0) {
        console.log(`  ok    ${scenario.name} (${seconds}s)`)
      } else {
        failed++
        console.log(`  FAIL  ${scenario.name} (${seconds}s)\n${problems.map(problem => `    - ${problem}`).join('\n')}`)
      }
    }

    const total = ((performance.now() - started) / 1000).toFixed(0)
    console.log(failed === 0 ? `\nEvery scenario behaved (${total}s).` : `\n${failed} of ${selected.length} scenarios failed (${total}s).`)
    if (failed > 0) process.exitCode = 1
  } finally {
    stallServer?.closeAllConnections()
    stallServer?.close()
    rmSync(workDir, { recursive: true, force: true })
  }
}

let stallServer: Server | undefined

await main()
