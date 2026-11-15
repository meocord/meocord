// Run under Node and Bun by scripts/check-dual-build.ts: one process loads both builds of `dist`, the way a project
// that mixes `import` and `require()` of meocord does, and prints what it found as JSON.
//   app <first: esm|cjs> <app: esm|cjs> <mode: module|bot>  an app from one build, with classes the other decorated
//   logger <first: esm|cjs>                                  what each build's Logger writes, colour as the env sets it
import fs from 'fs'
import { createRequire } from 'module'
import os from 'os'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(repoRoot, 'dist')
const require = createRequire(import.meta.url)
const { version } = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
const [task, first, appBuild, mode] = process.argv.slice(2)

const ENTRIES = ['common', 'core', 'decorator', 'enum', 'testing']
const load = {
  esm: async () => Object.fromEntries(await Promise.all(ENTRIES.map(async e => [e, await import(pathToFileURL(path.join(dist, 'esm', e, 'index.js')).href)]))),
  cjs: async () => Object.fromEntries(ENTRIES.map(e => [e, require(path.join(dist, 'cjs', e, 'index.cjs'))])),
}
const second = first === 'esm' ? 'cjs' : 'esm'
const builds = { [first]: await load[first]() }
builds[second] = await load[second]()

const problems = []
const expect = (label, actual, wanted) => {
  if (!Object.is(actual, wanted)) problems.push(`${label}: got ${String(actual)}, expected ${String(wanted)}`)
}
const attempt = async (label, fn) => {
  try {
    return await fn()
  } catch (error) {
    problems.push(`${label}: threw ${error?.constructor?.name}: ${String(error?.message).split('\n')[0]}`)
  }
}

if (task === 'logger') {
  // Each build's Logger, written to captured streams; the timestamp each line starts with is left out
  const captured = {}
  const TIMESTAMP = /[A-Z][a-z]+day, [A-Z][a-z]+ \d+, \d+ [\d:]+ UTC[+-][\d:]+/g
  for (const build of ['esm', 'cjs']) {
    const lines = { stdout: '', stderr: '' }
    const writes = { stdout: process.stdout.write, stderr: process.stderr.write }
    process.stdout.write = chunk => ((lines.stdout += chunk), true)
    process.stderr.write = chunk => ((lines.stderr += chunk), true)
    try {
      const logger = new builds[build].common.Logger('DualBuild')
      for (const level of ['log', 'info', 'verbose', 'debug', 'warn', 'error']) logger[level](`${level} line`, { count: 1 })
    } finally {
      process.stdout.write = writes.stdout
      process.stderr.write = writes.stderr
    }
    captured[build] = { stdout: lines.stdout.replace(TIMESTAMP, ''), stderr: lines.stderr.replace(TIMESTAMP, '') }
  }
  console.log(JSON.stringify({ captured }))
  process.exit(0)
}

const app = builds[appBuild]
const other = builds[appBuild === 'esm' ? 'cjs' : 'esm']
const discord = require(require.resolve('discord.js', { paths: [dist] }))
const GUILD = '100000000000000001'
const GUILD_COLOR = 0x123456

// The other build decorates the theme resolver and a service: its inversify copy writes their metadata
const LOOKUPS = 'lookups'
class LookupThemes {
  constructor(lookups) {
    this.lookups = lookups
  }
  guild({ guild }) {
    this.lookups.asked++
    return guild.id === GUILD ? { colors: { primary: GUILD_COLOR } } : undefined
  }
}
other.decorator.Inject(LOOKUPS)(LookupThemes, undefined, 0)
other.decorator.Service()(LookupThemes)
class Greeter {
  hello() {
    return 'hi'
  }
}
other.decorator.Service()(Greeter)

// The app's own classes come from the app's build
const seen = {}
class Panel {
  constructor(greeter) {
    this.greeter = greeter
  }
  press() {
    seen.calls = (seen.calls ?? 0) + 1
    seen.inCall = { app: app.common.useTheme().colors.primary, other: other.common.useTheme().colors.primary, greeting: this.greeter?.hello() }
  }
}
Reflect.defineMetadata('design:paramtypes', [Greeter], Panel)
const press = Object.getOwnPropertyDescriptor(Panel.prototype, 'press')
app.decorator.Command('press', app.enum.CommandType.BUTTON)(Panel.prototype, 'press', press)
Object.defineProperty(Panel.prototype, 'press', press)
app.decorator.Controller()(Panel)
class App {}
const lookups = { asked: 0 }
app.decorator.MeoCord({
  controllers: [Panel],
  providers: [{ provide: LOOKUPS, useValue: lookups }],
  themeFor: LookupThemes,
  clientOptions: { intents: [], allowedMentions: { parse: [] } },
})(App)

const interaction = () => Object.assign(app.testing.createMockInteraction(discord.ButtonInteraction, { customId: 'press' }), { guildId: GUILD })

let container
let invoke
let client
let close
if (mode === 'module') {
  const module = await app.testing.MeoCordTestingModule.fromApp(App).compile()
  container = module.container
  invoke = async () => {
    const each = interaction()
    await module.invoke(Panel, 'press', each)
    return each
  }
  close = () => module.close()
} else {
  // A started bot: the factory's bindings and dispatch, with login answered here so nothing reaches Discord
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meocord-dual-build-'))
  fs.mkdirSync(path.join(dir, 'dist'))
  fs.writeFileSync(path.join(dir, 'dist', 'meocord.config.mjs'), "export default { discordToken: 'not-a-real-token' }\n")
  process.chdir(dir)
  discord.Client.prototype.login = function () {
    client = this
    return Promise.resolve('token')
  }
  discord.Client.prototype.destroy = () => Promise.resolve()
  const bot = app.core.MeoCordFactory.create(App)
  await bot.start()
  Object.defineProperty(client, 'application', { value: { id: '100000000000000002', commands: { set: async () => [] } }, configurable: true })
  client.rest.put = async () => []
  for (const listener of client.listeners('clientReady')) await listener(client)
  container = bot.container
  invoke = async () => {
    const each = interaction()
    Object.defineProperty(each, 'client', { value: client, configurable: true })
    for (const listener of client.listeners('interactionCreate')) await listener(each)
    await new Promise(resolve => setImmediate(resolve))
    return each
  }
  close = () => fs.promises.rm(dir, { recursive: true, force: true })
}

// Another app from the other build, so the process holds a container of each inversify copy
class OtherApp {}
other.decorator.MeoCord({ controllers: [] })(OtherApp)
const otherModule = await other.testing.MeoCordTestingModule.fromApp(OtherApp).compile()
const containers = [container, otherModule.container]
expect('the two builds run two inversify copies', container.constructor !== otherModule.container.constructor, true)

const answered = await invoke()
expect('the handler ran once', seen.calls, 1)
expect("the app's theme in a call", seen.inCall?.app, GUILD_COLOR)
expect("the other build's theme in a call", seen.inCall?.other, GUILD_COLOR)
expect('a service the other build decorated is injected', seen.inCall?.greeting, 'hi')
expect('the resolver the other build decorated was asked', lookups.asked > 0, true)

// Outside a call, the theme is read through the shared state whichever build set it
const sharedKey = name => Symbol.for(`meocord@${version}:${name}`)
await attempt('the theme outside a call', async () => {
  const theme = await globalThis[sharedKey('themeState')].themeOutsideCalls(answered)
  expect('the theme outside a call', theme.colors.primary, GUILD_COLOR)
})

// The app's container, asked through its own methods only, with classes the other build decorated
await attempt('container methods with a class the other build decorated', () => {
  expect('get a service the other build decorated', container.get(Greeter).hello(), 'hi')
  container.bind('dual-build').to(LookupThemes)
  expect('bind and get', container.get('dual-build').guild({ guild: { id: GUILD } }).colors.primary, GUILD_COLOR)
  container.rebind('dual-build').toConstantValue('rebound')
  expect('rebind and get', container.get('dual-build'), 'rebound')
  container.unbind('dual-build')
  expect('unbind', container.isBound('dual-build'), false)
})

// Every store the two builds share. Each is listed with how it can reach an inversify object; one not listed fails
// the check, so a store added later is looked at here before it ships.
const STORES = {
  appThemes: 'keyed by an app container, read through the container that made it',
  callOrder: 'counters and a WeakMap of answers',
  clientPresenters: 'presenters by client',
  clientThemes: "an app's container by client, asked only through its own methods",
  clientTranslators: 'translators by client',
  commandIdScopes: 'command IDs by client',
  commandIdSources: 'keyed by an app container, holding functions over its commands',
  commandRegistrations: 'registrations in progress by client',
  deprecationWarnings: 'the deprecation warnings already printed',
  hiddenValues: 'values the Logger redacts',
  issueTexts: 'texts by usage issue',
  legacyThemeColors: 'colours the deprecated Theme statics set',
  logLevel: 'the log threshold',
  messageLocks: 'locks by message',
  mockIds: 'the last mock snowflake',
  mockThemes: 'mock themes',
  mocks: 'mock functions',
  processState: 'process-wide start and shutdown state',
  refusalReporting: 'refusals already reported',
  responseStates: 'answers by interaction',
  strictMocks: 'the strict-mocks setting',
  themeCaches: 'resolver caches by ThemeCache',
  themeScope: 'the theme of the call in progress',
  themeState: 'theme defaults and the app whose theme is read outside a call, compared by identity',
  themedClasses: 'classes a theme applies to',
}
const prefix = `meocord@${version}:`
const names = Object.getOwnPropertySymbols(globalThis)
  .map(symbol => symbol.description ?? '')
  .filter(name => name.startsWith(prefix))
  .map(name => name.slice(prefix.length))
const unknown = names.filter(name => !(name in STORES))
if (unknown.length > 0) problems.push(`shared stores this check does not know: ${unknown.join(', ')}`)

// Walks what each store reaches, weak collections looked up with the objects the run made, for inversify containers
// held as values or as keys
const keys = [...containers, client, answered, answered?.client, container.get(app.common.ThemeCache), otherModule.container.get(other.common.ThemeCache)]
const isContainer = value => containers.some(each => value instanceof each.constructor)
const found = new Set()
const visited = new Set()
const walk = (value, depth) => {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function') || visited.has(value) || depth > 6) return
  visited.add(value)
  if (isContainer(value)) return void found.add(value)
  if (typeof value === 'function') return
  if (value instanceof WeakMap) {
    for (const key of keys) {
      if (!key || !value.has(key)) continue
      if (isContainer(key)) found.add(key)
      walk(value.get(key), depth + 1)
    }
    return
  }
  if (value instanceof Map) return value.forEach((entry, key) => (walk(key, depth + 1), walk(entry, depth + 1)))
  if (value instanceof Set) return value.forEach(entry => walk(entry, depth + 1))
  if (value instanceof WeakSet) return
  for (const key of Reflect.ownKeys(value)) walk(Object.getOwnPropertyDescriptor(value, key)?.value, depth + 1)
}
for (const name of names) walk(globalThis[sharedKey(name)], 0)
for (const each of found) {
  if (!containers.includes(each)) problems.push('a shared store holds a container no app in this run made')
  await attempt('a shared container answers through its own methods', () => {
    each.bind('dual-build-walk').toConstantValue(1)
    expect('a shared container answers through its own methods', each.get('dual-build-walk'), 1)
    each.unbind('dual-build-walk')
  })
}

await otherModule.close()
await close()
console.log(JSON.stringify({ problems, stores: names.length, containers: found.size }))
process.exit(0)
