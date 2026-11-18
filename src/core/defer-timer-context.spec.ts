import { ButtonInteraction, resolveColor } from 'discord.js'
import { inject } from 'inversify'
import { vi } from 'vitest'
import { bindTheme, type ExecutionContext, respond } from '@src/common/index.js'
import { Command, Controller, Defer, MeoCord, type MeoCordOptions, Observer, Service, UseTheme } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { type DispatchObserver, type OnReady } from '@src/interface/index.js'
import { createMockInteraction, createMockMessage, getResponse, MeoCordTestingModule } from '@src/testing/index.js'

// @Defer({ mode: 'auto' })'s timer draws the loading view of a lock() pending when it fires, in the call's theme

const GUILD = '100000000000000001'
const SERVER = { colors: { primary: '#00000D' } } as const
const DEFAULT_PRIMARY = '#7680F4'
const DEFAULT_LOADING = '⏳'
const AFTER_MS = 100
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

const timings = ['real timers', 'fake timers'] as const
type Timing = (typeof timings)[number]

@Controller()
@UseTheme({ colors: { primary: '#0000A1' } })
class Cards {
  @Defer({ mode: 'auto', after: AFTER_MS })
  @Command('card', CommandType.BUTTON)
  async card(interaction: ButtonInteraction) {
    await respond(interaction).lock()
    await sleep(2 * AFTER_MS)
  }

  @Defer({ mode: 'auto', after: AFTER_MS })
  @UseTheme({ emojis: { loading: '🌀' } })
  @Command('spin', CommandType.BUTTON)
  async spin(interaction: ButtonInteraction) {
    await respond(interaction).lock()
    await sleep(2 * AFTER_MS)
  }

  @UseTheme({ emojis: { loading: '🌀' } })
  @Command('later', CommandType.BUTTON)
  async later(interaction: ButtonInteraction) {
    await respond(interaction).send('now')
    const followUp = () => void respond(interaction).followUp({ embeds: [{ description: 'later' }] })
    setTimeout(bound ? bindTheme(followUp) : followUp, AFTER_MS)
  }
}

/** Whether the `later` handler wraps its own timer's callback in bindTheme(). */
let bound = false

function compile(extra: Partial<MeoCordOptions> = {}) {
  @MeoCord({ controllers: [Cards], clientOptions: { intents: [] }, ...extra })
  class App {}
  return MeoCordTestingModule.fromApp(App).compile()
}

/** A click on a card with one button, which a lock disables. */
function click(customId: string) {
  const message = Object.assign(createMockMessage(), {
    components: [{ toJSON: () => ({ type: 1, components: [{ type: 2, style: 1, custom_id: customId, label: 'Go' }] }) }],
  })
  return createMockInteraction(ButtonInteraction, { customId, guildId: GUILD, message } as never)
}

/** Waits `ms` on the clock the test runs on. */
const pass = (timing: Timing, ms: number) => (timing === 'fake timers' ? vi.advanceTimersByTimeAsync(ms) : sleep(ms))

/** The colour and emoji of the loading view the timer drew: the first edit after its acknowledgement. */
function loadingView(interaction: ButtonInteraction) {
  const [acknowledgement, loading] = getResponse(interaction).calls
  const payload = loading?.payload as { embeds?: { color?: number; description?: string }[] } | undefined
  const embed = payload?.embeds?.[0]
  return [acknowledgement?.method, loading?.method, embed?.color, embed?.description?.split(' ')[0]]
}

async function dispatch(timing: Timing, interaction: ButtonInteraction, extra?: Partial<MeoCordOptions>) {
  if (timing === 'fake timers') vi.useFakeTimers()
  const handled = compile(extra).dispatch(interaction)
  await pass(timing, 4 * AFTER_MS)
  await handled
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  bound = false
})

describe("the loading view @Defer({ mode: 'auto' })'s timer draws for a pending lock()", () => {
  it.each(timings)("has the controller's @UseTheme, under %s", async timing => {
    const interaction = click('card')
    await dispatch(timing, interaction)
    expect(loadingView(interaction)).toEqual(['deferUpdate', 'editReply', resolveColor('#0000A1'), DEFAULT_LOADING])
  })

  it.each(timings)("has the handler's @UseTheme over the controller's, under %s", async timing => {
    const interaction = click('spin')
    await dispatch(timing, interaction)
    expect(loadingView(interaction)).toEqual(['deferUpdate', 'editReply', resolveColor('#0000A1'), '🌀'])
  })

  it.each(timings)("has the server's theme from themeFor over the handler's @UseTheme, under %s", async timing => {
    const interaction = click('spin')
    await dispatch(timing, interaction, { themeFor: { guild: () => SERVER } })
    expect(loadingView(interaction)).toEqual(['deferUpdate', 'editReply', resolveColor(SERVER.colors.primary), '🌀'])
  })
})

describe("the loading view @Defer({ mode: 'auto' })'s timer draws for a lock() pending from onStart, with waitForReady and a resolver whose hook runs", () => {
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

  @Observer()
  class Locks implements DispatchObserver {
    onStart(context: ExecutionContext) {
      void respond(context.getInteraction() as ButtonInteraction).lock()
    }
    onSettled() {}
  }

  @Controller()
  @UseTheme({ emojis: { loading: '🌀' } })
  class Slow {
    @Defer({ mode: 'auto', after: AFTER_MS })
    @Command('slow', CommandType.BUTTON)
    slow() {}
  }

  it.each(timings)("is drawn once the hook settles, in the server's theme over @UseTheme, under %s", async timing => {
    if (timing === 'fake timers') vi.useFakeTimers()
    const module = compile({ controllers: [Slow], observers: [Locks], themeFor: PrefsThemes, waitForReady: true })
    const ready = module.init({ ready: true })
    await pass(timing, 0)
    const interaction = click('slow')
    const handled = module.dispatch(interaction)

    await pass(timing, 4 * AFTER_MS)
    expect(getResponse(interaction).calls.map(call => call.method)).toEqual(['deferUpdate'])
    settle()
    await pass(timing, 0)
    await Promise.all([handled, ready])

    expect(loadingView(interaction)).toEqual(['deferUpdate', 'editReply', resolveColor(SERVER.colors.primary), '🌀'])
  })
})

describe("a handler's own timer", () => {
  /** The colour of the follow-up the `later` handler's timer sends. */
  async function followUpColour(timing: Timing) {
    const interaction = click('later')
    await dispatch(timing, interaction)
    const followUp = getResponse(interaction).calls.find(call => call.method === 'followUp')
    return (followUp?.payload as { embeds?: { color?: number }[] }).embeds?.[0]?.color
  }

  it("keeps the call's theme under real timers", async () => {
    expect(await followUpColour('real timers')).toBe(resolveColor('#0000A1'))
  })

  it("loses the call's theme under fake timers, which run its callback outside the call", async () => {
    expect(await followUpColour('fake timers')).toBe(resolveColor(DEFAULT_PRIMARY))
  })

  it("keeps the call's theme under fake timers with its callback wrapped in bindTheme()", async () => {
    bound = true
    expect(await followUpColour('fake timers')).toBe(resolveColor('#0000A1'))
  })
})
