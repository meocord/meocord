import { type Message } from 'discord.js'
import { Controller, MeoCord, MessageHandler } from '@src/decorator/index.js'
import { type MessageCommandOptions, type MessageHandlerOptions } from '@src/interface/index.js'
import { buildMessageRoutes } from '@src/core/message-routes.js'
import { createMockGuild, createMockMessage, MeoCordTestingModule } from '@src/testing/index.js'

/** Two controllers each answering `ping`, the first with `first` options and the second with `second`. */
function pair(first: MessageHandlerOptions, second: MessageHandlerOptions) {
  @Controller()
  class First {
    @MessageHandler('ping', first)
    ping() {}
  }
  @Controller()
  class Second {
    @MessageHandler('ping', second)
    ping() {}
  }
  return [First, Second]
}

const refused = (controllers: (new () => object)[], options: MessageCommandOptions) => {
  try {
    buildMessageRoutes(controllers, options)
    return 'accepted'
  } catch (error) {
    return /match the same messages/.test((error as Error).message) ? 'refused' : (error as Error).message
  }
}

describe('message handlers whose starts overlap', () => {
  it("are refused when one's own prefix is the app's, in either controller order", () => {
    const [own, app] = pair({ prefix: '!' }, {})
    expect(refused([own, app], { prefix: '!' })).toBe('refused')
    expect(refused([app, own], { prefix: '!' })).toBe('refused')
  })

  it('are refused when their own prefixes share one', () => {
    const [one, two] = pair({ prefix: '!' }, { prefix: ['?', '!'] })
    expect(refused([one, two], {})).toBe('refused')
  })

  it("are refused when one takes the message as it is and the app has no prefix", () => {
    const [none, app] = pair({ prefix: false }, {})
    expect(refused([none, app], {})).toBe('refused')
  })

  it('are refused when a mention starts both in a server', () => {
    const [mentioned, app] = pair({ mention: 'only', scope: 'guild' }, { scope: 'guild' })
    expect(refused([mentioned, app], { prefix: '!', mention: true })).toBe('refused')
  })

  it('are kept when their starts share none, or the app reads its prefix from a function', () => {
    const [bang, question] = pair({ prefix: '!' }, {})
    expect(refused([bang, question], { prefix: '?' })).toBe('accepted')
    expect(refused([bang, question], { prefix: () => '?' })).toBe('accepted')
    const [mentioned, app] = pair({ mention: 'only', scope: 'guild' }, { scope: 'guild' })
    expect(refused([mentioned, app], { prefix: '!' })).toBe('accepted')
  })
})

describe('a prefix function', () => {
  const ran: string[] = []

  @Controller()
  class Dice {
    @MessageHandler('roll {sides:int}')
    roll(message: Message) {
      ran.push(message.content)
    }
  }

  const prefixes: Record<string, unknown> = {}
  @MeoCord({
    controllers: [Dice],
    clientOptions: { intents: [] },
    messages: { prefix: (message: Message) => prefixes[message.guildId ?? ''] as string },
  })
  class App {}

  const send = async (content: string, found: unknown) => {
    const guild = createMockGuild()
    prefixes[guild.id] = found
    await MeoCordTestingModule.fromApp(App).compile().dispatch(createMockMessage({ content, guild }))
  }

  beforeEach(() => (ran.length = 0))

  it('that finds no prefix for a server starts no command there', async () => {
    for (const found of [[], undefined, null]) await send('roll 20', found)
    expect(ran).toEqual([])
  })

  it("starts a command after a prefix it finds, and takes the message as it is only for an explicit ''", async () => {
    await send('!roll 6', ['!'])
    await send('roll 8', '')
    expect(ran).toEqual(['!roll 6', 'roll 8'])
  })
})
