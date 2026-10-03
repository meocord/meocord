import { vi } from 'vitest'
import { ButtonInteraction, resolveColor } from 'discord.js'
import { Command, Controller, Guard, Inject, MeoCord, Service, UseGuard } from '@src/decorator/index.js'
import { ExecutionContext, Logger, respond, ThemeCache, useTheme } from '@src/common/index.js'
import { CommandType } from '@src/enum/index.js'
import {
  type GuildThemeTarget,
  type ResponsePresenter,
  type ResponseView,
  type ThemeOverride,
  type ThemeResolver,
  type ThemeResolvers,
  type UserThemeTarget,
} from '@src/interface/index.js'
import { DEFAULT_THEME } from '@src/core/theme-defaults.js'
import { createMockInteraction, MeoCordTestingModule } from '@src/testing/index.js'

const GUILD = '100000000000000001'
const OTHER_GUILD = '100000000000000002'
const USER = '200000000000000001'
const { primary: PRIMARY, info: INFO } = DEFAULT_THEME.colors
const seen: unknown[][] = []

/** A button pressed by `userId` in `guildId`. */
function press(customId: string, { guildId = GUILD, userId = USER }: { guildId?: string; userId?: string } = {}) {
  const interaction = createMockInteraction(ButtonInteraction, { customId })
  Object.assign(interaction, { guildId })
  Object.assign(interaction.user, { id: userId })
  return interaction
}

/** The primary and info colours each handler call saw. */
const handled = () => seen.filter(([where]) => where === 'handler').map(([, primary, info]) => [primary, info])

@Controller()
class Panel {
  @Command('panel', CommandType.BUTTON)
  panel() {
    seen.push(['handler', useTheme().colors.primary, useTheme().colors.info])
  }
}

beforeEach(() => {
  seen.length = 0
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

/** What a lookup answers for a server or user: part of a theme, none, a failure, or no answer at all. */
type Answer = ThemeOverride | null | undefined | Error | 'never'

/** The answers each test sets, and the lookups the resolvers were asked for, as `guild <id>` or `user <id>`. */
class Lookups {
  readonly guilds = new Map<string, Answer>()
  readonly users = new Map<string, Answer>()
  readonly asked: string[] = []

  answer(kind: 'guild' | 'user', id: string): ThemeOverride | null | undefined | Promise<ThemeOverride> {
    this.asked.push(`${kind} ${id}`)
    const answer = (kind === 'guild' ? this.guilds : this.users).get(id)
    if (answer instanceof Error) throw answer
    return answer === 'never' ? new Promise<ThemeOverride>(() => {}) : answer
  }
}
const LOOKUPS = 'lookups'

@Service()
class LookupThemes implements ThemeResolver {
  constructor(@Inject(LOOKUPS) private readonly lookups: Lookups) {}
  guild({ guild }: GuildThemeTarget) {
    return this.lookups.answer('guild', guild.id)
  }
  user({ user }: UserThemeTarget) {
    return this.lookups.answer('user', user.id)
  }
}

/** The app's `themeFor` in each form, reading `lookups`: functions over it, or a class that injects it. */
const FORMS: [string, (lookups: Lookups) => ThemeResolvers | typeof LookupThemes][] = [
  ['functions', lookups => ({ guild: ({ guild }) => lookups.answer('guild', guild.id), user: ({ user }) => lookups.answer('user', user.id) })],
  ['a ThemeResolver class', () => LookupThemes],
]

/** A module of an app whose `themeFor` is `form`'s, reading a fresh `Lookups`, with the app's other options. */
function moduleOf(form: (lookups: Lookups) => ThemeResolvers | typeof LookupThemes, options: object = {}) {
  const lookups = new Lookups()
  @MeoCord({ controllers: [Panel], clientOptions: { intents: [] }, themeFor: form(lookups), providers: [{ provide: LOOKUPS, useValue: lookups }], ...options } as never)
  class App {}
  return { lookups, module: MeoCordTestingModule.fromApp(App).compile() }
}

describe.each(FORMS)('themeFor as %s', (_form, form) => {
  it('asks once per server and user, serves the answer from the cache after, and asks a server it has not seen', async () => {
    const { lookups, module } = moduleOf(form)
    lookups.guilds.set(GUILD, { colors: { primary: '#0000F1' } })
    lookups.users.set(USER, { colors: { info: '#0000F2' } })

    await module.invoke(Panel, 'panel', press('panel'))
    await module.invoke(Panel, 'panel', press('panel'))
    await module.invoke(Panel, 'panel', press('panel', { guildId: OTHER_GUILD }))

    expect(lookups.asked).toEqual([`guild ${GUILD}`, `user ${USER}`, `guild ${OTHER_GUILD}`])
    expect(handled()).toEqual([
      ['#0000F1', '#0000F2'],
      ['#0000F1', '#0000F2'],
      [PRIMARY, '#0000F2'],
    ])
  })

  it('asks again once an answer is older than ttlSeconds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] })
    const { lookups, module } = moduleOf(form, { themeCache: { ttlSeconds: 60 } })

    await module.invoke(Panel, 'panel', press('panel'))
    vi.advanceTimersByTime(59_000)
    await module.invoke(Panel, 'panel', press('panel'))
    vi.advanceTimersByTime(2_000)
    await module.invoke(Panel, 'panel', press('panel'))

    expect(lookups.asked).toEqual([`guild ${GUILD}`, `user ${USER}`, `guild ${GUILD}`, `user ${USER}`])
  })

  it("asks again for a user or a server once ThemeCache forgets its answer, and only for it", async () => {
    const { lookups, module } = moduleOf(form)
    await module.invoke(Panel, 'panel', press('panel'))
    module.themeCache.invalidateUser(USER)
    await module.invoke(Panel, 'panel', press('panel'))
    module.themeCache.invalidateGuild(GUILD)
    await module.invoke(Panel, 'panel', press('panel'))

    expect(lookups.asked).toEqual([`guild ${GUILD}`, `user ${USER}`, `user ${USER}`, `guild ${GUILD}`])
  })

  it('gives up on a lookup after themeForTimeoutMs, logging it, and the call goes on without its theme', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] })
    const errors = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {})
    const { lookups, module } = moduleOf(form, { themeForTimeoutMs: 20 })
    lookups.guilds.set(GUILD, 'never')
    lookups.users.set(USER, { colors: { info: '#0000F3' } })

    const call = module.invoke(Panel, 'panel', press('panel'))
    await vi.advanceTimersByTimeAsync(20)
    await call

    expect(handled()).toEqual([[PRIMARY, '#0000F3']])
    expect(errors.mock.calls).toEqual([[expect.stringContaining(`themeFor.guild for guild ${GUILD} did not answer within 20 ms`)]])
  })

  it('leaves out a failing lookup, is not asked again during the backoff, and logs each target once until it answers', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] })
    const errors = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {})
    const logs = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {})
    const { lookups, module } = moduleOf(form)
    lookups.users.set(USER, new Error('database down'))

    await module.invoke(Panel, 'panel', press('panel'))
    await module.invoke(Panel, 'panel', press('panel'))
    vi.advanceTimersByTime(10_001)
    await module.invoke(Panel, 'panel', press('panel'))
    vi.advanceTimersByTime(10_001)
    lookups.users.set(USER, { colors: { info: '#0000F4' } })
    await module.invoke(Panel, 'panel', press('panel'))

    expect(lookups.asked.filter(lookup => lookup.startsWith('user'))).toHaveLength(3)
    expect(handled()).toEqual([
      [PRIMARY, INFO],
      [PRIMARY, INFO],
      [PRIMARY, INFO],
      [PRIMARY, '#0000F4'],
    ])
    expect(errors.mock.calls).toEqual([[expect.stringContaining(`themeFor.user for user ${USER} failed: database down`)]])
    expect(logs.mock.calls.filter(([text]) => String(text).includes('answers again'))).toEqual([
      [expect.stringContaining(`themeFor.user for user ${USER} answers again, after 2 failed lookup(s)`)],
    ])
  })

  it('leaves out an answer that is not a valid theme, warning once for its server until it is valid', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] })
    const warnings = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {})
    const { lookups, module } = moduleOf(form, { themeCache: { ttlSeconds: 1 } })
    lookups.guilds.set(GUILD, { colors: { primary: 'blue' as `#${string}`, info: '#0000F5' } })

    await module.invoke(Panel, 'panel', press('panel'))
    vi.advanceTimersByTime(1_001)
    await module.invoke(Panel, 'panel', press('panel'))

    expect(lookups.asked.filter(lookup => lookup.startsWith('guild'))).toHaveLength(2)
    expect(handled()).toEqual([
      [PRIMARY, INFO],
      [PRIMARY, INFO],
    ])
    expect(warnings.mock.calls).toEqual([[expect.stringContaining(`themeFor.guild for guild ${GUILD}`)]])
  })

  it('reads null and undefined as no theme, warning about neither', async () => {
    const warnings = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {})
    const { lookups, module } = moduleOf(form)
    lookups.guilds.set(GUILD, null)

    await module.invoke(Panel, 'panel', press('panel'))

    expect(handled()).toEqual([[PRIMARY, INFO]])
    expect(warnings).not.toHaveBeenCalled()
  })
})

describe('a ThemeResolver class', () => {
  @Service()
  class Palettes {
    readonly byUser = new Map<string, `#${string}`>([[USER, '#0000E1']])
  }

  /** Reads a user's colour from the service it injects by its type, and a server's from the value provided as 'servers'. */
  @Service()
  class StoredThemes implements ThemeResolver {
    constructor(
      readonly palettes: Palettes,
      @Inject('servers') readonly servers: Map<string, `#${string}`>,
    ) {}
    guild({ guild }: GuildThemeTarget) {
      const primary = this.servers.get(guild.id)
      return primary && { colors: { primary } }
    }
    user({ user }: UserThemeTarget) {
      const info = this.palettes.byUser.get(user.id)
      return info && { colors: { info } }
    }
  }
  Reflect.defineMetadata('design:paramtypes', [Palettes, Map], StoredThemes)

  const SERVERS = { provide: 'servers', useValue: new Map([[GUILD, '#0000E2']]) }
  const appWith = (themeFor: unknown, options: object = {}) => {
    @MeoCord({ controllers: [Panel], clientOptions: { intents: [] }, themeFor, providers: [SERVERS], ...options } as never)
    class App {}
    return App
  }

  it('gets a provider and a service it injects, which reach guild() and user()', async () => {
    const module = MeoCordTestingModule.fromApp(appWith(StoredThemes)).compile()
    await module.invoke(Panel, 'panel', press('panel'))

    expect(handled()).toEqual([['#0000E2', '#0000E1']])
    expect(module.get(StoredThemes).palettes).toBe(module.get(Palettes))
  })

  it.each([
    ['only user()', 'user', [PRIMARY, '#0000E3']],
    ['only guild()', 'guild', ['#0000E3', INFO]],
  ] as const)('with %s is asked for that alone', async (_has, kind, colours) => {
    const asked: string[] = []
    const Resolver = {
      user: class implements ThemeResolver {
        user() {
          asked.push('user')
          return { colors: { info: '#0000E3' as const } }
        }
      },
      guild: class implements ThemeResolver {
        guild() {
          asked.push('guild')
          return { colors: { primary: '#0000E3' as const } }
        }
      },
    }[kind]
    const module = MeoCordTestingModule.fromApp(appWith(Resolver)).compile()
    await module.invoke(Panel, 'panel', press('panel'))

    expect(asked).toEqual([kind])
    expect(handled()).toEqual([colours])
  })

  it.each([
    ['methods of other names', class Other { server() {} }, ''],
    ['arrow-function properties only', class Arrows { user = () => undefined }, ' Declare them as methods: arrow-function properties are not on the class.'],
  ])('with neither method, declaring %s, is refused in one line', (_declaring, Resolver, hint) => {
    expect(() => appWith(Resolver)).toThrow(
      new TypeError(`App: @MeoCord({ themeFor }): ${Resolver.name} has neither a guild() nor a user() method, so it gives no theme.${hint}`),
    )
  })

  it('with neither method is refused by overrideThemeFor too, and a function is refused where the app is declared', () => {
    class Empty {}
    expect(() => appWith(() => ({ colors: { primary: '#0000E4' } }))).toThrow(
      'App: @MeoCord({ themeFor }) takes { guild?, user? }, each a function returning part of a theme, or a class implementing ThemeResolver.',
    )
    expect(() => MeoCordTestingModule.create({ controllers: [Panel] }).overrideThemeFor(Empty as never)).toThrow(
      'overrideThemeFor: Empty has neither a guild() nor a user() method, so it gives no theme. Declare them as methods: arrow-function properties are not on the class.',
    )
  })

  it("gives its theme to every reader in a dispatch: a guard's getTheme(), a service's useTheme(), respond()'s fill and the presenter's error view", async () => {
    @Service()
    class Reader {
      primary() {
        return useTheme().colors.primary
      }
    }
    @Guard()
    class Reads {
      constructor(private readonly context: ExecutionContext) {}
      canActivate() {
        seen.push(['guard', this.context.getTheme().colors.primary])
        return true
      }
    }
    Reflect.defineMetadata('design:paramtypes', [ExecutionContext], Reads)
    @Controller()
    class Reply {
      constructor(private readonly reader: Reader) {}
      @Command('reply', CommandType.BUTTON)
      @UseGuard(Reads)
      async reply(interaction: ButtonInteraction) {
        seen.push(['service', this.reader.primary()])
        await respond(interaction).send({ embeds: [{ description: 'filled' }] })
      }
      @Command('fail', CommandType.BUTTON)
      fail() {
        throw new Error('broken')
      }
    }
    Reflect.defineMetadata('design:paramtypes', [Reader], Reply)
    class Presenter implements ResponsePresenter {
      loading(): ResponseView {
        return { text: '…' }
      }
      error(): ResponseView {
        seen.push(['presenter', useTheme().colors.primary])
        return { text: 'Something broke.' }
      }
    }
    @MeoCord({ controllers: [Reply], clientOptions: { intents: [] }, themeFor: StoredThemes, providers: [SERVERS], presenter: Presenter })
    class App {}
    const module = MeoCordTestingModule.fromApp(App).compile()
    const reply = press('reply')

    await module.dispatch(reply)
    await module.dispatch(press('fail')).catch(() => undefined)

    expect(seen).toEqual([
      ['guard', '#0000E2'],
      ['service', '#0000E2'],
      ['presenter', '#0000E2'],
    ])
    // A button's send() updates the message it is on
    expect((reply.update.mock.calls[0][0]).embeds[0].color).toBe(resolveColor('#0000E2'))
  })

  it("keeps a call's theme when the choice behind it changes during the call, and gives the next call the new one", async () => {
    @Service()
    class Choices {
      constructor(
        readonly palettes: Palettes,
        private readonly themes: ThemeCache,
      ) {}
      choose(userId: string, info: `#${string}`) {
        this.palettes.byUser.set(userId, info)
        this.themes.invalidateUser(userId)
      }
    }
    Reflect.defineMetadata('design:paramtypes', [Palettes, ThemeCache], Choices)
    @Controller()
    class Settings {
      constructor(private readonly choices: Choices) {}
      @Command('choose', CommandType.BUTTON)
      choose() {
        seen.push(['before', useTheme().colors.info])
        this.choices.choose(USER, '#0000E5')
        seen.push(['after', useTheme().colors.info])
      }
    }
    Reflect.defineMetadata('design:paramtypes', [Choices], Settings)
    @MeoCord({ controllers: [Settings, Panel], clientOptions: { intents: [] }, themeFor: StoredThemes, providers: [SERVERS] })
    class App {}
    const module = MeoCordTestingModule.fromApp(App).compile()

    await module.invoke(Settings, 'choose', press('choose'))
    await module.invoke(Panel, 'panel', press('panel'))

    expect(seen).toEqual([
      ['before', '#0000E1'],
      ['after', '#0000E1'],
      ['handler', '#0000E2', '#0000E5'],
    ])
  })

  it.each([
    [
      'overrideProvider replaces the class',
      () => MeoCordTestingModule.fromApp(appWith(StoredThemes)).overrideProvider(StoredThemes).useValue({ guild: () => ({ colors: { primary: '#0000E6' } }) }),
      [['#0000E6', INFO]],
    ],
    [
      'overrideThemeFor puts a class in place of functions',
      () => MeoCordTestingModule.fromApp(appWith({ guild: () => ({ colors: { primary: '#0000E7' } }) })).overrideThemeFor(StoredThemes),
      [['#0000E2', '#0000E1']],
    ],
    [
      'overrideThemeFor puts functions in place of a class',
      () => MeoCordTestingModule.fromApp(appWith(StoredThemes)).overrideThemeFor({ user: () => ({ colors: { info: '#0000E8' } }) }),
      [[PRIMARY, '#0000E8']],
    ],
  ] as const)('in a testing module: %s', async (_how, builder, colours) => {
    const module = builder().compile()
    await module.invoke(Panel, 'panel', press('panel'))
    expect(handled()).toEqual(colours)
  })
})
