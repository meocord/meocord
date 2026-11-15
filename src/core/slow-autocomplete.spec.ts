import { AutocompleteInteraction, type Message } from 'discord.js'
import { vi } from 'vitest'
import { Logger } from '@src/common/index.js'
import { forgetDeprecationWarnings } from '@src/common/deprecation.js'
import { Autocomplete, Controller, MeoCord, MessageHandler, Service } from '@src/decorator/index.js'
import { type OnReady } from '@src/interface/index.js'
import { Container } from 'inversify'
import { runReadyHooks, SLOW_READY_HOOK_MS, slowReadyWarning } from '@src/core/lifecycle-hooks.js'
import { bindProvider } from '@src/core/providers.js'
import { createDiscordError, createMockInteraction, createMockMessage, getResponse, MeoCordTestingModule } from '@src/testing/index.js'
import { forgetStrictMocks, useStrictMocks } from '@src/testing/strict-mocks.js'

// Autocomplete has Discord's three seconds and no acknowledgement: a handler near or past them is named, and the menu
// of one that returned without answering is closed.

const UNKNOWN_INTERACTION = 10062

/** The monotonic clock the calls are timed by, which each handler moves on by `took`. */
let now = 1_000
let took = 0
let mode: 'answer' | 'none' | 'throw' = 'answer'

@Controller()
class Search {
  @Autocomplete('search')
  async query(interaction: AutocompleteInteraction) {
    now += took
    if (mode === 'throw') throw new Error('lookup failed')
    if (mode === 'answer') await interaction.respond([{ name: 'tea', value: 'tea' }])
  }

  @MessageHandler('first', { prefix: false })
  first(_message: Message) {
    now += 6_000
  }

  // A listener for every message, which waits for the handler before it
  @MessageHandler()
  second(_message: Message) {}
}

const compile = (options: { warnSlow?: boolean; warnUnanswered?: boolean; slowHandlerWarning?: boolean } = {}) => {
  const { slowHandlerWarning, ...app } = options
  @MeoCord({
    controllers: [Search],
    clientOptions: { intents: [] },
    ...app,
    ...(slowHandlerWarning !== undefined && { messages: { slowHandlerWarning } }),
  })
  class App {}
  return MeoCordTestingModule.create({ app: App, controllers: [Search] }).compile()
}

/** An autocomplete created when it arrives, `lag` ms earlier by Discord's clock. */
function typed(lag = 0) {
  const interaction = createMockInteraction(AutocompleteInteraction, { commandName: 'search' })
  Object.defineProperty(interaction, 'createdTimestamp', { value: Date.now() - lag })
  return interaction
}

let warned: string[]
let errors: string[]
const named = (handler = 'Search.query') => warned.filter(text => text.startsWith(handler) || text.startsWith(`Discord refused ${handler}'s`))

beforeEach(() => {
  forgetStrictMocks()
  forgetDeprecationWarnings()
  now = 1_000
  took = 0
  mode = 'answer'
  warned = []
  errors = []
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.spyOn(Logger.prototype, 'warn').mockImplementation((text: unknown) => void warned.push(String(text)))
  vi.spyOn(Logger.prototype, 'error').mockImplementation((text: unknown) => void errors.push(String(text)))
})
afterEach(() => {
  forgetStrictMocks()
  vi.restoreAllMocks()
})

describe('an autocomplete handler near Discord\'s three seconds, with warnSlow', () => {
  it('logs nothing at 1.9 s', async () => {
    const module = compile({ warnSlow: true })
    took = 1_900
    await module.dispatch(typed())

    expect(named()).toEqual([])
  })

  it('names the handler at exactly 2.0 s', async () => {
    const module = compile({ warnSlow: true })
    took = 2_000
    await module.dispatch(typed())

    expect(named()).toEqual([expect.stringContaining('took 2.0 s')])
  })

  it('names the handler at 2.4 s, once over two calls', async () => {
    const module = compile({ warnSlow: true })
    took = 2_400
    await module.dispatch(typed())
    await module.dispatch(typed())

    expect(named()).toEqual([
      "Search.query took 2.4 s of Discord's 3 s to suggest choices for /search. Past 3 s the member sees no suggestions; " +
        'cache what it searches, or search less.',
    ])
  })

  it("counts from the interaction's creation when it came in late", async () => {
    took = 1_500
    await compile({ warnSlow: true }).dispatch(typed(800))

    expect(named()).toEqual([expect.stringContaining('took 2.3 s')])
  })

  it('logs a respond() Discord refused as expired as the miss, not as an error', async () => {
    const module = compile({ warnSlow: true })
    took = 3_200
    const interaction = typed()
    interaction.respond.mockRejectedValue(createDiscordError(UNKNOWN_INTERACTION))

    // A testing module's dispatch rejects with an error no filter handled, as it reports every such error
    await expect(module.dispatch(interaction)).rejects.toThrow('10062')

    expect(named()).toEqual([
      "Discord refused Search.query's choices for /search as expired, after 3.2 s by MeoCord's count, so the member saw " +
        "no suggestions. Discord gives an autocomplete 3 s: cache what it searches, or search less.",
    ])
    expect(errors).toEqual([])
    // The token is gone, so no close is tried after it
    expect(interaction.respond).toHaveBeenCalledTimes(1)
  })

  it("logs a close of the menu Discord refused as expired, after the handler's error, at warn", async () => {
    useStrictMocks()
    const module = compile({ warnSlow: true })
    mode = 'throw'
    took = 3_100
    const interaction = typed()
    interaction.respond.mockRejectedValue(createDiscordError(UNKNOWN_INTERACTION))
    const debug = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined)

    await expect(module.dispatch(interaction)).rejects.toThrow('lookup failed')

    expect(named()).toEqual([expect.stringMatching(/^Discord refused Search\.query's choices for \/search as expired, after 3\.1 s by MeoCord's count/)])
    expect(debug.mock.calls.flat().join(' ')).not.toContain('close the autocomplete window')
  })

  it('keeps any other Discord error as it was', async () => {
    took = 3_200
    const interaction = typed()
    interaction.respond.mockRejectedValueOnce(createDiscordError(50035))

    await compile({ warnSlow: true })
      .dispatch(interaction)
      .catch(() => undefined)

    expect(named()).toEqual([])
    expect(errors).toEqual([expect.stringContaining('Error handling autocomplete for "search"')])
  })
})

describe('the slow autocomplete warnings, silenced', () => {
  it.each([
    ['warnSlow: false', { warnSlow: false }],
    ['a testing module by default', {}],
  ] as const)('give nothing with %s, and keep the error as before', async (_label, options) => {
    const module = compile(options)
    took = 2_400
    await module.dispatch(typed())

    const late = typed()
    took = 3_200
    late.respond.mockRejectedValue(createDiscordError(UNKNOWN_INTERACTION))
    await module.dispatch(late).catch(() => undefined)

    expect(named()).toEqual([])
    expect(errors).toEqual([expect.stringContaining('Error handling autocomplete for "search"')])
  })
})

describe('an autocomplete handler that returns without answering', () => {
  beforeEach(() => {
    mode = 'none'
  })

  it('has its menu closed with no choices under strict mocks, as on a bot, and is named once over two calls', async () => {
    useStrictMocks()
    const module = compile()
    const first = typed()
    const second = typed()

    await module.dispatch(first)
    await module.dispatch(second)

    expect(first.respond).toHaveBeenCalledWith([])
    expect(second.respond).toHaveBeenCalledWith([])
    expect(named()).toEqual([
      'Search.query returned without answering its autocomplete, so MeoCord closed the menu with no choices. ' +
        "Answer it with interaction.respond(choices) within Discord's 3 s.",
    ])
  })

  it.each([true, false])('is named whatever warnSlow says (%s)', async warnSlow => {
    useStrictMocks()
    await compile({ warnSlow }).dispatch(typed())

    expect(named()).toEqual([expect.stringContaining('so MeoCord closed the menu with no choices')])
  })

  it('gives warnUnanswered no second warning', async () => {
    useStrictMocks()
    await compile({ warnUnanswered: true }).dispatch(typed())

    expect(named()).toEqual([expect.stringContaining('so MeoCord closed the menu with no choices')])
  })

  it('says, once, that it was also too slow when Discord refuses the close as expired', async () => {
    useStrictMocks()
    const module = compile({ warnSlow: false })
    took = 3_400
    const interaction = typed()
    interaction.respond.mockRejectedValue(createDiscordError(UNKNOWN_INTERACTION))

    await module.dispatch(interaction)

    expect(named()).toEqual([
      "Search.query returned without answering its autocomplete, and Discord refused MeoCord's close of the menu as " +
        "expired, after 3.4 s by MeoCord's count, so the member saw its options fail to load. Answer it with " +
        "interaction.respond(choices) within Discord's 3 s.",
    ])
  })

  it('leaves the interaction untouched without strict mocks, as before', async () => {
    const interaction = typed()

    await compile().dispatch(interaction)

    expect(interaction.respond).not.toHaveBeenCalled()
    expect(getResponse(interaction).calls).toEqual([])
  })

  it('names the handler without strict mocks, and warns once a run that the bot closes the menu', async () => {
    const module = compile()

    await module.dispatch(typed())
    await module.dispatch(typed())

    expect(named()).toEqual([
      'Search.query returned without answering its autocomplete, so the member saw its options fail to load. ' +
        "Answer it with interaction.respond(choices) within Discord's 3 s.",
    ])
    expect(warned.filter(text => text.startsWith('dispatch() here leaves open the menu'))).toHaveLength(1)
  })

  it('counts a respond() a test set the behaviour of as an answer without strict mocks', async () => {
    mode = 'answer'
    const interaction = typed()
    interaction.respond.mockResolvedValue(undefined)

    await compile().dispatch(interaction)

    expect(named()).toEqual([])
  })
})

describe('messages.slowHandlerWarning', () => {
  const twoHandlers = async (options: Parameters<typeof compile>[0]) => {
    await compile(options).dispatch(createMockMessage({ content: 'first' }))
    return warned.filter(text => text.startsWith('Search.first took'))
  }

  it('follows warnSlow when unset', async () => {
    expect(await twoHandlers({ warnSlow: true })).toHaveLength(1)
    warned.length = 0
    expect(await twoHandlers({ warnSlow: false })).toEqual([])
  })

  it('wins over warnSlow when set', async () => {
    expect(await twoHandlers({ warnSlow: false, slowHandlerWarning: true })).toHaveLength(1)
    warned.length = 0
    expect(await twoHandlers({ warnSlow: true, slowHandlerWarning: false })).toEqual([])
  })
})

describe('a slow onReady in a testing module', () => {
  it.each([
    [true, ['onReady in Warmer has run for 10.0 s, holding back no hooks after it; calls are already being handled. ' + 'Start long work without awaiting it in onReady, and stop it in onShutdown.']],
    [undefined, []],
  ] as const)('is named with warnSlow %s only when true', async (warnSlow, expected) => {
    @Service()
    class Warmer implements OnReady {
      onReady() {
        return new Promise<void>(resolve => setTimeout(resolve, SLOW_READY_HOOK_MS + 1_000))
      }
    }
    @MeoCord({ controllers: [], services: [Warmer], clientOptions: { intents: [] }, ...(warnSlow !== undefined && { warnSlow }) })
    class App {}
    vi.useFakeTimers()
    try {
      const module = MeoCordTestingModule.fromApp(App).compile()
      const ready = module.init({ ready: true })
      await vi.advanceTimersByTimeAsync(SLOW_READY_HOOK_MS + 1_000)
      await ready

      expect(warned.filter(text => text.startsWith('onReady in Warmer'))).toEqual(expected)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('the slow onReady warning, counting the hooks after it', () => {
  it.each([
    ['constructs', false],
    ['throws as it is made', true],
  ] as const)('makes no later unit before its turn, one whose constructor %s', async (_label, throws) => {
    let made = 0
    class Slow implements OnReady {
      onReady() {
        return new Promise<void>(resolve => setTimeout(resolve, SLOW_READY_HOOK_MS + 1_000))
      }
    }
    Service()(Slow)
    class Later implements OnReady {
      constructor() {
        made++
        if (throws) throw new Error('constructor failed')
      }
      onReady() {}
    }
    Service()(Later)
    @MeoCord({ controllers: [], clientOptions: { intents: [] }, warnSlow: true })
    class App {}
    const module = MeoCordTestingModule.create({
      app: App,
      providers: [
        { provide: Slow, useClass: Slow },
        { provide: Later, useClass: Later },
      ],
    }).compile()
    vi.useFakeTimers()
    try {
      const ready = module.init({ ready: true }).catch((error: Error) => error)
      await vi.advanceTimersByTimeAsync(SLOW_READY_HOOK_MS)
      expect(made).toBe(0)
      await vi.advanceTimersByTimeAsync(1_000)
      const settled = await ready

      expect(made).toBe(1)
      expect(warned.filter(text => text.startsWith('onReady in Slow'))).toEqual([expect.stringContaining('holding back 1 hook after it')])
      if (throws) expect(String(settled)).toContain('constructor failed')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('the slow onReady warning, counting the hooks of the providers after it', () => {
  class Slow implements OnReady {
    onReady() {
      return new Promise<void>(resolve => setTimeout(resolve, SLOW_READY_HOOK_MS + 1_000))
    }
  }
  Service()(Slow)
  class Hooked implements OnReady {
    onReady() {}
  }
  Service()(Hooked)
  class Plain {}
  Service()(Plain)
  const withHook = () => ({ onReady: () => undefined })

  it.each([
    ['a value with onReady', [{ provide: 'LATER', useValue: withHook() }], '1 hook'],
    ['a value without hooks', [{ provide: Hooked, useValue: {} }], 'no hooks'],
    ['a factory whose value has onReady', [{ provide: 'LATER', useFactory: withHook }], '1 hook'],
    ['an async factory whose value has onReady', [{ provide: 'LATER', useFactory: async () => withHook() }], '1 hook'],
    ['a class token given a class without hooks', [{ provide: Hooked, useClass: Plain }], 'no hooks'],
    ['a string token given a class with onReady', [{ provide: 'LATER', useClass: Hooked }], '1 hook'],
    ['one value under two tokens', ((value: object) => [{ provide: 'A', useValue: value }, { provide: 'B', useValue: value }])(withHook()), '1 hook'],
  ])('counts %s, given to the module or to the app', async (_label, providers, hooks) => {
    for (const where of ['module', 'app'] as const) {
      warned.length = 0
      // Listed after Slow, so their hooks run after its
      const listed = [{ provide: Slow, useClass: Slow }, ...providers]
      @MeoCord({ controllers: [], ...(where === 'app' && { providers: listed }), clientOptions: { intents: [] }, warnSlow: true })
      class App {}
      const module = where === 'app' ? MeoCordTestingModule.fromApp(App).compile() : MeoCordTestingModule.create({ app: App, providers: listed }).compile()
      await expectWarning(module, hooks)
    }
  })

  // Both a bot and a testing module make factories before the hooks run; one not made yet can't be read
  it.each([
    ['alone', [], 'an unknown number of hooks'],
    ['after a class with onReady', [Hooked], 'at least 1 hook'],
  ] as const)('says how many it knows of when a factory not made yet follows, %s', async (_label, before, hooks) => {
    const container = new Container()
    for (const cls of [Slow, ...before]) container.bind(cls).toSelf().inSingletonScope()
    bindProvider(container, { provide: 'LATER', useFactory: withHook }, () => undefined)
    const units = [Slow, ...before, 'LATER'].map(token => ({ token, name: String((token as { name?: string }).name ?? token), dependencies: [] }))
    const said: string[] = []
    vi.useFakeTimers()
    try {
      const ran = runReadyHooks(container, units, {} as never, { primary: true }, {
        resolveFailed: () => undefined,
        hookFailed: () => undefined,
        slow: (unit, waiting) => void said.push(slowReadyWarning(unit, SLOW_READY_HOOK_MS, waiting)),
      }, { slowAfterMs: SLOW_READY_HOOK_MS })
      await vi.advanceTimersByTimeAsync(SLOW_READY_HOOK_MS + 1_000)
      await ran

      expect(said).toEqual([expect.stringContaining(`holding back ${hooks} after it`)])
    } finally {
      vi.useRealTimers()
    }
  })

  async function expectWarning(module: ReturnType<ReturnType<typeof MeoCordTestingModule.create>['compile']>, hooks: string) {
    vi.useFakeTimers()
    try {
      const ready = module.init({ ready: true })
      await vi.advanceTimersByTimeAsync(SLOW_READY_HOOK_MS + 1_000)
      await ready

      expect(warned.filter(text => text.startsWith('onReady in Slow'))).toEqual([expect.stringContaining(`holding back ${hooks} after it`)])
    } finally {
      vi.useRealTimers()
    }
  }
})

describe('@MeoCord({ warnSlow })', () => {
  it('takes only true or false', () => {
    expect(() => compile({ warnSlow: 'yes' as never })).toThrow('App: @MeoCord({ warnSlow }) takes true or false.')
  })
})
