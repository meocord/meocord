import {
  ApplicationCommandType,
  ButtonInteraction,
  ChatInputCommandInteraction,
  ContextMenuCommandBuilder,
  MessageContextMenuCommandInteraction,
  ModalSubmitInteraction,
  SlashCommandBuilder,
  User,
} from 'discord.js'
import { CommandNotFoundError } from '@src/common/index.js'
import { handlerInput } from '@src/core/handler-input.js'
import { Command, CommandBuilder, Controller, MessageHandler } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { createChatInputOptions, createMockInteraction, createModalFields, MeoCordTestingModule } from '@src/testing/index.js'

// Names that Object.prototype holds, which Discord accepts as command, option and field names
const NAMES = ['constructor', '__proto__', 'toString'] as const

/** An object with `name` as an own key, which an object literal can't give `__proto__`. */
const keyed = <T>(name: string, value: T): Record<string, T> =>
  Object.defineProperty({}, name, { value, enumerable: true, writable: true, configurable: true })

const ran: string[] = []
const received: Record<string, unknown>[] = []

@CommandBuilder(CommandType.SLASH)
class SlashBuilder {
  build(name: string) {
    return new SlashCommandBuilder()
      .setName(name)
      .setDescription('Probe')
      .addStringOption(option => option.setName('__proto__').setDescription('Text'))
      .addUserOption(option => option.setName('constructor').setDescription('User'))
  }
}

@CommandBuilder(CommandType.CONTEXT_MENU)
class MessageMenuBuilder {
  build(name: string) {
    return new ContextMenuCommandBuilder().setName(name).setType(ApplicationCommandType.Message)
  }
}

// Made per test, so a name its decorators refuse fails that test alone
const named = () => {
  @Controller()
  class Named {
  @Command('constructor', SlashBuilder)
  async ctor(_interaction: ChatInputCommandInteraction, params: Record<string, unknown>) {
    ran.push('constructor')
    received.push(params)
  }

  @Command('__proto__', SlashBuilder)
  async proto(_interaction: ChatInputCommandInteraction) {
    ran.push('__proto__')
  }

  @Command('toString', MessageMenuBuilder)
  async toStringMenu(_interaction: MessageContextMenuCommandInteraction) {
    ran.push('toString')
  }

  @Command('__proto__', CommandType.MODAL_SUBMIT)
  async submitted(_interaction: ModalSubmitInteraction, params: Record<string, unknown>) {
    received.push(params)
  }
  }
  return Named
}

@Controller()
class Ping {
  @Command('ping', SlashBuilder)
  async ping() {}
}

beforeEach(() => {
  ran.length = 0
  received.length = 0
})

describe('names Object.prototype holds', () => {
  it('runs a slash command and a context menu declared with such a name', async () => {
    const module = MeoCordTestingModule.create({ controllers: [named()] }).compile()

    await module.dispatch(createMockInteraction(ChatInputCommandInteraction, { commandName: 'constructor' }))
    await module.dispatch(createMockInteraction(ChatInputCommandInteraction, { commandName: '__proto__' }))
    await module.dispatch(createMockInteraction(MessageContextMenuCommandInteraction, { commandName: 'toString' }))

    expect(ran).toEqual(['constructor', '__proto__', 'toString'])
  })

  it.each(NAMES)('answers %s, never declared, as a command no handler matches', async name => {
    const module = MeoCordTestingModule.create({ controllers: [Ping] }).compile()

    const slash = await module.dispatch(createMockInteraction(ChatInputCommandInteraction, { commandName: name }))
    const menu = await module.dispatch(createMockInteraction(MessageContextMenuCommandInteraction, { commandName: name }))

    expect(slash).toMatchObject({ ran: false, error: expect.any(CommandNotFoundError) })
    expect(menu).toMatchObject({ ran: false, error: expect.any(CommandNotFoundError) })
  })

  it('declares such a command on a controller whose inherited routes are replaced', () => {
    @Controller()
    class Base {
      @MessageHandler('ping')
      async ping() {}
    }
    expect(() => {
      @Controller({ inheritedRoutes: 'replace' })
      class Derived extends Base {
        @Command('constructor', SlashBuilder)
        async ctor() {}
      }
      return Derived
    }).not.toThrow()
  })

  it('gives a handler an option named __proto__ as an own param, a text or a user alike', async () => {
    const module = MeoCordTestingModule.create({ controllers: [named()] }).compile()
    const user = createMockInteraction(User, { id: '111111111111111111' })

    await module.dispatch(createMockInteraction(ChatInputCommandInteraction, { commandName: 'constructor', options: createChatInputOptions(keyed('__proto__', 'hello')) }))
    await module.dispatch(createMockInteraction(ChatInputCommandInteraction, { commandName: 'constructor', options: createChatInputOptions(keyed('__proto__', user)) }))

    expect(received.map(params => Object.hasOwn(params, '__proto__'))).toEqual([true, true])
    expect(received.map(params => Object.getOwnPropertyDescriptor(params, '__proto__')?.value)).toEqual(['hello', user])
    expect(received.map(params => Object.getPrototypeOf(params))).toEqual([Object.prototype, Object.prototype])
    expect(Object.keys(received[0])).toEqual(['__proto__'])
  })

  it('gives a handler a modal field whose customId is __proto__', async () => {
    const module = MeoCordTestingModule.create({ controllers: [named()] }).compile()

    await module.dispatch(createMockInteraction(ModalSubmitInteraction, { customId: '__proto__', fields: createModalFields(keyed('__proto__', 'typed')) }))

    expect(received).toHaveLength(1)
    expect(Object.getOwnPropertyDescriptor(received[0], '__proto__')?.value).toBe('typed')
  })

  it.each(['constructor', 'toString'])('finds no field named %s for a customId param to collide with', name => {
    const button = createMockInteraction(ButtonInteraction, { customId: 'card/1' })

    expect(handlerInput(button, { [name]: '1' }).collisions).toEqual([])
  })
})
