import { ButtonInteraction, ChatInputCommandInteraction, type GuildMember, type Message } from 'discord.js'
import { Catch, Command, Controller, Guard, MeoCord, MessageHandler, Service, UseFilter, UseGuard } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { type ExceptionFilter, type GuardInterface } from '@src/interface/index.js'
import { createMetadata, ExecutionContext, MessageUsageError } from '@src/common/index.js'
import {
  createChatInputOptions,
  createMock,
  createMockGuild,
  createMockInteraction,
  createMockMessage,
  MeoCordTestingModule,
} from '@src/testing/index.js'

const log: string[] = []
const Label = createMetadata<string>('label')

@Guard()
class AllowA implements GuardInterface {
  canActivate() {
    log.push('A')
    return true
  }
}

@Guard()
class AllowB implements GuardInterface {
  canActivate() {
    log.push('B')
    return true
  }
}

@Guard()
class Deny implements GuardInterface {
  canActivate() {
    log.push('deny')
    return false
  }
}

@Guard()
class ContextGuard implements GuardInterface {
  constructor(private readonly context: ExecutionContext) {}

  canActivate() {
    log.push(`context:${this.context.get(Label)}:${this.context.getParams()?.min}`)
    return true
  }
}

@Service()
class GreetingService {
  readonly greeted: string[] = []

  greet(name: string) {
    this.greeted.push(name)
  }
}

@Controller()
@UseGuard(AllowA)
class GreetingController {
  constructor(private readonly greetings: GreetingService) {}

  @Command('greet', CommandType.SLASH)
  @UseGuard(AllowB)
  async greet(_interaction: ChatInputCommandInteraction, { name }: { name: string }) {
    log.push('greet')
    this.greetings.greet(name)
  }

  @Command('denied', CommandType.SLASH)
  @UseGuard(AllowB, Deny, AllowB)
  async denied(_interaction: ChatInputCommandInteraction) {
    log.push('denied')
  }

  @Command('context', CommandType.SLASH)
  @Label('method label')
  @UseGuard({ provide: ContextGuard, params: { min: 1 } })
  async context(_interaction: ChatInputCommandInteraction) {
    log.push('context')
  }

  @Command('outer', CommandType.SLASH)
  async outer(interaction: ChatInputCommandInteraction) {
    log.push('outer')
    await this.inner(interaction)
  }

  @UseGuard(Deny)
  async inner(_interaction: ChatInputCommandInteraction) {
    log.push('inner')
  }

  @Command('fails', CommandType.SLASH)
  async fails(_interaction: ChatInputCommandInteraction) {
    throw new Error('handler failed')
  }
}

@Controller()
@UseGuard(AllowA)
class BaseButtonController {
  @Command('refresh', CommandType.BUTTON)
  @UseGuard(AllowB)
  async refresh(_interaction: ButtonInteraction) {
    log.push('refresh')
  }
}

@Controller()
class ProfileButtonController extends BaseButtonController {
  @Command('profile/{id}', CommandType.BUTTON)
  @UseGuard(AllowB)
  async profile(_interaction: ButtonInteraction, { id }: { id: string }) {
    log.push(`profile:${id}`)
  }
}

const slash = () => createMockInteraction(ChatInputCommandInteraction)
const compile = () =>
  MeoCordTestingModule.create({ controllers: [GreetingController, ProfileButtonController] }).compile()

describe('TestingModule.invoke', () => {
  beforeEach(() => {
    log.length = 0
  })

  it('runs class guards, then method guards, once each, then the handler', async () => {
    const module = compile()
    const outcome = await module.invoke(GreetingController, 'greet', slash(), { name: 'Alice' })

    expect(log).toEqual(['A', 'B', 'greet'])
    expect(outcome).toEqual({ ran: true })
    expect(module.get(GreetingService).greeted).toEqual(['Alice'])
  })

  it('stops at the first guard that denies, without running the handler', async () => {
    const outcome = await compile().invoke(GreetingController, 'denied', slash())

    expect(log).toEqual(['A', 'B', 'deny'])
    expect(outcome).toEqual({ ran: false })
  })

  it('resolves guards from the module, so overrideGuard stubs apply', async () => {
    const module = MeoCordTestingModule.create({ controllers: [GreetingController] })
      .overrideGuard(Deny)
      .useValue({ canActivate: () => true })
      .compile()

    await module.invoke(GreetingController, 'denied', slash())
    expect(log).toEqual(['A', 'B', 'B', 'denied'])
  })

  it('gives guards that inject ExecutionContext the call context', async () => {
    await compile().invoke(GreetingController, 'context', slash())
    expect(log).toEqual(['A', 'context:method label:1', 'context'])
  })

  it('runs the guards of a guarded method the handler calls directly', async () => {
    await compile().invoke(GreetingController, 'outer', slash())
    expect(log).toEqual(['A', 'outer', 'deny'])
  })

  it('leaves no pass behind, so a later direct call with the same interaction runs its guards', async () => {
    const module = compile()
    const interaction = slash()

    await module.invoke(GreetingController, 'greet', interaction, { name: 'Alice' })
    log.length = 0
    await module.get(GreetingController).greet(interaction, { name: 'Bob' })

    expect(log).toEqual(['A', 'B', 'greet'])
  })

  it("runs an inherited handler with the guards it was declared with, and the subclass's own with its base's", async () => {
    const button = createMockInteraction(ButtonInteraction)

    await compile().invoke(ProfileButtonController, 'refresh', button)
    await compile().invoke(ProfileButtonController, 'profile', button, { id: '42' })

    expect(log).toEqual(['A', 'B', 'refresh', 'A', 'B', 'profile:42'])
  })

  it('rejects with the error the handler throws', async () => {
    await expect(compile().invoke(GreetingController, 'fails', slash())).rejects.toThrow('handler failed')
  })

  it('rejects a controller the module was not created with', async () => {
    const module = MeoCordTestingModule.create({ controllers: [ProfileButtonController] }).compile()

    await expect(module.invoke(GreetingController, 'denied', slash())).rejects.toThrow(
      'GreetingController is not a controller of this testing module',
    )
  })

  it('rejects a method the controller does not have, naming it', async () => {
    await expect(compile().invoke(GreetingController, 'missing' as never, slash())).rejects.toThrow('GreetingController.missing is not a method')
  })

  describe('checks the interaction against the handler route', () => {
    it("rejects a customId the handler's pattern does not match", async () => {
      const button = createMockInteraction(ButtonInteraction, { customId: 'something/else' })

      await expect(compile().invoke(ProfileButtonController, 'profile', button)).rejects.toThrow(
        "customId 'something/else' does not match ProfileButtonController.profile's route 'profile/{id}'.",
      )
      expect(log).not.toContain('profile:undefined')
    })

    it('rejects a command name the handler is not registered for', async () => {
      const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName: 'greeting' })

      await expect(compile().invoke(GreetingController, 'denied', interaction)).rejects.toThrow(
        "command 'greeting' does not match GreetingController.denied's route 'denied'.",
      )
    })

    it('accepts a matching customId and command name, and an interaction that carries neither', async () => {
      const module = compile()
      await module.invoke(ProfileButtonController, 'profile', createMockInteraction(ButtonInteraction, { customId: 'profile/7' }))
      await module.invoke(GreetingController, 'denied', createMockInteraction(ChatInputCommandInteraction, { commandName: 'denied' }))
      await module.invoke(ProfileButtonController, 'profile', createMockInteraction(ButtonInteraction), { id: '8' })

      expect(log).toContain('profile:7')
      expect(log).toContain('profile:8')
    })

    it('accepts a subcommand handled by its command, as dispatch would route it', async () => {
      @Controller()
      class Settings {
        @Command('settings', CommandType.SLASH)
        async settings(_interaction: ChatInputCommandInteraction) {
          log.push('settings')
        }
      }
      const interaction = createMockInteraction(ChatInputCommandInteraction, {
        commandName: 'settings',
        options: createChatInputOptions({ subcommand: 'language' }) as never,
      })

      await MeoCordTestingModule.create({ controllers: [Settings] }).compile().invoke(Settings, 'settings', interaction)

      expect(log.at(-1)).toBe('settings')
    })

    it('leaves a method without a route unchecked', async () => {
      const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName: 'anything' })

      await compile().invoke(GreetingController, 'inner', interaction)

      expect(log).toEqual(['deny'])
    })
  })
})


describe('TestingModule.invoke with a message', () => {
  const received: unknown[] = []

  @Controller()
  class DiceController {
    @MessageHandler('roll {sides} {note...?}')
    async roll(_message: Message, params: { sides: string; note?: string }) {
      received.push(params)
    }

    @MessageHandler()
    async everything(_message: Message) {
      received.push('listener')
    }
  }

  beforeEach(() => {
    received.length = 0
  })

  it("parses the params from the message's content, as dispatch would", async () => {
    const module = MeoCordTestingModule.create({ controllers: [DiceController] }).compile()

    await module.invoke(DiceController, 'roll', createMockMessage({ content: 'roll 20 for luck' }))

    expect(received).toEqual([{ sides: '20', note: 'for luck' }])
  })

  it("matches only a mention of the bot under mention: 'only', as dispatch does", async () => {
    @MeoCord({ controllers: [DiceController], clientOptions: { intents: [] }, messages: { mention: 'only' } })
    class App {}
    const module = MeoCordTestingModule.create({ controllers: [DiceController], app: App }).compile()
    const mention = createMockMessage({ content: 'roll 6' })
    mention.content = `<@${mention.client.user.id}> roll 6`

    await module.invoke(DiceController, 'roll', mention)
    expect(received).toEqual([{ sides: '6' }])
    await expect(module.invoke(DiceController, 'roll', createMockMessage({ content: 'roll 6' }))).rejects.toThrow("does not match DiceController.roll's pattern")
  })

  it("strips the app's prefix first, awaiting a prefix function", async () => {
    @MeoCord({ controllers: [DiceController], clientOptions: { intents: [] }, messages: { prefix: async () => ['!', '?'] } })
    class App {}
    const module = MeoCordTestingModule.create({ controllers: [DiceController], app: App }).compile()

    await module.invoke(DiceController, 'roll', createMockMessage({ content: '?roll 6' }))

    expect(received).toEqual([{ sides: '6' }])
  })

  it("leaves the app's prefix function uncalled when every handler has its own prefix, as dispatch does", async () => {
    const prefix = vi.fn(() => '!')
    @Controller()
    class Own {
      @MessageHandler('roll {sides}', { prefix: '?' })
      async roll(_message: Message, params: { sides: string }) {
        received.push(params)
      }
    }
    @MeoCord({ controllers: [Own], clientOptions: { intents: [] }, messages: { prefix } })
    class App {}
    const module = MeoCordTestingModule.create({ controllers: [Own], app: App }).compile()

    await module.invoke(Own, 'roll', createMockMessage({ content: '?roll 6' }))

    expect(received).toEqual([{ sides: '6' }])
    expect(prefix).not.toHaveBeenCalled()
  })

  it("rejects content the handler's pattern does not match, naming both", async () => {
    const module = MeoCordTestingModule.create({ controllers: [DiceController] }).compile()

    await expect(module.invoke(DiceController, 'roll', createMockMessage({ content: 'flip' }))).rejects.toThrow(
      "message 'flip' does not match DiceController.roll's pattern 'roll {sides} {note...?}'.",
    )
    expect(received).toEqual([])
  })

  it('uses params given explicitly, and leaves a message without content or a listener unchecked', async () => {
    const module = MeoCordTestingModule.create({ controllers: [DiceController] }).compile()

    await module.invoke(DiceController, 'roll', createMockMessage({ content: 'flip' }), { sides: '4' })
    await module.invoke(DiceController, 'roll', createMockMessage())
    await module.invoke(DiceController, 'everything', createMockMessage({ content: 'anything' }))

    expect(received).toEqual([{ sides: '4' }, {}, 'listener'])
  })
})

describe('TestingModule.invoke with typed message params', () => {
  const received: unknown[] = []
  const TARGET = '200000000000000002'

  @Controller()
  class PayController {
    @MessageHandler('pay {to:member} {amount:int}')
    async pay(_message: Message, params: { to: GuildMember; amount: number }) {
      received.push(params)
    }
  }

  beforeEach(() => {
    received.length = 0
  })

  it('resolves them as dispatch does, from the message guild caches', async () => {
    const to = createMock<GuildMember>({ id: TARGET })
    const module = MeoCordTestingModule.create({ controllers: [PayController] }).compile()
    const message = createMockMessage({ content: `pay <@${TARGET}> 25`, guild: createMockGuild({ members: [to] }) })

    await module.invoke(PayController, 'pay', message)

    expect(received).toEqual([{ to, amount: 25 }])
  })

  it('rejects with the usage, as dispatch answers it, when a prefixed message names the command but a param is missing', async () => {
    @MeoCord({ controllers: [PayController], clientOptions: { intents: [] }, messages: { prefix: '!' } })
    class App {}
    const module = MeoCordTestingModule.create({ controllers: [PayController], app: App }).compile()
    const message = createMockMessage({ content: `!pay <@${TARGET}>`, guild: createMockGuild() })

    const error = await module.invoke(PayController, 'pay', message).then(
      () => undefined,
      (thrown: unknown) => thrown,
    )

    expect(error).toBeInstanceOf(MessageUsageError)
    expect((error as MessageUsageError).message).toBe('Usage: !pay <to> <amount>\namount is missing')
    expect(received).toEqual([])
    // Without a prefix, dispatch takes no message for a command, and runs nothing
    await expect(module.invoke(PayController, 'pay', createMockMessage({ content: 'pay', guild: createMockGuild() }))).rejects.toThrow(
      "message 'pay' does not match PayController.pay's pattern",
    )
  })

  it('rejects as not reaching the handler a message dispatch sends to a more specific one', async () => {
    @Controller()
    class Config {
      @MessageHandler('config {key}')
      async show(_message: Message, params: { key: string }) {
        received.push(params)
      }

      @MessageHandler('config set {key} {value...}')
      async set(_message: Message, params: { key: string; value: string }) {
        received.push(params)
      }
    }
    @MeoCord({ controllers: [Config], clientOptions: { intents: [] }, messages: { prefix: '!' } })
    class App {}
    const module = MeoCordTestingModule.create({ controllers: [Config], app: App }).compile()

    await expect(module.invoke(Config, 'show', createMockMessage({ content: '!config set prefix ?' }))).rejects.toThrow(
      "message '!config set prefix ?' does not reach Config.show: dispatch runs Config.set.",
    )
    await expect(module.invoke(Config, 'show', createMockMessage({ content: '!config' }))).rejects.toThrow('Usage: !config <key>')
    expect(received).toEqual([])
  })

  it('rejects a message the handler matches but dispatch gives to a more specific one', async () => {
    @Controller()
    class RollAny {
      @MessageHandler('roll {sides}')
      async roll(_message: Message, params: { sides: string }) {
        received.push(params)
      }
    }
    @Controller()
    class RollTwenty {
      @MessageHandler('roll 20')
      async twenty() {
        received.push('twenty')
      }
    }
    @MeoCord({ controllers: [RollAny, RollTwenty], clientOptions: { intents: [] }, messages: { prefix: '!' } })
    class App {}
    const module = MeoCordTestingModule.create({ controllers: [RollAny, RollTwenty], app: App }).compile()

    await expect(module.invoke(RollAny, 'roll', createMockMessage({ content: '!roll 20' }))).rejects.toThrow(
      "message '!roll 20' does not reach RollAny.roll: dispatch runs RollTwenty.twenty.",
    )
    await module.invoke(RollAny, 'roll', createMockMessage({ content: '!roll 6' }))
    expect(received).toEqual([{ sides: '6' }])
  })

  it("lets the handler's filters answer a missing param, as they do in dispatch", async () => {
    const caught: string[] = []
    @Catch(MessageUsageError)
    class UsageFilter implements ExceptionFilter<MessageUsageError> {
      catch(error: MessageUsageError) {
        caught.push(error.usage)
      }
    }
    @Controller()
    class Filtered {
      @MessageHandler('pay {to:member} {amount:int}')
      @UseFilter(UsageFilter)
      async pay(_message: Message, params: { to: GuildMember; amount: number }) {
        received.push(params)
      }
    }
    @MeoCord({ controllers: [Filtered], clientOptions: { intents: [] }, messages: { prefix: '!' } })
    class App {}
    const module = MeoCordTestingModule.create({ controllers: [Filtered], app: App }).compile()

    const result = await module.invoke(Filtered, 'pay', createMockMessage({ content: '!pay', guild: createMockGuild() }))

    expect(result).toEqual({ ran: false, error: expect.any(MessageUsageError) })
    expect(caught).toEqual(['!pay <to> <amount>'])
    await expect(module.invoke(Filtered, 'pay', createMockMessage({ content: '!balance' }))).rejects.toThrow(
      "message '!balance' does not match Filtered.pay's pattern",
    )
  })

  it('rejects with the usage when a word is not a value of its type', async () => {
    const module = MeoCordTestingModule.create({ controllers: [PayController] }).compile()
    const message = createMockMessage({ content: `pay <@${TARGET}> lots`, guild: createMockGuild() })

    await expect(module.invoke(PayController, 'pay', message)).rejects.toThrow(MessageUsageError)
    await expect(module.invoke(PayController, 'pay', message)).rejects.toThrow('amount: "lots" is not a whole number')
    expect(received).toEqual([])
  })

  it("rejects a message sent where the handler's scope says it does not work, and runs one sent where it does", async () => {
    @Controller()
    class InboxController {
      @MessageHandler('inbox', { scope: 'dm', aliases: ['i'] })
      async inbox(_message: Message) {
        received.push('inbox')
      }
    }
    const module = MeoCordTestingModule.create({ controllers: [InboxController] }).compile()

    await expect(module.invoke(InboxController, 'inbox', createMockMessage({ content: 'inbox', guild: createMockGuild() }))).rejects.toThrow(
      'This command works in direct messages only.',
    )
    await module.invoke(InboxController, 'inbox', createMockMessage({ content: 'i', guild: null }))
    expect(received).toEqual(['inbox'])
  })
})
