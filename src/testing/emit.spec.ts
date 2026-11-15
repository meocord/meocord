import { type GuildMember } from 'discord.js'
import { vi } from 'vitest'
import { Controller, Guard, Inject, MeoCord, MessageHandler, On, Once, Service, UseGuard } from '@src/decorator/index.js'
import { type GuardInterface, type PresentedError, type ResponsePresenter } from '@src/interface/index.js'
import { createMock, createMockMessage, MeoCordTestingModule } from '@src/testing/index.js'
import { GuardDeniedError, Logger, MemoryCooldownStore, UserError } from '@src/common/index.js'
import { forgetDeprecationWarnings } from '@src/common/deprecation.js'

describe('TestingModule.emit', () => {
  it('runs the handlers on controllers, class providers and their dependencies', async () => {
    const greeted: string[] = []

    @Service()
    class Audit {
      @On('guildMemberAdd')
      record(member: GuildMember) {
        greeted.push(`audit ${member.id}`)
      }
    }

    @Service()
    class Welcome {
      constructor(readonly audit: Audit) {}
      @On('guildMemberAdd')
      greet(member: GuildMember) {
        greeted.push(`welcome ${member.id}`)
      }
    }

    @Controller()
    class Members {
      constructor(readonly welcome: Welcome) {}
      @On('guildMemberAdd')
      count(member: GuildMember) {
        greeted.push(`members ${member.id}`)
      }
    }

    @Service()
    class Standalone {
      @On('guildMemberAdd')
      note(member: GuildMember) {
        greeted.push(`standalone ${member.id}`)
      }
    }

    const module = MeoCordTestingModule.create({
      controllers: [Members],
      providers: [{ provide: Standalone, useClass: Standalone }],
    }).compile()

    const { ran } = await module.emit('guildMemberAdd', createMock<GuildMember>({ id: '42' }))

    expect(ran).toBe(4)
    expect(greeted.sort()).toEqual(['audit 42', 'members 42', 'standalone 42', 'welcome 42'])
  })

  it('runs the handlers on a service only a stage injects, a class provided under another token and a provided value, once per instance', async () => {
    const heard: string[] = []

    @Service()
    class StageOnly {
      @On('guildMemberAdd')
      joined() {
        heard.push('StageOnly')
      }
    }

    @Guard()
    class NeedsStageOnly implements GuardInterface {
      constructor(@Inject(StageOnly) readonly dependency: StageOnly) {}
      canActivate() {
        return true
      }
    }

    @Controller()
    @UseGuard(NeedsStageOnly)
    class Guarded {
      @MessageHandler('ping')
      ping() {}
    }

    abstract class Weather {}
    @Service()
    class OpenMeteo extends Weather {
      @On('guildMemberAdd')
      joined() {
        heard.push('OpenMeteo')
      }
    }

    class Given {
      @On('guildMemberAdd')
      joined() {
        heard.push('Given')
      }
    }

    const given = new Given()
    const module = MeoCordTestingModule.create({
      controllers: [Guarded],
      providers: [
        { provide: Weather, useClass: OpenMeteo },
        { provide: 'given', useValue: given },
        { provide: 'again', useFactory: () => given },
      ],
    }).compile()

    const { ran } = await module.emit('guildMemberAdd', createMock<GuildMember>({ id: '42' }))

    expect(ran).toBe(3)
    expect(heard.sort()).toEqual(['Given', 'OpenMeteo', 'StageOnly'])
  })

  it('runs an @Once handler on a class provider once when a factory aliases its instance', async () => {
    const heard: string[] = []
    abstract class Weather {}
    class OpenMeteo extends Weather {
      @Once('guildMemberAdd')
      first() {
        heard.push('first')
      }
    }

    const module = MeoCordTestingModule.create({
      providers: [
        { provide: Weather, useClass: OpenMeteo },
        { provide: 'weather', useFactory: (weather: Weather) => weather, inject: [Weather] },
      ],
    }).compile()

    const runs = [await module.emit('guildMemberAdd', createMock<GuildMember>()), await module.emit('guildMemberAdd', createMock<GuildMember>())]

    expect([runs.map(({ ran }) => ran), heard]).toEqual([[1, 0], ['first']])
  })

  // No event reaches the cooldown store, so neither does one through a factory that returns the store's instance
  it("runs no handler on the cooldown store when a factory returns the store's instance", async () => {
    const heard: string[] = []
    class Store extends MemoryCooldownStore {
      @On('guildMemberAdd')
      joined() {
        heard.push('store')
      }
    }
    @MeoCord({
      controllers: [],
      cooldownStore: Store,
      providers: [{ provide: 'alias', useFactory: (store: Store) => store, inject: [Store] }],
      clientOptions: { intents: [] },
    })
    class App {}

    const module = await MeoCordTestingModule.fromApp(App).compile().init()
    const { ran } = await module.emit('guildMemberAdd', createMock<GuildMember>())

    expect([ran, heard]).toEqual([0, []])
  })

  it('runs an @Once handler for the first event only', async () => {
    const warm = vi.fn()

    @Controller()
    class Warmup {
      @Once('clientReady')
      warm() {
        warm()
      }
    }

    const module = MeoCordTestingModule.create({ controllers: [Warmup] }).compile()
    const client = createMock<any>()

    expect((await module.emit('clientReady', client)).ran).toBe(1)
    expect((await module.emit('clientReady', client)).ran).toBe(0)
    expect(warm).toHaveBeenCalledTimes(1)
  })

  it('runs the app guards and the handler guards, and does not count a denied handler', async () => {
    const order: string[] = []

    @Guard()
    class GlobalGuard implements GuardInterface {
      canActivate() {
        order.push('global')
        return true
      }
    }

    @Guard()
    class Deny implements GuardInterface {
      canActivate() {
        order.push('deny')
        return false
      }
    }

    @Controller()
    class Members {
      @On('guildMemberAdd')
      @UseGuard(Deny)
      greet() {
        order.push('handler')
      }
    }

    @MeoCord({ controllers: [], guards: [GlobalGuard], clientOptions: { intents: [] } })
    class App {}

    const module = MeoCordTestingModule.create({ app: App, controllers: [Members] }).compile()
    const { ran } = await module.emit('guildMemberAdd', createMock<GuildMember>())

    expect(ran).toBe(0)
    expect(order).toEqual(['global', 'deny'])
  })

  it('rejects with the error when one handler throws, after the others have run', async () => {
    const ran = vi.fn()

    @Controller()
    class Members {
      @On('guildMemberAdd')
      fail() {
        throw new Error('boom')
      }
      @On('guildMemberAdd')
      greet() {
        ran()
      }
    }

    const module = MeoCordTestingModule.create({ controllers: [Members] }).compile()

    await expect(module.emit('guildMemberAdd', createMock<GuildMember>())).rejects.toThrow('boom')
    expect(ran).toHaveBeenCalled()
  })

  it('rejects with an AggregateError when several handlers throw', async () => {
    @Controller()
    class Members {
      @On('guildMemberAdd')
      first() {
        throw new Error('one')
      }
      @On('guildMemberAdd')
      second() {
        throw new Error('two')
      }
    }

    const module = MeoCordTestingModule.create({ controllers: [Members] }).compile()
    const error = await module.emit('guildMemberAdd', createMock<GuildMember>()).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(AggregateError)
    expect((error as AggregateError).errors.map(e => (e as Error).message)).toEqual(['one', 'two'])
  })

  // Without eventFallback, the bot's event fallback, which skips a refused event and answers a UserError, isn't run
  it.each([
    ["a guard's GuardDeniedError", new GuardDeniedError('no events for you')],
    ["a handler's UserError", new UserError('slow down')],
  ])('rejects with %s, as with any error', async (_, error) => {
    @Guard()
    class Refuse implements GuardInterface {
      canActivate() {
        if (error instanceof GuardDeniedError) throw error
        return true
      }
    }

    @Controller()
    class Members {
      @On('guildMemberAdd')
      @UseGuard(Refuse)
      greet() {
        throw error
      }
    }

    const module = MeoCordTestingModule.create({ controllers: [Members] }).compile()

    await expect(module.emit('guildMemberAdd', createMock<GuildMember>())).rejects.toBe(error)
  })

  it('runs no handler for an event nothing handles', async () => {
    @Controller()
    class Members {
      @On('guildMemberAdd')
      greet() {}
    }

    const module = MeoCordTestingModule.create({ controllers: [Members] }).compile()

    expect(await module.emit('guildMemberRemove', createMock<GuildMember>())).toEqual({ ran: 0 })
  })

  // As in an app, where one class failing to resolve leaves the other listeners running
  it('runs the other handlers when a class cannot be resolved, then rejects with its error', async () => {
    const ran = vi.fn()

    @Controller()
    class Broken {
      constructor() {
        throw new Error('no database')
      }
      @Once('guildMemberAdd')
      greet() {}
    }

    @Controller()
    class Members {
      @On('guildMemberAdd')
      greet() {
        ran()
      }
    }

    const module = MeoCordTestingModule.create({ controllers: [Broken, Members] }).compile()

    await expect(module.emit('guildMemberAdd', createMock<GuildMember>())).rejects.toThrow('no database')
    expect(ran).toHaveBeenCalled()
  })
})

describe('TestingModule.emit with eventFallback', () => {
  const warned: string[] = []
  const fallbackWarnings = () => warned.filter(text => text.includes('eventFallback'))

  beforeEach(() => {
    warned.length = 0
    forgetDeprecationWarnings()
    vi.spyOn(Logger.prototype, 'warn').mockImplementation((text: unknown) => void warned.push(String(text)))
  })

  afterEach(() => vi.restoreAllMocks())

  @Guard()
  class Refuse implements GuardInterface {
    canActivate(): boolean {
      throw new GuardDeniedError('no events for you')
    }
  }

  const greeted = vi.fn()

  @Controller()
  class Members {
    @On('guildMemberAdd')
    @UseGuard(Refuse)
    refused() {
      greeted('refused')
    }

    @On('guildMemberAdd')
    greet() {
      greeted('greet')
    }

    @On('guildMemberRemove')
    farewell() {
      throw new UserError('No one to tell.')
    }

    @On('guildBanAdd')
    broken() {
      throw new Error('database down')
    }
  }

  @Controller()
  class Links {
    @On('messageCreate')
    check() {
      throw new UserError('Link your account first.')
    }

    @On('messageUpdate')
    recheck() {
      throw new UserError('Edits are not checked again.')
    }
  }

  @MeoCord({ controllers: [Links], messages: { replyEmoji: true }, theme: { emojis: { warning: '🚧' } }, clientOptions: { intents: [] } })
  class App {}

  beforeEach(() => greeted.mockClear())

  it("skips a guard's GuardDeniedError, and doesn't count the denied handler", async () => {
    const module = MeoCordTestingModule.create({ controllers: [Members], eventFallback: true }).compile()

    expect(await module.emit('guildMemberAdd', createMock<GuildMember>())).toEqual({ ran: 1 })
    expect(greeted.mock.calls).toEqual([['greet']])
  })

  it("answers a UserError as a reply to the event's message, with the app's replyEmoji", async () => {
    const module = MeoCordTestingModule.fromApp(App, { eventFallback: true }).compile()
    const message = createMockMessage({ content: 'hello' })

    expect(await module.emit('messageCreate', message)).toEqual({ ran: 1 })
    expect(message.reply).toHaveBeenCalledWith({ content: '🚧 Link your account first.', allowedMentions: { repliedUser: false, parse: [] } })
  })

  it('replies to the newest message the event carries: an edit\'s new message', async () => {
    const module = MeoCordTestingModule.create({ app: App, controllers: [Links], eventFallback: true }).compile()
    const before = createMockMessage({ content: 'old' })
    const after = createMockMessage({ content: 'new' })

    await module.emit('messageUpdate', before, after)

    expect(before.reply).not.toHaveBeenCalled()
    expect(after.reply).toHaveBeenCalledWith({ content: '🚧 Edits are not checked again.', allowedMentions: { repliedUser: false, parse: [] } })
  })

  it("draws the reply with the app's presenter", async () => {
    class Presenter implements ResponsePresenter {
      loading() {
        return { text: 'Working' }
      }
      error(_context: unknown, { message }: PresentedError) {
        return { text: message }
      }
      messageError(_context: unknown, { message }: PresentedError) {
        return { title: 'Not yet', text: message }
      }
    }
    @MeoCord({ controllers: [Links], presenter: Presenter, clientOptions: { intents: [] } })
    class Presented {}
    const module = MeoCordTestingModule.fromApp(Presented, { eventFallback: true }).compile()
    const message = createMockMessage({ content: 'hello' })

    await module.emit('messageCreate', message)

    const [reply] = vi.mocked(message.reply).mock.calls[0] as [{ embeds: { title?: string; description?: string }[] }]
    expect(reply.embeds[0]).toMatchObject({ title: 'Not yet', description: 'Link your account first.' })
  })

  it('resolves a UserError from an event that carries no message, as the bot only logs it', async () => {
    const module = MeoCordTestingModule.create({ controllers: [Members], eventFallback: true }).compile()

    expect(await module.emit('guildMemberRemove', createMock<GuildMember>())).toEqual({ ran: 1 })
  })

  it('rejects with any other error', async () => {
    const module = MeoCordTestingModule.create({ controllers: [Members], eventFallback: true }).compile()

    await expect(module.emit('guildBanAdd', createMock())).rejects.toThrow('database down')
  })

  it('rejects when the reply cannot be drawn, as the bot ends that call in the fault', async () => {
    class Broken implements ResponsePresenter {
      loading() {
        return { text: 'Working' }
      }
      error(_context: unknown, { message }: PresentedError) {
        return { text: message }
      }
      messageError(): never {
        throw new TypeError('presenter broke')
      }
    }
    @MeoCord({ controllers: [Links], presenter: Broken, clientOptions: { intents: [] } })
    class BrokenApp {}
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    const module = MeoCordTestingModule.fromApp(BrokenApp, { eventFallback: true }).compile()

    await expect(module.emit('messageCreate', createMockMessage({ content: 'hello' }))).rejects.toThrow('presenter broke')
  })

  it('warns once, unset, where emit rejects with a GuardDeniedError or a UserError', async () => {
    const module = MeoCordTestingModule.create({ controllers: [Members] }).compile()

    await expect(module.emit('guildBanAdd', createMock())).rejects.toThrow('database down')
    expect(fallbackWarnings()).toEqual([])

    await expect(module.emit('guildMemberAdd', createMock<GuildMember>())).rejects.toBeInstanceOf(GuardDeniedError)
    await expect(module.emit('guildMemberRemove', createMock<GuildMember>())).rejects.toBeInstanceOf(UserError)

    expect(fallbackWarnings()).toHaveLength(1)
    expect(fallbackWarnings()[0]).toContain('5.0')
    expect(fallbackWarnings()[0]).toContain('https://github.com/meocord/meocord/issues/964')
  })

  it.each([
    ['false, keeping the rejection', false],
    ['true', true],
  ])('does not warn when set to %s', async (_, eventFallback) => {
    const module = MeoCordTestingModule.create({ controllers: [Members], eventFallback }).compile()

    const emitted = module.emit('guildMemberRemove', createMock<GuildMember>())
    if (eventFallback) await emitted
    else await expect(emitted).rejects.toBeInstanceOf(UserError)

    expect(fallbackWarnings()).toEqual([])
  })
})
