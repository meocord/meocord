import { ChatInputCommandInteraction } from 'discord.js'
import { inject } from 'inversify'
import { bindTheme, Logger, respond, useTheme } from '@src/common/index.js'
import { Catch, Command, Controller, Defer, Guard, MeoCord, Observer, Service, UseGuard } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { type DispatchObserver, type ExceptionFilter, type GuardInterface, type OnReady } from '@src/interface/index.js'
import { createMockInteraction, MeoCordTestingModule } from '@src/testing/index.js'

// When themeFor's resolver is asked, against what else a call runs: after the observers' onStart and a bound
// function's synchronous part, before @Defer's first step, the guards and the handler

const GUILD = '100000000000000001'
const SERVER = { colors: { primary: '#00000D' } } as const
/** MeoCord's default primary colour: the theme of an app with none of its own. */
const DEFAULT_PRIMARY = '#7680F4'
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0))

const order: string[] = []
/** Whether the first observer's onStart throws, and whether it answers, set by each test. */
let throwing = false
let answering = false
let bound: ((interaction: unknown) => void) | undefined

@Observer()
class First implements DispatchObserver {
  onStart(context: { getInteraction(): unknown }) {
    order.push(`onStart reads ${useTheme().colors.primary}`)
    if (answering) void respond(context.getInteraction() as ChatInputCommandInteraction).send({ embeds: [{ description: 'from onStart' }] })
    if (throwing) throw new Error('observer down')
  }
  onSettled() {
    order.push('onSettled')
  }
}

@Observer()
class Second implements DispatchObserver {
  async onStart() {
    order.push('second onStart')
    await tick()
    order.push(`second onStart after await reads ${useTheme().colors.primary}`)
  }
  onSettled() {}
}

@Guard()
class Recording implements GuardInterface {
  canActivate() {
    order.push('guard')
    return true
  }
}

@Catch()
class Unrouted implements ExceptionFilter {
  catch() {
    order.push(`filter reads ${useTheme().colors.primary}`)
  }
}

@Controller()
class Calls {
  @Defer()
  @UseGuard(Recording)
  @Command('eager', CommandType.SLASH)
  eager() {
    order.push('handler')
  }

  @Defer({ mode: 'auto' })
  @UseGuard(Recording)
  @Command('auto', CommandType.SLASH)
  auto() {
    order.push('handler')
  }

  @UseGuard(Recording)
  @Command('plain', CommandType.SLASH)
  plain() {
    order.push('handler')
    bound = bindTheme(() => order.push(`listener reads ${useTheme().colors.primary}`))
  }
}

const resolvers = {
  'answers with a value': () => (order.push('resolver'), SERVER),
  'answers through a promise': async () => (order.push('resolver'), SERVER),
  'throws': () => {
    order.push('resolver')
    throw new Error('themes down')
  },
} as const
const kinds = Object.keys(resolvers) as (keyof typeof resolvers)[]
/** What a call reads once its lookup is over: the server's theme, or the handler's when the resolver failed. */
const found = (kind: keyof typeof resolvers) => (kind === 'throws' ? DEFAULT_PRIMARY : SERVER.colors.primary)

let settle: () => void = () => undefined
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
    order.push('resolver')
    return SERVER
  }
}

function compile(themeFor: object, extra: object = {}) {
  @MeoCord({ controllers: [Calls], observers: [First, Second], filters: [Unrouted], clientOptions: { intents: [] }, themeFor, ...extra } as never)
  class App {}
  return MeoCordTestingModule.fromApp(App).compile()
}

/** A slash command whose first Discord calls are recorded in the order. */
function slash(commandName: string, userId?: string) {
  const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName, guildId: GUILD } as never)
  if (userId) Object.assign(interaction.user, { id: userId })
  for (const method of ['deferReply', 'reply'] as const) {
    const call = interaction[method].bind(interaction) as (...args: unknown[]) => unknown
    Object.assign(interaction, { [method]: (...args: unknown[]) => (order.push(method), call(...args)) })
  }
  return interaction
}

async function dispatched(module: ReturnType<typeof compile>, interaction: object) {
  order.push('dispatch')
  await module.dispatch(interaction as never).catch(() => undefined)
  await tick()
  return order.join(' > ')
}

beforeEach(() => {
  order.length = 0
  throwing = false
  answering = false
  bound = undefined
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe("a call's lookup through themeFor", () => {
  describe.each(kinds)('with a resolver that %s', kind => {
    const after = `second onStart after await reads ${found(kind)} > onSettled`

    it.each([
      ['eager', '@Defer()', 'deferReply > guard > handler'],
      ['auto', "@Defer({ mode: 'auto' })", 'guard > handler'],
      ['plain', 'no @Defer', 'guard > handler'],
    ] as const)('asks it after the observers start, before %s and %s', async (commandName, _defer, rest) => {
      expect(await dispatched(compile({ guild: resolvers[kind] }), slash(commandName))).toBe(
        `dispatch > onStart reads ${DEFAULT_PRIMARY} > second onStart > resolver > ${rest} > ${after}`,
      )
    })

    it('asks it when an observer throws as it starts', async () => {
      throwing = true
      expect(await dispatched(compile({ guild: resolvers[kind] }), slash('eager'))).toBe(
        `dispatch > onStart reads ${DEFAULT_PRIMARY} > second onStart > resolver > deferReply > guard > handler > ${after}`,
      )
    })

    // The answer waits for the theme, so it goes out where it does on a9611dc9 with the theme cached: after the guard
    it("asks it before an onStart answer's own step runs, which then answers once the guard has run", async () => {
      answering = true
      expect(await dispatched(compile({ guild: resolvers[kind] }), slash('plain'))).toBe(
        `dispatch > onStart reads ${DEFAULT_PRIMARY} > second onStart > resolver > guard > reply > handler > ${after}`,
      )
    })

    it('asks it for a call no route takes before its filters run', async () => {
      expect(await dispatched(compile({ guild: resolvers[kind] }), slash('nothing'))).toBe(`dispatch > resolver > filter reads ${found(kind)} > onSettled`)
    })

    it("asks it for a function bindTheme wraps once the function's synchronous part has returned", async () => {
      // A user resolver, so the listener's lookup for another member isn't the call's, already cached
      const module = compile({ user: resolvers[kind] })
      await module.dispatch(slash('plain'))
      await tick()
      order.length = 0
      order.push('listener called')
      bound!(slash('plain', '200000000000000099'))
      order.push('listener returned')
      await tick()

      expect(order.join(' > ')).toBe(`listener called > listener reads ${DEFAULT_PRIMARY} > listener returned > resolver`)
    })

    it('asks it for an answer outside any call once respond() has returned', async () => {
      const module = compile({ user: resolvers[kind] })
      const first = slash('plain')
      await module.dispatch(first)
      await tick()
      order.length = 0
      const other = createMockInteraction(ChatInputCommandInteraction, { commandName: 'plain', guildId: GUILD, client: first.client } as never)
      Object.assign(other.user, { id: '200000000000000098' })
      order.push('respond called')
      const sent = respond(other).send({ embeds: [{ description: 'outside' }] }).catch(() => undefined)
      order.push('respond returned')
      await sent

      expect(order.join(' > ')).toBe('respond called > respond returned > resolver')
    })
  })

  it("asks nothing for a theme cached for the server and the user, which onStart reads at once", async () => {
    const module = compile({ guild: resolvers['answers with a value'] })
    await module.dispatch(slash('plain'))
    await tick()
    order.length = 0

    expect(await dispatched(module, slash('eager'))).toBe(
      `dispatch > onStart reads ${SERVER.colors.primary} > second onStart > deferReply > guard > handler > second onStart after await reads ${SERVER.colors.primary} > onSettled`,
    )
  })

  it('lets an onStart answer go out after the guard with the theme cached, as it does once a lookup is over', async () => {
    const module = compile({ guild: resolvers['answers with a value'] })
    await module.dispatch(slash('plain'))
    await tick()
    order.length = 0
    answering = true

    expect(await dispatched(module, slash('plain'))).toBe(
      `dispatch > onStart reads ${SERVER.colors.primary} > second onStart > guard > reply > handler > second onStart after await reads ${SERVER.colors.primary} > onSettled`,
    )
  })

  it("asks only for the user's theme when the server's is cached, and onStart reads the handler's until both are in", async () => {
    const module = compile({ guild: resolvers['answers with a value'], user: () => (order.push('user resolver'), { colors: { info: '#00000E' } }) })
    await module.dispatch(slash('plain'))
    await tick()
    order.length = 0

    expect(await dispatched(module, slash('eager', '200000000000000097'))).toBe(
      `dispatch > onStart reads ${DEFAULT_PRIMARY} > second onStart > user resolver > deferReply > guard > handler > second onStart after await reads ${SERVER.colors.primary} > onSettled`,
    )
  })

  it("asks it under waitForReady once the resolver's hook settles", async () => {
    const module = compile(PrefsThemes, { services: [Prefs], waitForReady: true })
    const ready = module.init({ ready: true })
    await tick()
    order.push('dispatch')
    const handled = module.dispatch(slash('eager')).catch(() => undefined)
    await tick()
    order.push('hook settles')
    settle()
    await Promise.all([handled, ready])
    await tick()

    expect(order.join(' > ')).toBe(
      `dispatch > onStart reads ${DEFAULT_PRIMARY} > second onStart > deferReply > hook settles > resolver > guard > handler > second onStart after await reads ${SERVER.colors.primary} > onSettled`,
    )
  })
})

describe("a call's server and user", () => {
  /** Counts each read of an interaction's server and user id, the two values its theme lookup takes from it. */
  function counted(interaction: ChatInputCommandInteraction) {
    const reads = { guildId: 0, userId: 0 }
    const { guildId, user } = interaction
    const { id } = user
    Object.defineProperty(interaction, 'guildId', { get: () => (reads.guildId++, guildId) })
    Object.defineProperty(user, 'id', { get: () => (reads.userId++, id) })
    return reads
  }

  it.each([
    ['looked up in a microtask', false],
    ['all cached', true],
  ] as const)('are read once for a call whose themes are %s', async (_how, cached) => {
    const module = compile({ guild: resolvers['answers through a promise'], user: resolvers['answers with a value'] })
    const member = '200000000000000095'
    if (cached) await dispatched(module, slash('plain', member))
    order.length = 0
    const interaction = slash('plain', member)
    const reads = counted(interaction)

    expect(await dispatched(module, interaction)).toContain(`second onStart after await reads ${SERVER.colors.primary}`)
    expect(order.includes('resolver')).toBe(!cached)
    expect(reads).toEqual({ guildId: 1, userId: 1 })
  })

  it("are read once for a call under waitForReady whose lookup waits for the resolver's hook", async () => {
    const module = compile(PrefsThemes, { services: [Prefs], waitForReady: true })
    const ready = module.init({ ready: true })
    await tick()
    const interaction = slash('plain')
    const reads = counted(interaction)
    const handled = module.dispatch(interaction).catch(() => undefined)
    await tick()
    order.push('hook settles')
    settle()
    await Promise.all([handled, ready])
    await tick()

    expect(order.slice(order.indexOf('hook settles'), order.indexOf('hook settles') + 2)).toEqual(['hook settles', 'resolver'])
    expect(reads).toEqual({ guildId: 1, userId: 1 })
  })

  it('are read once for an answer outside any call', async () => {
    const module = compile({ user: resolvers['answers through a promise'] })
    const first = slash('plain')
    await module.dispatch(first)
    await tick()
    order.length = 0
    const other = createMockInteraction(ChatInputCommandInteraction, { commandName: 'plain', guildId: GUILD, client: first.client } as never)
    Object.assign(other.user, { id: '200000000000000096' })
    const reads = counted(other)
    await respond(other).send({ embeds: [{ description: 'outside' }] }).catch(() => undefined)

    expect(order).toEqual(['resolver'])
    expect(reads).toEqual({ guildId: 1, userId: 1 })
  })
})
