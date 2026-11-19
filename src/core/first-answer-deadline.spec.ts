import { EventEmitter } from 'node:events'
import { AutocompleteInteraction, ChatInputCommandInteraction, type InteractionReplyOptions } from 'discord.js'
import { inject } from 'inversify'
import { vi } from 'vitest'
import { bindTheme, type ExecutionContext, Logger, respond, ThemeCache, useTheme } from '@src/common/index.js'
import { Autocomplete, Command, Controller, Defer, MeoCord, MessageHandler, Observer, Service } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { type DispatchObserver, type OnReady } from '@src/interface/index.js'
import { READY_WAIT_AUTOCOMPLETE_MS, READY_WAIT_INTERACTION_MS } from '@src/core/ready-gate.js'
import { abandonLookups, resolverCaches } from '@src/core/theme-resolvers.js'
import { createMockInteraction, createMockMessage, MeoCordTestingModule } from '@src/testing/index.js'
import { forgetStrictMocks, useStrictMocks } from '@src/testing/strict-mocks.js'

// An interaction Discord has been told nothing of has one first-answer deadline, READY_WAIT_INTERACTION_MS from its
// creation, which bounds its wait for the onReady hooks and for themeFor's lookup together. Times are from creation.

/** Discord's window for a first answer, counted from the interaction's creation. */
const DISCORD_WINDOW_MS = 3000
const GUILD = '100000000000000001'
const ADA = '200000000000000001'
const BEN = '200000000000000002'
const SERVER = '#00000D'
/** MeoCord's default primary colour: the handler's theme in an app with none of its own. */
const HANDLER = '#7680F4'
/** MeoCord's default danger colour, which an error's answer takes. */
const HANDLER_DANGER = '#E3606D'

/** One call the interaction made to Discord: its method, when, and the primary colour of its first embed. */
interface Sent {
  method: string
  at: number
  colour?: string
}

/** What each test sets: how the resolver answers, whether onStart answers, what the handler does after its answer. */
let answer: (asked: number) => unknown
let asked: number
let welcoming: boolean
let afterwards: (() => Promise<void>) | undefined
let warned: string[]
let failed: string[]
/** When the message handler ran, from the message's creation. */
let noted: number[]
/** When the autocomplete handler ran, from the interaction's creation, and the primary colour it read. */
let suggested: [number, string][]
/** What onStart does with the call's interaction, beyond `welcoming`. */
let early: ((interaction: ChatInputCommandInteraction) => void) | undefined

let settleHook: () => void = () => undefined
@Service()
class Prefs implements OnReady {
  onReady() {
    const done = Promise.withResolvers<void>()
    settleHook = done.resolve
    return done.promise
  }
}

/** The server theme comes from Prefs, so a lookup under waitForReady waits for its hook. */
@Service()
class PrefsThemes {
  constructor(@inject(Prefs) readonly prefs: Prefs) {}
  guild() {
    return answer(++asked)
  }
}

@Observer()
class Welcome implements DispatchObserver {
  onStart(context: ExecutionContext) {
    const interaction = context.getInteraction() as ChatInputCommandInteraction
    if (welcoming) void respond(interaction).send(embed('welcome')).catch(() => undefined)
    early?.(interaction)
  }
  onSettled() {}
}

const embed = (description: string) => ({ embeds: [{ description }] })

@Controller()
class Calls {
  @Command('plain', CommandType.SLASH)
  async plain(interaction: ChatInputCommandInteraction) {
    await respond(interaction).send(embed('pong'))
    if (afterwards) {
      await afterwards()
      await respond(interaction).send(embed('later'))
    }
  }

  @Defer()
  @Command('eager', CommandType.SLASH)
  async eager(interaction: ChatInputCommandInteraction) {
    await respond(interaction).send(embed('pong'))
  }

  @Defer({ mode: 'auto' })
  @Command('auto', CommandType.SLASH)
  async auto(interaction: ChatInputCommandInteraction) {
    await respond(interaction).send(embed('pong'))
  }

  @Command('collect', CommandType.SLASH)
  async collect(interaction: ChatInputCommandInteraction) {
    await respond(interaction).send(embed('collecting'))
    collector.on('click', bindTheme((click: ChatInputCommandInteraction) => void respond(click).send(embed('picked')).catch(() => undefined)))
  }

  @Defer({ mode: 'auto', after: 2800 })
  @Command('patient', CommandType.SLASH)
  async patient(interaction: ChatInputCommandInteraction) {
    await respond(interaction).send(embed('pong'))
  }

  @Autocomplete('pick')
  suggest(interaction: AutocompleteInteraction) {
    suggested.push([Date.now() - interaction.createdTimestamp, String(useTheme().colors.primary)])
    return interaction.respond([])
  }

  @MessageHandler('note', { prefix: false })
  note(message: { createdTimestamp: number }) {
    noted.push(Date.now() - message.createdTimestamp)
  }
}

/** Stands in for a collector: the `collect` handler binds its listener to it. */
let collector: EventEmitter

/** Resolves at `ms` from `created`. */
const at = (created: number, ms: number) => new Promise<void>(resolve => setTimeout(resolve, Math.max(0, created + ms - Date.now())))

function compile({
  waitForReady = true,
  hook = true,
  byUser = false,
  ...options
}: { waitForReady?: boolean; hook?: boolean; byUser?: boolean; themeForTimeoutMs?: number } = {}) {
  @MeoCord({
    controllers: [Calls],
    services: hook ? [Prefs] : [],
    observers: [Welcome],
    clientOptions: { intents: [] },
    themeFor: hook ? PrefsThemes : { [byUser ? 'user' : 'guild']: () => answer(++asked) },
    waitForReady,
    ...options,
  } as never)
  class App {}
  return MeoCordTestingModule.fromApp(App).compile()
}

/**
 * A slash command created `age` ms ago, whose calls to Discord are recorded with their time and colour; `prepare` sets
 * its mocks' behaviour first.
 */
function slash(
  commandName: string,
  { age = 0, user = ADA, client, prepare }: { age?: number; user?: string; client?: object; prepare?: (interaction: ChatInputCommandInteraction) => void } = {},
) {
  const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName, guildId: GUILD, ...(client && { client }) } as never)
  Object.defineProperty(interaction, 'createdTimestamp', { value: Date.now() - age, configurable: true })
  Object.assign(interaction.user, { id: user })
  prepare?.(interaction)
  const sent: Sent[] = []
  for (const method of ['reply', 'deferReply', 'editReply', 'followUp'] as const) {
    const call = interaction[method] as (...args: unknown[]) => unknown
    Object.assign(interaction, {
      [method]: (...args: unknown[]) => {
        const colour = (args[0] as InteractionReplyOptions | undefined)?.embeds?.[0] as { color?: number; data?: { color?: number } } | undefined
        const value = colour?.data?.color ?? colour?.color
        sent.push({ method, at: Date.now() - interaction.createdTimestamp, ...(value !== undefined && { colour: hex(value) }) })
        return call(...args)
      },
    })
  }
  return { interaction, sent, created: interaction.createdTimestamp }
}

const hex = (value: number) => `#${value.toString(16).padStart(6, '0').toUpperCase()}`
const never = () => new Promise(() => undefined)
const themed = { colors: { primary: SERVER } }

beforeEach(() => {
  asked = 0
  welcoming = false
  afterwards = undefined
  answer = never
  warned = []
  failed = []
  noted = []
  suggested = []
  early = undefined
  collector = new EventEmitter()
  vi.spyOn(Logger.prototype, 'warn').mockImplementation((text: unknown) => void warned.push(String(text)))
  vi.spyOn(Logger.prototype, 'error').mockImplementation((text: unknown) => void failed.push(String(text)))
  vi.useFakeTimers()
})
afterEach(() => {
  // Every row's calls have ended by now, so nothing of theirs, a first-answer deadline included, is left armed
  expect(vi.getTimerCount()).toBe(0)
  settleHook()
  forgetStrictMocks()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** Runs `interaction` through `module` for `ms` of fake time, with the app's hooks begun and still running. */
async function run(module: ReturnType<typeof compile>, interaction: object, ms = 8000) {
  const handled = module.dispatch(interaction as never).catch(() => undefined)
  await vi.advanceTimersByTimeAsync(ms)
  return handled
}

async function started(options?: Parameters<typeof compile>[0]) {
  const module = compile(options)
  void module.init({ ready: true }).catch(() => undefined)
  await vi.advanceTimersByTimeAsync(0)
  return module
}

describe('the first answer of an interaction Discord has been told nothing of', () => {
  it.each([
    ['the default themeForTimeoutMs', {}],
    ['a themeForTimeoutMs of 5 s', { themeForTimeoutMs: 5000 }],
  ] as const)("goes out at the deadline in the handler's theme, with a hook that doesn't settle and a resolver that doesn't answer, with %s", async (_how, options) => {
    const module = await started(options)
    const { interaction, sent } = slash('plain')
    await run(module, interaction)

    expect(sent).toEqual([{ method: 'reply', at: READY_WAIT_INTERACTION_MS, colour: HANDLER }])
    expect(sent[0].at).toBeLessThan(DISCORD_WINDOW_MS)
  })

  it("goes out at the deadline from onStart, and the handler's answer edits it in the same theme", async () => {
    welcoming = true
    const module = await started()
    const { interaction, sent } = slash('plain')
    await run(module, interaction)

    expect(sent).toEqual([
      { method: 'reply', at: READY_WAIT_INTERACTION_MS, colour: HANDLER },
      { method: 'editReply', at: READY_WAIT_INTERACTION_MS, colour: HANDLER },
    ])
  })

  it.each([500, 1500])("waits until the deadline for a resolver that doesn't answer once the hook settles at %i ms", async settledAt => {
    const module = await started({ themeForTimeoutMs: 5000 })
    const { interaction, sent, created } = slash('plain')
    void at(created, settledAt).then(() => settleHook())
    await run(module, interaction)

    expect(sent).toEqual([{ method: 'reply', at: READY_WAIT_INTERACTION_MS, colour: HANDLER }])
    expect(asked).toBe(1)
  })

  it('is themed when the resolver answers within the rest of the 2 s once the hook settles', async () => {
    const module = await started()
    const { interaction, sent, created } = slash('plain')
    answer = () => at(created, 1500).then(() => themed)
    void at(created, 500).then(() => settleHook())
    await run(module, interaction)

    expect(sent).toEqual([{ method: 'reply', at: 1500, colour: SERVER }])
  })

  it.each([
    [1999, SERVER],
    [2000, HANDLER],
    [2001, HANDLER],
  ] as const)('reads the clock at a tie: a resolver answering at %i ms gives %s, its timer set before the call', async (answersAt, colour) => {
    const module = await started({ waitForReady: false, hook: false, themeForTimeoutMs: 5000 })
    const { interaction, sent, created } = slash('plain')
    // Set before the call's own timers, so it fires first when they meet
    const landed = at(created, answersAt).then(() => themed)
    answer = () => landed
    await run(module, interaction)

    expect(sent[0]).toEqual({ method: 'reply', at: Math.min(answersAt, READY_WAIT_INTERACTION_MS), colour })
  })

  it.each([
    [1999, SERVER],
    [2000, HANDLER],
    [2001, HANDLER],
  ] as const)('reads the clock at a tie: a resolver answering at %i ms gives %s, its timer set once it is asked', async (answersAt, colour) => {
    const module = await started({ waitForReady: false, hook: false, themeForTimeoutMs: 5000 })
    const { interaction, sent, created } = slash('plain')
    answer = () => at(created, answersAt).then(() => themed)
    await run(module, interaction)

    expect(sent[0]).toEqual({ method: 'reply', at: Math.min(answersAt, READY_WAIT_INTERACTION_MS), colour })
  })

  it("keeps the handler's theme to the call's end once cut, and the next call reads the theme the lookup found", async () => {
    const module = await started({ waitForReady: false, hook: false, themeForTimeoutMs: 5000 })
    const { interaction, sent, created } = slash('plain')
    answer = () => at(created, 2500).then(() => themed)
    afterwards = () => at(created, 2600)
    await run(module, interaction)

    expect(sent).toEqual([
      { method: 'reply', at: 2000, colour: HANDLER },
      { method: 'editReply', at: 2600, colour: HANDLER },
    ])
    afterwards = undefined
    const next = slash('plain')
    await run(module, next.interaction)
    expect(next.sent).toEqual([{ method: 'reply', at: 0, colour: SERVER }])
    expect(asked).toBe(1)
    expect(failed).toEqual([])
  })

  it('goes out at the deadline without waitForReady, with a themeForTimeoutMs of 5 s, and the lookup fills the cache', async () => {
    const module = await started({ waitForReady: false, hook: false, themeForTimeoutMs: 5000 })
    const { interaction, sent, created } = slash('plain')
    answer = () => at(created, 4000).then(() => themed)
    await run(module, interaction)

    expect(sent).toEqual([{ method: 'reply', at: 2000, colour: HANDLER }])
    const next = slash('plain')
    await run(module, next.interaction)
    expect(next.sent).toEqual([{ method: 'reply', at: 0, colour: SERVER }])
    expect(asked).toBe(1)
  })
})

describe('the deadline of two interactions sharing one lookup', () => {
  it("cuts each at its own deadline: the first in its handler's theme, the second themed once the lookup lands", async () => {
    const module = await started({ waitForReady: false, hook: false, themeForTimeoutMs: 5000 })
    const first = slash('plain')
    answer = () => at(first.created, 2200).then(() => themed)
    const handled = module.dispatch(first.interaction).catch(() => undefined)
    await vi.advanceTimersByTimeAsync(500)
    const second = slash('plain')
    await run(module, second.interaction)
    await handled

    expect(first.sent).toEqual([{ method: 'reply', at: 2000, colour: HANDLER }])
    expect(second.sent).toEqual([{ method: 'reply', at: 1700, colour: SERVER }])
    expect(asked).toBe(1)
    expect(failed).toEqual([])
    expect(warned).toHaveLength(1)
  })

  it('counts a lookup that times out between the two deadlines as one failure, which only the second sees', async () => {
    const module = await started({ waitForReady: false, hook: false, themeForTimeoutMs: 2200 })
    const first = slash('plain')
    const handled = module.dispatch(first.interaction).catch(() => undefined)
    await vi.advanceTimersByTimeAsync(500)
    const second = slash('plain')
    await run(module, second.interaction)
    await handled

    expect(first.sent).toEqual([{ method: 'reply', at: 2000, colour: HANDLER }])
    expect(second.sent).toEqual([{ method: 'reply', at: 1700, colour: HANDLER }])
    expect(asked).toBe(1)
    expect(failed).toEqual([expect.stringContaining('did not answer within 2200 ms')])
  })

  it("counts a later interaction's deadline from its own creation, after the first's has passed", async () => {
    const module = await started({ waitForReady: false, hook: false, themeForTimeoutMs: 5000 })
    const first = slash('plain')
    answer = () => at(first.created, 3000).then(() => themed)
    const handled = module.dispatch(first.interaction).catch(() => undefined)
    await vi.advanceTimersByTimeAsync(2100)
    const second = slash('plain')
    await run(module, second.interaction)
    await handled

    expect(first.sent).toEqual([{ method: 'reply', at: 2000, colour: HANDLER }])
    expect(second.sent).toEqual([{ method: 'reply', at: 900, colour: SERVER }])
  })
})

describe('the deadline while Discord is being told', () => {
  it('leaves an eager @Defer as it was: acknowledged at once, and its answer themed once the lookup lands', async () => {
    const module = await started({ waitForReady: false, hook: false, themeForTimeoutMs: 5000 })
    const { interaction, sent, created } = slash('eager')
    answer = () => at(created, 2600).then(() => themed)
    await run(module, interaction)

    expect(sent).toEqual([
      { method: 'deferReply', at: 0 },
      { method: 'editReply', at: 2600, colour: SERVER },
    ])
  })

  it("leaves @Defer({ mode: 'auto' }) as it was: acknowledged at its timer, and its answer themed once the lookup lands", async () => {
    const module = await started({ waitForReady: false, hook: false, themeForTimeoutMs: 5000 })
    const { interaction, sent, created } = slash('auto')
    answer = () => at(created, 2600).then(() => themed)
    await run(module, interaction)

    expect(sent).toEqual([
      { method: 'deferReply', at: 1500 },
      { method: 'editReply', at: 2600, colour: SERVER },
    ])
  })

  it.each([
    ['received at once, failing at its 1.5 s timer', 0, 1500, 2000],
    ['received 1 s late, failing at its timer at 2.5 s', 1000, 2500, 2500],
  ] as const)("cuts @Defer({ mode: 'auto' }) %s, at whichever is later of the deadline and the failure", async (_how, age, failsAt, firstAnswerAt) => {
    useStrictMocks()
    const module = await started({ waitForReady: false, hook: false, themeForTimeoutMs: 5000 })
    const { interaction, sent } = slash('auto', { age, prepare: made => vi.mocked(made.deferReply).mockRejectedValueOnce(new Error('acknowledgement failed')) })
    await run(module, interaction)

    expect(sent).toEqual([
      { method: 'deferReply', at: failsAt },
      { method: 'reply', at: firstAnswerAt, colour: HANDLER },
    ])
    expect(sent[1].at).toBeLessThan(DISCORD_WINDOW_MS)
  })

  it.each([
    ['goes through', 'ok', [{ method: 'editReply', at: 2600, colour: SERVER }]],
    // The failed acknowledgement is the call's error, whose answer is the first one
    ['fails', 'fails', [{ method: 'reply', at: 2200, colour: HANDLER_DANGER }]],
  ] as const)("doesn't cut while an eager @Defer's acknowledgement is on its way at the deadline, and when it %s at 2.2 s", async (_how, outcome, after) => {
    useStrictMocks()
    const module = await started({ waitForReady: false, hook: false, themeForTimeoutMs: 5000 })
    const { interaction, sent, created } = slash('eager', {
      prepare: made =>
        vi.mocked(made.deferReply).mockImplementationOnce(() =>
          at(made.createdTimestamp, 2200).then(() => (outcome === 'ok' ? (undefined as never) : Promise.reject(new Error('acknowledgement failed')))),
        ),
    })
    answer = () => at(created, 2600).then(() => themed)
    await run(module, interaction)

    expect(sent).toEqual([{ method: 'deferReply', at: 0 }, ...after])
  })
})

describe('the deadline of a call that has none', () => {
  it("lets a message wait for the resolver's whole themeForTimeoutMs", async () => {
    const module = await started({ waitForReady: false, hook: false, themeForTimeoutMs: 2500 })
    await run(module, createMockMessage({ content: 'note', guildId: GUILD } as never))

    expect(noted).toEqual([2500])
  })
})

describe('the deadline of an answer made outside the call', () => {
  it("cuts an answer outside any call at its own interaction's deadline", async () => {
    const module = await started({ waitForReady: false, hook: false, byUser: true, themeForTimeoutMs: 5000 })
    answer = () => themed
    const first = slash('plain')
    await run(module, first.interaction, 0)
    answer = never
    const other = slash('plain', { user: BEN, client: first.interaction.client })
    void respond(other.interaction).send(embed('outside')).catch(() => undefined)
    await vi.advanceTimersByTimeAsync(8000)

    expect(other.sent).toEqual([{ method: 'reply', at: 2000, colour: HANDLER }])
  })

  it("cuts a click on a function bindTheme wraps at the click's own deadline, 14 minutes after the call", async () => {
    const module = await started({ waitForReady: false, hook: false, byUser: true, themeForTimeoutMs: 5000 })
    answer = () => themed
    await run(module, slash('collect').interaction, 14 * 60_000)
    answer = never
    const click = slash('plain', { user: BEN })
    collector.emit('click', click.interaction)
    await vi.advanceTimersByTimeAsync(8000)

    expect(click.sent).toEqual([{ method: 'reply', at: 2000, colour: HANDLER }])
  })
})

describe('the deadline of an interaction received late', () => {
  it.each([
    ['looked up', false, HANDLER],
    ['cached', true, SERVER],
  ] as const)('answers at once one received past its deadline, with its theme %s', async (_how, cached, colour) => {
    const module = await started({ waitForReady: false, hook: false, themeForTimeoutMs: 5000 })
    if (cached) {
      answer = () => themed
      await run(module, slash('plain').interaction, 0)
    }
    const { interaction, sent, created } = slash('plain', { age: 2100 })
    answer = () => at(created, 2500).then(() => themed)
    await run(module, interaction)

    expect(sent).toEqual([{ method: 'reply', at: 2100, colour }])
    const next = slash('plain')
    await run(module, next.interaction)
    expect(next.sent).toEqual([{ method: 'reply', at: 0, colour: SERVER }])
  })

  it('counts the deadline from when the call came for one created ahead of the host clock', async () => {
    const module = await started({ waitForReady: false, hook: false, themeForTimeoutMs: 5000 })
    const { interaction, sent } = slash('plain', { age: -5000 })
    await run(module, interaction)

    expect(sent).toEqual([{ method: 'reply', at: 2000 - 5000, colour: HANDLER }])
  })
})

describe('the warning of a call cut at its deadline', () => {
  it('is one, the hook\'s, for a call whose hook and theme are both late', async () => {
    const module = await started()
    await run(module, slash('plain').interaction)

    expect(warned).toEqual([expect.stringContaining('before onReady in Prefs had settled')])
  })

  it('names the call and the server for a call whose theme alone is late', async () => {
    const module = await started({ waitForReady: false, hook: false, themeForTimeoutMs: 5000 })
    await run(module, slash('plain').interaction)

    expect(warned).toHaveLength(1)
    expect(warned[0]).toContain('Calls.plain')
    expect(warned[0]).toContain(GUILD)
    expect(failed).toEqual([expect.stringContaining('did not answer within 5000 ms')])
  })

  it('is one for three calls waiting on one lookup', async () => {
    const module = await started({ waitForReady: false, hook: false, themeForTimeoutMs: 5000 })
    const handled = [0, 1, 2].map(() => module.dispatch(slash('plain').interaction).catch(() => undefined))
    await vi.advanceTimersByTimeAsync(8000)
    await Promise.all(handled)

    expect(warned).toHaveLength(1)
  })

  it('is none for a theme found in time', async () => {
    const module = await started({ waitForReady: false, hook: false, themeForTimeoutMs: 5000 })
    const { interaction, created } = slash('plain')
    answer = () => at(created, 1500).then(() => themed)
    await run(module, interaction)

    expect(warned).toEqual([])
  })
})

describe("the deadline's timer", () => {
  it.each([
    ['the theme is found in time', 1500],
    ['the call is cut', 2500],
  ] as const)('is gone once %s', async (_how, answersAt) => {
    const module = await started({ waitForReady: false, hook: false, themeForTimeoutMs: 5000 })
    const { interaction, created } = slash('plain')
    answer = () => at(created, answersAt).then(() => themed)
    await run(module, interaction, answersAt)

    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('the deadline of an autocomplete', () => {
  it.each([
    ["a resolver that doesn't answer, with waitForReady", { themeForTimeoutMs: 5000 }],
    ["a resolver that doesn't answer, without waitForReady", { waitForReady: false, hook: false, themeForTimeoutMs: 5000 }],
    ['the default themeForTimeoutMs, with waitForReady', {}],
  ] as const)('suggests at its own 1 s bound, with %s', async (_how, options) => {
    const module = await started(options)
    await run(module, createMockInteraction(AutocompleteInteraction, { commandName: 'pick', guildId: GUILD } as never))

    expect(suggested).toEqual([[READY_WAIT_AUTOCOMPLETE_MS, HANDLER]])
  })

  it('leaves the lookup to fill the cache for the next call', async () => {
    const module = await started({ waitForReady: false, hook: false, themeForTimeoutMs: 5000 })
    const pick = createMockInteraction(AutocompleteInteraction, { commandName: 'pick', guildId: GUILD } as never)
    answer = () => at(pick.createdTimestamp, 1500).then(() => themed)
    await run(module, pick)
    await run(module, createMockInteraction(AutocompleteInteraction, { commandName: 'pick', guildId: GUILD } as never))

    expect(suggested).toEqual([
      [READY_WAIT_AUTOCOMPLETE_MS, HANDLER],
      [0, SERVER],
    ])
  })
})

describe('the deadline against the host clock', () => {
  it.each([
    ['jumps back an hour', -3_600_000],
    ['jumps forward an hour', 3_600_000],
  ] as const)('ends 2 s after the call came when the clock %s during the wait', async (_how, jump) => {
    const module = await started({ waitForReady: false, hook: false, themeForTimeoutMs: 5000 })
    const { interaction, created } = slash('plain')
    const times: number[] = []
    const reply = interaction.reply as (...args: unknown[]) => unknown
    Object.assign(interaction, { reply: (...args: unknown[]) => (times.push(performance.now()), reply(...args)) })
    const start = performance.now()
    answer = () => at(created, 2500).then(() => themed)
    const handled = module.dispatch(interaction).catch(() => undefined)
    await vi.advanceTimersByTimeAsync(500)
    vi.setSystemTime(Date.now() + jump)
    await vi.advanceTimersByTimeAsync(8000)
    await handled

    expect(times.map(time => time - start)).toEqual([READY_WAIT_INTERACTION_MS])
  })

  it('counts from when the call came for an interaction with no creation time', async () => {
    const module = await started({ waitForReady: false, hook: false, themeForTimeoutMs: 5000 })
    const { interaction } = slash('plain')
    Object.defineProperty(interaction, 'createdTimestamp', { value: Number.NaN, configurable: true })
    const start = Date.now()
    const replied: number[] = []
    const reply = interaction.reply as (...args: unknown[]) => unknown
    Object.assign(interaction, { reply: (...args: unknown[]) => (replied.push(Date.now() - start), reply(...args)) })
    await run(module, interaction)

    expect(replied).toEqual([READY_WAIT_INTERACTION_MS])
  })

  it('answers one received past its deadline without waiting a timer', async () => {
    const module = await started({ waitForReady: false, hook: false, themeForTimeoutMs: 5000 })
    const { interaction, sent } = slash('plain', { age: 2100 })
    const handled = module.dispatch(interaction).catch(() => undefined)
    for (let turn = 0; turn < 100 && sent.length === 0; turn++) await Promise.resolve()

    expect(sent).toEqual([{ method: 'reply', at: 2100, colour: HANDLER }])
    await vi.advanceTimersByTimeAsync(8000)
    await handled
  })
})

describe('the deadline and other ways of telling Discord', () => {
  it("is lifted by a raw deferReply() in onStart once Discord has it, and the answer waits for the theme", async () => {
    useStrictMocks()
    const module = await started({ waitForReady: false, hook: false, themeForTimeoutMs: 5000 })
    const { interaction, sent, created } = slash('plain')
    early = made => void made.deferReply().catch(() => undefined)
    answer = () => at(created, 2600).then(() => themed)
    await run(module, interaction)

    expect(sent).toEqual([
      { method: 'deferReply', at: 0 },
      { method: 'editReply', at: 2600, colour: SERVER },
    ])
  })

  it("cuts @Defer({ mode: 'auto', after: 2800 }), held to 2.5 s from creation, once its acknowledgement fails there", async () => {
    useStrictMocks()
    const module = await started({ waitForReady: false, hook: false, themeForTimeoutMs: 5000 })
    const { interaction, sent } = slash('patient', { prepare: made => vi.mocked(made.deferReply).mockRejectedValueOnce(new Error('acknowledgement failed')) })
    await run(module, interaction)

    expect(sent).toEqual([
      { method: 'deferReply', at: 2500 },
      { method: 'reply', at: 2500, colour: HANDLER },
    ])
  })

  it("warns once when @Defer({ mode: 'auto' }) fails with the hook and the lookup both pending", async () => {
    useStrictMocks()
    const module = await started({ themeForTimeoutMs: 5000 })
    const { interaction, sent } = slash('auto', { prepare: made => vi.mocked(made.deferReply).mockRejectedValueOnce(new Error('acknowledgement failed')) })
    await run(module, interaction)

    expect(sent).toEqual([
      { method: 'deferReply', at: 1500 },
      { method: 'reply', at: 2000, colour: HANDLER },
    ])
    expect(warned).toHaveLength(1)
  })
})

describe('the lines a slow lookup logs', () => {
  it('are one cut and one timeout for three calls on a lookup that is cut, then times out', async () => {
    const module = await started({ waitForReady: false, hook: false, themeForTimeoutMs: 2500 })
    const handled = [0, 1, 2].map(() => module.dispatch(slash('plain').interaction).catch(() => undefined))
    await vi.advanceTimersByTimeAsync(8000)
    await Promise.all(handled)

    expect(warned).toEqual([expect.stringContaining('had not answered 2.0 s after the interaction was created')])
    expect(failed).toEqual([expect.stringContaining('did not answer within 2500 ms')])
  })

  it('serve a later call from the lookup in flight when its result is invalidated while the first is cut', async () => {
    const module = await started({ waitForReady: false, hook: false, themeForTimeoutMs: 5000 })
    const first = slash('plain')
    answer = () => at(first.created, 2400).then(() => themed)
    const handled = module.dispatch(first.interaction).catch(() => undefined)
    await vi.advanceTimersByTimeAsync(500)
    const second = slash('plain')
    const later = module.dispatch(second.interaction).catch(() => undefined)
    await vi.advanceTimersByTimeAsync(1600)
    module.get(ThemeCache).invalidateGuild(GUILD)
    await vi.advanceTimersByTimeAsync(8000)
    await Promise.all([handled, later])

    expect(first.sent).toEqual([{ method: 'reply', at: 2000, colour: HANDLER }])
    expect(second.sent).toEqual([{ method: 'reply', at: 1900, colour: SERVER }])
    const next = slash('plain')
    await run(module, next.interaction)
    expect(asked).toBe(2)
  })
})

describe('the first-answer timers of one interaction', () => {
  /** Tracks the timers `answerDeadline` sets, by the stack that sets them: how many were made, are armed now, and at most. */
  function deadlineTimers() {
    const armed = new Set<unknown>()
    const counts = { made: 0, now: 0, most: 0 }
    const set = globalThis.setTimeout
    const clear = globalThis.clearTimeout
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: () => void, ms?: number) => {
      if (!new Error().stack?.includes('answerDeadline')) return set(callback, ms)
      const timer: unknown = set(() => {
        armed.delete(timer)
        counts.now = armed.size
        callback()
      }, ms)
      armed.add(timer)
      counts.made++
      counts.now = armed.size
      counts.most = Math.max(counts.most, armed.size)
      return timer
    }) as typeof setTimeout)
    vi.spyOn(globalThis, 'clearTimeout').mockImplementation(((timer?: unknown) => {
      armed.delete(timer)
      counts.now = armed.size
      clear(timer as Parameters<typeof clearTimeout>[0])
    }) as typeof clearTimeout)
    return counts
  }

  it.each([
    // The gate's lease ends at its decision, and the lookup's wait then takes a deadline already due
    ['the gate holds the call and its lookup, then the lookup waits on its own past the deadline', { themeForTimeoutMs: 5000 }, 2],
    ['the pipeline and an onStart answer wait for one lookup, without waitForReady', { waitForReady: false, hook: false, themeForTimeoutMs: 5000 }, 1],
  ] as const)('are one at most when %s, and none once the call ends', async (how, options, made) => {
    welcoming = how.includes('onStart')
    const module = await started(options)
    const timers = deadlineTimers()
    const { interaction, sent } = slash('plain')
    await run(module, interaction)

    expect(sent[0]).toEqual({ method: 'reply', at: READY_WAIT_INTERACTION_MS, colour: HANDLER })
    expect(timers).toEqual({ made, now: 0, most: 1 })
  })
})

describe('the deadline across the gate handing a call over to its lookup', () => {
  it.each([
    ['created ahead of the clock, the hook settling at 1.5 s', -5000, 1500],
    ['created ahead of the clock, the hook settling at 2 s', -5000, 2000],
    ['created ahead of the clock, the hook settling at 2.5 s', -5000, 2500],
    ['created ahead of the clock, the hook never settling', -5000, undefined],
    ['with no creation time, the hook settling at 1.5 s', Number.NaN, 1500],
    ['with no creation time, the hook settling at 2 s', Number.NaN, 2000],
    ['with no creation time, the hook settling at 2.5 s', Number.NaN, 2500],
    ['with no creation time, the hook never settling', Number.NaN, undefined],
  ] as const)('counts 2 s from when the call came for one %s', async (_how, age, settledAt) => {
    const module = await started({ themeForTimeoutMs: 5000 })
    const { interaction } = slash('plain')
    Object.defineProperty(interaction, 'createdTimestamp', { value: Number.isNaN(age) ? Number.NaN : Date.now() - age, configurable: true })
    const start = Date.now()
    const replied: number[] = []
    const reply = interaction.reply as (...args: unknown[]) => unknown
    Object.assign(interaction, { reply: (...args: unknown[]) => (replied.push(Date.now() - start), reply(...args)) })
    if (settledAt !== undefined) setTimeout(() => settleHook(), settledAt)
    await run(module, interaction)

    expect(replied).toEqual([READY_WAIT_INTERACTION_MS])
  })

  it.each([
    ['back an hour, the hook settling at 1.5 s', -3_600_000, 1500],
    ['back an hour, the hook never settling', -3_600_000, undefined],
    ['forward an hour, the hook settling at 1.5 s', 3_600_000, 1500],
    ['forward an hour, the hook never settling', 3_600_000, undefined],
  ] as const)('ends 2 s after the call came when the clock jumps during the gate wait: %s', async (_how, jump, settledAt) => {
    const module = await started({ themeForTimeoutMs: 5000 })
    const { interaction } = slash('plain')
    const times: number[] = []
    const reply = interaction.reply as (...args: unknown[]) => unknown
    Object.assign(interaction, { reply: (...args: unknown[]) => (times.push(performance.now()), reply(...args)) })
    const start = performance.now()
    if (settledAt !== undefined) setTimeout(() => settleHook(), settledAt)
    const handled = module.dispatch(interaction).catch(() => undefined)
    await vi.advanceTimersByTimeAsync(500)
    vi.setSystemTime(Date.now() + jump)
    await vi.advanceTimersByTimeAsync(8000)
    await handled

    expect(times.map(time => time - start)).toEqual([READY_WAIT_INTERACTION_MS])
  })

  it.each([
    ['the default themeForTimeoutMs', {}],
    ['a themeForTimeoutMs of 5 s', { themeForTimeoutMs: 5000 }],
  ] as const)("cuts @Defer({ mode: 'auto' }) received 0.8 s late under a hook, once its acknowledgement fails at 2.3 s, with %s", async (_how, options) => {
    useStrictMocks()
    const module = await started(options)
    const { interaction, sent } = slash('auto', { age: 800, prepare: made => vi.mocked(made.deferReply).mockRejectedValueOnce(new Error('acknowledgement failed')) })
    await run(module, interaction)

    expect(sent).toEqual([
      { method: 'deferReply', at: 2300 },
      { method: 'reply', at: 2300, colour: HANDLER },
    ])
    expect(warned).toEqual([expect.stringContaining('before onReady in Prefs had settled')])
  })

  it("cuts @Defer({ mode: 'auto' }) created ahead of the clock under a hook at 2 s from when it came, its acknowledgement failing", async () => {
    useStrictMocks()
    const module = await started({ themeForTimeoutMs: 5000 })
    const { interaction, sent } = slash('auto', { age: -5000, prepare: made => vi.mocked(made.deferReply).mockRejectedValueOnce(new Error('acknowledgement failed')) })
    await run(module, interaction)

    // From when the call came, 5 s before its creation time
    expect(sent.map(({ at, ...rest }) => ({ ...rest, at: at + 5000 }))).toEqual([
      { method: 'deferReply', at: 1500 },
      { method: 'reply', at: READY_WAIT_INTERACTION_MS, colour: HANDLER },
    ])
  })
})

describe('the lines two interactions on one lookup log', () => {
  it.each([
    ['settles at 2.1 s', 2100],
    ['never settles', undefined],
  ] as const)("name the lookup for the second when the hook, late for the first, %s", async (_how, settledAt) => {
    const module = await started({ themeForTimeoutMs: 5000 })
    if (settledAt !== undefined) setTimeout(() => settleHook(), settledAt)
    const first = slash('plain')
    const handled = module.dispatch(first.interaction).catch(() => undefined)
    await vi.advanceTimersByTimeAsync(1000)
    const second = slash('plain', { user: BEN })
    await run(module, second.interaction)
    await handled

    expect(first.sent).toEqual([{ method: 'reply', at: 2000, colour: HANDLER }])
    expect(second.sent).toEqual([{ method: 'reply', at: 2000, colour: HANDLER }])
    expect(asked).toBe(1)
    expect(warned).toEqual([expect.stringContaining('before onReady in Prefs had settled'), expect.stringContaining(`themeFor.guild for guild ${GUILD} had not answered`)])
  })

  it.each([
    ['answering, its timer set first', 'first', 'answers'],
    ['answering, its timer set after the deadline', 'after', 'answers'],
    ['rejecting, its timer set first', 'first', 'rejects'],
    ['rejecting, its timer set after the deadline', 'after', 'rejects'],
  ] as const)('name a lookup landing at the deadline once, whichever timer fires first: %s', async (_how, order, outcome) => {
    const module = await started({ waitForReady: false, hook: false, themeForTimeoutMs: 5000 })
    const first = slash('plain')
    const land = () => at(first.created, 2000).then(() => (outcome === 'answers' ? themed : Promise.reject(new Error('themes down'))))
    // Set before the deadline's timer, or a few microtasks after the lookup starts, so after it
    const early = order === 'first' ? land() : undefined
    early?.catch(() => undefined)
    answer = () => early ?? Promise.resolve().then(() => Promise.resolve()).then(land)
    const handled = module.dispatch(first.interaction).catch(() => undefined)
    await vi.advanceTimersByTimeAsync(500)
    const second = slash('plain', { user: BEN })
    await run(module, second.interaction)
    await handled

    expect(first.sent).toEqual([{ method: 'reply', at: 2000, colour: HANDLER }])
    expect(second.sent).toEqual([{ method: 'reply', at: 1500, colour: outcome === 'answers' ? SERVER : HANDLER }])
    expect(warned).toEqual([expect.stringContaining(`themeFor.guild for guild ${GUILD} had not answered`)])
    expect(failed).toEqual(outcome === 'answers' ? [] : [expect.stringContaining('themes down')])
  })

  it.each([
    ['its timeout first, as the lookup starts before the wait', false],
    ['the deadline first', true],
  ] as const)('name a lookup timing out at the deadline once, whichever timer fires first: %s', async (_how, deadlineFirst) => {
    const module = await started({ waitForReady: false, hook: false, themeForTimeoutMs: READY_WAIT_INTERACTION_MS })
    let deferred = 0
    if (deadlineFirst) {
      // The lookup's timeout runs in a 0 ms timer of its own, so it comes after the deadline's at the same moment
      const set = globalThis.setTimeout
      vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: () => void, ms?: number) =>
        /\bwithin[ @(]/.test(new Error().stack ?? '') ? (deferred++, set(() => set(callback, 0), ms)) : set(callback, ms)) as typeof setTimeout)
    }
    const { interaction, sent } = slash('plain')
    await run(module, interaction)

    expect(deferred).toBe(deadlineFirst ? 1 : 0)

    expect(sent).toEqual([{ method: 'reply', at: READY_WAIT_INTERACTION_MS, colour: HANDLER }])
    expect(warned).toEqual([expect.stringContaining(`themeFor.guild for guild ${GUILD} had not answered`)])
    expect(failed).toEqual([expect.stringContaining(`did not answer within ${READY_WAIT_INTERACTION_MS} ms`)])
  })
})

describe('a lookup in flight as the testing module closes', () => {
  /** Closes `module`, then gives every timer left 8 s: what is logged after the close, and how many timers it left. */
  async function closed(module: ReturnType<typeof compile>) {
    const closing = module.close()
    await vi.advanceTimersByTimeAsync(0)
    await closing
    const since = { warned: warned.length, failed: failed.length }
    const armed = vi.getTimerCount()
    await vi.advanceTimersByTimeAsync(8000)
    return { armed, warned: warned.slice(since.warned), failed: failed.slice(since.failed) }
  }

  it.each([
    ['the default themeForTimeoutMs', {}],
    ['a themeForTimeoutMs of 5 s', { themeForTimeoutMs: 5000 }],
  ] as const)('logs nothing after the close for a lookup the gate let through at the deadline and the call was cut from, with %s', async (_how, options) => {
    const module = await started(options)
    setTimeout(() => settleHook(), 2100)
    const { interaction, sent } = slash('plain')
    await run(module, interaction, 2200)
    expect(sent).toEqual([{ method: 'reply', at: 2000, colour: HANDLER }])

    expect(await closed(module)).toEqual({ armed: 0, warned: [], failed: [] })
  })

  it("ends a wait on the lookup in the handler's theme as the module closes", async () => {
    useStrictMocks()
    const module = await started({ waitForReady: false, hook: false, themeForTimeoutMs: 5000 })
    const { interaction, sent } = slash('eager')
    const handled = module.dispatch(interaction).catch(() => undefined)
    await vi.advanceTimersByTimeAsync(500)

    expect(await closed(module)).toEqual({ armed: 0, warned: [], failed: [] })
    await handled
    expect(sent).toEqual([
      { method: 'deferReply', at: 0 },
      { method: 'editReply', at: 500, colour: HANDLER },
    ])
  })

  it("clears an abandoned lookup's timeout at once, and keeps nothing of it nor backs it off", async () => {
    const caches = resolverCaches({ resolvers: { guild: () => (asked++, never()) as never }, timeoutMs: 5000 }, () => {
      throw new Error('no class')
    })!
    void caches.guild!.lookup(GUILD, performance.now())
    expect(vi.getTimerCount()).toBe(1)

    abandonLookups(caches)
    // Cleared as it is abandoned, not once the lookup's promise settles
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(8000)
    expect(failed).toEqual([])
    void caches.guild!.lookup(GUILD, performance.now())
    expect(asked).toBe(2)
    abandonLookups(caches)
  })

  it.each([
    ['has answered', 'answers'],
    ['was rejected by the resolver', 'rejects'],
    ['has timed out', 'never'],
    ['was abandoned', 'abandoned'],
  ] as const)('keeps no lookup to end once it %s', async (_how, outcome) => {
    /** How many lookups `cache` holds to end at a shutdown: the size of its private `live` set. */
    const liveLookups = (cache: object) => (cache as unknown as { live: Set<unknown> }).live.size
    const answer = () =>
      outcome === 'never' || outcome === 'abandoned'
        ? never()
        : at(Date.now(), 100).then(() => (outcome === 'answers' ? themed : Promise.reject(new Error('themes down'))))
    const caches = resolverCaches({ resolvers: { guild: answer as never }, timeoutMs: 1000 }, () => {
      throw new Error('no class')
    })!
    void caches.guild!.lookup(GUILD, performance.now())
    expect(liveLookups(caches.guild!)).toBe(1)

    if (outcome === 'abandoned') abandonLookups(caches)
    await vi.advanceTimersByTimeAsync(1100)
    expect(liveLookups(caches.guild!)).toBe(0)
  })

  it("ends a user's lookup as a server's", async () => {
    const module = await started({ waitForReady: false, hook: false, byUser: true, themeForTimeoutMs: 5000 })
    await run(module, slash('plain').interaction, 2100)
    expect(warned).toEqual([expect.stringContaining(`themeFor.user for user ${ADA} had not answered`)])

    expect(await closed(module)).toEqual({ armed: 0, warned: [], failed: [] })
  })

  it('ends a lookup an invalidation forgot while it was in flight', async () => {
    const module = await started({ waitForReady: false, hook: false, themeForTimeoutMs: 5000 })
    await run(module, slash('plain').interaction, 2100)
    module.get(ThemeCache).invalidateGuild(GUILD)

    expect(await closed(module)).toEqual({ armed: 0, warned: [], failed: [] })
  })

  it('ends it all the same when an onShutdown hook throws', async () => {
    @Service()
    class Failing {
      onShutdown() {
        throw new Error('pool gone')
      }
    }
    const module = await started({ waitForReady: false, hook: false, themeForTimeoutMs: 5000, services: [Failing] } as never)
    module.get(Failing)
    await run(module, slash('plain').interaction, 2100)

    const closing = expect(module.close()).rejects.toThrow('pool gone')
    await vi.advanceTimersByTimeAsync(0)
    await closing
    const since = { warned: warned.length, failed: failed.length }
    const armed = vi.getTimerCount()
    await vi.advanceTimersByTimeAsync(8000)
    expect({ armed, warned: warned.slice(since.warned), failed: failed.slice(since.failed) }).toEqual({ armed: 0, warned: [], failed: [] })
  })

  it.each([
    ['answering', 'answers'],
    ['rejecting', 'rejects'],
  ] as const)('ignores a resolver %s after the close: nothing logged or counted', async (_how, outcome) => {
    const module = await started({ waitForReady: false, hook: false, themeForTimeoutMs: 5000 })
    const first = slash('plain')
    answer = () => at(first.created, 3000).then(() => (outcome === 'answers' ? themed : Promise.reject(new Error('themes down'))))
    await run(module, first.interaction, 2100)

    // The one timer left is the resolver's own, which answers at 3 s
    expect(await closed(module)).toEqual({ armed: 1, warned: [], failed: [] })
    // A closed module asks the resolver nothing more: the next call goes on in its handler's theme at once
    const next = slash('plain')
    await run(module, next.interaction)
    expect(asked).toBe(1)
    expect(next.sent).toEqual([{ method: 'reply', at: 0, colour: HANDLER }])
  })
})
