// Run under Node and Bun by scripts/check-dual-build.ts: one process loads both builds of `dist`, the way a project
// that mixes `import` and `require()` of meocord does, and prints what it found as JSON.
//   app <first: esm|cjs> <app: esm|cjs> <mode: module|bot>  an app from one build, with classes the other decorated
//   logger <first: esm|cjs>                                  what each build's Logger writes, colour as the env sets it
//   versions <first: esm|cjs> <copy>                         `dist` beside a copy of it with another version: each
//                                                           version keeps its own MeoCord classes
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
  esm: async (from = dist) => Object.fromEntries(await Promise.all(ENTRIES.map(async e => [e, await import(pathToFileURL(path.join(from, 'esm', e, 'index.js')).href)]))),
  cjs: async (from = dist) => Object.fromEntries(ENTRIES.map(e => [e, require(path.join(from, 'cjs', e, 'index.cjs'))])),
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

// MeoCord's own classes, each one class object per version for both builds
const TOKENS = [
  ['common', 'Translator'],
  ['common', 'ThemeCache'],
  ['common', 'ExecutionContext'],
  ['common', 'CooldownStore'],
  ['common', 'MemoryCooldownStore'],
  ['core', 'HandlerRegistry'],
  ['core', 'ShardContext'],
]

if (task === 'versions') {
  const copy = path.resolve(process.argv[4])
  const copies = { [first]: await load[first](copy) }
  copies[second] = await load[second](copy)
  for (const [entry, name] of TOKENS) {
    expect(`${name}: this version's builds share it`, builds.esm[entry][name] === builds.cjs[entry][name], true)
    expect(`${name}: the other version's builds share theirs`, copies.esm[entry][name] === copies.cjs[entry][name], true)
    expect(`${name}: the two versions keep theirs apart`, builds.esm[entry][name] !== copies.esm[entry][name], true)
  }
  console.log(JSON.stringify({ problems }))
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
// A guard and a controller that type MeoCord's classes from the other build, as the compiler records them for a file
// written against that build's types: each must still be given the app's own instance
class Gate {
  constructor(context) {
    this.context = context
  }
  canActivate() {
    seen.guard = { typedByOther: this.context instanceof other.common.ExecutionContext, handler: this.context.getHandlerName() }
    return true
  }
}
Reflect.defineMetadata('design:paramtypes', [other.common.ExecutionContext], Gate)
app.decorator.Guard()(Gate)
class Tokens {
  constructor(translator, cache, store, registry, shards) {
    Object.assign(this, { translator, cache, store, registry, shards })
  }
  show() {
    seen.tokenCalls = (seen.tokenCalls ?? 0) + 1
  }
}
Reflect.defineMetadata(
  'design:paramtypes',
  [other.common.Translator, other.common.ThemeCache, other.common.CooldownStore, other.core.HandlerRegistry, other.core.ShardContext],
  Tokens,
)
const show = Object.getOwnPropertyDescriptor(Tokens.prototype, 'show')
app.decorator.Command('tokens', app.enum.CommandType.BUTTON)(Tokens.prototype, 'show', show)
app.decorator.UseGuard(Gate)(Tokens.prototype, 'show', show)
app.decorator.Cooldown({ seconds: 60, uses: 5 })(Tokens.prototype, 'show', show)
Object.defineProperty(Tokens.prototype, 'show', show)
app.decorator.Controller()(Tokens)
// A refusal answered through the other build's respond(), which reads the viewMode the app's build registered
class Refusal {
  refuse(interaction) {
    return other.common.respond(interaction).error(new other.common.UserError('Not yours.'))
  }
}
const refuse = Object.getOwnPropertyDescriptor(Refusal.prototype, 'refuse')
app.decorator.Command('refuse', app.enum.CommandType.BUTTON)(Refusal.prototype, 'refuse', refuse)
Object.defineProperty(Refusal.prototype, 'refuse', refuse)
app.decorator.Controller()(Refusal)
const translator = app.common.createTranslator({ default: 'en-US', locales: { 'en-US': { hi: 'Hello' } } })

class App {}
const lookups = { asked: 0 }
app.decorator.MeoCord({
  controllers: [Panel, Tokens, Refusal],
  i18n: translator,
  providers: [{ provide: LOOKUPS, useValue: lookups }],
  themeFor: LookupThemes,
  clientOptions: { intents: [], allowedMentions: { parse: [] } },
  viewMode: 'v2',
})(App)

const interaction = (customId = 'press') => Object.assign(app.testing.createMockInteraction(discord.ButtonInteraction, { customId }), { guildId: GUILD })

let container
let invoke
let client
let close
if (mode === 'module') {
  const module = await app.testing.MeoCordTestingModule.fromApp(App).compile()
  container = module.container
  invoke = async (cls = Panel, method = 'press', customId = 'press') => {
    const each = interaction(customId)
    await module.invoke(cls, method, each)
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
  invoke = async (_cls, _method, customId = 'press') => {
    const each = interaction(customId)
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

const refused = await invoke(Refusal, 'refuse', 'refuse')
const refusal = app.testing.getResponse(refused).calls.find(call => call.method === 'reply')
expect("the other build's respond() answers in the app's viewMode", (Number(refusal?.payload?.flags ?? 0) & discord.MessageFlags.IsComponentsV2) !== 0, true)

// Outside a call, the theme is read through the shared state whichever build set it
const sharedKey = name => Symbol.for(`meocord@${version}:${name}`)
await attempt('the theme outside a call', async () => {
  const theme = await globalThis[sharedKey('themeState')].themeOutsideCalls(answered)
  expect('the theme outside a call', theme.colors.primary, GUILD_COLOR)
})

// MeoCord's classes: one per version for both builds, and the app's own instance whichever build types it
for (const [entry, name] of TOKENS) expect(`${name} is one class for both builds`, builds.esm[entry][name] === builds.cjs[entry][name], true)
for (const name of ['HandlerRegistry', 'ShardContext']) {
  expect(`${name} carries no design metadata, as on main`, Reflect.getOwnMetadataKeys(app.core[name]).join(','), '')
}
for (const build of ['esm', 'cjs']) {
  for (const name of ['MemoryCooldownStore', 'RedisCooldownStore', 'ShardedCooldownStore']) {
    expect(`${build}'s ${name} extends the shared CooldownStore`, Object.getPrototypeOf(builds[build].common[name]) === app.common.CooldownStore, true)
  }
}
expect("the app's translator is a Translator to either build", translator instanceof other.common.Translator && translator instanceof app.common.Translator, true)
await invoke(Tokens, 'show', 'tokens')
expect('the controller typed from the other build ran once', seen.tokenCalls, 1)
expect("a guard typed by the other build's ExecutionContext gets the call's context", seen.guard?.typedByOther && seen.guard.handler, 'show')
await attempt("the other build's types inject the app's instances", () => {
  const tokens = container.get(Tokens)
  expect('Translator', tokens.translator, translator)
  expect('ThemeCache', tokens.cache, container.get(app.common.ThemeCache))
  expect('CooldownStore', tokens.store, container.get(app.common.CooldownStore))
  expect('HandlerRegistry', tokens.registry, container.get(app.core.HandlerRegistry))
  expect('ShardContext', tokens.shards, container.get(app.core.ShardContext))
  expect('the registry lists the controller', tokens.registry.list().some(entry => entry.controller === Tokens), true)
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
  'class:CooldownStore': 'the class itself, one per version',
  'class:ExecutionContext': 'the class itself, one per version',
  'class:HandlerRegistry': 'the class itself, one per version',
  'class:MemoryCooldownStore': 'the class itself, one per version',
  'class:ShardContext': 'the class itself, one per version',
  'class:ThemeCache': 'the class itself, one per version',
  'class:Translator': 'the class itself, one per version',
  clientPresenters: 'presenters by client',
  clientThemes: "an app's container by client, asked only through its own methods",
  clientTranslators: 'translators by client',
  clientViewModes: "the app's viewMode by client",
  commandIdScopes: 'command IDs by client',
  commandInteractionChecks: "each @Command method's check of its interaction, by the class that declares it",
  commandIdSources: 'keyed by an app container, holding functions over its commands',
  commandRegistrations: 'registrations in progress by client',
  cooldownCalls: "each memory cooldown store's calls",
  cooldownRecordedCalls: 'the calls each allowed verdict recorded',
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
  quietReads: "a counter of the reads MeoCord and its mocks' own code keep quiet",
  readyGates: 'keyed by an app container, holding its ready gate',
  refusalReporting: 'refusals already reported',
  registryLateSources: 'the event sources each registry lists late',
  registryRoutes: "the message routes each registry's dispatcher reads",
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
// A listed store neither build made is one a build keeps for itself, so the two would each see their own state
const missing = Object.keys(STORES).filter(name => !names.includes(name))
if (missing.length > 0) problems.push(`stores this check lists that the builds do not share: ${missing.join(', ')}`)

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
