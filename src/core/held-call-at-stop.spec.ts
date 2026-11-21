// Real timers throughout: a fake timer fires outside the call's AsyncLocalStorage context, which the gate reads
import { ButtonInteraction, ChatInputCommandInteraction, DiscordAPIError } from 'discord.js'
import { inject } from 'inversify'
import { vi } from 'vitest'
import { bindTheme, Logger, respond } from '@src/common/index.js'
import { Command, Controller, Cooldown, Defer, MeoCord, Observer, On, Service } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { type DispatchObserver, type DispatchResult, type OnReady, type OnShutdown } from '@src/interface/index.js'
import { type ExecutionContext } from '@src/common/execution-context.js'
import { droppedReplyDeleteMs, hooksReserveMs } from '@src/core/lifecycle-hooks.js'
import { ReadyGate } from '@src/core/ready-gate.js'
import { type CooldownEntry, MemoryCooldownStore } from '@src/common/cooldown-store.js'
import { createMockGuild, createMockInteraction, getResponse, MeoCordTestingModule } from '@src/testing/index.js'
import { forgetStrictMocks, useStrictMocks } from '@src/testing/strict-mocks.js'
import {
  actAround,
  after,
  CALLBACK_ORDERS,
  forgetFrameworkTimers,
  interceptFrameworkTimer,
  nextInOrder,
  stopRecord,
  TIMER_EARLY_MS,
  sleep,
  timersLeftByStop,
  trackFrameworkTimers,
  untrackFrameworkTimers,
} from '@src/spec-framework-timers.js'

const STOP_MESSAGE = 'The bot stopped before this call started.'
/** MeoCord's default primary colour: the handler's theme in an app with none of its own. */
const HANDLER = '#7680F4'
const TIMEOUT = 400
/** When the stop's drain ends, from the close: where the gate closes. */
const DRAIN = TIMEOUT - hooksReserveMs(TIMEOUT)
/** How long after the dispatch each row closes. */
const CLOSE_AT = 50
/** How long LateStore takes to answer: past the drain's end, so only a drain that finished waits for it. */
const LATE_STORE_MS = 320
/** How long past the drain's end the stop waits for a dropped call's deferred reply to be deleted. */
const DELETE_GRACE = droppedReplyDeleteMs(TIMEOUT)
/** How late the late-deadline row's deadline fires: past any early firing and rounding, so a figure taken from when it was due shows. */
const LATE_MS = 30

/** Runs `act` at `order` relative to the drain-end timer's callback, where the close decides. */
const atDrainEnd = (order: (typeof CALLBACK_ORDERS)[number], act: () => void) =>
  actAround((file, delay) => file === 'core/lifecycle-hooks.ts' && delay === DRAIN, order, act)

beforeAll(() => trackFrameworkTimers())
afterAll(() => untrackFrameworkTimers())

// ---- The app ------------------------------------------------------------------------------------------------------

const events: string[] = []
const warned: string[] = []
/** Released by a row: Cache's onReady waits for it. */
let warm: PromiseWithResolvers<void>
let warming: PromiseWithResolvers<void>
let running: PromiseWithResolvers<void>
/** How many warnings were logged when Ledger's onShutdown ran, so a row can tell which came before the hooks. */
let warnedAtShutdown = 0
/** Where Ledger's onShutdown ran in the order the timer tracker keeps: when the hooks began. */
let ledgerSeq = 0
/** Where each deletion a row made with deletesIn settled in that order. */
const deletedSeq: number[] = []
/** How long Slow's onSettled takes, or never. */
let settleTakes: number | 'never' = 'never'
/** What StartsSlowly's onStart waits for: a row resolves it once close() has resolved, or never. */
let starts: PromiseWithResolvers<void>
/** What HangingStore's operations and Stuck's handler wait for, which a row resolves only once close() has resolved. */
let hang: PromiseWithResolvers<void>
/** The row running, so an observer a row left waiting records nothing in the next. */
let row = 0

beforeEach(() => {
  events.length = 0
  warned.length = 0
  deletedSeq.length = 0
  forgetFrameworkTimers()
  warnedAtShutdown = 0
  settleTakes = 'never'
  starts = Promise.withResolvers()
  hang = Promise.withResolvers()
  row++
  warm = Promise.withResolvers()
  warming = Promise.withResolvers()
  running = Promise.withResolvers()
  vi.spyOn(Logger.prototype, 'warn').mockImplementation((...args: unknown[]) => void warned.push(String(args[0])))
  vi.spyOn(Logger.prototype, 'error').mockImplementation((...args: unknown[]) => void warned.push(String(args[0])))
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
})
afterEach(async () => {
  warm.resolve()
  running.resolve()
  await sleep(20)
  vi.restoreAllMocks()
})

@Service()
class Cache implements OnReady, OnShutdown {
  async onReady() {
    events.push('Cache.onReady')
    warming.resolve()
    await warm.promise
    events.push('Cache ready')
  }
  onShutdown() {
    events.push('Cache.onShutdown')
  }
}

/** Ready as soon as it is made, so close()'s hooks always shut it down: the rows' mark of when they ran. */
@Service()
class Ledger implements OnShutdown {
  onShutdown() {
    events.push('Ledger.onShutdown')
    warnedAtShutdown = warned.length
    ledgerSeq = nextInOrder()
  }
}

/** Listed before Cache, with no hook: its handler runs while Cache's hook does. */
@Service()
class Early {
  @On('guildDelete')
  async gone() {
    events.push('gone begins')
    await running.promise
    events.push('gone ends')
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

/** Handles an event with no server or user, and injects nothing. */
@Service()
class Alarm {
  @On('warn')
  raised() {
    events.push('raised runs')
  }
}

/** A cooldown store whose answer comes after `LATE_STORE_MS`, past a call's own wait for it, and that closes in onShutdown. */
@Service()
class LateStore extends MemoryCooldownStore {
  override async consumeMany(entries: readonly CooldownEntry[]) {
    await sleep(LATE_STORE_MS)
    events.push('store operation settles')
    return super.consumeMany(entries)
  }
  onShutdown() {
    events.push('store.onShutdown')
  }
}

/** Needs no unit with a hook, so the gate lets it through; its cooldown leaves a store operation behind. */
@Controller()
class Limited {
  @Cooldown({ seconds: 5 })
  @Command('limited', CommandType.SLASH)
  limited() {
    events.push('limited runs')
  }
}

/** A cooldown store whose operations settle only once the row resolves `hang`, and that closes in onShutdown. */
@Service()
class HangingStore extends MemoryCooldownStore {
  override async consumeMany(entries: readonly CooldownEntry[]) {
    await hang.promise
    return super.consumeMany(entries)
  }
  onShutdown() {
    events.push('store.onShutdown')
  }
}

/** Needs no unit with a hook, so the gate lets it through; it runs until the row resolves `hang`, its store operation pending. */
@Controller()
class Stuck {
  @Cooldown({ seconds: 5 })
  @Command('stuck', CommandType.SLASH)
  async stuck() {
    events.push('stuck runs')
    await hang.promise
  }
}

/** A controller with a pending onReady, listed after Limited: it holds its own calls and none of Limited's. */
@Controller()
class Gatekeeper implements OnReady {
  async onReady() {
    warming.resolve()
    await warm.promise
  }
  @Command('gated', CommandType.SLASH)
  gated() {
    events.push('gated runs')
  }
}

/** Themes only servers, reading Cache. */
@Service()
class GuildThemes {
  constructor(@inject(Cache) readonly cache: Cache) {}
  guild() {
    events.push('resolver asked')
    return { colors: { primary: '#0000D1' as const } }
  }
}

@Service()
class CacheThemes {
  constructor(@inject(Cache) readonly cache: Cache) {}
  user() {
    events.push('resolver asked')
    return { colors: { primary: '#0000D1' as const } }
  }
}

@Observer()
class Watch implements DispatchObserver {
  onStart() {
    events.push('onStart')
  }
  onSettled(_context: unknown, { outcome, handled, response, error }: DispatchResult) {
    events.push(`onSettled ${outcome} handled=${handled} response=${response} ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Answers in onStart, which waits for the call's theme. */
@Observer()
class AnswersOnStart implements DispatchObserver {
  onStart(context: ExecutionContext) {
    void respond(context.getInteraction() as ChatInputCommandInteraction).send({ embeds: [{ description: 'Working' }] })
  }
  onSettled(_context: unknown, { outcome, response, error }: DispatchResult) {
    events.push(`onSettled ${outcome} response=${response} ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Answers 10 ms after onStart, once an eager @Defer's deferred reply has gone out, so its answer edits that reply. */
@Observer()
class AnswersSoon implements DispatchObserver {
  onStart(context: ExecutionContext) {
    after(10, () => void respond(context.getInteraction() as ChatInputCommandInteraction).send('Working'))
  }
  onSettled() {}
}

/** Finishes its onStart once the row resolves `starts`, or never. */
@Observer()
class StartsSlowly implements DispatchObserver {
  onStart() {
    return starts.promise
  }
  onSettled() {
    events.push('StartsSlowly told')
  }
}

/** Takes `settleTakes` to hear of a settled call, or never finishes. */
@Observer()
class Slow implements DispatchObserver {
  onSettled() {
    const mine = row
    events.push('onSettled begins')
    return settleTakes === 'never' ? new Promise<void>(() => undefined) : sleep(settleTakes).then(() => void (mine === row && events.push('onSettled ends')))
  }
}

/** Never finishes hearing of a call the stop dropped; done at once with any other. */
@Observer()
class NeverForDropped implements DispatchObserver {
  onSettled(_context: unknown, { outcome }: DispatchResult) {
    return outcome === 'error' ? new Promise<void>(() => undefined) : undefined
  }
}

@Controller()
class Quotes {
  constructor(@inject(Cache) readonly cache: Cache) {}
  @Command('quote', CommandType.SLASH)
  quote() {
    events.push('quote runs')
  }
  @Defer()
  @Command('eager', CommandType.SLASH)
  eager() {
    events.push('eager runs')
  }
  @Defer({ ephemeral: true })
  @Command('privately', CommandType.SLASH)
  privately() {
    events.push('privately runs')
  }
  @Defer()
  @Command('press', CommandType.BUTTON)
  press() {
    events.push('press runs')
  }
  @Defer({ mode: 'auto' })
  @Command('auto', CommandType.SLASH)
  auto() {
    events.push('auto runs')
  }
  @Defer({ mode: 'auto' })
  @Command('pick', CommandType.BUTTON)
  pick() {
    events.push('pick runs')
  }
}

@Controller()
class Free {
  @Command('shown', CommandType.SLASH)
  async shown(interaction: ChatInputCommandInteraction) {
    events.push('shown runs')
    await respond(interaction).send({ embeds: [{ description: 'Shown' }] })
  }
  /** Throws what a dropped call settles with, by message only. */
  @Command('lookalike', CommandType.SLASH)
  lookalike() {
    throw new Error(STOP_MESSAGE)
  }
}

function moduleOf(
  options: {
    themeFor?: unknown
    warnSlow?: boolean
    observers?: unknown[]
    shutdownTimeout?: number
    services?: unknown[]
    controllers?: unknown[]
    cooldownStore?: unknown
  } = {},
) {
  const { themeFor, warnSlow, observers = [Watch], shutdownTimeout = TIMEOUT, services = [Ledger, Early, Cache, Welcome], controllers = [Quotes, Free], cooldownStore } = options
  @MeoCord({
    controllers: controllers as never,
    services: services as never,
    // A call waits 20 ms for the store and goes on without it, so its operation outlives the call
    ...(cooldownStore !== undefined && { cooldownStore: cooldownStore as never, cooldownStoreTimeoutMs: 20, cooldownStoreFailure: 'allow' as const }),
    observers: observers as never,
    waitForReady: true,
    clientOptions: { intents: [] },
    ...(themeFor !== undefined && { themeFor: themeFor as never }),
    ...(warnSlow !== undefined && { warnSlow }),
  })
  class App {}
  return MeoCordTestingModule.fromApp(App, { shutdownTimeout }).compile()
}
type Module = ReturnType<typeof moduleOf>

/** Starts the hooks and waits for Cache's to begin. */
async function readying(module: Module): Promise<void> {
  void module.init({ ready: true })
  await warming.promise
}

/** A slash interaction whose bound, 2 s from its creation, passes `dueMs` from now. */
function slash(commandName: string, dueMs = 2_000) {
  const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName })
  Object.defineProperty(interaction, 'createdTimestamp', { value: Date.now() - (2_000 - dueMs), configurable: true })
  return interaction
}
const sent = (interaction: object) => getResponse(interaction as never).calls.map(call => call.method)
function colours(interaction: object): (string | undefined)[] {
  return getResponse(interaction as never).calls.map(({ payload }) => {
    const embed = (payload as { embeds?: { color?: number; data?: { color?: number } }[] } | undefined)?.embeds?.[0]
    const colour = embed?.data?.color ?? embed?.color
    return colour === undefined ? undefined : `#${colour.toString(16).padStart(6, '0').toUpperCase()}`
  })
}

/** Closes the module `CLOSE_AT` ms from `since`, returning what was armed and logged as the close resolved. */
async function closeAt(module: Module, since: number) {
  await sleep(Math.max(0, CLOSE_AT - (performance.now() - since)))
  await module.close()
  return { timers: timersLeftByStop(), logged: warned.length }
}

/** `call`'s result if it has settled within a few ms. */
const settledBy = <T>(call: Promise<T>) => Promise.race([call, sleep(5).then(() => 'still pending' as const)])

describe('a call the ready gate holds when a testing module closes', () => {
  it('starts nothing for a held interaction: dispatch() resolves with ran false and the stop error by the close', async () => {
    const module = moduleOf()
    await readying(module)
    const quote = slash('quote', 500)
    const since = performance.now()
    const handled = module.dispatch(quote)
    const { timers, logged } = await closeAt(module, since)

    const result = await settledBy(handled)
    expect(result).toMatchObject({ ran: false, error: expect.objectContaining({ message: STOP_MESSAGE }) })
    const { error } = result as { error: Error }
    // A plain Error, so an app catches nothing new
    expect(Object.getPrototypeOf(error)).toBe(Error.prototype)
    expect(timers).toEqual([])

    // Past its bound, then the hook settles: still nothing starts
    await sleep(600)
    warm.resolve()
    await sleep(50)
    // Its observers hear of it before the onShutdown hooks run, as of a call the drain waited for
    expect(events).toEqual(['Cache.onReady', 'onStart', `onSettled error handled=false response=unanswered ${STOP_MESSAGE}`, 'Ledger.onShutdown', 'Cache ready'])
    expect(sent(quote)).toEqual([])
    // The module names no dropped call, and the gate warns of no call it let through
    expect(warned).toEqual(['onReady in Cache is still running after 200 ms; shutting down without waiting for it.'])
    expect(warned.length).toBe(logged)
  })

  it('starts nothing for a held event: emit() counts no handler and observers get no response', async () => {
    const module = moduleOf()
    await readying(module)
    const since = performance.now()
    const handled = module.emit('guildCreate', createMockGuild())
    const { timers } = await closeAt(module, since)

    expect(await settledBy(handled)).toEqual({ ran: 0 })
    expect(timers).toEqual([])
    warm.resolve()
    await sleep(50)
    expect(events).toEqual(['Cache.onReady', 'onStart', `onSettled error handled=false response=undefined ${STOP_MESSAGE}`, 'Ledger.onShutdown', 'Cache ready'])
  })

  it('resolves invoke() of a held call with ran false and the stop error', async () => {
    const module = moduleOf()
    await readying(module)
    const since = performance.now()
    const handled = module.invoke(Quotes, 'quote', slash('quote', 500) as never)
    await closeAt(module, since)

    expect(await settledBy(handled)).toMatchObject({ ran: false, error: expect.objectContaining({ message: STOP_MESSAGE }) })
    await sleep(500)
    expect(events).not.toContain('quote runs')
  })

  it.each([
    ['a slash command', () => slash('auto', 0)],
    ['a button', () => Object.defineProperty(createMockInteraction(ButtonInteraction, { customId: 'pick' }), 'createdTimestamp', { value: Date.now() - 2_000 })],
  ])("cancels @Defer({ mode: 'auto' })'s timer on %s without acknowledging", async (_name, make) => {
    const module = moduleOf()
    await readying(module)
    const interaction = make()
    const since = performance.now()
    const handled = module.dispatch(interaction)
    await closeAt(module, since)
    // Past the 500 ms its acknowledgement was due at
    await sleep(900 - (performance.now() - since))
    warm.resolve()
    await handled
    await sleep(50)

    expect(sent(interaction)).toEqual([])
    expect(events.filter(event => event.endsWith('runs'))).toEqual([])
  })

  it("sends an observer's onStart answer once, in the handler's theme, the resolver not asked", async () => {
    const module = moduleOf({ themeFor: CacheThemes, observers: [AnswersOnStart] })
    await readying(module)
    const quote = slash('quote', 500)
    const since = performance.now()
    const handled = module.dispatch(quote)
    await closeAt(module, since)

    expect(await settledBy(handled)).toMatchObject({ ran: false })
    expect(colours(quote)).toEqual([HANDLER])
    warm.resolve()
    await sleep(700)
    expect(sent(quote)).toEqual(['reply'])
    expect(events).toEqual(['Cache.onReady', `onSettled error response=replied ${STOP_MESSAGE}`, 'Ledger.onShutdown', 'Cache ready'])
  })

  /**
   * A dropped call's tail that outlasts the drain's time, set up on `quote`: the event that shows its observers were
   * told, and when they are: by the drain's end, once after the close as what was under way settles, or never.
   */
  const tails: [string, unknown[], (quote: ChatInputCommandInteraction) => void, string, 'by the drain' | 'after' | 'never'][] = [
    ['an onSettled that never settles', [Slow], () => (settleTakes = 'never'), 'onSettled begins', 'by the drain'],
    ['an onSettled that takes 300 ms', [Slow], () => (settleTakes = 300), 'onSettled begins', 'by the drain'],
    ['an onSettled that takes 1000 ms', [Slow], () => (settleTakes = 1_000), 'onSettled begins', 'by the drain'],
    ['an async onStart that never settles', [StartsSlowly], () => undefined, 'StartsSlowly told', 'never'],
    ['an async onStart that settles once close() has resolved', [StartsSlowly], () => undefined, 'StartsSlowly told', 'after'],
    [
      'an onStart answer whose reply never resolves',
      [AnswersOnStart],
      quote => void Object.assign(quote, { reply: () => new Promise(() => undefined) }),
      'onSettled error',
      'never',
    ],
  ]

  // Waiting for dropped calls ends with the drain's time, so the hooks run with their reserve, and close() after them
  it.each(tails)("runs the onShutdown hooks at the drain's end, and close() after them, for a dropped call with %s", async (_name, observers, tail, told, when) => {
    const module = moduleOf({ observers })
    await readying(module)
    const quote = slash('quote', 500)
    tail(quote)
    const since = performance.now()
    void module.dispatch(quote)
    await closeAt(module, since)
    const closed = performance.now() - since
    const logged = warned.length

    // The drain's end, its lines, then the hooks, and close() within shutdownTimeout
    expect(warned.slice(1)).toEqual([
      `Calls dropped at the stop still had an answer to Discord or an observer under way after ${DRAIN} ms; running the onShutdown hooks in the ${TIMEOUT - DRAIN} ms left.`,
    ])
    expect(warnedAtShutdown).toBe(warned.length)
    expect(closed - CLOSE_AT).toBeLessThan(TIMEOUT)
    const toldBy = (event: string) => event.startsWith(told)
    if (when === 'by the drain') expect(events.findIndex(toldBy)).toBeLessThan(events.indexOf('Ledger.onShutdown'))
    else expect(events.filter(toldBy)).toEqual([])
    if (when === 'after') starts.resolve()
    // Once the close has resolved, only what was under way settles: the observers told once at most, the hooks not again, nothing logged
    await sleep(1_100)
    expect(events.filter(toldBy)).toHaveLength(when === 'never' ? 0 : 1)
    expect(events.filter(event => event === 'Ledger.onShutdown')).toHaveLength(1)
    expect(warned).toHaveLength(logged)
  })

  it("runs the onShutdown hooks at the drain's end when a call that ran has an observer that never finishes", async () => {
    settleTakes = 'never'
    running.resolve()
    const module = moduleOf({ observers: [Slow] })
    await readying(module)
    const since = performance.now()
    // Early comes before Cache, so its handler runs at once and ends; only its observer goes on
    void module.emit('guildDelete', createMockGuild())
    await closeAt(module, since)

    // The drain's end, then the hooks with no line of their own, and close() within shutdownTimeout
    expect(warned.slice(1)).toEqual([])
    expect(warnedAtShutdown).toBe(1)
    expect(performance.now() - since - CLOSE_AT).toBeLessThan(TIMEOUT)
  })

  // A dropped call is not running, whether its observers are done with it at once or never
  it.each([
    ['hear of it at once', [Watch]],
    ['never finish with it', [NeverForDropped]],
  ])("ends a drain that waited only on a dropped call whose observers %s: the store's operations settle first, nothing is still running", async (_name, observers) => {
    const module = moduleOf({ cooldownStore: LateStore, services: [Early], controllers: [Limited, Gatekeeper], observers })
    await readying(module)
    const since = performance.now()
    void module.dispatch(slash('limited'))
    void module.dispatch(slash('gated', 500))
    try {
      await closeAt(module, since)

      expect(events).toContain('limited runs')
      expect(events.slice(-2)).toEqual(['store operation settles', 'store.onShutdown'])
      expect(warned.filter(line => line.startsWith('Calls still running'))).toEqual([])
    } finally {
      // The operation /limited left behind settles here too when the row fails, rather than in the next row
      await sleep(LATE_STORE_MS)
    }
  })

  // A call still running when the drain ends may never let its store operations settle, so the hooks don't wait on them
  it("runs the onShutdown hooks, the store's included, without waiting on a store operation a call still running at the drain's end left pending", async () => {
    const module = moduleOf({ cooldownStore: HangingStore, services: [Early], controllers: [Stuck, Gatekeeper] })
    await readying(module)
    const since = performance.now()
    void module.dispatch(slash('stuck'))
    try {
      await closeAt(module, since)

      expect(events).toContain('stuck runs')
      expect(events.filter(event => event.endsWith('.onShutdown'))).toEqual(['store.onShutdown'])
      expect(warned.filter(line => line.startsWith('Calls still running'))).toHaveLength(1)
      expect(warned.filter(line => line.startsWith('onShutdown hooks did not finish'))).toEqual([])
    } finally {
      hang.resolve()
      await sleep(20)
    }
  })

  it('runs a call the gate releases during the drain, before the onShutdown hooks', async () => {
    const module = moduleOf()
    await readying(module)
    const since = performance.now()
    const handled = module.emit('guildCreate', createMockGuild())
    after(150, () => warm.resolve())
    await closeAt(module, since)

    expect(await handled).toEqual({ ran: 1 })
    expect(events.slice(0, 5)).toEqual(['Cache.onReady', 'onStart', 'Cache ready', 'greet runs', 'Cache.onShutdown'])
  })

  it.each(CALLBACK_ORDERS.map(order => [order, order !== 'in a later turn'] as const))(
    "decides a hook settling at the close by the drain-end timer's turn: %s, runs %s",
    async (order, runs) => {
      const module = moduleOf()
      await readying(module)
      atDrainEnd(order, () => warm.resolve())
      const since = performance.now()
      const handled = module.emit('guildCreate', createMockGuild())
      await closeAt(module, since)
      await sleep(50)

      expect(await handled).toEqual({ ran: runs ? 1 : 0 })
      expect(events.includes('greet runs')).toBe(runs)
      // A call let through runs before the onShutdown hooks; one dropped starts nothing after them
      expect(events.indexOf('greet runs')).toBeLessThan(runs ? events.indexOf('Ledger.onShutdown') : 0)
    },
  )

  it.each(CALLBACK_ORDERS.filter(order => order !== 'in the callback, after it'))(
    "runs a call whose bound is due at the close, its own timer run by the drain-end timer's: %s",
    async order => {
      const module = moduleOf()
      await readying(module)
      let bound: (() => void) | undefined
      // The bound's own timer runs only where this row places it
      interceptFrameworkTimer(
        file => file === 'core/ready-gate.ts',
        run => ((bound = run), () => undefined),
      )
      atDrainEnd(order, () => bound?.())
      const quote = slash('quote', CLOSE_AT + DRAIN - 5)
      const since = performance.now()
      const handled = module.dispatch(quote)
      await closeAt(module, since)

      expect(bound).toBeDefined()
      expect(await handled).toMatchObject({ ran: true })
      expect(events).toContain('quote runs')
    },
  )

  it('settles a handler that throws an error with the stop message as any other error', async () => {
    const module = moduleOf()
    warm.resolve()
    await module.init({ ready: true })

    await expect(module.dispatch(slash('lookalike'))).rejects.toThrow(STOP_MESSAGE)
    // The filters and the fallback answer it
    expect(events).toEqual(['Cache.onReady', 'Cache ready', 'onStart', `onSettled error handled=true response=replied ${STOP_MESSAGE}`])
  })
})

describe('how long the stop waits for dropped calls\' deferred replies to be deleted', () => {
  it.each([
    // The default shutdownTimeout: the hooks keep 1.5 s of their 2.5 s reserve
    [10_000, 2_500, 1_000],
    [8_000, 2_000, 1_000],
    [4_000, 1_000, 500],
    [TIMEOUT, 200, 100],
  ])('gives %i ms of shutdownTimeout a %i ms reserve, and the deletions %i ms of it', (timeoutMs, reserve, grace) => {
    expect(hooksReserveMs(timeoutMs)).toBe(reserve)
    expect(droppedReplyDeleteMs(timeoutMs)).toBe(grace)
  })
})

describe.each([
  ['default mode', false],
  ['strict mode', true],
])("the deferred reply @Defer made for a call the testing module's close drops, in %s", (_mode, strict) => {
  beforeEach(() => {
    forgetStrictMocks()
    if (strict) useStrictMocks()
  })
  afterAll(() => forgetStrictMocks())

  /**
   * Dispatches `interactions` to a module whose Cache is still getting ready, and closes it; resolves with when close()
   * did, and when the hooks began, from the dispatch, once dispatch() has resolved too, unless `settles` is false.
   */
  async function dropped(interactions: object | object[], { observers, settles = true }: { observers?: unknown[]; settles?: boolean } = {}) {
    const module = moduleOf({ observers })
    await readying(module)
    const since = performance.now()
    const handled = [interactions].flat().map(interaction => module.dispatch(interaction as never))
    await closeAt(module, since)
    if (settles) await Promise.all(handled)
  }
  /** Makes `interaction`'s deleteReply take `ms`, or never settle, then reject with `failure` if given. */
  function deletesIn(interaction: ChatInputCommandInteraction, ms: number | 'never', failure?: Error) {
    vi.mocked(interaction.deleteReply).mockImplementation(async () => {
      events.push('deleting')
      if (ms === 'never') await new Promise(() => undefined)
      await sleep(ms as number)
      deletedSeq.push(nextInOrder())
      events.push('deleted')
      if (failure) throw failure
      return undefined as never
    })
  }
  const onReadyLine = 'onReady in Cache is still running after 200 ms; shutting down without waiting for it.'
  /**
   * The close's one deletion deadline, checked as the delay the code asked for from its own clock reads: the grace
   * past the drain's end, or past the decision when the drain's timer fired early.
   */
  function deadlineOf() {
    const record = stopRecord(DRAIN)
    expect(record).toBeDefined()
    const { deadlines, drainDeadline, decidedAt, readBefore } = record!
    expect(deadlines).toHaveLength(1)
    const deadline = deadlines[0]!
    const ends = Math.max(drainDeadline, Math.min(decidedAt!, drainDeadline) + DELETE_GRACE)
    expect(deadline.delay).toBeCloseTo(Math.max(0, ends - readBefore(deadline)!.at), 6)
    return { record: record!, deadline }
  }
  /** The figure warning `index` gives: the time the close ran by its last clock read, taken once the wait ended at `endedSeq`. */
  function figureOf(index: number, endedSeq: number) {
    const spent = Number(/after (\d+) ms/.exec(warned[index] ?? '')?.[1])
    const { startedAt, last } = stopRecord(DRAIN)!
    expect(last?.seq).toBeGreaterThan(endedSeq)
    expect(spent).toBe(Math.max(DRAIN, Math.round(last!.at - startedAt)))
    return spent
  }
  const droppedLine = (spent: number) =>
    `Calls dropped at the stop still had an answer to Discord or an observer under way after ${spent} ms; running the onShutdown hooks in the ${TIMEOUT - spent} ms left.`

  it.each([
    ['an eager @Defer on a slash command', 'eager'],
    ['a private eager @Defer', 'privately'],
  ])('deletes the deferred reply of %s before the onShutdown hooks', async (_name, command) => {
    const interaction = slash(command)
    await dropped(interaction)

    expect(sent(interaction)).toEqual(['deferReply', 'deleteReply'])
    expect(events.indexOf(`onSettled error handled=false response=deferred ${STOP_MESSAGE}`)).toBeLessThan(events.indexOf('Ledger.onShutdown'))
    expect(events.filter(event => event.endsWith('runs'))).toEqual([])
    expect(warned).toEqual([onReadyLine])
  })

  it("deletes the deferred reply @Defer({ mode: 'auto' }) made while the call waited", async () => {
    // Created 2.48 s ago, so the timer acknowledges 20 ms in, at the 2.5 s limit, while the gate holds the call
    const interaction = slash('auto', -480)
    await dropped(interaction)

    expect(sent(interaction)).toEqual(['deferReply', 'deleteReply'])
  })

  it("leaves an eager @Defer's deferred update on a component, which shows nothing", async () => {
    const interaction = createMockInteraction(ButtonInteraction, { customId: 'press' })
    await dropped(interaction)
    await sleep(50)

    expect(sent(interaction)).toEqual(['deferUpdate'])
  })

  it("leaves a deferred reply an observer's onStart answer was sent into", async () => {
    const interaction = slash('eager')
    await dropped(interaction, { observers: [AnswersSoon] })
    await sleep(50)

    expect(sent(interaction)).toEqual(['deferReply', 'editReply'])
  })

  // Calls are dropped as the drain's time runs out: the deletions get DELETE_GRACE out of the hooks' reserve
  it('waits past the drain for a deletion that settles within the grace, the hooks right after it', async () => {
    const interaction = slash('eager')
    deletesIn(interaction, DELETE_GRACE / 2)
    await dropped(interaction)
    const { deadline } = deadlineOf()

    expect(events.indexOf('deleted')).toBeGreaterThan(-1)
    expect(events.indexOf('deleted')).toBeLessThan(events.indexOf('Ledger.onShutdown'))
    // Not the whole grace: the wait ends as the deletion settles, its deadline cleared unfired
    expect(deadline.firedSeq).toBeUndefined()
    expect(warned).toEqual([onReadyLine])
  })

  it('runs the deletions of several dropped calls at once, under one deadline, the hooks after the last', async () => {
    const interactions = [slash('eager'), slash('eager'), slash('privately')]
    for (const interaction of interactions) deletesIn(interaction, DELETE_GRACE / 2)
    await dropped(interactions)
    const { deadline } = deadlineOf()

    expect(interactions.map(sent)).toEqual(Array(3).fill(['deferReply', 'deleteReply']))
    // All under way before any settles: one after another, they would take 1.5 of the grace and be cut
    expect(events.filter(event => event.startsWith('delet'))).toEqual([...Array(3).fill('deleting'), ...Array(3).fill('deleted')])
    expect(events.slice(0, events.indexOf('Ledger.onShutdown')).filter(event => event === 'deleted')).toHaveLength(3)
    expect(deadline.firedSeq).toBeUndefined()
    expect(warned).toEqual([onReadyLine])
  })

  it.each([
    ['never settles', 'never' as const],
    ['outlasts the grace', DELETE_GRACE * 3],
  ])("runs the onShutdown hooks at the grace's end, with half their reserve or more, for a deletion that %s", async (_name, ms) => {
    const interaction = slash('eager')
    deletesIn(interaction, ms)
    await dropped(interaction, { settles: ms !== 'never' })
    const { deadline } = deadlineOf()

    expect(events).toContain('deleting')
    expect(events.slice(0, events.indexOf('Ledger.onShutdown'))).not.toContain('deleted')
    expect(deadline.firedSeq).toBeDefined()
    expect(ledgerSeq).toBeGreaterThan(deadline.firedSeq!)
    // The time the sequence really ran, which the grace took from the reserve
    expect(warned[1]).toBe(droppedLine(figureOf(1, deadline.firedSeq!)))
  })

  it('reports the time a deadline that fired late took, not the time it was due', async () => {
    const interaction = slash('eager')
    deletesIn(interaction, 'never')
    // The deadline's callback runs LATE_MS past its time, as on a loaded runner; the drain's own wait is shorter still
    interceptFrameworkTimer(
      (file, delay) => file === 'core/lifecycle-hooks.ts' && delay >= TIMER_EARLY_MS && delay <= DELETE_GRACE,
      run => () => {
        const until = performance.now() + LATE_MS
        while (performance.now() < until);
        run()
      },
    )
    await dropped(interaction, { settles: false })
    const { deadline } = deadlineOf()

    expect(warned[1]).toBe(droppedLine(figureOf(1, deadline.firedSeq!)))
  })

  // One deadline for the batch: deletions waited for in turn, each with its own grace, would take the hooks' reserve
  it("runs the onShutdown hooks at the one deadline's end for several deletions that never settle", async () => {
    const interactions = [slash('eager'), slash('eager')]
    for (const interaction of interactions) deletesIn(interaction, 'never')
    await dropped(interactions, { settles: false })
    const { deadline } = deadlineOf()

    expect(events.filter(event => event === 'deleting')).toHaveLength(2)
    expect(deadline.firedSeq).toBeDefined()
    expect(ledgerSeq).toBeGreaterThan(deadline.firedSeq!)
  })

  it('reports the time a deletion that settled took from the reserve, when an observer is still under way', async () => {
    const interaction = slash('eager')
    deletesIn(interaction, DELETE_GRACE / 2)
    await dropped(interaction, { observers: [NeverForDropped], settles: false })
    const { deadline } = deadlineOf()

    expect(deadline.firedSeq).toBeUndefined()
    expect(events.indexOf('deleted')).toBeLessThan(events.indexOf('Ledger.onShutdown'))
    expect(warned[1]).toBe(droppedLine(figureOf(1, deletedSeq[0]!)))
  })

  it('closes without delay when the deletions fail, the hooks run, and names the failures in one line', async () => {
    const interactions = [slash('eager'), slash('eager')]
    vi.mocked(interactions[0]!.deleteReply).mockRejectedValue(new DiscordAPIError({ code: 10062, message: 'Unknown interaction' }, 10062, 404, 'DELETE', '/x', {}))
    vi.mocked(interactions[1]!.deleteReply).mockRejectedValue(new Error('socket hang up'))
    await dropped(interactions)

    // Settled by the drain's end: no deadline armed
    expect(stopRecord(DRAIN)?.deadlines).toEqual([])
    expect(events).toContain('Ledger.onShutdown')
    // The module names no dropped call
    expect(warned).toEqual([
      onReadyLine,
      'Deleting the deferred replies of calls dropped at the stop failed: a call (DiscordAPIError[10062]: Unknown interaction), a call (Error: socket hang up).',
    ])
    expect(warnedAtShutdown).toBe(warned.length)
  })

  it('reports on its own a deletion that fails once the hooks have begun', async () => {
    const interaction = slash('eager')
    deletesIn(interaction, DELETE_GRACE * 2, new Error('socket hang up'))
    await dropped(interaction)

    expect(warned.slice(warnedAtShutdown)).toEqual(['Deleting the deferred reply of a call dropped at the stop failed after the hooks began: a call (Error: socket hang up).'])
  })
})

describe('after a testing module closes', () => {
  /** A module whose hooks have settled and that has closed, and a client its calls registered. */
  async function closed() {
    const module = moduleOf({ themeFor: CacheThemes })
    warm.resolve()
    const first = slash('shown')
    await module.dispatch(first)
    await module.init({ ready: true })
    events.length = 0
    await module.close()
    events.length = 0
    warned.length = 0
    return { module, client: first.client }
  }

  it("runs a dispatch through, with the closed-module warning, in the handler's theme, the resolver not asked", async () => {
    const { module } = await closed()
    const shown = slash('shown')
    expect(await module.dispatch(shown)).toMatchObject({ ran: true })

    expect(events).toEqual(['onStart', 'shown runs', 'onSettled ran handled=false response=replied undefined'])
    expect(colours(shown)).toEqual([HANDLER])
    expect(warned.filter(line => line.startsWith('This testing module is closed'))).toHaveLength(1)
  })

  it("answers a bindTheme function's call in the handler's theme, the resolver not asked", async () => {
    const { client } = await closed()
    const click = createMockInteraction(ButtonInteraction, { customId: 'x', client } as never)
    await bindTheme((interaction: ButtonInteraction) => respond(interaction).send({ embeds: [{ description: 'Picked' }] }))(click)

    expect(colours(click)).toEqual([HANDLER])
    expect(events).toEqual([])
  })
})

describe('a theme lookup the ready gate holds when a testing module closes', () => {
  it.each([
    ['a bindTheme click', (click: ButtonInteraction) => bindTheme((interaction: ButtonInteraction) => respond(interaction).send({ embeds: [{ description: 'Picked' }] }))(click)],
    ['an answer outside any call', (click: ButtonInteraction) => respond(click).send({ embeds: [{ description: 'Outside' }] })],
  ])("answers %s in the handler's theme by the close, the resolver not asked", async (_name, answer) => {
    const module = moduleOf({ themeFor: CacheThemes })
    const first = slash('shown')
    await module.dispatch(first)
    await readying(module)
    events.length = 0
    const click = createMockInteraction(ButtonInteraction, { customId: 'x', client: first.client } as never)
    Object.defineProperty(click, 'createdTimestamp', { value: Date.now() - 1_500, configurable: true })
    const since = performance.now()
    const answered = Promise.resolve(answer(click))
    const { timers } = await closeAt(module, since)

    expect(await settledBy(answered)).not.toBe('still pending')
    expect(colours(click)).toEqual([HANDLER])
    expect(timers).toEqual([])
    warm.resolve()
    await sleep(50)
    expect(events).not.toContain('resolver asked')
  })
})

describe('a call with no server or user theme to look up when a testing module closes', () => {
  // Every lookup wait the gate makes, read here so the close's rejection of one is handled: a call with nothing to look up makes none
  const made: Promise<void>[] = []
  beforeEach(() => {
    made.length = 0
    const lookupReady = ReadyGate.prototype.lookupReady
    vi.spyOn(ReadyGate.prototype, 'lookupReady').mockImplementation(function (this: ReadyGate, ...args) {
      const wait = lookupReady.apply(this, args)
      if (wait) made.push(wait.catch(() => undefined))
      return wait
    })
  })

  it('leaves no wait at the gate for an event from no server or user', async () => {
    const module = moduleOf({ themeFor: CacheThemes, services: [Early, Cache, Alarm] })
    await readying(module)
    const since = performance.now()
    const handled = module.emit('warn', 'gateway slow')
    await closeAt(module, since)
    await sleep(20)

    expect(await settledBy(handled)).toEqual({ ran: 0 })
    expect(made).toEqual([])
  })

  it.each([
    ['a bindTheme click', (click: ButtonInteraction) => bindTheme((interaction: ButtonInteraction) => respond(interaction).send({ embeds: [{ description: 'Picked' }] }))(click)],
    ['an answer outside any call', (click: ButtonInteraction) => respond(click).send({ embeds: [{ description: 'Outside' }] })],
  ])('leaves no wait at the gate for %s in a DM, which a server-only resolver has nothing for', async (_name, answer) => {
    const module = moduleOf({ themeFor: GuildThemes })
    const first = slash('shown')
    await module.dispatch(first)
    await readying(module)
    const click = createMockInteraction(ButtonInteraction, { customId: 'x', client: first.client, guildId: null } as never)
    const since = performance.now()
    await answer(click)
    await closeAt(module, since)
    await sleep(20)

    expect(colours(click)).toEqual([HANDLER])
    expect(made).toEqual([])
  })
})

describe("the slow-warning timer of an onReady a testing module's close gives up on", () => {
  it('is ended by the close', async () => {
    const module = moduleOf({ warnSlow: true })
    await readying(module)
    const since = performance.now()
    const { timers } = await closeAt(module, since)

    expect(timers).toEqual([])
  })

  it('still warns at 10 s while a close waits the hook out', async () => {
    vi.useFakeTimers()
    try {
      const module = moduleOf({ warnSlow: true, shutdownTimeout: 20_000 })
      await readying(module)
      setTimeout(() => warm.resolve(), 11_000)
      const closing = module.close()
      await vi.advanceTimersByTimeAsync(11_000)
      await closing

      expect(warned.filter(line => line.includes('has run for 10.0 s'))).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
