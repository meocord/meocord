import 'reflect-metadata'
import {
  ButtonInteraction,
  Collection,
  type GuildTextBasedChannel,
  type Interaction,
  type Message,
  MessageReaction,
  type PartialMessageReaction,
  type PartialUser,
  type User,
} from 'discord.js'
import { vi } from 'vitest'
import { Logger } from '@src/common/logger.js'
import { createTranslator, defineCatalog, ExecutionContext } from '@src/common/index.js'
import { translatorOfClient } from '@src/common/meocord-text.js'
import { Controller, Guard, MeoCord, MessageHandler, On, Once, UseGuard } from '@src/decorator/index.js'
import { forgetStrictMocks, useStrictMocks } from '@src/testing/strict-mocks.js'
import { createMockInteraction, createMockMessage, createMockUser, MeoCordTestingModule } from '@src/testing/index.js'

const seen: string[] = []

@Guard()
class Deny {
  constructor(private readonly context: ExecutionContext) {}
  canActivate() {
    seen.push(`Deny sees ${this.context.getType()}`)
    return false
  }
}

@Guard({ types: ['message'] })
class MessageOnly {
  canActivate() {
    seen.push('MessageOnly ran')
    return false
  }
}

@Guard({ types: ['reaction'] })
class ReactionOnly {
  canActivate() {
    seen.push('ReactionOnly ran')
    return false
  }
}

@Controller()
class Audit {
  @On('messageCreate')
  @UseGuard(MessageOnly)
  onMessage(_message: Message) {
    seen.push('onMessage ran')
  }

  @On('messageReactionAdd')
  @UseGuard(ReactionOnly)
  onReaction(_reaction: MessageReaction | PartialMessageReaction, _user: User | PartialUser) {
    seen.push('onReaction ran')
  }

  @On('interactionCreate')
  onInteraction(...args: unknown[]) {
    seen.push(`onInteraction ran with ${args.length}`)
  }

  @On('interactionCreate')
  @UseGuard(Deny)
  denied(_interaction: Interaction) {
    seen.push('denied ran')
  }

  @Once('messageCreate')
  @UseGuard(MessageOnly)
  onFirstMessage(_message: Message) {
    seen.push('onFirstMessage ran')
  }

  @On('messageCreate')
  @MessageHandler()
  @UseGuard(Deny)
  both(_message: Message) {
    seen.push('both ran')
  }
}

const reaction = (message: Message) => Object.create(MessageReaction.prototype, { message: { value: message } }) as MessageReaction
const warnings = () => vi.mocked(Logger.prototype.warn).mock.calls.map(([text]) => String(text)).filter(text => text.startsWith('invoke runs'))

beforeEach(() => {
  seen.length = 0
  forgetStrictMocks()
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())
afterAll(() => forgetStrictMocks())

describe('invoke on an @On or @Once handler, under useStrictMocks()', () => {
  beforeEach(() => useStrictMocks())

  it('runs it as an event, skipping a guard declared for messages or reactions, as emit does', async () => {
    const module = MeoCordTestingModule.create({ controllers: [Audit] }).compile()
    const message = createMockMessage({ content: 'hi' })

    const results = [
      await module.invoke(Audit, 'onMessage', message),
      await module.invoke(Audit, 'onReaction', reaction(message), createMockUser()),
      await module.invoke(Audit, 'onFirstMessage', message),
    ]

    expect(results.map(({ ran }) => ran)).toEqual([true, true, true])
    expect(seen).toEqual(['onMessage ran', 'onReaction ran', 'onFirstMessage ran'])
    expect(warnings()).toEqual([])
  })

  it('gives an interactionCreate handler the arguments as given, and a guard the type event, acknowledging nothing on a denial', async () => {
    const module = MeoCordTestingModule.create({ controllers: [Audit] }).compile()
    const button = createMockInteraction(ButtonInteraction, { customId: 'x' })

    await module.invoke(Audit, 'onInteraction', button)
    const { ran } = await module.invoke(Audit, 'denied', button)

    expect(ran).toBe(false)
    expect(seen).toEqual(['onInteraction ran with 1', 'Deny sees event'])
    expect([button.deferUpdate, button.reply, button.deferReply].map(answer => vi.mocked(answer).mock.calls.length)).toEqual([0, 0, 0])
  })

  it("sets the app's translator on the client of each argument, as emit does, when the first carries none", async () => {
    @Controller()
    class Bulk {
      @On('messageDeleteBulk')
      bulk(_messages: unknown, _channel: GuildTextBasedChannel) {}
    }
    const t = createTranslator({ default: 'en-US', locales: { 'en-US': defineCatalog({ hi: 'hi' }) } })
    @MeoCord({ controllers: [Bulk], i18n: t, clientOptions: { intents: [] } })
    class App {}
    const module = MeoCordTestingModule.fromApp(App).compile()
    const channel = createMockMessage({ content: 'hi' }).channel as GuildTextBasedChannel

    await module.invoke(Bulk, 'bulk', new Collection() as never, channel)

    expect(translatorOfClient(channel.client)).toBe(t)
  })

  it('keeps the message path for a method a route also reaches', async () => {
    const module = MeoCordTestingModule.create({ controllers: [Audit] }).compile()

    await module.invoke(Audit, 'both', createMockMessage({ content: 'hi' }))

    expect(seen).toEqual(['Deny sees message'])
  })
})

describe('invoke on an @On or @Once handler, without strict mocks', () => {
  it('runs it as before, warning once per handler that the bot runs it as an event', async () => {
    const module = MeoCordTestingModule.create({ controllers: [Audit] }).compile()
    const message = createMockMessage({ content: 'hi' })

    await module.invoke(Audit, 'onMessage', message)
    await module.invoke(Audit, 'onMessage', message)
    await module.invoke(Audit, 'onInteraction', createMockInteraction(ButtonInteraction, { customId: 'x' }))

    expect(seen).toEqual(['MessageOnly ran', 'MessageOnly ran', 'onInteraction ran with 2'])
    expect(warnings()).toEqual([
      "invoke runs Audit.onMessage, an @On('messageCreate') handler, as a message call; the bot runs it as an event " +
        'with its arguments as given, and useStrictMocks() runs it so.',
      "invoke runs Audit.onInteraction, an @On('interactionCreate') handler, as an interaction call with its params " +
        'added; the bot runs it as an event with its arguments as given, and useStrictMocks() runs it so.',
    ])
  })

  it('warns nothing for emit, for dispatch, or for a handler a route also reaches', async () => {
    const module = MeoCordTestingModule.create({ controllers: [Audit] }).compile()
    const message = createMockMessage({ content: 'hi' })

    await module.emit('messageCreate', message)
    await module.dispatch(message)
    await module.invoke(Audit, 'both', message)

    expect(warnings()).toEqual([])
  })
})
