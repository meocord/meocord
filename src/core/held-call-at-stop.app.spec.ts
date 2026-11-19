// Real timers throughout: a fake timer fires outside the call's AsyncLocalStorage context, which the gate reads
import { vi } from 'vitest'
import { ButtonInteraction, ChatInputCommandInteraction, Client } from 'discord.js'
import { inject } from 'inversify'

const { logged, config, reports } = vi.hoisted(() => ({
  logged: [] as string[],
  /** Whether reporting a failed onShutdown throws, as a broken logger's may. */
  reports: { throw: false },
  config: { discordToken: 'token', shutdownTimeout: 400 } as { discordToken: string; shutdownTimeout: number },
}))

vi.mock('@src/common/index.js', async importOriginal => ({
  ...(await importOriginal<object>()),
  Logger: class {
    log = vi.fn()
    debug = vi.fn()
    info = vi.fn()
    verbose = vi.fn()
    warn = (...args: unknown[]) => logged.push(String(args[0]))
    error = (...args: unknown[]) => {
      if (reports.throw && String(args[0]).startsWith('onShutdown failed')) throw new Error('report broke')
      logged.push(String(args[0]))
    }
  },
}))
vi.mock('@src/util/meocord-config-loader.util.js', () => ({ loadMeoCordConfig: () => config }))
vi.mock('@src/util/platform.util.js', () => ({ assertBuiltForThisPlatform: () => {} }))

import { bindTheme, respond } from '@src/common/index.js'
import { Command, Controller, MeoCord, Observer, On, Service } from '@src/decorator/index.js'
import { MeoCordFactory } from '@src/core/meocord-factory.js'
import { CommandType } from '@src/enum/index.js'
import { type DispatchObserver, type DispatchResult, type MeoCordApplication, type OnReady, type OnShutdown } from '@src/interface/index.js'
import { createMockGuild, createMockInteraction, getResponse } from '@src/testing/index.js'
import {
  after,
  forgetFrameworkTimers,
  interceptFrameworkTimer,
  sleep,
  timersLeftByStop,
  trackFrameworkTimers,
  untrackFrameworkTimers,
} from '@src/spec-framework-timers.js'

const STOP_MESSAGE = 'The bot stopped before this call started.'
/** MeoCord's default primary colour: the handler's theme in an app with none of its own. */
const HANDLER = '#7680F4'
/** The colour the app's theme resolver answers with. */
const RESOLVED = '#0000D1'
const DROPPED = 'Calls dropped before they started, as the stop came while they waited: '

const events: string[] = []
/** Released by a row: Cache's onReady waits for it. */
let warm: PromiseWithResolvers<void>
let warming: PromiseWithResolvers<void>
let running: PromiseWithResolvers<void>
/** How many lines were logged when Early's onShutdown ran, so a row can tell which came before the hooks. */
let loggedAtShutdown = 0

beforeAll(() => trackFrameworkTimers())
afterAll(() => untrackFrameworkTimers())
beforeEach(() => {
  events.length = 0
  logged.length = 0
  config.shutdownTimeout = 400
  loggedAtShutdown = 0
  reports.throw = false
  forgetFrameworkTimers()
  warm = Promise.withResolvers()
  warming = Promise.withResolvers()
  running = Promise.withResolvers()
  vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
})
afterEach(async () => {
  warm.resolve()
  running.resolve()
  await sleep(20)
  vi.restoreAllMocks()
  process.removeAllListeners('SIGINT')
  process.removeAllListeners('SIGTERM')
})

/** Listed first, with no onReady: its handler runs while Cache's hook does, and a stop always closes it. */
@Service()
class Early implements OnShutdown {
  @On('guildDelete')
  async gone() {
    events.push('gone begins')
    await running.promise
    events.push('gone ends')
  }
  onShutdown() {
    events.push('Early.onShutdown')
    loggedAtShutdown = logged.length
  }
}

/** Closes after Cache's dependants and throws as it does. */
@Service()
class Breaks implements OnShutdown {
  onShutdown() {
    events.push('Breaks.onShutdown')
    throw new Error('pool gone')
  }
}

@Service()
class Cache implements OnReady {
  async onReady() {
    events.push('Cache.onReady')
    warming.resolve()
    await warm.promise
    events.push('Cache ready')
  }
}

@Service()
class Later implements OnReady {
  constructor(@inject(Cache) readonly cache: Cache) {}
  onReady() {
    events.push('Later.onReady')
  }
}

@Service()
class Welcome {
  constructor(@inject(Cache) readonly cache: Cache) {}
  @On('guildCreate')
  greet() {
    events.push('greet runs')
  }
}

@Service()
class Themes {
  user() {
    events.push('resolver asked')
    return { colors: { primary: RESOLVED as `#${string}` } }
  }
}

@Service()
class CacheThemes {
  constructor(@inject(Cache) readonly cache: Cache) {}
  user() {
    events.push('resolver asked')
    return { colors: { primary: RESOLVED as `#${string}` } }
  }
}

@Observer()
class Watch implements DispatchObserver {
  onSettled(_context: unknown, { outcome, error }: DispatchResult) {
    if (outcome === 'error') events.push(`onSettled error ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Answers in onStart, before the call waits at the gate. */
@Observer()
class AnswersOnStart implements DispatchObserver {
  onStart(context: { getInteraction(): unknown }) {
    void respond(context.getInteraction() as ChatInputCommandInteraction).send('Working')
  }
  onSettled() {}
}

@Controller()
class Quotes {
  constructor(@inject(Cache) readonly cache: Cache) {}
  @Command('quote', CommandType.SLASH)
  quote() {
    events.push('quote runs')
  }
}

@Controller()
class Free {
  @Command('shown', CommandType.SLASH)
  async shown(interaction: ChatInputCommandInteraction) {
    events.push('shown runs')
    await respond(interaction).send({ embeds: [{ description: 'Shown' }] })
  }
}

@Controller()
class NeedsLater {
  constructor(@inject(Later) readonly later: Later) {}
  @Command('later', CommandType.SLASH)
  afterLater() {
    events.push('later runs')
  }
}

let app: MeoCordApplication

/** Starts a bot logged in without a network, its hooks begun as the client comes online, with Cache's under way. */
async function startBot(
  options: { themeFor?: unknown; services?: unknown[]; controllers?: unknown[]; observers?: unknown[]; logins?: ((client: Client) => Promise<string>)[] } = {},
) {
  const { themeFor, services = [Early, Cache, Welcome], controllers = [Quotes, Free], observers = [Watch], logins = [] } = options
  const clients: Client[] = []
  vi.spyOn(Client.prototype, 'login').mockImplementation(function (this: Client) {
    clients.push(this)
    return (logins[clients.length - 1] ?? (() => Promise.resolve('token')))(this)
  })
  vi.spyOn(Client.prototype, 'destroy').mockResolvedValue(undefined)

  @MeoCord({
    controllers: controllers as never,
    services: services as never,
    observers: observers as never,
    waitForReady: true,
    clientOptions: { allowedMentions: { parse: [] }, intents: [] },
    ...(themeFor !== undefined && { themeFor: themeFor as never }),
  })
  class App {}
  app = MeoCordFactory.create(App)
  for (let attempt = 1; attempt < logins.length; attempt++) await app.start().catch(() => undefined)
  await app.start()
  const client = clients.at(-1)!
  const ready = (client.listeners('clientReady')[0] as (client: Client) => Promise<void>)(client)
  await Promise.race([warming.promise, ready])
  return { client, ready }
}

/** A slash interaction on `client` whose bound, 2 s from its creation, passes `dueMs` from now. */
function slash(client: Client, commandName: string, dueMs = 2_000) {
  const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName, client } as never)
  Object.defineProperty(interaction, 'createdTimestamp', { value: Date.now() - (2_000 - dueMs), configurable: true })
  return interaction
}
const deliver = (client: Client, event: string, ...args: unknown[]) =>
  Promise.all(client.listeners(event).map(listener => (listener as (...args: unknown[]) => unknown)(...args)))
function colours(interaction: object): (string | undefined)[] {
  return getResponse(interaction as never).calls.map(({ payload }) => {
    const embed = (payload as { embeds?: { color?: number; data?: { color?: number } }[] } | undefined)?.embeds?.[0]
    const colour = embed?.data?.color ?? embed?.color
    return colour === undefined ? undefined : `#${colour.toString(16).padStart(6, '0').toUpperCase()}`
  })
}
/** The warnings about the stop: the drain's line, the dropped line and the onReady one. */
const stopLines = () => logged.filter(line => /^(Calls |onReady in )/.test(line))

describe('a call the ready gate holds when the bot stops', () => {
  it('names a held call and a running call once each: the running one in the drain line, the dropped one in its own', async () => {
    const { client } = await startBot()
    const gone = deliver(client, 'guildDelete', createMockGuild())
    const quote = deliver(client, 'interactionCreate', slash(client, 'quote', 500))
    after(600, () => running.resolve())
    await sleep(50)
    await app.stop()
    await Promise.all([gone, quote])

    expect(stopLines()).toEqual([
      'onReady in Cache is still running after 200 ms; shutting down without waiting for it.',
      "Calls still running after 200 ms: @On('guildDelete') in Early.gone; running the onShutdown hooks in the 200 ms left.",
      `${DROPPED}interaction "/quote" for onReady in Cache.`,
    ])
    expect(events).toEqual(['Cache.onReady', 'gone begins', `onSettled error ${STOP_MESSAGE}`, 'Early.onShutdown', 'gone ends'])
  })

  it('drops a call held for a hook the stop keeps from running as the pass ends, without waiting the drain out', async () => {
    // The drain would end 7.5 s in, and records it if it does: the stop resolves at the pass's end, which cancels it
    config.shutdownTimeout = 10_000
    interceptFrameworkTimer(
      (file, delay) => file === 'core/lifecycle-hooks.ts' && delay === 7_500,
      run => () => {
        events.push('drain ends')
        run()
      },
    )
    const { client, ready } = await startBot({ services: [Early, Cache, Later], controllers: [NeedsLater] })
    const handled = deliver(client, 'interactionCreate', slash(client, 'later'))
    await sleep(50)
    const stopping = app.stop()
    after(50, () => warm.resolve())
    await stopping
    await Promise.all([ready, handled])

    expect(events).toEqual(['Cache.onReady', 'Cache ready', `onSettled error ${STOP_MESSAGE}`, 'Early.onShutdown'])
    expect(stopLines()).toEqual([`${DROPPED}interaction "/later" for onReady in Later.`])
  })

  // The failed start's undo closes its gate as a stop does, and takes the call it drops off the calls running
  it("lets a later stop's drain leave out a call a failed start's gate dropped, its answer still under way", async () => {
    const refused = (client: Client) => {
      const held = slash(client, 'quote')
      Object.assign(held, { reply: () => new Promise(() => undefined) })
      void deliver(client, 'interactionCreate', held)
      // A turn later, once the call waits at the gate
      return new Promise<string>((_, reject) => setImmediate(() => reject(new Error('login refused'))))
    }
    await startBot({ observers: [Watch, AnswersOnStart], logins: [refused, () => Promise.resolve('token')] })
    const undone = stopLines()
    await app.stop()

    // The stop has no call running to wait for, and the undo named the one its gate dropped
    expect(stopLines().slice(undone.length)).toEqual(['onReady in Cache is still running after 200 ms; shutting down without waiting for it.'])
    expect(undone).toEqual([
      'Calls dropped before they started, as the login failed while they waited: interaction "/quote" for onReady in Cache.',
      'Calls dropped at the failed login still had an answer to Discord or an observer under way after 200 ms; running the onShutdown hooks in the 200 ms left.',
    ])
  })

  it('drops the call before the hooks, and runs every hook, when a hook throws and reporting it throws', async () => {
    reports.throw = true
    const { client } = await startBot({ services: [Early, Breaks, Cache] })
    const held = slash(client, 'quote', 500)
    const handled = deliver(client, 'interactionCreate', held)
    await sleep(50)
    await app.stop().catch(() => undefined)
    await handled

    await sleep(600)
    warm.resolve()
    await sleep(50)
    expect(events).toEqual(['Cache.onReady', `onSettled error ${STOP_MESSAGE}`, 'Breaks.onShutdown', 'Early.onShutdown', 'Cache ready'])
    expect(stopLines()).toContain(`${DROPPED}interaction "/quote" for onReady in Cache.`)
    expect(getResponse(held).calls).toEqual([])
    expect(timersLeftByStop()).toEqual([])
  })

  // Waiting for a dropped call's answer ends with the drain's time, so the hooks run with their reserve, the stop after
  it.each([
    ['never resolves', 0],
    ['resolves once the stop has resolved', 1],
  ])("runs the onShutdown hooks at the drain's end for a dropped call whose onStart answer's reply %s", async (_name, told) => {
    const replied = Promise.withResolvers<void>()
    const reply = () => replied.promise
    const { client } = await startBot({ observers: [Watch, AnswersOnStart] })
    const held = slash(client, 'quote', 500)
    Object.assign(held, { reply })
    void deliver(client, 'interactionCreate', held)
    await sleep(50)
    const since = performance.now()
    await app.stop()
    const stopped = performance.now() - since
    const lines = [...logged]

    expect(stopLines()).toEqual([
      'onReady in Cache is still running after 200 ms; shutting down without waiting for it.',
      'Calls dropped before they started, as the stop came while they waited: interaction "/quote" for onReady in Cache.',
      'Calls dropped at the stop still had an answer to Discord or an observer under way after 200 ms; running the onShutdown hooks in the 200 ms left.',
    ])
    // The drain's end, its lines, then the hooks, and the stop within shutdownTimeout
    expect(events).toEqual(['Cache.onReady', 'Early.onShutdown'])
    expect(loggedAtShutdown).toBe(logged.length)
    expect(stopped).toBeLessThan(config.shutdownTimeout)
    if (told) replied.resolve()
    // Once the stop has resolved, only the reply settles: the observers told once as it does, or never, no hook again, nothing logged
    await sleep(1_100)
    expect(events).toEqual(['Cache.onReady', 'Early.onShutdown', ...Array<string>(told).fill(`onSettled error ${STOP_MESSAGE}`)])
    expect(logged).toEqual(lines)
  })

  it("leaves no timer and asks no resolver for a call held for its themeFor class's hook", async () => {
    const { client } = await startBot({ themeFor: CacheThemes })
    const shown = slash(client, 'shown', 500)
    const handled = deliver(client, 'interactionCreate', shown)
    await sleep(50)
    await app.stop()
    const timers = timersLeftByStop()
    const before = logged.length
    await handled

    // Past its bound, then the hook settles: nothing starts, asks the resolver or logs
    await sleep(600)
    warm.resolve()
    await sleep(50)
    expect(timers).toEqual([])
    expect(logged.length).toBe(before)
    expect(events).toEqual(['Cache.onReady', `onSettled error ${STOP_MESSAGE}`, 'Early.onShutdown', 'Cache ready'])
    expect(getResponse(shown).calls).toEqual([])
  })
})

describe('after the bot stops', () => {
  it("answers a bindTheme function's call in the handler's theme, the resolver not asked", async () => {
    warm.resolve()
    const { client, ready } = await startBot({ themeFor: Themes })
    await ready
    await app.stop()
    events.length = 0
    const click = createMockInteraction(ButtonInteraction, { customId: 'x', client } as never)
    await bindTheme((interaction: ButtonInteraction) => respond(interaction).send({ embeds: [{ description: 'Picked' }] }))(click)

    expect(colours(click)).toEqual([HANDLER])
    expect(events).toEqual([])
  })

  it('leaves no slow-warning timer for an onReady the stop gave up on', async () => {
    await startBot()
    await app.stop()

    expect(timersLeftByStop()).toEqual([])
  })
})

describe('a start that fails and is retried', () => {
  it('looks a theme up through the resolver', async () => {
    warm.resolve()
    const { client, ready } = await startBot({ themeFor: Themes, logins: [() => Promise.reject(new Error('login refused')), () => Promise.resolve('token')] })
    await ready
    const shown = slash(client, 'shown')
    await deliver(client, 'interactionCreate', shown)

    // The failed start's undo closed Early; the retry's call looks up, as before its onStart
    expect(events).toEqual(['Early.onShutdown', 'Cache.onReady', 'Cache ready', 'resolver asked', 'shown runs'])
    expect(colours(shown)).toEqual([RESOLVED])
    await app.stop()
  })
})
