import { ButtonInteraction, ChatInputCommandInteraction, MessageFlags, resolveColor } from 'discord.js'
import { inject } from 'inversify'
import { vi } from 'vitest'
import { type ExecutionContext, Logger, respond } from '@src/common/index.js'
import { Command, Controller, Defer, Guard, MeoCord, type MeoCordOptions, Observer, Service, UseGuard } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { type DispatchObserver, type GuardInterface, type OnReady } from '@src/interface/index.js'
import { READY_WAIT_INTERACTION_MS } from '@src/core/ready-gate.js'
import { createMockInteraction, createMockMessage, getResponse, MeoCordTestingModule } from '@src/testing/index.js'
import { forgetStrictMocks, useStrictMocks } from '@src/testing/strict-mocks.js'

// An answer an observer's onStart makes runs in the call's scope before the pipeline waits for the call's themes

const GUILD = '100000000000000001'
const SERVER = { colors: { primary: '#00000D', danger: '#00000E' } } as const
/** MeoCord's default primary colour: the theme of an app with none of its own. */
const DEFAULT_PRIMARY = '#7680F4'
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/** What onStart does with the call's interaction, set by each test. */
let early: (interaction: ChatInputCommandInteraction | ButtonInteraction) => void
/** What the app logged as a warning or an error. */
let logged: string[]

@Observer()
class Early implements DispatchObserver {
  onStart(context: ExecutionContext) {
    early(context.getInteraction() as ChatInputCommandInteraction | ButtonInteraction)
  }
  onSettled() {}
}

@Guard()
class Silent implements GuardInterface {
  canActivate() {
    return false
  }
}

@Controller()
class Themed {
  @Command('themed', CommandType.SLASH)
  async themed(interaction: ChatInputCommandInteraction) {
    await respond(interaction).send({ embeds: [{ description: 'from the handler' }] })
  }

  @Command('quiet', CommandType.SLASH)
  quiet() {}

  @Defer()
  @Command('eager', CommandType.SLASH)
  eager() {}

  @Defer({ ephemeral: true })
  @Command('hushed', CommandType.SLASH)
  hushed() {}

  @Defer({ mode: 'auto' })
  @Command('later', CommandType.SLASH)
  later() {}

  @Defer({ mode: 'auto', after: 100 })
  @Command('press', CommandType.BUTTON)
  async press() {
    await sleep(100)
  }

  @Defer({ mode: 'auto' })
  @Command('slowLater', CommandType.SLASH)
  async slowLater() {
    await sleep(2000)
  }

  @Defer({ mode: 'auto', after: 100 })
  @Command('locks', CommandType.BUTTON)
  async locks(interaction: ButtonInteraction) {
    await respond(interaction).lock()
    await sleep(300)
  }

  @Defer({ mode: 'auto' })
  @UseGuard(Silent)
  @Command('denied', CommandType.SLASH)
  denied() {}

  @UseGuard(Silent)
  @Command('deniedPress', CommandType.BUTTON)
  deniedPress() {}
}

function compile(themeFor: MeoCordOptions['themeFor'], extra: object = {}) {
  @MeoCord({ controllers: [Themed], observers: [Early], clientOptions: { intents: [] }, themeFor, ...extra })
  class App {}
  return MeoCordTestingModule.fromApp(App).compile()
}

const slash = (commandName: string, guildId: string | undefined = GUILD) =>
  createMockInteraction(ChatInputCommandInteraction, { commandName, ...(guildId && { guildId }) } as never)

/** A button pressed on a message that has it. */
const button = (customId: string) =>
  createMockInteraction(ButtonInteraction, {
    customId,
    guildId: GUILD,
    message: Object.assign(createMockMessage(), { components: [{ toJSON: () => ({ type: 1, components: [{ type: 2, style: 1, custom_id: customId, label: 'Press' }] }) }] }),
  } as never)

/** Each answer call's method and the colour of its first embed. */
const answers = (interaction: object) =>
  getResponse(interaction as never).calls.map(call => [call.method, (call.payload as { embeds?: { color?: number }[] } | undefined)?.embeds?.[0]?.color])

const sendEarly = (interaction: ChatInputCommandInteraction | ButtonInteraction) => void respond(interaction).send({ embeds: [{ description: 'from onStart' }] })

beforeEach(() => {
  logged = []
  early = sendEarly
  for (const level of ['warn', 'error'] as const) vi.spyOn(Logger.prototype, level).mockImplementation((text: unknown) => void logged.push(String(text)))
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  forgetStrictMocks()
})

describe("an answer an observer's onStart makes", () => {
  it.each([
    ['resolves after 50 ms', async () => (await sleep(50), SERVER)],
    ['resolves at once', async () => SERVER],
    ['returns synchronously', () => SERVER],
  ] as const)("has the server's theme, from a resolver that %s, and goes before the handler's", async (_how, guild) => {
    const interaction = slash('themed')
    await compile({ guild }).dispatch(interaction)

    expect(answers(interaction)).toEqual([
      ['reply', resolveColor(SERVER.colors.primary)],
      ['editReply', resolveColor(SERVER.colors.primary)],
    ])
  })

  it('goes out without waiting when no resolver applies', async () => {
    const order: string[] = []
    early = interaction => {
      void respond(interaction)
        .send('from onStart')
        .then(() => order.push('sent'))
      setTimeout(() => order.push('next task'), 0)
    }
    const interaction = slash('quiet', undefined)
    await compile({ guild: () => SERVER }).dispatch(interaction)
    await sleep(0)

    expect(order).toEqual(['sent', 'next task'])
  })

  it('keeps the order of two answers made without waiting, both themed', async () => {
    early = interaction => {
      void respond(interaction).send({ embeds: [{ description: 'first' }] })
      void respond(interaction).followUp({ embeds: [{ description: 'second' }] })
    }
    const interaction = slash('quiet')
    await compile({ guild: async () => (await sleep(50), SERVER) }).dispatch(interaction)
    await sleep(0)

    expect(answers(interaction)).toEqual([
      ['reply', resolveColor(SERVER.colors.primary)],
      ['followUp', resolveColor(SERVER.colors.primary)],
    ])
  })

  it("presents an error in the server's theme", async () => {
    early = interaction => void respond(interaction).error(new Error('tracer down'))
    const interaction = slash('quiet')
    await compile({ guild: async () => (await sleep(50), SERVER) }).dispatch(interaction)
    await sleep(0)

    expect(answers(interaction)).toEqual([['reply', resolveColor(SERVER.colors.danger)]])
  })

  // Real timers: a fake timer's callback runs outside the scope it was set in, so the draw would read no call's theme
  it("draws a component's loading view at @Defer's timer in the server's theme, from a resolver slower than the timer", async () => {
    early = interaction => void respond(interaction).lock()
    const message = Object.assign(createMockMessage(), { components: [{ toJSON: () => ({ type: 1, components: [{ type: 2, style: 1, custom_id: 'press', label: 'Press' }] }) }] })
    const interaction = createMockInteraction(ButtonInteraction, { customId: 'press', guildId: GUILD, message } as never)
    await compile({ guild: async () => (await sleep(300), SERVER) }).dispatch(interaction)

    const [, loading] = answers(interaction)
    expect(loading).toEqual(['editReply', resolveColor(SERVER.colors.primary)])
  })

  it.each([
    ['public', {}, 0],
    ['private', { flags: MessageFlags.Ephemeral }, MessageFlags.Ephemeral],
  ] as const)(
    "lets an eager @Defer's acknowledgement go first while it waits for a theme slower than 3 s, as private as a %s answer",
    async (_how, privacy, flags) => {
      vi.useFakeTimers()
      early = interaction => void respond(interaction).send({ embeds: [{ description: 'from onStart' }], ...privacy })
      const interaction = slash('eager')
      const handled = compile({ guild: async () => (await sleep(3500), SERVER) }, { themeForTimeoutMs: 5000 }).dispatch(interaction)

      await vi.advanceTimersByTimeAsync(0)
      expect(getResponse(interaction).calls.map(call => [call.method, call.payload])).toEqual([['deferReply', { flags }]])
      await vi.advanceTimersByTimeAsync(3500)
      await handled
      expect(answers(interaction)).toEqual([
        ['deferReply', undefined],
        ['editReply', resolveColor(SERVER.colors.primary)],
      ])
    },
  )

  it("leaves a lock asked for in onStart to @Defer({ mode: 'auto' })'s timer, acknowledging nothing before it", async () => {
    vi.useFakeTimers()
    early = interaction => void respond(interaction).lock()
    const message = Object.assign(createMockMessage(), { components: [{ toJSON: () => ({ type: 1, components: [{ type: 2, style: 1, custom_id: 'press', label: 'Press' }] }) }] })
    const interaction = createMockInteraction(ButtonInteraction, { customId: 'press', message } as never)
    const handled = compile(undefined).dispatch(interaction)

    await vi.advanceTimersByTimeAsync(99)
    expect(answers(interaction)).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    // The timer's acknowledgement and the lock's loading view, then the restore once the handler returns
    expect(answers(interaction).slice(0, 2)).toEqual([
      ['deferUpdate', undefined],
      ['editReply', resolveColor(DEFAULT_PRIMARY)],
    ])
    await vi.advanceTimersByTimeAsync(100)
    await handled
  })

  it("leaves a lock asked for behind an answer waiting for its theme to @Defer({ mode: 'auto' })'s timer, which goes ahead of that answer", async () => {
    vi.useFakeTimers()
    early = interaction => {
      void respond(interaction).send({ embeds: [{ description: 'from onStart' }] })
      void respond(interaction).lock()
    }
    const message = Object.assign(createMockMessage(), { components: [{ toJSON: () => ({ type: 1, components: [{ type: 2, style: 1, custom_id: 'press', label: 'Press' }] }) }] })
    const interaction = createMockInteraction(ButtonInteraction, { customId: 'press', guildId: GUILD, message } as never)
    const handled = compile({ guild: async () => (await sleep(300), SERVER) }).dispatch(interaction)

    await vi.advanceTimersByTimeAsync(99)
    expect(answers(interaction)).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(answers(interaction)).toEqual([['deferUpdate', undefined]])
    await vi.advanceTimersByTimeAsync(400)
    await handled
    expect(answers(interaction)[1]).toEqual(['editReply', resolveColor(SERVER.colors.primary)])
  })

  it('settles acknowledge() once its acknowledgement lands, without waiting for the answer ahead of it to find its theme', async () => {
    vi.useFakeTimers()
    const settled: string[] = []
    early = interaction => {
      void respond(interaction).send({ embeds: [{ description: 'from onStart' }] })
      void respond(interaction)
        .acknowledge()
        .then(() => settled.push(`acknowledged at ${Date.now() - start}`))
    }
    const interaction = slash('quiet')
    const start = Date.now()
    const handled = compile({ guild: async () => (await sleep(300), SERVER) }).dispatch(interaction)
    await vi.advanceTimersByTimeAsync(300)
    await handled

    expect(settled).toEqual(['acknowledged at 0'])
    expect(answers(interaction)).toEqual([
      ['deferReply', undefined],
      ['editReply', resolveColor(SERVER.colors.primary)],
    ])
  })

  it("fails the call once when an eager @Defer's acknowledgement that went first fails, without asking Discord again", async () => {
    vi.useFakeTimers()
    const interaction = slash('eager')
    vi.mocked(interaction.deferReply).mockRejectedValue(new Error('Service unavailable'))
    const failed = compile({ guild: async () => (await sleep(3500), SERVER) }, { themeForTimeoutMs: 5000 })
      .dispatch(interaction)
      .catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(3500)

    expect(await failed).toEqual(new Error('Service unavailable'))
    expect(getResponse(interaction).calls.map(call => [call.method, call.error !== undefined])).toEqual([
      ['deferReply', true],
      ['reply', false],
      ['followUp', false],
    ])
  })

  it.each([
    [
      'throws',
      () => {
        throw new Error('themes down')
      },
    ],
    ['returns a theme that is not one', () => ({ colors: { primary: 'not a colour' } }) as never],
  ] as const)("goes out once in the handler's theme, logging the fault once, for a resolver that %s", async (_how, guild) => {
    const interaction = slash('quiet')
    await compile({ guild }).dispatch(interaction)
    await sleep(0)

    expect(answers(interaction)).toEqual([['reply', resolveColor(DEFAULT_PRIMARY)]])
    expect(logged).toHaveLength(1)
  })
})

// Where the theme is found at once, nothing waits, so the calls are those Discord gets without the acknowledgement rule
describe("an answer an observer's onStart makes with the theme found at once", () => {
  const themes = [
    ['no resolver applies', undefined, DEFAULT_PRIMARY, false],
    ['a resolver answers synchronously', { guild: () => SERVER }, SERVER.colors.primary, false],
    ['the theme is cached', { guild: async () => (await sleep(50), SERVER) }, SERVER.colors.primary, true],
  ] as const

  /** Dispatches `interaction`, after a call that only fills the cache when `warm`, and lets every timer run. */
  async function dispatched(interaction: object, themeFor: MeoCordOptions['themeFor'], warm: boolean) {
    vi.useFakeTimers()
    const module = compile(themeFor)
    if (warm) {
      const warming = early
      early = () => undefined
      const filled = module.dispatch(slash('quiet'))
      await vi.advanceTimersByTimeAsync(100)
      await filled
      early = warming
    }
    const handled = module.dispatch(interaction as never).catch(() => undefined)
    await vi.advanceTimersByTimeAsync(5000)
    await handled
  }

  /** Each call's method, whether it is private, and the colour of its first embed. */
  const calls = (interaction: object) =>
    getResponse(interaction as never).calls.map(call => {
      const payload = call.payload as { flags?: number; embeds?: { color?: number }[] } | undefined
      return [call.method, Boolean((payload?.flags ?? 0) & MessageFlags.Ephemeral), payload?.embeds?.[0]?.color]
    })

  describe.each(themes)('when %s', (_how, themeFor, primary, warm) => {
    const colour = resolveColor(primary)

    it.each([
      ['@Defer()', 'public', 'eager', {}, false],
      ['@Defer({ ephemeral: true })', 'public', 'hushed', {}, false],
      ['@Defer()', 'private', 'eager', { flags: MessageFlags.Ephemeral }, true],
      ['@Defer({ ephemeral: true })', 'private', 'hushed', { flags: MessageFlags.Ephemeral }, true],
    ] as const)('is the first answer alone under an eager %s, as a %s answer', async (_defer, _privacy, commandName, privacy, ephemeral) => {
      early = interaction => void respond(interaction).send({ embeds: [{ description: 'from onStart' }], ...privacy })
      const interaction = slash(commandName)
      await dispatched(interaction, themeFor, warm)

      expect(calls(interaction)).toEqual([['reply', ephemeral, colour]])
    })

    it("goes before @Defer({ mode: 'auto' })'s timer, which then has nothing to acknowledge", async () => {
      const interaction = slash('slowLater')
      await dispatched(interaction, themeFor, warm)

      expect(calls(interaction)).toEqual([['reply', false, colour]])
    })

    it('goes before a lock asked for after it, which the answer leaves nothing to do', async () => {
      early = interaction => {
        void respond(interaction).send({ embeds: [{ description: 'from onStart' }] })
        void respond(interaction).lock()
      }
      const interaction = button('locks')
      await dispatched(interaction, themeFor, warm)

      expect(calls(interaction)).toEqual([['update', false, colour]])
    })

    it("leaves a component's handler that returns before the timer with nothing to acknowledge", async () => {
      const interaction = button('press')
      await dispatched(interaction, themeFor, warm)

      expect(calls(interaction)).toEqual([['update', false, colour]])
    })

    it.each([
      ['a command', () => slash('denied'), 'reply'],
      ['a component', () => button('deniedPress'), 'update'],
    ] as const)('leaves %s a guard denies silently with nothing to acknowledge', async (_what, made, method) => {
      const interaction = made()
      await dispatched(interaction, themeFor, warm)

      expect(calls(interaction)).toEqual([[method, false, colour]])
    })
  })
})

describe("an answer an observer's onStart makes, with waitForReady and a resolver whose hooks run", () => {
  let settle: () => void

  @Service()
  class Prefs implements OnReady {
    onReady() {
      const done = Promise.withResolvers<void>()
      settle = done.resolve
      return done.promise
    }
  }

  @Service()
  class PrefsThemes {
    constructor(@inject(Prefs) readonly prefs: Prefs) {}
    guild() {
      return SERVER
    }
  }

  /** A resolver slower than Discord's 3 s, also waiting for Prefs. */
  @Service()
  class SlowPrefsThemes {
    constructor(@inject(Prefs) readonly prefs: Prefs) {}
    async guild() {
      await sleep(3500)
      return SERVER
    }
  }

  async function started(themeFor: MeoCordOptions['themeFor'] = PrefsThemes, extra: object = {}) {
    vi.useFakeTimers()
    const module = compile(themeFor, { waitForReady: true, ...extra })
    const ready = module.init({ ready: true })
    await vi.advanceTimersByTimeAsync(0)
    return { module, ready }
  }

  it("goes out at the 2 s bound in the server's theme, with the call's one warning", async () => {
    const { module, ready } = await started()
    const interaction = slash('quiet')
    const handled = module.dispatch(interaction)

    await vi.advanceTimersByTimeAsync(READY_WAIT_INTERACTION_MS - 1)
    expect(answers(interaction)).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    await handled
    expect(answers(interaction)).toEqual([['reply', resolveColor(SERVER.colors.primary)]])
    expect(logged).toEqual([
      'Themed.quiet ran before onReady in Prefs had settled, 2.0 s after the interaction was created, as long as an interaction without ' +
        '@Defer waits. Add @Defer to Themed.quiet to have it wait for the hook, or make onReady in Prefs faster.',
    ])

    settle()
    await ready
  })

  it.each([
    ['the default themeForTimeoutMs and a synchronous resolver', PrefsThemes, {}, 0],
    ['a themeForTimeoutMs of 5 s and a resolver taking 3.5 s', SlowPrefsThemes, { themeForTimeoutMs: 5000 }, 3500],
  ] as const)("under an eager @Defer, acknowledges at once and edits the deferral in the server's theme once the hooks settle, with %s", async (_how, themeFor, extra, lookupMs) => {
    const { module, ready } = await started(themeFor, extra)
    const interaction = slash('eager')
    const handled = module.dispatch(interaction)

    await vi.advanceTimersByTimeAsync(0)
    expect(answers(interaction)).toEqual([['deferReply', undefined]])
    await vi.advanceTimersByTimeAsync(2 * READY_WAIT_INTERACTION_MS)
    expect(answers(interaction)).toEqual([['deferReply', undefined]])
    settle()
    await vi.advanceTimersByTimeAsync(lookupMs)
    await Promise.all([handled, ready])

    expect(answers(interaction)).toEqual([
      ['deferReply', undefined],
      ['editReply', resolveColor(SERVER.colors.primary)],
    ])
    expect(logged).toEqual([])
  })

  it("under @Defer({ mode: 'auto' }), edits the deferral in the server's theme once the hooks settle", async () => {
    const { module, ready } = await started()
    const interaction = slash('later')
    const handled = module.dispatch(interaction)

    await vi.advanceTimersByTimeAsync(2 * READY_WAIT_INTERACTION_MS)
    expect(answers(interaction)).toEqual([['deferReply', undefined]])
    settle()
    await vi.advanceTimersByTimeAsync(0)
    await Promise.all([handled, ready])

    expect(answers(interaction)).toEqual([
      ['deferReply', undefined],
      ['editReply', resolveColor(SERVER.colors.primary)],
    ])
    expect(logged).toEqual([])
  })

  it("under @Defer({ mode: 'auto' }), goes out as the first answer when the timer's acknowledgement fails, without waiting for the hooks", async () => {
    const { module, ready } = await started()
    const interaction = slash('later')
    vi.mocked(interaction.deferReply).mockRejectedValue(new Error('Service unavailable'))
    const handled = module.dispatch(interaction).catch(() => undefined)

    await vi.advanceTimersByTimeAsync(2 * READY_WAIT_INTERACTION_MS)
    expect(getResponse(interaction).calls.map(call => [call.method, call.error !== undefined])).toEqual([
      ['deferReply', true],
      ['reply', false],
    ])

    settle()
    await Promise.all([handled, ready])
  })

  it("under @Defer({ mode: 'auto' }), goes out when the timer's acknowledgement, queued behind an answer, goes ahead of it and fails", async () => {
    // Strict mocks mark the interaction deferred once the call lands, as discord.js does, so the timer finds the
    // first acknowledgement still on its way
    forgetStrictMocks()
    useStrictMocks()
    const { module, ready } = await started()
    const interaction = slash('later')
    early = interaction => {
      void respond(interaction)
        .acknowledge()
        .catch(() => undefined)
      sendEarly(interaction)
    }
    // The first acknowledgement is still in flight when the timer fires, so the timer's queues behind onStart's answer
    vi.mocked(interaction.deferReply)
      .mockImplementationOnce(async () => {
        await sleep(2 * READY_WAIT_INTERACTION_MS)
        throw new Error('Service unavailable')
      })
      .mockRejectedValue(new Error('Service unavailable'))
    const handled = module.dispatch(interaction).catch(() => undefined)

    await vi.advanceTimersByTimeAsync(2 * READY_WAIT_INTERACTION_MS + 1)
    expect(getResponse(interaction).calls.map(call => [call.method, call.error !== undefined])).toEqual([
      ['deferReply', true],
      ['deferReply', true],
      ['reply', false],
    ])

    settle()
    await Promise.all([handled, ready])
  })
})
