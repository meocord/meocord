/**
 * Checks MeoCord against real Discord (see "Checking against real Discord" in CONTRIBUTING.md), after `bun run build`:
 * the smoke app, installed from the packed build, logs in, registers, shards, calls across shards, shuts down and
 * answers a helper bot, theme included. Skips without MEOCORD_E2E_BOT_TOKEN and MEOCORD_E2E_GUILD_ID; `--manual`
 * leaves it running with the checklist's commands registered globally.
 */

import { type ChildProcess, spawn, spawnSync } from 'child_process'
import { cpSync, existsSync, mkdtempSync, realpathSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { isDeepStrictEqual } from 'util'
import { actorLine } from './lib/actor.js'
import { DiscordApi, type RegisteredCommand, type StoredMessage } from './lib/discord-api.js'
import { DEFAULT_THEME } from '../src/core/theme-defaults.js'
import {
  APP_THEME,
  CLASS_THEME,
  COLOR_ROLES,
  EMOJI_ROLES,
  GUILD_THEME,
  REFUSAL,
  REFUSE,
  SWATCHES,
  USER_THEME,
} from '../test/e2e/app/src/theme-showcase.js'
import { builtCli, cleanEnv, installedCliOf, mustRun, pack, renderApp, repoRoot } from './lib/packed-app.js'

const botToken = process.env.MEOCORD_E2E_BOT_TOKEN?.trim() ?? ''
const guildId = process.env.MEOCORD_E2E_GUILD_ID?.trim() ?? ''
const channelId = process.env.MEOCORD_E2E_CHANNEL_ID?.trim() ?? ''
const helperToken = process.env.MEOCORD_E2E_HELPER_BOT_TOKEN?.trim() ?? ''
// The Discord user working through the manual checklist, whose calls are told apart from anyone else's
const clickerId = process.env.MEOCORD_E2E_CLICKER_ID?.trim() ?? ''
const manual = process.argv.includes('--manual')

const overlayDir = path.join(repoRoot, 'test', 'e2e', 'app')
// Resolved, because the check for processes left running matches the paths they were started with
const workDir = realpathSync(mkdtempSync(path.join(tmpdir(), 'meocord-e2e-')))
const appDir = path.join(workDir, 'app')
const installedCli = installedCliOf(appDir)

/** Output with every token replaced, for anything printed. */
const redact = (text: string) =>
  [botToken, helperToken].filter(Boolean).reduce((out, secret) => out.replaceAll(secret, '[token]'), text)

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

/**
 * The smoke app's environment: the inherited one, which cleanEnv strips of every MEOCORD_E2E_ value, without
 * DISCORD_TOKEN, then exactly what the app reads, so the bot's token is the one passed here and nothing else.
 */
function botEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env = cleanEnv()
  delete env.DISCORD_TOKEN
  return { ...env, MEOCORD_E2E_BOT_TOKEN: botToken, MEOCORD_E2E_GUILD_ID: guildId, ...extra }
}

/** A line the smoke app writes through `report()`. */
interface Marker {
  event: string
  pid: number
  [key: string]: unknown
}

/** The smoke app started with `meocord start --prod`, and what it reported. */
class Bot {
  readonly markers: Marker[] = []
  readonly exit: Promise<number | null>
  private readonly child: ChildProcess
  private output = ''

  constructor(env: NodeJS.ProcessEnv, echo = false, onMarker?: (marker: Marker) => void) {
    this.child = spawn('node', [installedCli, 'start', '--prod'], { cwd: appDir, env: botEnv(env), stdio: ['ignore', 'pipe', 'pipe'] })
    let pending = ''
    const read = (chunk: string) => {
      this.output += chunk
      pending += chunk
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines.map(text => text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, ''))) {
        const marker = /^E2E (\{.*\})$/.exec(line.trim())
        const reported = marker ? (JSON.parse(marker[1]) as Marker) : undefined
        if (reported) this.markers.push(reported)
        if (echo) console.log(redact(line))
        if (reported) onMarker?.(reported)
      }
    }
    this.child.stdout!.setEncoding('utf8').on('data', read)
    this.child.stderr!.setEncoding('utf8').on('data', read)
    this.exit = new Promise(resolve => this.child.on('exit', code => resolve(code)))
  }

  get running(): boolean {
    return this.child.exitCode === null && this.child.signalCode === null
  }

  /** Waits until `found` returns something truthy, failing when the bot exits first or time runs out. */
  async until<T>(what: string, found: () => T | undefined | false, timeoutMs: number): Promise<T> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const value = found()
      if (value) return value
      if (!this.running) throw new Error(`The bot exited (code ${this.child.exitCode}) before ${what}.\n${this.tail()}`)
      if (Date.now() > deadline) throw new Error(`No ${what} within ${timeoutMs / 1000}s.\n${this.tail()}`)
      await sleep(200)
    }
  }

  waitFor(what: string, match: (marker: Marker) => boolean, timeoutMs = 30_000): Promise<Marker> {
    return this.until(what, () => this.markers.find(match), timeoutMs)
  }

  waitForOutput(text: string, timeoutMs = 60_000): Promise<true> {
    return this.until(`"${text}" in the output`, () => this.output.includes(text), timeoutMs)
  }

  count(text: string): number {
    return this.output.split(text).length - 1
  }

  /** The last lines of output, with tokens replaced. */
  tail(lines = 30): string {
    const text = this.output.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').trimEnd()
    return redact(text.split('\n').slice(-lines).map(line => `        | ${line}`).join('\n'))
  }

  /** Sends a signal to the CLI alone, as Docker does. */
  stop(signal: NodeJS.Signals = 'SIGINT'): void {
    this.child.kill(signal)
  }

  async stopped(timeoutMs: number): Promise<number | null> {
    const timeout = sleep(timeoutMs).then(() => 'timeout' as const)
    const code = await Promise.race([this.exit, timeout])
    if (code === 'timeout') throw new Error(`The bot did not exit within ${timeoutMs / 1000}s of the signal.\n${this.tail()}`)
    return code
  }

  kill(): void {
    if (this.running) this.child.kill('SIGKILL')
  }
}

type Outcome = 'ok' | 'FAIL' | 'skip' | 'human'
const outcomes: Outcome[] = []

function record(outcome: Outcome, name: string, detail?: string): void {
  outcomes.push(outcome)
  console.log(`  ${outcome.padEnd(5)} ${name}${detail ? `\n        ${detail}` : ''}`)
}

async function check(name: string, body: () => Promise<string | void>): Promise<boolean> {
  try {
    record('ok', name, (await body()) || undefined)
    return true
  } catch (error) {
    record('FAIL', name, redact(error instanceof Error ? error.message : String(error)))
    return false
  }
}

/** The processes whose command line names a path inside the work directory; none on Windows, where it is not checked. */
function processesLeft(): { pid: number; command: string }[] {
  if (process.platform === 'win32') return []
  const ps = spawnSync('ps', ['-A', '-o', 'pid=,args='], { encoding: 'utf8' })
  return ps.stdout
    .split('\n')
    .filter(line => line.includes(workDir + path.sep))
    .map(line => {
      const [, pid, command] = /^\s*(\d+)\s+(.*)$/.exec(line) ?? []
      return { pid: Number(pid), command }
    })
    .filter(({ pid }) => pid > 0 && pid !== process.pid)
}

async function checkNothingLeft(): Promise<void> {
  await check('leaves no process running', async () => {
    for (let attempt = 0; attempt < 50; attempt++) {
      if (processesLeft().length === 0) return
      await sleep(200)
    }
    const left = processesLeft()
    for (const { pid } of left) process.kill(pid, 'SIGKILL')
    throw new Error(`Still running, now killed:\n${left.map(({ command }) => `        ${command}`).join('\n')}`)
  })
}

/** Renders a generated app from the packed build, replaces its code with the smoke app's, installs, typechecks and builds it. */
function prepare(): void {
  const started = performance.now()
  renderApp(appDir, pack(workDir))
  rmSync(path.join(appDir, 'src'), { recursive: true, force: true })
  cpSync(overlayDir, appDir, { recursive: true })
  mustRun('install the smoke app', process.execPath, ['install'], appDir)
  mustRun('typecheck the smoke app', process.execPath, ['run', 'tsc', '-p', 'tsconfig.json'], appDir)
  mustRun('build the smoke app', 'node', [installedCli, 'build', '--prod'], appDir, botEnv())
  console.log(`  ok    install, typecheck and build the smoke app (${((performance.now() - started) / 1000).toFixed(0)}s)`)
}

const readyOf = (bot: Bot, cls: string) => bot.markers.filter(marker => marker.event === 'ready' && marker.cls === cls)
const shutdownOrder = (bot: Bot, pid: number) =>
  bot.markers.filter(marker => marker.event === 'shutdown' && marker.pid === pid).map(marker => String(marker.cls))

/** A hex colour as Discord stores it. */
const colourOf = (hex: string) => Number.parseInt(hex.slice(1), 16)

/** The theme a message from the helper bot in the test server is answered in: every layer, in the order MeoCord merges them. */
const expectedTheme = {
  colors: { ...DEFAULT_THEME.colors, ...APP_THEME.colors, ...CLASS_THEME.colors, ...GUILD_THEME.colors, ...USER_THEME.colors } as Record<string, string>,
  emojis: { ...DEFAULT_THEME.emojis, ...CLASS_THEME.emojis } as Record<string, string>,
}

/** The bot's reply to `messageId`, once it is there. */
async function replyTo(api: DiscordApi, messageId: string, botId: string): Promise<StoredMessage> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const reply = (await api.messagesAfter(channelId, messageId)).find(
      message => message.author.id === botId && message.message_reference?.message_id === messageId,
    )
    if (reply) return reply
    await sleep(1_000)
  }
  throw new Error(`No reply to message ${messageId} within 30s.`)
}

/**
 * The helper bot asks the showcase listener for its swatches and for a refusal, and the stored answers must carry
 * the call's theme: the app's, the listener class's @UseTheme, the test server's and the helper bot's, merged.
 */
async function themeChecks(bot: Bot, helper: DiscordApi): Promise<void> {
  const api = new DiscordApi(botToken)
  const botId = (await api.currentUser()).id
  const sent: string[] = []
  const replies: string[] = []
  try {
    await check("a listener's reply takes the app's, the class's, the server's and the user's theme", async () => {
      const ask = await helper.sendMessage(channelId, SWATCHES)
      sent.push(ask.id)
      const marker = await bot.waitFor('the swatches reply', marker => marker.event === 'theme-reply' && marker.to === ask.id)
      replies.push(String(marker.id))
      const reply = await api.message(channelId, String(marker.id))
      const colours = Object.fromEntries(reply.embeds.map(embed => [embed.title, embed.color]))
      const expected = Object.fromEntries(COLOR_ROLES.map(role => [role, colourOf(expectedTheme.colors[role])]))
      expect(isDeepStrictEqual(colours, expected), `Stored ${JSON.stringify(colours)}, expected ${JSON.stringify(expected)}.`)
      const emojis = EMOJI_ROLES.map(role => `${role} ${expectedTheme.emojis[role]}`).join('\n')
      expect(reply.content === emojis, `Stored ${JSON.stringify(reply.content)}, expected ${JSON.stringify(emojis)}.`)
    })
    await check("a UserError from a listener is answered with the call's warning emoji", async () => {
      const ask = await helper.sendMessage(channelId, REFUSE)
      sent.push(ask.id)
      const reply = await replyTo(api, ask.id, botId)
      replies.push(reply.id)
      const text = `${expectedTheme.emojis.warning} ${REFUSAL}`
      expect(reply.content === text, `Stored ${JSON.stringify(reply.content)}, expected ${JSON.stringify(text)}.`)
    })
  } finally {
    for (const id of sent) await helper.deleteMessage(channelId, id).catch(error => console.log(`        could not delete the helper's message: ${redact(String(error))}`))
    for (const id of replies) await api.deleteMessage(channelId, id).catch(error => console.log(`        could not delete the bot's reply: ${redact(String(error))}`))
  }
}

/** The helper bot posts a message and reacts to it, which the smoke app must see, then runs the theme checks. */
async function helperChecks(bot: Bot): Promise<void> {
  if (!helperToken || !channelId) {
    const name = 'a message, a reaction and the theme showcase from the helper bot'
    if (process.env.CI === 'true') {
      // Skipped, as on a contributor's machine, but with a warning on the run, so a job that passes says what it left unrun
      const warning =
        'helper bot not configured: set MEOCORD_E2E_HELPER_BOT_TOKEN and MEOCORD_E2E_CHANNEL_ID in the e2e environment; ' +
        'message, reaction and theme checks skipped'
      console.log(`::warning title=Real Discord::${warning}`)
      record('skip', name, warning)
    } else {
      record('skip', name, 'set MEOCORD_E2E_CHANNEL_ID and MEOCORD_E2E_HELPER_BOT_TOKEN to run them')
    }
    return
  }

  const helper = new DiscordApi(helperToken)
  let message: { id: string } | undefined
  try {
    await check("@On('messageCreate') receives the helper bot's message", async () => {
      message = await helper.sendMessage(channelId, 'MeoCord e2e: a message and reaction check, deleted when it ends.')
      await bot.waitFor('message event for the helper bot’s message', marker => marker.event === 'message-event' && marker.id === message!.id)
    })
    await check("@ReactionHandler with bots: true receives the helper bot's reaction, and one without ignores it", async () => {
      expect(message, 'There is no message to react to.')
      await helper.react(channelId, message.id, '✅')
      await bot.waitFor('reaction on the helper bot’s message', marker => marker.event === 'reaction' && marker.message === message!.id)
      // The handler without bots: true would have run with the other, had the reaction reached it
      await sleep(2_000)
      const reached = bot.markers.some(marker => marker.event === 'reaction-people-only' && marker.message === message!.id)
      expect(!reached, 'A handler without bots: true ran for the helper bot’s reaction.')
    })
  } finally {
    if (message) {
      await helper.deleteMessage(channelId, message.id).catch(error => console.log(`        could not delete the helper's message: ${redact(String(error))}`))
    }
  }
  await themeChecks(bot, helper)
}

async function automated(): Promise<void> {
  const api = new DiscordApi(botToken)
  const applicationId = await api.applicationId()
  let registered: RegisteredCommand[] = []

  // The helper bot's id, so the smoke app gives its messages a user's theme
  const themedUserId = helperToken && channelId ? (await new DiscordApi(helperToken).currentUser()).id : ''
  console.log('\nOne process')
  const bot = new Bot({ MEOCORD_E2E_THEMED_USER_ID: themedUserId })
  try {
    const started = await check('logs in and runs onReady in dependency order', async () => {
      const probe = await bot.waitFor('onReady in ProbeService', marker => marker.event === 'ready' && marker.cls === 'ProbeService', 90_000)
      const order = bot.markers.filter(marker => marker.event === 'ready').map(marker => marker.cls)
      expect(isDeepStrictEqual(order, ['ClockService', 'ProbeService']), `onReady ran in the order ${order.join(', ')}.`)
      expect(probe.primary === true, 'onReady was told the process is not primary.')
    })
    if (!started) return

    await check('ShardContext.call reaches the one process', async () => {
      const call = await bot.waitFor('ShardContext.call result', marker => marker.event === 'shard-call')
      expect(isDeepStrictEqual(call.results, [[0]]), `call returned ${JSON.stringify(call.results)}.`)
    })

    await check('registers exactly the smoke command in the test server', async () => {
      await bot.waitForOutput('Registered ')
      registered = await api.guildCommands(applicationId, guildId)
      const names = registered.map(command => command.name).sort()
      expect(isDeepStrictEqual(names, ['e2e-ping']), `The test server has ${JSON.stringify(names)}.`)
    })

    await check('clearOther leaves no global command', async () => {
      let global: RegisteredCommand[] = []
      for (let attempt = 0; attempt < 20; attempt++) {
        global = await api.globalCommands(applicationId)
        if (global.length === 0) return
        await sleep(1_000)
      }
      throw new Error(`Global commands are still registered: ${global.map(command => command.name).join(', ')}.`)
    })

    await helperChecks(bot)
    record('human', '@MessageHandler answers "e2e ping"', 'dispatch ignores messages from bots, so a person checks it; see the checklist')

    await check('SIGINT to the CLI runs onShutdown in reverse dependency order and exits 0', async () => {
      const pid = readyOf(bot, 'ProbeService')[0].pid
      bot.stop('SIGINT')
      const code = await bot.stopped(30_000)
      expect(code === 0, `The CLI exited with code ${code}.\n${bot.tail()}`)
      const order = shutdownOrder(bot, pid)
      expect(isDeepStrictEqual(order, ['ProbeService', 'ClockService']), `onShutdown ran in the order ${order.join(', ') || '(none)'}.`)
    })
    await checkNothingLeft()
  } finally {
    bot.kill()
  }

  console.log('\nProcess sharding, two shards')
  const sharded = new Bot({ MEOCORD_E2E_SHARDING: 'process' })
  try {
    const started = await check('starts a process per shard, primary only on shard 0', async () => {
      const probes = await sharded.until('onReady in both shards', () => readyOf(sharded, 'ProbeService').length >= 2 && readyOf(sharded, 'ProbeService'), 180_000)
      const shards = probes.map(probe => ({ shards: probe.shards, primary: probe.primary })).sort((a, b) => String(a.shards).localeCompare(String(b.shards)))
      expect(
        isDeepStrictEqual(shards, [
          { shards: [0], primary: true },
          { shards: [1], primary: false },
        ]),
        `The shards reported ${JSON.stringify(shards)}.`,
      )
      expect(new Set(probes.map(probe => probe.pid)).size === 2, 'Both shards ran in one process.')
    })
    if (!started) return

    await check('ShardContext.call reaches both processes', async () => {
      const call = await sharded.waitFor('ShardContext.call result', marker => marker.event === 'shard-call')
      const results = (call.results as unknown[]).map(result => JSON.stringify(result)).sort()
      expect(isDeepStrictEqual(results, ['[0]', '[1]']), `call returned ${JSON.stringify(call.results)}.`)
    })

    await check('registers once, leaving the registered commands as they were', async () => {
      await sharded.waitForOutput('Registered ')
      expect(sharded.count('Registered ') === 1, `Commands were registered ${sharded.count('Registered ')} times.`)
      const now = await api.guildCommands(applicationId, guildId)
      const identity = (commands: RegisteredCommand[]) => commands.map(({ id, name, version }) => ({ id, name, version })).sort((a, b) => a.name.localeCompare(b.name))
      expect(
        registered.length === 0 || isDeepStrictEqual(identity(now), identity(registered)),
        `The commands changed: ${JSON.stringify(identity(registered))} became ${JSON.stringify(identity(now))}.`,
      )
    })

    await check('SIGINT to the CLI shuts every shard down through onShutdown and exits 0', async () => {
      const pids = readyOf(sharded, 'ProbeService').map(marker => marker.pid)
      sharded.stop('SIGINT')
      const code = await sharded.stopped(40_000)
      expect(code === 0, `The CLI exited with code ${code}.\n${sharded.tail()}`)
      for (const pid of pids) {
        const order = shutdownOrder(sharded, pid)
        expect(isDeepStrictEqual(order, ['ProbeService', 'ClockService']), `onShutdown in process ${pid} ran in the order ${order.join(', ') || '(none)'}.`)
      }
    })
    await checkNothingLeft()
  } finally {
    sharded.kill()
  }
}

/** Starts the smoke app with the checklist's commands and passes its output through until Ctrl+C. */
async function manualRun(): Promise<void> {
  const api = new DiscordApi(botToken)
  const applicationId = await api.applicationId()
  // The global copies replace them here, so the test server lists each command once
  await api.clearGuildCommands(applicationId, guildId)
  console.log(`\nCleared the test server's commands; the next automated run registers them there again.`)
  console.log(`Starting the smoke app with the checklist's commands, registered globally.`)
  const install = `https://discord.com/oauth2/authorize?client_id=${applicationId}`
  console.log(`Add the bot to a server:  ${install}&scope=bot+applications.commands&permissions=117760&integration_type=0`)
  console.log(`Install it to an account: ${install}&scope=applications.commands&integration_type=1`)
  console.log(
    clickerId
      ? 'Each call is checked against MEOCORD_E2E_CLICKER_ID; one from anyone else is flagged.'
      : 'MEOCORD_E2E_CLICKER_ID is not set: each call shows who made it, unchecked.',
  )
  console.log('Work through "Checking against real Discord" in CONTRIBUTING.md, then press Ctrl+C.\n')
  const bot = new Bot({ MEOCORD_E2E_MODE: 'manual' }, true, marker => {
    const line = actorLine(marker, clickerId)
    if (line) console.log(line)
  })
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => bot.stop(signal))
  const code = await bot.exit
  if (code !== 0) process.exitCode = code ?? 1
}

async function main(): Promise<void> {
  if (!botToken || !guildId) {
    console.log(
      'Skipping the real-Discord checks: MEOCORD_E2E_BOT_TOKEN and MEOCORD_E2E_GUILD_ID are not set. ' +
        'See "Checking against real Discord" in CONTRIBUTING.md.',
    )
    rmSync(workDir, { recursive: true, force: true })
    return
  }
  if (!existsSync(builtCli)) {
    console.error(`Built CLI not found at ${path.relative(repoRoot, builtCli)}. Run "bun run build" first.`)
    rmSync(workDir, { recursive: true, force: true })
    process.exitCode = 1
    return
  }

  if (!manual) {
    // An interrupted run would otherwise leave a bot online and a full install in the temp directory
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.once(signal, () => {
        for (const { pid } of processesLeft()) process.kill(pid, 'SIGKILL')
        rmSync(workDir, { recursive: true, force: true })
        process.exit(130)
      })
    }
  }

  const started = performance.now()
  try {
    console.log(`Checking against real Discord in ${workDir}\n`)
    prepare()
    if (manual) {
      await manualRun()
      return
    }
    await automated()
    const failed = outcomes.filter(outcome => outcome === 'FAIL').length
    const total = ((performance.now() - started) / 1000).toFixed(0)
    console.log(failed === 0 ? `\nEvery check passed (${total}s).` : `\n${failed} check(s) failed (${total}s).`)
    if (failed > 0) process.exitCode = 1
  } catch (error) {
    console.error(`\n${redact(error instanceof Error ? error.message : String(error))}`)
    process.exitCode = 1
  } finally {
    for (const { pid } of processesLeft()) process.kill(pid, 'SIGKILL')
    rmSync(workDir, { recursive: true, force: true })
  }
}

await main()
