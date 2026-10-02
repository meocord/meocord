import 'reflect-metadata'
import {
  AutocompleteInteraction,
  ButtonInteraction,
  ChatInputCommandInteraction,
  type Message,
  type MessageReaction,
} from 'discord.js'
import {
  Autocomplete,
  Catch,
  Command,
  Controller,
  MeoCord,
  MessageHandler,
  Observer,
  ReactionHandler,
  UseFilter,
} from '@src/decorator/index.js'
import { CommandType, ReactionHandlerAction } from '@src/enum/index.js'
import { CommandNotFoundError, MessageUsageError, UserError } from '@src/common/errors.js'
import { type DispatchObserver, type ExceptionFilter, type ReactionEvent } from '@src/interface/index.js'
import { type DispatchedCall, MeoCordTestingModule } from './meocord-testing-module.js'
import { resolveRoute } from './routing.js'
import { createChatInputOptions, createMock, createMockInteraction, createMockMessage, createMockUser } from './mock-interaction.js'

const calls: string[] = []

class Handled extends Error {}

@Catch(Handled)
class HandledFilter implements ExceptionFilter<Handled> {
  async catch() {
    calls.push('filter')
  }
}

@Controller()
class CardController {
  @Command('card/{id}', CommandType.BUTTON)
  card(_interaction: ButtonInteraction, { id }: { id: string }) {
    calls.push(`card ${id}`)
  }

  @Command('card/summary/{id}', CommandType.BUTTON)
  summary(_interaction: ButtonInteraction, { id }: { id: string }) {
    calls.push(`summary ${id}`)
  }

  @Command('boom', CommandType.BUTTON)
  boom() {
    throw new Error('boom')
  }

  @Command('refuse', CommandType.BUTTON)
  refuse() {
    throw new UserError('You cannot do that.')
  }

  @UseFilter(HandledFilter)
  @Command('handled', CommandType.BUTTON)
  handled() {
    throw new Handled('handled')
  }
}

@Controller()
class PingController {
  @Command('ping', CommandType.SLASH)
  ping() {
    calls.push('ping')
  }

  @Autocomplete('ping', 'target')
  complete() {
    calls.push('complete target')
  }
}

@Controller()
class TalkController {
  @MessageHandler('roll {sides:int}')
  roll(_message: Message, { sides }: { sides: number }) {
    calls.push(`roll ${sides}`)
  }

  @MessageHandler()
  listen(message: Message) {
    calls.push(`heard ${message.content}`)
  }

  @ReactionHandler('👍')
  thumbs(_reaction: MessageReaction, { action }: ReactionEvent) {
    calls.push(`thumbs ${action}`)
  }
}

const told: string[] = []

@Observer()
class Counting implements DispatchObserver {
  async onSettled(_context: unknown, result: { outcome: string }) {
    await new Promise(resolve => setTimeout(resolve, 5))
    told.push(result.outcome)
  }
}

@MeoCord({
  controllers: [CardController, PingController, TalkController],
  messages: { prefix: '!' },
  observers: [Counting],
  clientOptions: { intents: [] },
})
class App {}

const compile = () => MeoCordTestingModule.create({ app: App, controllers: [CardController, PingController, TalkController] }).compile()
const button = (customId: string) => createMockInteraction(ButtonInteraction, { customId })
const handlers = (result: DispatchedCall) => result.handlers.map(({ controller, method, ran }) => `${controller.name}.${method} ${ran}`)

beforeEach(() => {
  calls.length = 0
  told.length = 0
})

describe('TestingModule.dispatch', () => {
  it('routes a button to the most specific pattern, with its params, and says which handler ran', async () => {
    const result = await compile().dispatch(button('card/summary/7'))

    expect(calls).toEqual(['summary 7'])
    expect(result.ran).toBe(true)
    expect(handlers(result)).toEqual(['CardController.summary true'])
  })

  it('routes a slash command by name, and an autocomplete to its option', async () => {
    const module = compile()

    await module.dispatch(createMockInteraction(ChatInputCommandInteraction, { commandName: 'ping' }))
    const autocomplete = createMockInteraction(AutocompleteInteraction, { commandName: 'ping' })
    autocomplete.options = createChatInputOptions({ focused: 'target', target: 'a' }) as never
    await module.dispatch(autocomplete)

    expect(calls).toEqual(['ping', 'complete target'])
  })

  it('resolves with CommandNotFoundError for an interaction nothing handles, answered as the bot answers it', async () => {
    const interaction = button('nowhere')

    const result = await compile().dispatch(interaction)

    expect(result).toEqual({ ran: false, handlers: [], error: expect.any(CommandNotFoundError) })
    expect(interaction.reply).toHaveBeenCalled()
  })

  it('rejects with an error no filter handles, once the fallback has answered the user', async () => {
    const interaction = button('boom')

    await expect(compile().dispatch(interaction)).rejects.toThrow('boom')

    expect(interaction.reply).toHaveBeenCalled()
  })

  // The user is told, as the fallback means it: an outcome to assert on, not a failure
  it("resolves with an error the fallback answers as the user's own, having told the user", async () => {
    const interaction = button('refuse')

    const result = await compile().dispatch(interaction)

    expect(result.error).toBeInstanceOf(UserError)
    expect(result.handlers).toEqual([{ controller: CardController, method: 'refuse', ran: true, error: expect.any(UserError) }])
    expect(interaction.reply).toHaveBeenCalled()
  })

  it('resolves with an error a filter handled, on the handler that threw it', async () => {
    const result = await compile().dispatch(button('handled'))

    expect(calls).toEqual(['filter'])
    expect(result.error).toBeInstanceOf(Handled)
    // It ran, then threw
    expect(result.handlers).toEqual([{ controller: CardController, method: 'handled', ran: true, error: expect.any(Handled) }])
  })

  it('runs the patterned message handler, then every listener, in order', async () => {
    const result = await compile().dispatch(createMockMessage({ content: '!roll 20' }))

    expect(calls).toEqual(['roll 20', 'heard !roll 20'])
    expect(handlers(result)).toEqual(['TalkController.roll true', 'TalkController.listen true'])
  })

  it('resolves with the MessageUsageError a misused command gets, having replied with the usage', async () => {
    const message = createMockMessage({ content: '!roll lots' })

    const result = await compile().dispatch(message)

    expect(result.error).toBeInstanceOf(MessageUsageError)
    expect(message.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Usage: !roll <sides>') }))
  })

  it("answers a parent with no handler with its subcommands' usage, which no handler, resolveRoute or invoke takes", async () => {
    @Controller()
    class Settings {
      @MessageHandler('settings get {key}')
      get() {}

      @MessageHandler('settings set {key} {value}')
      set() {}
    }
    @MeoCord({ controllers: [Settings], clientOptions: { intents: [] }, messages: { prefix: '!' } })
    class SettingsApp {}
    const module = MeoCordTestingModule.create({ app: SettingsApp, controllers: [Settings] }).compile()
    const message = createMockMessage({ content: '!settings' })

    const result = await module.dispatch(message)

    expect(result.error).toBeInstanceOf(MessageUsageError)
    expect(result.handlers).toEqual([])
    expect(message.reply).toHaveBeenCalledWith(expect.objectContaining({ content: 'Usage:\n!settings get <key>\n!settings set <key> <value>' }))
    expect(resolveRoute(SettingsApp, { content: '!settings' })).toBeUndefined()
    await expect(module.invoke(Settings, 'get', createMockMessage({ content: '!settings' }))).rejects.toThrow("does not match Settings.get's pattern")
  })

  it('skips a message from a bot, as the bot does', async () => {
    const message = createMockMessage({ content: '!roll 20' })
    Object.assign(message.author, { bot: true })

    expect(await compile().dispatch(message)).toEqual({ ran: false, handlers: [] })
    expect(calls).toEqual([])
  })

  it('runs a reaction handler, adding by default', async () => {
    const reaction = createMock<MessageReaction>({ emoji: { name: '👍' } as never, message: createMockMessage() as never })
    const user = createMockUser()

    const added = await compile().dispatch(reaction, { user })
    await compile().dispatch(reaction, { user, action: ReactionHandlerAction.REMOVE })

    expect(calls).toEqual(['thumbs ADD', 'thumbs REMOVE'])
    expect(handlers(added)).toEqual(['TalkController.thumbs true'])
  })

  it('waits for the observers before it resolves', async () => {
    await compile().dispatch(button('card/1'))

    expect(told).toEqual(['ran'])
  })
})
