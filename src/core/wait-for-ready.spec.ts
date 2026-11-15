import { AutocompleteInteraction, ButtonInteraction, ChatInputCommandInteraction, type Message, MessageFlags, MessageFlagsBitField } from 'discord.js'
import { inject } from 'inversify'
import { vi } from 'vitest'
import { bindTheme, Logger, respond, UserError } from '@src/common/index.js'
import { Autocomplete, Command, Controller, Defer, Guard, MeoCord, MessageHandler, On, Pipe, Service, UseGuard, UsePipe } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { type GuardInterface, type OnReady, type PipeInterface } from '@src/interface/index.js'
import { READY_WAIT_AUTOCOMPLETE_MS, READY_WAIT_INTERACTION_MS, ReadyGate } from '@src/core/ready-gate.js'
import { SLOW_READY_HOOK_MS } from '@src/core/lifecycle-hooks.js'
import { createChatInputOptions, createMockInteraction, createMockMessage, getResponse, MeoCordTestingModule } from '@src/testing/index.js'
import { forgetStrictMocks, useStrictMocks } from '@src/testing/strict-mocks.js'

// With waitForReady, a call waits for the onReady hooks of the classes it uses, up to its kind's bound.

let events: string[]
let warned: string[]

/** A hook that records its start and end, and settles when its test says so. */
class Hook {
  private readonly done = Promise.withResolvers<void>()
  readonly began = Promise.withResolvers<void>()
  constructor(private readonly name: string) {}
  async run(fail = false) {
    events.push(`${this.name} begins`)
    this.began.resolve()
    await this.done.promise
    events.push(`${this.name} ready`)
    if (fail) throw new Error(`${this.name} failed`)
  }
  settle() {
    this.done.resolve()
  }
}

let hooks: Record<string, Hook>
const hook = (name: string) => (hooks[name] ??= new Hook(name))

const slash = (commandName: string) => createMockInteraction(ChatInputCommandInteraction, { commandName })
/** An interaction whose creation time is 5 s ahead of the clock, as a host clock running late reads it. */
function aheadOfTheClock<T extends object>(interaction: T): T {
  Object.defineProperty(interaction, 'createdTimestamp', { value: Date.now() + 5_000, configurable: true })
  return interaction
}
const calls = (interaction: object) => getResponse(interaction as never).calls.map(call => call.method)
const tick = () => new Promise(resolve => setTimeout(resolve, 10))

beforeEach(() => {
  events = []
  warned = []
  hooks = {}
  vi.spyOn(Logger.prototype, 'warn').mockImplementation((text: unknown) => void warned.push(String(text)))
})
afterEach(() => {
  forgetStrictMocks()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

@Service()
class Cache implements OnReady {
  onReady() {
    return hook('Cache').run()
  }
}

@Service()
class Scheduler implements OnReady {
  onReady() {
    return hook('Scheduler').run()
  }
}

@Controller()
class Prices {
  constructor(@inject(Cache) readonly cache: Cache) {}

  @Command('price', CommandType.SLASH)
  price() {
    events.push('price runs')
  }

  @Defer()
  @Command('quote', CommandType.SLASH)
  quote() {
    events.push('quote runs')
  }

  @Defer({ mode: 'auto', after: 100 })
  @Command('estimate', CommandType.SLASH)
  estimate() {
    events.push('estimate runs')
  }

  @Autocomplete('price')
  suggest(interaction: AutocompleteInteraction) {
    events.push('suggest runs')
    return interaction.respond([])
  }

  @MessageHandler('price', { prefix: false })
  priceMessage(_message: Message) {
    events.push('message runs')
  }
}

@Controller()
class Ping {
  @Command('ping', CommandType.SLASH)
  ping() {
    events.push('ping runs')
  }

  @MessageHandler('ping', { prefix: false })
  pingMessage(_message: Message) {
    events.push('ping message runs')
  }
}

/** A controller ordered after Ping, with a hook of its own. */
@Controller()
class Jobs implements OnReady {
  onReady() {
    return hook('Jobs').run()
  }
}

/** A controller whose call waits for Cache under @Defer({ mode: 'auto' }), which acknowledges after 1.5 s. */
@Controller()
class Deferred {
  constructor(@inject(Cache) readonly cache: Cache) {}

  @Defer({ mode: 'auto' })
  @Command('deferred', CommandType.SLASH)
  deferred() {
    events.push('deferred runs')
  }
}

function compile(options: { waitForReady?: boolean; warnSlow?: boolean; services?: unknown[]; controllers?: unknown[]; extra?: object } = {}) {
  const { services = [Cache], controllers = [Prices, Ping], extra = {}, ...flags } = options
  @MeoCord({ controllers: controllers as never, services: services as never, clientOptions: { intents: [] }, ...flags, ...extra })
  class App {}
  return MeoCordTestingModule.fromApp(App).compile()
}

describe('a call with waitForReady', () => {
  it('waits for the onReady of a class its controller injects, while that hook runs', async () => {
    const module = compile({ waitForReady: true })
    const ready = module.init({ ready: true })
    await hook('Cache').began.promise

    const handled = module.dispatch(createMockMessage({ content: 'price' }))
    await tick()
    expect(events).toEqual(['Cache begins'])

    hook('Cache').settle()
    await Promise.all([ready, handled])
    expect(events).toEqual(['Cache begins', 'Cache ready', 'message runs'])
  })

  it('waits for a hook it depends on that has not started, behind an unrelated one ordered before it', async () => {
    const module = compile({ waitForReady: true, services: [Scheduler, Cache] })
    const ready = module.init({ ready: true })
    await hook('Scheduler').began.promise

    const handled = module.dispatch(createMockMessage({ content: 'price' }))
    await tick()
    hook('Scheduler').settle()
    await hook('Cache').began.promise
    await tick()
    expect(events).toEqual(['Scheduler begins', 'Scheduler ready', 'Cache begins'])

    hook('Cache').settle()
    await Promise.all([ready, handled])
    expect(events.at(-1)).toBe('message runs')
  })

  it("doesn't wait for a hook ordered after its own classes", async () => {
    const module = compile({ waitForReady: true, services: [], controllers: [Ping, Jobs] })
    const ready = module.init({ ready: true })
    await hook('Jobs').began.promise

    await module.dispatch(slash('ping'))
    expect(events).toEqual(['Jobs begins', 'ping runs'])
    expect(warned.filter(text => text.includes('ran before onReady'))).toEqual([])

    hook('Jobs').settle()
    await ready
  })

  it('runs once the hooks it waits for have settled, while a hook ordered after them still runs', async () => {
    const module = compile({ waitForReady: true, controllers: [Prices, Jobs] })
    const ready = module.init({ ready: true })
    await hook('Cache').began.promise

    const handled = module.dispatch(createMockMessage({ content: 'price' }))
    await tick()
    hook('Cache').settle()
    await hook('Jobs').began.promise
    await handled
    expect(events).toEqual(['Cache begins', 'Cache ready', 'Jobs begins', 'message runs'])

    hook('Jobs').settle()
    await ready
  })

  it('runs two calls waiting on one hook once it settles', async () => {
    const module = compile({ waitForReady: true })
    const ready = module.init({ ready: true })
    await hook('Cache').began.promise

    const handled = [module.dispatch(createMockMessage({ content: 'price' })), module.dispatch(createMockMessage({ content: 'price' }))]
    await tick()
    hook('Cache').settle()
    await Promise.all([ready, ...handled])

    expect(events).toEqual(['Cache begins', 'Cache ready', 'message runs', 'message runs'])
  })

  it.each([
    ['an object', () => ({})],
    ['undefined', () => undefined],
    ['a message', () => createMockMessage({ content: 'price' })],
  ])("refuses at once a call its @Command handler can't take, given %s, while the hook it waits for never settles", async (_label, make) => {
    const module = compile({ waitForReady: true })
    void module.init({ ready: true })
    await hook('Cache').began.promise

    await expect(module.invoke(Prices, 'price', make() as never)).rejects.toThrow(
      "Prices.price: @Command('price', CommandType.SLASH) takes a ChatInputCommandInteraction",
    )
    expect(events).toEqual(['Cache begins'])
  }, 1_000)

  it('runs once a hook it waits for throws, which counts as settled', async () => {
    @Service()
    class Broken implements OnReady {
      onReady() {
        return hook('Broken').run(true)
      }
    }
    @Controller()
    class Uses {
      constructor(@inject(Broken) readonly broken: Broken) {}
      @MessageHandler('use', { prefix: false })
      use() {
        events.push('use runs')
      }
    }
    const module = compile({ waitForReady: true, services: [Broken], controllers: [Uses] })
    const ready = module.init({ ready: true })
    await hook('Broken').began.promise

    const handled = module.dispatch(createMockMessage({ content: 'use' }))
    hook('Broken').settle()

    await expect(ready).rejects.toThrow('Broken failed')
    await handled
    expect(events).toEqual(['Broken begins', 'Broken ready', 'use runs'])
  })

  // Strict mocks order a class only a stage injects after the controllers, as the bot does: only the stage holds it
  it("waits under strict mocks for the hook of a global guard's dependency ordered after its controller", async () => {
    @Guard()
    class Allowlist {
      constructor(@inject(Cache) readonly cache: Cache) {}
      canActivate() {
        return true
      }
    }
    useStrictMocks()
    const module = compile({ waitForReady: true, services: [], controllers: [Ping, Jobs], extra: { guards: [Allowlist] } })
    const ready = module.init({ ready: true })
    await hook('Jobs').began.promise
    hook('Jobs').settle()
    await hook('Cache').began.promise

    const handled = module.dispatch(createMockMessage({ content: 'ping' }))
    await tick()
    expect(events).toEqual(['Jobs begins', 'Jobs ready', 'Cache begins'])

    hook('Cache').settle()
    await Promise.all([ready, handled])
    expect(events.at(-1)).toBe('ping message runs')
  })

  it('acknowledges a deferred command first, and waits past the bound of one without @Defer', async () => {
    vi.useFakeTimers()
    const module = compile({ waitForReady: true })
    const ready = module.init({ ready: true })
    await vi.advanceTimersByTimeAsync(0)
    const interaction = slash('quote')

    const handled = module.dispatch(interaction)
    await vi.advanceTimersByTimeAsync(READY_WAIT_INTERACTION_MS + 1_000)
    expect(calls(interaction)).toEqual(['deferReply'])
    expect(events).toEqual(['Cache begins'])

    hook('Cache').settle()
    await Promise.all([ready, handled])
    expect(events).toEqual(['Cache begins', 'Cache ready', 'quote runs'])
    expect(warned.filter(text => text.includes('ran before onReady'))).toEqual([])
  })

  it("keeps @Defer({ mode: 'auto' })'s timer running through a hook slower than its after", async () => {
    vi.useFakeTimers()
    const module = compile({ waitForReady: true })
    const ready = module.init({ ready: true })
    await vi.advanceTimersByTimeAsync(0)
    const interaction = slash('estimate')

    const handled = module.dispatch(interaction)
    await vi.advanceTimersByTimeAsync(150)
    expect(calls(interaction)).toEqual(['deferReply'])
    expect(events).toEqual(['Cache begins'])

    hook('Cache').settle()
    await Promise.all([ready, handled])
    expect(events.at(-1)).toBe('estimate runs')
  })

  it.each([
    [
      'a command without @Defer',
      () => slash('price'),
      READY_WAIT_INTERACTION_MS,
      'price runs',
      'Prices.price ran before onReady in Cache had settled, 2.0 s after the interaction was created, as long as an interaction without @Defer ' +
        'waits. Add @Defer to Prices.price to have it wait for the hook, or make onReady in Cache faster.',
    ],
    [
      'an autocomplete',
      () => createMockInteraction(AutocompleteInteraction, { commandName: 'price' }),
      READY_WAIT_AUTOCOMPLETE_MS,
      'suggest runs',
      'Prices.suggest ran before onReady in Cache had settled, 1.0 s after the interaction was created, as long as an autocomplete waits. ' +
        "An autocomplete can't be deferred: have Prices.suggest suggest choices without what that hook prepares, or make it faster.",
    ],
    [
      'a command without @Defer created ahead of the clock',
      () => aheadOfTheClock(slash('price')),
      READY_WAIT_INTERACTION_MS,
      'price runs',
      'Prices.price ran before onReady in Cache had settled, after waiting 2.0 s, as long as an interaction without @Defer ' +
        'waits. Add @Defer to Prices.price to have it wait for the hook, or make onReady in Cache faster.',
    ],
  ] as const)('runs %s at its bound, warning once for the hook whatever warnSlow says', async (_label, make, bound, ran, warning) => {
    vi.useFakeTimers()
    const module = compile({ waitForReady: true, warnSlow: false })
    const ready = module.init({ ready: true })
    await vi.advanceTimersByTimeAsync(0)

    const first = module.dispatch(make())
    await vi.advanceTimersByTimeAsync(bound - 1)
    expect(events).toEqual(['Cache begins'])
    await vi.advanceTimersByTimeAsync(1)
    await first
    const second = module.dispatch(make())
    await vi.advanceTimersByTimeAsync(bound)
    await second

    expect(events).toEqual(['Cache begins', ran, ran])
    expect(warned.filter(text => text.includes('ran before onReady'))).toEqual([warning])
    hook('Cache').settle()
    await ready
  })

  // Once Discord has the answer, the call waits as long as the hooks run; if the answer fails, as one without @Defer does
  it.each([
    ['goes through', false],
    ['fails', true],
  ] as const)("holds a call under @Defer({ mode: 'auto' }) answered from outside before it acknowledges, whose answer %s, as Discord was told", async (_how, fails) => {
    vi.useFakeTimers()
    const module = compile({ waitForReady: true, controllers: [Deferred] })
    const ready = module.init({ ready: true })
    await vi.advanceTimersByTimeAsync(0)
    const interaction = slash('deferred')
    if (fails) interaction.reply.mockImplementationOnce(() => Promise.reject(new Error('answer failed')))

    const handled = module.dispatch(interaction)
    await vi.advanceTimersByTimeAsync(500)
    const answered = respond(interaction as never)
      .send('hi')
      .catch(() => undefined)
    await vi.advanceTimersByTimeAsync(READY_WAIT_INTERACTION_MS - 500 - 1)
    expect(events).toEqual(['Cache begins'])
    await vi.advanceTimersByTimeAsync(1)
    if (fails) {
      await handled
      expect(events).toEqual(['Cache begins', 'deferred runs'])
      expect(warned).toEqual([
        'Deferred.deferred ran before onReady in Cache had settled, 2.0 s after the interaction was created: Discord had been told ' +
          'nothing of it, as its @Defer acknowledgement failed or was cancelled with no answer sent, so it waited as long as one ' +
          'without @Defer. Make onReady in Cache faster.',
      ])
    } else {
      await vi.advanceTimersByTimeAsync(READY_WAIT_INTERACTION_MS * 5)
      expect(events).toEqual(['Cache begins'])
      expect(warned).toEqual([])
    }
    hook('Cache').settle()
    await Promise.all([ready, handled, answered])
    expect(calls(interaction)).toEqual(['reply'])
  })

  it("holds two calls on one interaction under @Defer({ mode: 'auto' }) once its acknowledgement goes through", async () => {
    vi.useFakeTimers()
    const module = compile({ waitForReady: true, controllers: [Deferred] })
    const ready = module.init({ ready: true })
    await vi.advanceTimersByTimeAsync(0)
    const interaction = slash('deferred')

    const handled = [module.dispatch(interaction), module.dispatch(interaction)]
    await vi.advanceTimersByTimeAsync(READY_WAIT_INTERACTION_MS * 5)
    expect([events, warned]).toEqual([['Cache begins'], []])

    hook('Cache').settle()
    await Promise.all([ready, ...handled])
    expect(events).toEqual(['Cache begins', 'Cache ready', 'deferred runs', 'deferred runs'])
    expect(calls(interaction)).toEqual(['deferReply'])
  })

  it('names the hook that holds a call, though no class the call uses has one', async () => {
    vi.useFakeTimers()
    const module = compile({ waitForReady: true, controllers: [Ping] })
    const ready = module.init({ ready: true })
    await vi.advanceTimersByTimeAsync(0)

    const handled = module.dispatch(slash('ping'))
    await vi.advanceTimersByTimeAsync(READY_WAIT_INTERACTION_MS)
    await handled
    expect(events).toEqual(['Cache begins', 'ping runs'])
    expect(warned).toEqual([expect.stringContaining('Ping.ping ran before onReady in Cache had settled')])
    hook('Cache').settle()
    await ready
  })

  // As the bot's stop does: the hook in progress is waited for, and calls only where the cooldown store needs them
  it('closes once the hook in progress settles, without waiting for the call that hook held', async () => {
    const finish = Promise.withResolvers<void>()
    @Controller()
    class Slow {
      constructor(@inject(Cache) readonly cache: Cache) {}

      @Command('slow', CommandType.SLASH)
      async slow() {
        events.push('slow runs')
        await finish.promise
        events.push('slow ends')
      }
    }
    const module = compile({ waitForReady: true, controllers: [Slow] })
    const ready = module.init({ ready: true })
    await hook('Cache').began.promise

    const handled = module.dispatch(slash('slow'))
    const closed = module.close().then(() => events.push('closed'))
    await tick()
    expect(events).toEqual(['Cache begins'])

    hook('Cache').settle()
    await closed
    expect([...events].sort()).toEqual(['Cache begins', 'Cache ready', 'closed', 'slow runs'])
    finish.resolve()
    await Promise.all([ready, handled])
    expect(events.at(-1)).toBe('slow ends')
  })

  it('lets a message wait past both bounds', async () => {
    vi.useFakeTimers()
    const module = compile({ waitForReady: true })
    const ready = module.init({ ready: true })
    await vi.advanceTimersByTimeAsync(0)

    const handled = module.dispatch(createMockMessage({ content: 'price' }))
    await vi.advanceTimersByTimeAsync(READY_WAIT_INTERACTION_MS * 5)
    expect(events).toEqual(['Cache begins'])

    hook('Cache').settle()
    await Promise.all([ready, handled])
    expect(events.at(-1)).toBe('message runs')
  })

  it('says in the slow onReady warning that the calls using the hook wait for it', async () => {
    vi.useFakeTimers()
    const module = compile({ waitForReady: true, warnSlow: true, controllers: [Ping] })
    const ready = module.init({ ready: true })
    await vi.advanceTimersByTimeAsync(SLOW_READY_HOOK_MS)
    hook('Cache').settle()
    await ready

    expect(warned.filter(text => text.startsWith('onReady in Cache'))).toEqual([
      'onReady in Cache has run for 10.0 s, holding back no hooks after it; the calls that use it or a class after it wait ' +
        'for it. Start long work without awaiting it in onReady, and stop it in onShutdown.',
    ])
  })
})

describe('a call with waitForReady and a themeFor class', () => {
  @Service()
  class Prefs implements OnReady {
    onReady() {
      return hook('Prefs').run()
    }
  }

  /** A resolver slow by itself, reaching no hook. */
  @Service()
  class SlowThemes {
    async user() {
      await new Promise(resolve => setTimeout(resolve, 2_000))
      return { colors: { primary: '#0000D3' as const } }
    }
  }

  @Service()
  class PrefsThemes {
    constructor(@inject(Prefs) readonly prefs: Prefs) {}
    user() {
      events.push('themes asked')
      return { colors: { primary: '#0000D1' as const, danger: '#0000D2' as const } }
    }
  }

  @Controller()
  class Notes {
    @Defer()
    @Command('notes', CommandType.SLASH)
    notes() {
      events.push('notes runs')
    }

    @Command('quick', CommandType.SLASH)
    quick() {
      events.push('quick runs')
    }

    @Defer({ mode: 'auto' })
    @Command('later', CommandType.SLASH)
    later() {
      events.push('later runs')
    }

    @Defer({ mode: 'auto', after: 2500 })
    @Command('latest', CommandType.SLASH)
    latest() {
      events.push('latest runs')
    }

    @Defer({ mode: 'auto', ephemeral: true })
    @Command('hushed', CommandType.SLASH)
    hushed() {
      events.push('hushed runs')
    }

    @Defer({ mode: 'auto' })
    @Command('go', CommandType.BUTTON)
    go() {
      events.push('go runs')
    }

    @Autocomplete('notes')
    suggest(interaction: AutocompleteInteraction) {
      events.push('suggest runs')
      return interaction.respond([])
    }

    @MessageHandler('note', { prefix: false })
    note(_message: Message) {
      events.push('note runs')
    }
  }

  /** A service listed before the resolver, so only the resolver makes its event wait for Prefs. */
  @Service()
  class Listener {
    @On('messageCreate')
    heard(_message: Message) {
      events.push('event runs')
    }
  }

  it("starts the call's theme lookup only once the resolver's hooks have settled", async () => {
    const module = compile({ waitForReady: true, services: [], controllers: [Notes], extra: { themeFor: PrefsThemes } })
    const ready = module.init({ ready: true })
    await hook('Prefs').began.promise

    const handled = module.dispatch(createMockMessage({ content: 'note' }))
    await tick()
    expect(events).toEqual(['Prefs begins'])

    hook('Prefs').settle()
    await Promise.all([ready, handled])
    expect(events).toEqual(['Prefs begins', 'Prefs ready', 'themes asked', 'note runs'])
  })

  it("answers a call that failed before its wait in its theme, looked up once the resolver's hooks have settled", async () => {
    const module = compile({ waitForReady: true, services: [], controllers: [Notes], extra: { themeFor: PrefsThemes } })
    const ready = module.init({ ready: true })
    await hook('Prefs').began.promise
    const interaction = slash('notes')
    interaction.deferReply.mockRejectedValueOnce(new Error('acknowledgement failed'))

    const handled = expect(module.dispatch(interaction)).rejects.toThrow('acknowledgement failed')
    await tick()
    expect(events).toEqual(['Prefs begins'])

    hook('Prefs').settle()
    await Promise.all([ready, handled])
    expect(events).toEqual(['Prefs begins', 'Prefs ready', 'themes asked'])
    const answer = JSON.stringify(getResponse(interaction).calls.map(call => call.payload))
    expect(answer).toContain(`"color":${0x0000d2}`)
  })

  /** A module whose client is this app's before its hooks run, as a call registers it, and a click on that client. */
  async function registeredClick() {
    const module = compile({ waitForReady: true, services: [], controllers: [Notes], extra: { themeFor: PrefsThemes } })
    const first = createMockMessage({ content: 'note' })
    await module.dispatch(first)
    events.length = 0
    const click = createMockInteraction(ButtonInteraction, { customId: 'x', client: first.client } as never)
    return { module, click }
  }
  const colourOf = (interaction: object) => JSON.stringify(getResponse(interaction as never).calls.map(call => call.payload))

  it("looks up the theme of a function bindTheme wraps only once the resolver's hooks have settled", async () => {
    const { module, click } = await registeredClick()
    const ready = module.init({ ready: true })
    await hook('Prefs').began.promise
    const bound = bindTheme((interaction: ButtonInteraction) => respond(interaction).send({ embeds: [{ description: 'Picked' }] }))

    const clicked = bound(click)
    await tick()
    expect(events).toEqual(['Prefs begins'])

    hook('Prefs').settle()
    await Promise.all([ready, clicked])
    expect(events).toEqual(['Prefs begins', 'Prefs ready', 'themes asked'])
    expect(colourOf(click)).toContain(`"color":${0x0000d1}`)
  })

  it("binds a function called with a message, its theme looked up once the resolver's hooks have settled", async () => {
    const { module, click } = await registeredClick()
    const { client } = click
    const ready = module.init({ ready: true })
    await hook('Prefs').began.promise
    const bound = bindTheme((_message: Message) => events.push('bound runs'))

    expect(() => bound(createMockMessage({ content: 'y', client } as never))).not.toThrow()
    await tick()
    expect(events).toEqual(['Prefs begins', 'bound runs'])

    hook('Prefs').settle()
    await ready
    await tick()
    expect(events).toEqual(['Prefs begins', 'bound runs', 'Prefs ready', 'themes asked'])
    expect(() => bound(createMockMessage({ content: 'z', client } as never))).not.toThrow()
  })

  it("looks up the theme of a function bindTheme wraps, called with an autocomplete, at the autocomplete's 1 s bound", async () => {
    vi.useFakeTimers()
    const { module, click } = await registeredClick()
    const ready = module.init({ ready: true })
    await vi.advanceTimersByTimeAsync(0)
    const typing = createMockInteraction(AutocompleteInteraction, { commandName: 'notes', client: click.client } as never)
    const bound = bindTheme((_interaction: AutocompleteInteraction) => void events.push('bound runs'))

    bound(typing)
    await vi.advanceTimersByTimeAsync(READY_WAIT_AUTOCOMPLETE_MS - 1)
    expect(events).toEqual(['Prefs begins', 'bound runs'])
    await vi.advanceTimersByTimeAsync(1)

    expect(events).toEqual(['Prefs begins', 'bound runs', 'themes asked'])
    expect(warned.filter(text => text.includes('looked up a theme'))).toEqual([
      'PrefsThemes looked up a theme before onReady in Prefs had settled, 1.0 s after the interaction was created, as long as an autocomplete ' +
        'waits. Make onReady in Prefs faster.',
    ])
    hook('Prefs').settle()
    await ready
  })

  it('reads what bounds a lookup only for a lookup that waits', async () => {
    const { module, click } = await registeredClick()
    let reads = 0
    // Any value can be a bound function's first argument; this one counts how often its kind is asked
    const argument = { client: click.client, user: click.user, isAutocomplete: () => false, isRepliable: () => (reads++, false) }
    const bound = bindTheme((_argument: unknown) => undefined)
    const ready = module.init({ ready: true })
    await hook('Prefs').began.promise

    bound(argument)
    expect(reads).toBe(1)

    hook('Prefs').settle()
    await ready
    bound(argument)
    expect(reads).toBe(1)
  })

  it("looks up the theme of an answer outside any call only once the resolver's hooks have settled", async () => {
    const { module, click } = await registeredClick()
    const ready = module.init({ ready: true })
    await hook('Prefs').began.promise

    const answered = respond(click).send({ embeds: [{ description: 'Picked' }] })
    await tick()
    expect(events).toEqual(['Prefs begins'])

    hook('Prefs').settle()
    await Promise.all([ready, answered])
    expect(events).toEqual(['Prefs begins', 'Prefs ready', 'themes asked'])
    expect(colourOf(click)).toContain(`"color":${0x0000d1}`)
  })

  it("looks up the theme of an unrouted command's answer only once the resolver's hooks have settled", async () => {
    const module = compile({ waitForReady: true, services: [], controllers: [Notes], extra: { themeFor: PrefsThemes } })
    const ready = module.init({ ready: true })
    await hook('Prefs').began.promise

    const handled = module.dispatch(slash('nothere')).catch(() => undefined)
    await tick()
    expect(events).toEqual(['Prefs begins'])

    hook('Prefs').settle()
    await Promise.all([ready, handled])
    expect(events).toEqual(['Prefs begins', 'Prefs ready', 'themes asked'])
  })

  it("looks an interaction's theme up at its 2 s bound, with a warning, when the resolver's hooks run longer", async () => {
    vi.useFakeTimers()
    const module = compile({ waitForReady: true, services: [], controllers: [Notes], extra: { themeFor: PrefsThemes } })
    const ready = module.init({ ready: true })
    await vi.advanceTimersByTimeAsync(0)

    const handled = module.dispatch(slash('nothere')).catch(() => undefined)
    await vi.advanceTimersByTimeAsync(READY_WAIT_INTERACTION_MS - 1)
    expect(events).toEqual(['Prefs begins'])
    await vi.advanceTimersByTimeAsync(1)
    await handled

    expect(events).toEqual(['Prefs begins', 'themes asked'])
    expect(warned.filter(text => text.includes('looked up a theme'))).toEqual([
      'PrefsThemes looked up a theme before onReady in Prefs had settled, 2.0 s after the interaction was created, as long as an interaction ' +
        'Discord has been told nothing of waits. Make onReady in Prefs faster.',
    ])
    hook('Prefs').settle()
    await ready
  })

  it("answers a call whose @Defer failed at the 2 s bound of an interaction Discord wasn't told about, with a warning", async () => {
    vi.useFakeTimers()
    const module = compile({ waitForReady: true, services: [], controllers: [Notes], extra: { themeFor: PrefsThemes } })
    const ready = module.init({ ready: true })
    await vi.advanceTimersByTimeAsync(0)
    const interaction = slash('notes')
    interaction.deferReply.mockRejectedValueOnce(new Error('acknowledgement failed'))

    const handled = expect(module.dispatch(interaction)).rejects.toThrow('acknowledgement failed')
    await vi.advanceTimersByTimeAsync(READY_WAIT_INTERACTION_MS - 1)
    expect(events).toEqual(['Prefs begins'])
    await vi.advanceTimersByTimeAsync(1)
    await handled

    expect(events).toEqual(['Prefs begins', 'themes asked'])
    expect(warned.filter(text => text.includes('looked up a theme'))).toEqual([
      'PrefsThemes looked up a theme before onReady in Prefs had settled, 2.0 s after the interaction was created, as long as an interaction ' +
        'Discord has been told nothing of waits. Make onReady in Prefs faster.',
    ])
    hook('Prefs').settle()
    await ready
  })

  it("looks up the theme of a call whose @Defer went through once the resolver's hooks settle, past the 2 s bound", async () => {
    vi.useFakeTimers()
    const module = compile({ waitForReady: true, services: [], controllers: [Notes], extra: { themeFor: PrefsThemes } })
    const ready = module.init({ ready: true })
    await vi.advanceTimersByTimeAsync(0)
    const interaction = slash('notes')

    const handled = module.dispatch(interaction)
    await vi.advanceTimersByTimeAsync(READY_WAIT_INTERACTION_MS * 5)
    expect(events).toEqual(['Prefs begins'])
    expect(calls(interaction)).toEqual(['deferReply'])

    hook('Prefs').settle()
    await Promise.all([ready, handled])
    expect(events).toEqual(['Prefs begins', 'Prefs ready', 'themes asked', 'notes runs'])
    expect(warned).toEqual([])
  })

  it("looks an autocomplete's theme up at its 1 s bound, with a warning, when the resolver's hooks run longer", async () => {
    vi.useFakeTimers()
    const module = compile({ waitForReady: true, services: [], controllers: [Notes], extra: { themeFor: PrefsThemes } })
    const ready = module.init({ ready: true })
    await vi.advanceTimersByTimeAsync(0)

    const handled = module.dispatch(createMockInteraction(AutocompleteInteraction, { commandName: 'notes' }))
    await vi.advanceTimersByTimeAsync(READY_WAIT_AUTOCOMPLETE_MS - 1)
    expect(events).toEqual(['Prefs begins'])
    await vi.advanceTimersByTimeAsync(1)
    await handled

    expect(events).toEqual(['Prefs begins', 'themes asked', 'suggest runs'])
    expect(warned.filter(text => text.includes('looked up a theme'))).toEqual([
      'PrefsThemes looked up a theme before onReady in Prefs had settled, 1.0 s after the interaction was created, as long as an autocomplete ' +
        'waits. Make onReady in Prefs faster.',
    ])
    hook('Prefs').settle()
    await ready
  })

  /** A slash command whose acknowledgement settles `after` ms once asked for, as `outcome` says. */
  function acknowledgedAfter(commandName: string, after: number, outcome: 'ok' | 'fails' | 'never') {
    const interaction = slash(commandName)
    interaction.deferReply.mockImplementationOnce(() => {
      if (outcome === 'never') return new Promise<never>(() => undefined)
      const settle = () => (outcome === 'ok' ? Promise.resolve(undefined as never) : Promise.reject(new Error('acknowledgement failed')))
      // At once for 0 ms, as a timer set while fake time is advanced to its moment would wait for the next advance
      return after === 0 ? settle() : new Promise<never>(resolve => setTimeout(() => resolve(settle()), after))
    })
    return interaction
  }
  const lookupWarnings = () => warned.filter(text => text.includes('looked up a theme'))

  it.each([2000, 2500])(
    "looks up the theme of a call whose @Defer acknowledgement goes through at %i ms once the resolver's hooks settle",
    async after => {
      vi.useFakeTimers()
      const module = compile({ waitForReady: true, services: [], controllers: [Notes], extra: { themeFor: PrefsThemes } })
      const ready = module.init({ ready: true })
      await vi.advanceTimersByTimeAsync(0)

      const handled = module.dispatch(acknowledgedAfter('notes', after, 'ok'))
      await vi.advanceTimersByTimeAsync(READY_WAIT_INTERACTION_MS * 5)
      expect(events).toEqual(['Prefs begins'])

      hook('Prefs').settle()
      await Promise.all([ready, handled])
      expect(events).toEqual(['Prefs begins', 'Prefs ready', 'themes asked', 'notes runs'])
      expect(warned).toEqual([])
    },
  )

  it.each([
    [0, READY_WAIT_INTERACTION_MS],
    [1900, READY_WAIT_INTERACTION_MS],
    [2500, 2500],
  ])("answers a call whose @Defer acknowledgement fails at %i ms in its theme at %i ms, with a warning", async (after, at) => {
    vi.useFakeTimers()
    const module = compile({ waitForReady: true, services: [], controllers: [Notes], extra: { themeFor: PrefsThemes } })
    const ready = module.init({ ready: true })
    await vi.advanceTimersByTimeAsync(0)

    const handled = expect(module.dispatch(acknowledgedAfter('notes', after, 'fails'))).rejects.toThrow('acknowledgement failed')
    await vi.advanceTimersByTimeAsync(at - 1)
    expect(events).toEqual(['Prefs begins'])
    expect(lookupWarnings()).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    await handled

    expect(events).toEqual(['Prefs begins', 'themes asked'])
    expect(lookupWarnings()).toHaveLength(1)
    hook('Prefs').settle()
    await ready
  })

  it('neither looks a theme up nor warns while a @Defer acknowledgement never settles', async () => {
    vi.useFakeTimers()
    const module = compile({ waitForReady: true, services: [], controllers: [Notes], extra: { themeFor: PrefsThemes } })
    const ready = module.init({ ready: true })
    await vi.advanceTimersByTimeAsync(0)

    void module.dispatch(acknowledgedAfter('notes', 0, 'never'))
    await vi.advanceTimersByTimeAsync(READY_WAIT_INTERACTION_MS * 5)

    expect(events).toEqual(['Prefs begins'])
    expect(warned).toEqual([])
    hook('Prefs').settle()
    await ready
  })

  // An answer from outside the call follows what Discord has been told of the interaction, as the call does, with its
  // bound counted from the interaction's creation; a scheduled acknowledgement it waits behind goes out first
  describe('an answer from outside the call', () => {
    const notes = { waitForReady: true, services: [], controllers: [Notes], extra: { themeFor: PrefsThemes } }
    const picked = { embeds: [{ description: 'Picked' }] }
    const lookupWarning =
      'PrefsThemes looked up a theme before onReady in Prefs had settled, 2.0 s after the interaction was created, as long as an interaction ' +
      'Discord has been told nothing of waits. Make onReady in Prefs faster.'
    /** An interaction on a client a call has run on, which an answer outside any call finds its app by. */
    async function registered(commandName: string, props: object = {}) {
      const module = compile(notes)
      const first = createMockMessage({ content: 'note' })
      await module.dispatch(first)
      events.length = 0
      const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName, client: first.client, ...props } as never)
      return { module, interaction }
    }

    it.each([
      ['later', 1_400, 1_500, false],
      ['latest', 2_400, 2_500, false],
      ['later', 500, 1_500, false],
      ['later', 1_400, 1_500, true],
    ] as const)(
      "under @Defer({ mode: 'auto' }) /%s, answered at %i ms, is an edit once the hooks settle, after the acknowledgement at %i ms (strict mocks: %s)",
      async (command, answerAt, ackAt, strict) => {
        if (strict) useStrictMocks()
        vi.useFakeTimers()
        const module = compile(notes)
        const ready = module.init({ ready: true })
        await vi.advanceTimersByTimeAsync(0)
        const interaction = slash(command)

        const handled = module.dispatch(interaction)
        await vi.advanceTimersByTimeAsync(answerAt)
        const answered = respond(interaction as never).send(picked)
        await vi.advanceTimersByTimeAsync(ackAt - answerAt - 1)
        expect(calls(interaction)).toEqual([])
        await vi.advanceTimersByTimeAsync(1)
        expect(calls(interaction)).toEqual(['deferReply'])
        // Acknowledged, the answer and the call wait as long as the hooks run
        await vi.advanceTimersByTimeAsync(4_000 - ackAt)
        expect([events, calls(interaction), warned]).toEqual([['Prefs begins'], ['deferReply'], []])

        hook('Prefs').settle()
        await Promise.all([ready, handled, answered])
        expect(calls(interaction)).toEqual(['deferReply', 'editReply'])
        expect(colourOf(interaction)).toContain(`"color":${0x0000d1}`)
        expect(warned).toEqual([])
      },
    )

    it.each(['followUp', 'error'] as const)(
      "under @Defer({ mode: 'auto' }), answered by %s at 1400 ms, is an edit once the hooks settle, after the acknowledgement",
      async how => {
        vi.useFakeTimers()
        const module = compile(notes)
        const ready = module.init({ ready: true })
        await vi.advanceTimersByTimeAsync(0)
        const interaction = slash('later')

        const handled = module.dispatch(interaction)
        await vi.advanceTimersByTimeAsync(1_400)
        const answer = respond(interaction as never)
        const answered = how === 'error' ? answer.error(new Error('boom')) : answer.followUp(picked)
        await vi.advanceTimersByTimeAsync(100)
        expect(calls(interaction)).toEqual(['deferReply'])
        await vi.advanceTimersByTimeAsync(2_500)
        expect([calls(interaction), warned]).toEqual([['deferReply'], []])

        hook('Prefs').settle()
        await Promise.all([ready, handled, answered])
        expect(calls(interaction)).toEqual(['deferReply', 'editReply'])
        expect(warned).toEqual([])
      },
    )

    it("under @Defer({ mode: 'auto' }), waits for an acknowledgement still on its way when the hooks settle, then edits it", async () => {
      vi.useFakeTimers()
      const module = compile(notes)
      const ready = module.init({ ready: true })
      await vi.advanceTimersByTimeAsync(0)
      // Asked for at 1.5 s, through at 4.5 s
      const interaction = acknowledgedAfter('later', 3_000, 'ok')

      const handled = module.dispatch(interaction)
      await vi.advanceTimersByTimeAsync(1_400)
      const answered = respond(interaction as never).send(picked)
      await vi.advanceTimersByTimeAsync(2_600)
      hook('Prefs').settle()
      await vi.advanceTimersByTimeAsync(499)
      expect(calls(interaction)).toEqual(['deferReply'])
      await vi.advanceTimersByTimeAsync(1)
      await Promise.all([ready, handled, answered])
      expect(calls(interaction)).toEqual(['deferReply', 'editReply'])
      expect(warned).toEqual([])
    })

    /** Each call with whether it asked to be private. */
    const privacy = (interaction: object) =>
      getResponse(interaction as never).calls.map(
        call => `${call.method}${(Number((call.payload as { flags?: number } | undefined)?.flags ?? 0) & MessageFlags.Ephemeral) !== 0 ? ' private' : ''}`,
      )
    const hushed = { ...picked, flags: MessageFlags.Ephemeral as const }
    const answers = {
      'a private send': (interaction: object) => respond(interaction as never).send(hushed),
      'a private followUp': (interaction: object) => respond(interaction as never).followUp(hushed),
      "a UserError's error, private by default": (interaction: object) => respond(interaction as never).error(new UserError('Not yet')),
      'a public send': (interaction: object) => respond(interaction as never).send(picked),
      "a UserError's error shown as a reply": (interaction: object) => respond(interaction as never).error(new UserError('Not yet'), { visibility: 'reply' }),
    }

    // The acknowledgement that goes ahead of an answer stands in for that answer's own first reply, so it is as private
    // as that answer, whatever @Defer says
    it.each([
      ['later', 'a private send', 'deferReply private', false],
      ['later', 'a private send', 'deferReply private', true],
      ['later', 'a private followUp', 'deferReply private', false],
      ['later', "a UserError's error, private by default", 'deferReply private', false],
      ['later', "a UserError's error shown as a reply", 'deferReply', false],
      ['hushed', 'a public send', 'deferReply', false],
    ] as const)(
      "under @Defer({ mode: 'auto' }) /%s, %s waiting for its theme is acknowledged as %s, then edits it (strict mocks: %s)",
      async (command, answer, acknowledged, strict) => {
        if (strict) useStrictMocks()
        vi.useFakeTimers()
        const module = compile(notes)
        const ready = module.init({ ready: true })
        await vi.advanceTimersByTimeAsync(0)
        const interaction = slash(command)

        const handled = module.dispatch(interaction)
        await vi.advanceTimersByTimeAsync(1_400)
        const answered = answers[answer](interaction)
        await vi.advanceTimersByTimeAsync(100)
        expect(privacy(interaction)).toEqual([acknowledged])

        await vi.advanceTimersByTimeAsync(2_500)
        hook('Prefs').settle()
        await Promise.all([ready, handled, answered])
        expect(privacy(interaction)).toEqual([acknowledged, 'editReply'])
        expect(warned).toEqual([])
      },
    )

    it.each([
      ['later', 'deferReply'],
      ['hushed', 'deferReply private'],
    ] as const)("under @Defer({ mode: 'auto' }) /%s with no answer waiting, the timer's acknowledgement is %s, as @Defer says", async (command, acknowledged) => {
      vi.useFakeTimers()
      const module = compile(notes)
      const ready = module.init({ ready: true })
      await vi.advanceTimersByTimeAsync(0)
      const interaction = slash(command)

      const handled = module.dispatch(interaction)
      await vi.advanceTimersByTimeAsync(1_500)
      expect(privacy(interaction)).toEqual([acknowledged])

      hook('Prefs').settle()
      await Promise.all([ready, handled])
    })

    it("under @Defer({ mode: 'auto', ephemeral: true }), a public send made before the timer replies publicly", async () => {
      vi.useFakeTimers()
      const module = compile(notes)
      const ready = module.init({ ready: true })
      await vi.advanceTimersByTimeAsync(0)
      hook('Prefs').settle()
      await ready
      const interaction = slash('hushed')

      await module.dispatch(interaction)
      await respond(interaction as never).send(picked)
      await vi.advanceTimersByTimeAsync(2_000)
      expect(privacy(interaction)).toEqual(['reply'])
    })

    // Asking for privacy in an edit: left out of an edit of a private deferral, which already is, and dropped with the
    // warning once the private reply has been sent; a deleted deferral's next answer follows up as asked
    describe('a private answer after a private acknowledgement', () => {
      /** An interaction acknowledged privately, or left unanswered, once the hooks have settled. */
      async function acknowledgedPrivately(acknowledged: boolean) {
        const { module, interaction } = await registered('quick')
        const ready = module.init({ ready: true })
        hook('Prefs').settle()
        await ready
        if (acknowledged) await respond(interaction as never).acknowledge({ ephemeral: true })
        return interaction
      }

      it('edits a private deferral without warning', async () => {
        const interaction = await acknowledgedPrivately(true)
        await respond(interaction as never).send(hushed)
        expect([privacy(interaction), warned]).toEqual([['deferReply private', 'editReply'], []])
      })

      it('follows up privately once the private deferral is deleted', async () => {
        const interaction = await acknowledgedPrivately(true)
        await respond(interaction as never).delete()
        await respond(interaction as never).send(hushed)
        expect(privacy(interaction)).toEqual(['deferReply private', 'deleteReply', 'followUp private'])
      })

      it('drops the flag with the warning in an edit of a private reply', async () => {
        const interaction = await acknowledgedPrivately(false)
        await respond(interaction as never).send(hushed)
        await respond(interaction as never).send(hushed)
        expect(privacy(interaction)).toEqual(['reply private', 'editReply'])
        expect(warned).toEqual([expect.stringMatching(/^Dropped flags Ephemeral, which an edit cannot take\./)])
      })
    })

    /** A click on a message with one "Go" button, on a client a call has run on. */
    async function clickOnGo() {
      const { module, interaction: first } = await registered('quick')
      const message = createMockMessage() as unknown as Record<string, unknown>
      const row = { type: 1, components: [{ type: 2, style: 1, custom_id: 'go', label: 'Go' }] }
      Object.assign(message, { flags: new MessageFlagsBitField(0), embeds: [], components: [{ toJSON: () => row }] })
      const click = createMockInteraction(ButtonInteraction, { customId: 'go', message, client: first.client } as never)
      return { module, click }
    }
    /** Each call with its content and whether its "Go" button is disabled. */
    const edits = (interaction: object) =>
      getResponse(interaction as never).calls.map(call => {
        const payload = (call.payload ?? {}) as { content?: string; components?: { components?: { disabled?: boolean }[] }[] }
        const go = payload.components?.[0]?.components?.[0]
        return [call.method, payload.content ?? (payload.components ? 'components' : undefined), go?.disabled ? 'Go disabled' : undefined].filter(Boolean).join(' ')
      })

    // The lock @Defer draws when the held handler starts is drawn and put back only over a message no answer has edited
    it.each([500, 1_600])(
      "under @Defer({ mode: 'auto' }), a click answered from outside at %i ms is edited once, with no lock drawn or put back over the answer",
      async answerAt => {
        vi.useFakeTimers()
        const { module, click } = await clickOnGo()
        const ready = module.init({ ready: true })
        await vi.advanceTimersByTimeAsync(0)

        const handled = module.dispatch(click)
        await vi.advanceTimersByTimeAsync(answerAt)
        const answered = respond(click).send({ content: 'hi', components: [] })
        await vi.advanceTimersByTimeAsync(4_000 - answerAt)
        hook('Prefs').settle()
        await Promise.all([ready, handled, answered])

        expect(edits(click)).toEqual(['deferUpdate', 'editReply hi'])
      },
    )

    it.each([
      ['a private follow-up from outside at 500 ms', true],
      ['no answer from outside', false],
    ] as const)("under @Defer({ mode: 'auto' }), a click with %s still gets the lock and its restore", async (_label, followsUp) => {
      vi.useFakeTimers()
      const { module, click } = await clickOnGo()
      const ready = module.init({ ready: true })
      await vi.advanceTimersByTimeAsync(0)

      const handled = module.dispatch(click)
      await vi.advanceTimersByTimeAsync(500)
      const answered = followsUp ? respond(click).followUp(hushed) : undefined
      await vi.advanceTimersByTimeAsync(3_500)
      hook('Prefs').settle()
      await Promise.all([ready, handled, answered])

      const drawn = edits(click).filter(call => call.startsWith('editReply'))
      expect(drawn).toEqual(['editReply components Go disabled', 'editReply components'])
      expect(edits(click).filter(call => call.startsWith('followUp'))).toHaveLength(followsUp ? 1 : 0)
    })

    it("under @Defer({ mode: 'auto' }), a modal refused while an answer prepares leaves the acknowledgement scheduled", async () => {
      vi.useFakeTimers()
      const module = compile(notes)
      const ready = module.init({ ready: true })
      await vi.advanceTimersByTimeAsync(0)
      const interaction = slash('later')

      const handled = module.dispatch(interaction)
      await vi.advanceTimersByTimeAsync(500)
      const answered = respond(interaction as never).send(picked)
      await vi.advanceTimersByTimeAsync(500)
      await expect(respond(interaction as never).modal({ customId: 'm', title: 'T', components: [] } as never)).rejects.toThrow('A modal must be the first response')
      await vi.advanceTimersByTimeAsync(500)
      expect(calls(interaction)).toEqual(['deferReply'])

      hook('Prefs').settle()
      await Promise.all([ready, handled, answered])
      expect(calls(interaction)).toEqual(['deferReply', 'editReply'])
    })

    // The call and its own theme lookup go ahead on one decision: let through at its bound, it runs then, as its warning says
    it.each([
      ['quick', 'at 500 ms', 500, false, false],
      ['quick', 'at 500 ms', 500, false, true],
      ['quick', 'at 1400 ms', 1_400, false, false],
      ['quick', 'at 1400 ms', 1_400, false, true],
      ['later', 'at 500 ms, its acknowledgement failing', 500, true, false],
      ['later', 'at 500 ms, its acknowledgement failing', 500, true, true],
    ] as const)('/%s answered from outside %s runs at its 2 s bound, as its one warning says (strict mocks: %4$s)', async (command, _label, answerAt, ackFails, strict) => {
      if (strict) useStrictMocks()
      vi.useFakeTimers()
      const { module, interaction } = await registered(command)
      if (ackFails) interaction.deferReply.mockRejectedValueOnce(new Error('acknowledgement failed'))
      const ready = module.init({ ready: true })
      await vi.advanceTimersByTimeAsync(0)

      const handled = module.dispatch(interaction).catch(() => undefined)
      await vi.advanceTimersByTimeAsync(answerAt)
      const answered = respond(interaction as never).send(picked)
      await vi.advanceTimersByTimeAsync(READY_WAIT_INTERACTION_MS - answerAt - 1)
      expect(events).not.toContain(`${command} runs`)
      await vi.advanceTimersByTimeAsync(1)
      await answered
      expect(events).toContain(`${command} runs`)
      expect(warned.filter(text => text.includes('before onReady in Prefs had settled'))).toHaveLength(1)

      hook('Prefs').settle()
      await Promise.all([ready, handled])
    })

    it('hands the call its gate decision to its own theme lookup, which goes ahead the moment the call does', async () => {
      vi.useFakeTimers()
      const lookups = vi.spyOn(ReadyGate.prototype, 'lookupReady')
      const { module, interaction } = await registered('quick')
      const ready = module.init({ ready: true })
      await vi.advanceTimersByTimeAsync(0)

      const handled = module.dispatch(interaction)
      await vi.advanceTimersByTimeAsync(0)
      const ahead = lookups.mock.calls.at(-1)![0]()!.ahead!
      let wentAhead = false
      void ahead.then(() => (wentAhead = true))
      await vi.advanceTimersByTimeAsync(READY_WAIT_INTERACTION_MS - 1)
      expect(wentAhead).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect([wentAhead, events]).toEqual([true, expect.arrayContaining(['quick runs'])])

      hook('Prefs').settle()
      await Promise.all([ready, handled])
      lookups.mockRestore()
    })

    it("an answer from outside after the call went ahead at its bound follows what Discord was told, not the call's decision", async () => {
      vi.useFakeTimers()
      const { module, interaction } = await registered('quick')
      const ready = module.init({ ready: true })
      await vi.advanceTimersByTimeAsync(0)

      const handled = module.dispatch(interaction)
      await vi.advanceTimersByTimeAsync(READY_WAIT_INTERACTION_MS)
      expect(events).toContain('quick runs')
      // Told nothing and past its bound, the first answer goes out at once; Discord then has it, so the next waits
      await vi.advanceTimersByTimeAsync(200)
      const sent = respond(interaction as never).send(picked)
      await vi.advanceTimersByTimeAsync(0)
      await sent
      const followed = respond(interaction as never).followUp(picked)
      await vi.advanceTimersByTimeAsync(1_000)
      expect(calls(interaction)).toEqual(['reply'])

      hook('Prefs').settle()
      await Promise.all([ready, handled, followed])
      expect(calls(interaction)).toEqual(['reply', 'followUp'])
    })

    // Without waitForReady too: an answer waiting for a slow resolver's theme doesn't hold @Defer({ mode: 'auto' })'s
    // acknowledgement back, which goes ahead as private as that answer
    describe('with waitForReady off and a slow themeFor resolver', () => {
      const slow = { waitForReady: false, services: [], controllers: [Notes], extra: { themeFor: SlowThemes, themeForTimeoutMs: 3_000 } }
      /** A module with the slow resolver, and an interaction on a client a call has run on. */
      async function registeredSlow(make: (client: unknown) => object) {
        const module = compile(slow)
        const first = createMockMessage({ content: 'note' })
        const registering = module.dispatch(first)
        await vi.advanceTimersByTimeAsync(2_000)
        await registering
        events.length = 0
        return { module, interaction: make(first.client) }
      }

      it.each([
        ['a send', picked, 'deferReply', false],
        ['a send', picked, 'deferReply', true],
        ['a private send', hushed, 'deferReply private', false],
        ['a private send', hushed, 'deferReply private', true],
      ] as const)("under @Defer({ mode: 'auto' }), %s from outside at 500 ms is acknowledged at 1.5 s, then edits it (strict mocks: %s)", async (_label, payload, acknowledged, strict) => {
        if (strict) useStrictMocks()
        vi.useFakeTimers()
        const { module, interaction } = await registeredSlow(client => createMockInteraction(ChatInputCommandInteraction, { commandName: 'later', client } as never))

        const handled = module.dispatch(interaction as never)
        await vi.advanceTimersByTimeAsync(500)
        const answered = respond(interaction as never).send(payload)
        await vi.advanceTimersByTimeAsync(1_000)
        expect(privacy(interaction)).toEqual([acknowledged])
        await vi.advanceTimersByTimeAsync(2_000)
        await Promise.all([handled, answered])
        expect(privacy(interaction)).toEqual([acknowledged, 'editReply'])
      })

      it.each([false, true])("under @Defer({ mode: 'auto' }), a click answered from outside at 500 ms is acknowledged at 1.5 s, then edited (strict mocks: %s)", async strict => {
        if (strict) useStrictMocks()
        vi.useFakeTimers()
        const { module, interaction: click } = await registeredSlow(client => {
          const message = createMockMessage() as unknown as Record<string, unknown>
          const row = { type: 1, components: [{ type: 2, style: 1, custom_id: 'go', label: 'Go' }] }
          Object.assign(message, { flags: new MessageFlagsBitField(0), embeds: [], components: [{ toJSON: () => row }] })
          return createMockInteraction(ButtonInteraction, { customId: 'go', message, client } as never)
        })

        const handled = module.dispatch(click as never)
        await vi.advanceTimersByTimeAsync(500)
        const answered = respond(click as never).send({ content: 'hi', components: [] })
        await vi.advanceTimersByTimeAsync(1_000)
        expect(edits(click)).toEqual(['deferUpdate'])
        await vi.advanceTimersByTimeAsync(2_000)
        await Promise.all([handled, answered])
        expect(edits(click)).toEqual(['deferUpdate', 'editReply hi'])
      })
    })

    it.each(['a private send', 'a private followUp', "a UserError's error, private by default"] as const)(
      "under @Defer({ mode: 'auto' }), %s whose acknowledgement fails replies privately at the 2 s bound",
      async answer => {
        vi.useFakeTimers()
        const module = compile(notes)
        const ready = module.init({ ready: true })
        await vi.advanceTimersByTimeAsync(0)
        const interaction = slash('later')
        interaction.deferReply.mockRejectedValueOnce(new Error('acknowledgement failed'))

        const handled = module.dispatch(interaction).catch(() => undefined)
        await vi.advanceTimersByTimeAsync(1_400)
        const answered = answers[answer](interaction)
        await vi.advanceTimersByTimeAsync(READY_WAIT_INTERACTION_MS - 1_400)
        await answered
        expect(privacy(interaction)).toEqual(['deferReply private', 'reply private'])
        expect(lookupWarnings()).toEqual([lookupWarning])

        hook('Prefs').settle()
        await Promise.all([ready, handled])
      },
    )

    it("under @Defer({ mode: 'auto' }) whose acknowledgement fails, is sent at the 2 s bound from its creation, with the lookup warning", async () => {
      vi.useFakeTimers()
      const module = compile(notes)
      const ready = module.init({ ready: true })
      await vi.advanceTimersByTimeAsync(0)
      const interaction = slash('later')
      interaction.deferReply.mockRejectedValueOnce(new Error('acknowledgement failed'))

      const handled = module.dispatch(interaction).catch(() => undefined)
      await vi.advanceTimersByTimeAsync(500)
      const answered = respond(interaction as never).send(picked)
      await vi.advanceTimersByTimeAsync(READY_WAIT_INTERACTION_MS - 500 - 1)
      expect(calls(interaction)).toEqual(['deferReply'])
      await vi.advanceTimersByTimeAsync(1)
      await answered
      expect(calls(interaction)).toEqual(['deferReply', 'reply'])
      expect(lookupWarnings()).toEqual([lookupWarning])

      hook('Prefs').settle()
      await Promise.all([ready, handled])
    })

    it.each([
      [1_400, 2_000, false],
      [500, 2_000, false],
      [2_400, 2_400, false],
      [1_400, 2_000, true],
    ] as const)('without @Defer, answered at %i ms, is sent at %i ms from its creation, with the lookup warning (strict mocks: %s)', async (answerAt, sentAt, strict) => {
      if (strict) useStrictMocks()
      vi.useFakeTimers()
      const { module, interaction } = await registered('quick')
      const ready = module.init({ ready: true })

      await vi.advanceTimersByTimeAsync(answerAt)
      const answered = respond(interaction as never).send(picked)
      await vi.advanceTimersByTimeAsync(Math.max(0, sentAt - answerAt - 1))
      if (sentAt > answerAt) expect(calls(interaction)).toEqual([])
      await vi.advanceTimersByTimeAsync(sentAt > answerAt ? 1 : 0)
      await answered
      expect([calls(interaction), warned]).toEqual([['reply'], [lookupWarning]])

      hook('Prefs').settle()
      await ready
    })

    it.each(['acknowledged by eager @Defer', 'replied'] as const)('%s, waits for the hooks with no bound and no warning', async how => {
      vi.useFakeTimers()
      const { module, interaction } = await registered('notes')
      const ready = module.init({ ready: true })
      await vi.advanceTimersByTimeAsync(0)
      // The mock's note on what reply() resolves to is not a warning of this framework's
      const handled = how === 'replied' ? interaction.reply('raw').then(() => void warned.splice(0)) : module.dispatch(interaction)
      await vi.advanceTimersByTimeAsync(1_000)
      const before = calls(interaction)

      const answered = respond(interaction as never).followUp(picked)
      await vi.advanceTimersByTimeAsync(3_000)
      expect([calls(interaction), warned]).toEqual([before, []])

      hook('Prefs').settle()
      await Promise.all([ready, handled, answered])
      expect(calls(interaction)).toHaveLength(before.length + 1)
      expect(warned).toEqual([])
    })

    it('waits no more than 2 s for an interaction whose creation time is ahead of the clock', async () => {
      vi.useFakeTimers()
      const { module, interaction } = await registered('quick')
      aheadOfTheClock(interaction)
      const ready = module.init({ ready: true })

      const answered = respond(interaction as never).send(picked)
      await vi.advanceTimersByTimeAsync(READY_WAIT_INTERACTION_MS - 1)
      expect(calls(interaction)).toEqual([])
      await vi.advanceTimersByTimeAsync(1)
      await answered
      expect(calls(interaction)).toEqual(['reply'])
      expect(warned).toEqual([lookupWarning.replace('2.0 s after the interaction was created', 'after waiting 2.0 s')])

      hook('Prefs').settle()
      await ready
    })

    it('counts the bound from when it is answered for an interaction with no creation time', async () => {
      vi.useFakeTimers()
      const { module, interaction } = await registered('quick')
      Object.defineProperty(interaction, 'createdTimestamp', { value: NaN, configurable: true })
      const ready = module.init({ ready: true })

      await vi.advanceTimersByTimeAsync(1_400)
      const answered = respond(interaction as never).send(picked)
      await vi.advanceTimersByTimeAsync(2_000 - 1)
      expect(calls(interaction)).toEqual([])
      await vi.advanceTimersByTimeAsync(1)
      await answered
      expect(calls(interaction)).toEqual(['reply'])
      expect(warned).toEqual([lookupWarning.replace('2.0 s after the interaction was created', 'after waiting 2.0 s')])

      hook('Prefs').settle()
      await ready
    })
  })

  // Under @Defer({ mode: 'auto' }) the acknowledgement is under way from the call's start, so the call waits for its outcome
  it.each([
    ['later', 'at 1.5 s', 'ok', undefined],
    ['later', 'at 1.5 s', 'fails', READY_WAIT_INTERACTION_MS],
    ['latest', 'at 2.5 s, past the bound', 'ok', undefined],
    ['latest', 'at 2.5 s, past the bound', 'fails', 2500],
  ] as const)("runs /%s, acknowledged by @Defer({ mode: 'auto' }) %s, which %s, as Discord was told", async (command, _when, outcome, at) => {
    vi.useFakeTimers()
    const module = compile({ waitForReady: true, services: [], controllers: [Notes], extra: { themeFor: PrefsThemes } })
    const ready = module.init({ ready: true })
    await vi.advanceTimersByTimeAsync(0)

    const handled = module.dispatch(acknowledgedAfter(command, 0, outcome))
    if (at === undefined) {
      await vi.advanceTimersByTimeAsync(READY_WAIT_INTERACTION_MS * 5)
      expect(events).toEqual(['Prefs begins'])
      hook('Prefs').settle()
      await Promise.all([ready, handled])
      expect(events).toEqual(['Prefs begins', 'Prefs ready', 'themes asked', `${command} runs`])
      expect(warned).toEqual([])
      return
    }
    await vi.advanceTimersByTimeAsync(at - 1)
    expect(events).toEqual(['Prefs begins'])
    await vi.advanceTimersByTimeAsync(1)
    await handled
    expect(events).toEqual(['Prefs begins', 'themes asked', `${command} runs`])
    expect(warned.filter(text => text.includes('Prefs'))).toEqual([expect.stringContaining('PrefsThemes looked up a theme before onReady in Prefs')])
    hook('Prefs').settle()
    await ready
  })

  it("runs a call without @Defer at its 2 s bound, its theme looked up within the same bound", async () => {
    vi.useFakeTimers()
    const module = compile({ waitForReady: true, services: [], controllers: [Notes], extra: { themeFor: PrefsThemes } })
    const ready = module.init({ ready: true })
    await vi.advanceTimersByTimeAsync(0)

    const handled = module.dispatch(slash('quick'))
    await vi.advanceTimersByTimeAsync(READY_WAIT_INTERACTION_MS - 1)
    expect(events).toEqual(['Prefs begins'])
    await vi.advanceTimersByTimeAsync(1)
    await handled

    expect(events).toEqual(['Prefs begins', 'themes asked', 'quick runs'])
    hook('Prefs').settle()
    await ready
  })

  it("looks a theme up only once the resolver's own onReady has settled", async () => {
    @Service()
    class SelfThemes implements OnReady {
      onReady() {
        return hook('Themes').run()
      }
      user() {
        events.push('themes asked')
        return { colors: { primary: '#0000D1' as const } }
      }
    }
    const module = compile({ waitForReady: true, services: [], controllers: [Notes], extra: { themeFor: SelfThemes } })
    const ready = module.init({ ready: true })
    await hook('Themes').began.promise

    const handled = module.dispatch(slash('nothere')).catch(() => undefined)
    await tick()
    expect(events).toEqual(['Themes begins'])

    hook('Themes').settle()
    await Promise.all([ready, handled])
    expect(events).toEqual(['Themes begins', 'Themes ready', 'themes asked'])
  })

  it("holds a call for the hook of the resolver's dependency, ordered after the call's own class", async () => {
    const module = compile({ waitForReady: true, services: [Listener], controllers: [Notes], extra: { themeFor: PrefsThemes } })
    const ready = module.init({ ready: true })
    await hook('Prefs').began.promise

    const handled = module.emit('messageCreate', createMockMessage({ content: 'hello' }))
    await tick()
    expect(events).toEqual(['Prefs begins'])

    hook('Prefs').settle()
    await Promise.all([ready, handled])
    expect(events).toEqual(['Prefs begins', 'Prefs ready', 'themes asked', 'event runs'])
  })
})

describe('a call without waitForReady', () => {
  it.each([
    ['off', { waitForReady: false }],
    ['unset', {}],
  ] as const)('runs at once while the hooks run, with it %s', async (_label, options) => {
    const module = compile(options)
    const ready = module.init({ ready: true })
    await hook('Cache').began.promise

    await module.dispatch(createMockMessage({ content: 'price' }))
    expect(events).toEqual(['Cache begins', 'message runs'])

    hook('Cache').settle()
    await ready
  })

  it('waits for nothing in a testing module whose hooks never ran', async () => {
    await compile({ waitForReady: true }).dispatch(slash('price'))

    expect(events).toEqual(['price runs'])
  })

  // The microtask at which a call reaches its guard and its handler, counted from dispatch(): the option adds none
  it.each([
    ['plain', false, { guard: 1, handler: 6 }],
    ['deferred', true, { guard: 15, handler: 26 }],
  ] as const)('reaches its guard and handler on the same microtasks as without the option, %s', async (_label, deferred, expected) => {
    let at = 0
    const seen: { guard?: number; handler?: number } = {}
    @Guard()
    class Pass {
      canActivate() {
        seen.guard ??= at
        return true
      }
    }
    class Ping {
      async ping(interaction: ChatInputCommandInteraction) {
        seen.handler ??= at
        await (deferred ? interaction.editReply({ content: 'pong' }) : interaction.reply({ content: 'pong' }))
      }
    }
    // Applied innermost first, as `@Command @UseGuard @Defer` on the method would be
    const decorators = [...(deferred ? [Defer({ mode: 'eager' })] : []), UseGuard(Pass), Command('ping', CommandType.SLASH)]
    for (const decorate of decorators) decorate(Ping.prototype, 'ping', Object.getOwnPropertyDescriptor(Ping.prototype, 'ping')!)
    Controller()(Ping)
    @MeoCord({ controllers: [Ping], clientOptions: { intents: [] } })
    class App {}
    const module = await MeoCordTestingModule.create({ app: App, controllers: [Ping] }).compile().init({ ready: true })
    const once = async () => {
      at = 0
      delete seen.guard
      delete seen.handler
      const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName: 'ping' })
      const handled = module.dispatch(Object.assign(interaction, { options: createChatInputOptions({}) }))
      for (; at < 100; at++) await Promise.resolve()
      await handled
      return { ...seen }
    }
    await once()

    expect(await once()).toEqual(expected)
  })
})

describe("a call its @Command handler can't take, unless a gate holds it", () => {
  @Guard()
  class Deny implements GuardInterface {
    canActivate() {
      events.push('guard runs')
      return false
    }
  }

  @Pipe()
  class Note implements PipeInterface<string, string> {
    transform(value: string) {
      events.push(`pipe given ${value}`)
      return value
    }
  }

  @Controller()
  class Staged {
    @Command('locked', CommandType.SLASH)
    @UseGuard(Deny)
    locked() {
      events.push('locked runs')
    }

    @Command('piped', CommandType.SLASH)
    @UsePipe('word', Note)
    piped(_interaction: ChatInputCommandInteraction, _params: { word: string }) {
      events.push('piped runs')
    }
  }

  // As without the gate: its guards and pipes run first, and the handler refuses what reaches it
  it.each([
    ['off', { waitForReady: false }, false],
    ['unset', {}, false],
    ['on, with the hooks settled', { waitForReady: true }, true],
  ] as const)('runs its stages first, with waitForReady %s', async (_label, options, init) => {
    const module = compile({ ...options, services: [], controllers: [Staged] })
    if (init) await module.init({ ready: true })

    await expect(module.invoke(Staged, 'locked', {} as never)).resolves.toEqual({ ran: false })
    expect(events).toEqual(['guard runs'])

    events.length = 0
    // A wrong first argument beside params, which invoke's types don't allow
    const invokeWith = module.invoke.bind(module) as (...args: unknown[]) => Promise<unknown>
    await expect(invokeWith(Staged, 'piped', {}, { word: 'tea' })).rejects.toThrow(
      "Staged.piped: @Command('piped', CommandType.SLASH) takes a ChatInputCommandInteraction",
    )
    expect(events).toEqual(['pipe given tea'])
  })
})

describe('@MeoCord({ waitForReady })', () => {
  it('takes only true or false', () => {
    expect(() => compile({ waitForReady: 'yes' as never })).toThrow('App: @MeoCord({ waitForReady }) takes true or false.')
  })
})
