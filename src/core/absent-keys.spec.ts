import { ButtonInteraction, ChatInputCommandInteraction, Client, Message, MessageReaction, StringSelectMenuInteraction } from 'discord.js'
import { bindTheme } from '@src/common/index.js'
import { readyBoundOf } from '@src/core/ready-gate.js'
import { themeTargets } from '@src/core/theme-resolvers.js'
import { quietReads } from '@src/util/quiet-reads.util.js'
import { Command, Controller } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { createMockInteraction, createMockMessage, createMockUser, MeoCordTestingModule } from '@src/testing/index.js'

/** Each handler's params, by handler. */
const received: [handler: string, params: unknown][] = []

@Controller()
class ItemController {
  @Command('item/{id}', CommandType.BUTTON)
  async open(_interaction: ButtonInteraction, params: { id: string }) {
    received.push(['open', params])
  }

  @Command('pick', CommandType.SELECT_MENU)
  async pick(_interaction: StringSelectMenuInteraction, params: { values: string[] }) {
    received.push(['pick', params])
  }

  @Command('ping', CommandType.SLASH)
  async ping() {
    received.push(['ping', undefined])
  }
}

/** Counts the reads of `key` on a mock, keeping what is written to it. */
function watch(mock: object, key: string): { reads: number; written: unknown } {
  const watched = { reads: 0, written: undefined as unknown }
  Object.defineProperty(mock, key, {
    configurable: true,
    get: () => {
      watched.reads++
      return watched.written
    },
    set: value => {
      watched.written = value
    },
  })
  return watched
}

beforeEach(() => {
  received.length = 0
})

describe('a dispatch reads no key the interaction’s class lacks', () => {
  const module = MeoCordTestingModule.create({ controllers: [ItemController] }).compile()

  it('passes a component’s route params to its handler without reading dynamicParams back, and still writes it', async () => {
    const press = createMockInteraction(ButtonInteraction, { customId: 'item/7' })
    const dynamicParams = watch(press, 'dynamicParams')

    await module.dispatch(press)

    expect(received).toEqual([['open', { id: '7' }]])
    expect(dynamicParams.reads).toBe(0)
    expect(dynamicParams.written).toEqual({ id: '7' })
  })

  it('reads no dynamicParams for a command, which matches no pattern', async () => {
    const command = createMockInteraction(ChatInputCommandInteraction, { commandName: 'ping' })
    const dynamicParams = watch(command, 'dynamicParams')

    await module.dispatch(command)

    expect(received).toEqual([['ping', undefined]])
    expect(dynamicParams.reads).toBe(0)
  })

  it('reads no values on a button, which has none', async () => {
    const press = createMockInteraction(ButtonInteraction, { customId: 'item/7' })
    const values = watch(press, 'values')

    await module.dispatch(press)

    expect(values.reads).toBe(0)
  })

  it('reads a select menu’s values', async () => {
    const select = createMockInteraction(StringSelectMenuInteraction, { customId: 'pick', values: ['a', 'b'] })

    await module.dispatch(select)

    expect(received).toEqual([['pick', { values: ['a', 'b'] }]])
  })
})

describe('a call’s server and user, for its theme, are read from keys its class has', () => {
  it('reads a message’s author, not a user', () => {
    const message = createMockMessage({ author: createMockUser({ id: '20' }) })
    const user = watch(message, 'user')

    expect(themeTargets([message])).toEqual({ guildId: message.guildId, userId: '20' })
    expect(user.reads).toBe(0)
  })

  /** A partial message, as discord.js makes one from an update it hasn't cached: it has no author. */
  const partialMessage = (client: Client) =>
    new (Message as unknown as new (client: Client, data: object) => Message)(client, { id: '30', channel_id: '40' })

  it('takes the user a call gives second for a partial message, which has no author, as a User or as { user }', () => {
    const client = new Client({ intents: [] })
    const user = (client.users as unknown as { _add(data: object): object })._add({ id: '20', username: 'u', discriminator: '0' })
    const partial = partialMessage(client)

    expect(partial.author).toBeNull()
    expect(themeTargets([partial, user])).toEqual({ guildId: undefined, userId: '20' })
    expect(themeTargets([partial, { user }])).toEqual({ guildId: undefined, userId: '20' })
  })

  it('reads a second argument’s user quietly, since an update’s new message has none', () => {
    const before = partialMessage(new Client({ intents: [] }))
    const after = createMockMessage()
    const quiet: boolean[] = []
    Object.defineProperty(after, 'user', { configurable: true, get: () => void quiet.push(quietReads()) })

    themeTargets([before, after])

    expect(quiet).toEqual([true])
  })

  it('reads an interaction’s user, not an author', () => {
    const press = createMockInteraction(ButtonInteraction, { guildId: '10', user: createMockUser({ id: '20' }) })
    const author = watch(press, 'author')

    expect(themeTargets([press])).toEqual({ guildId: '10', userId: '20' })
    expect(author.reads).toBe(0)
  })

  it('reads a reaction’s message for its server, and the user who reacted, given as a User or as { user }', () => {
    const message = createMockMessage()
    const reaction = createMockInteraction(MessageReaction, { message })
    const absent = ['guildId', 'guild', 'user', 'author'].map(key => watch(reaction, key))
    const reacting = createMockUser({ id: '20' })

    expect(themeTargets([reaction, reacting])).toEqual({ guildId: message.guildId, userId: '20' })
    expect(themeTargets([reaction, { user: reacting }])).toEqual({ guildId: message.guildId, userId: '20' })
    expect(absent.map(key => key.reads)).toEqual([0, 0, 0, 0])
  })

  it('reads an event argument’s keys quietly, any of which its class may lack', () => {
    const before = createMockUser({ id: '20' })
    const after = createMockUser({ id: '21' })
    const quiet: boolean[] = []
    for (const key of ['guildId', 'guild', 'message', 'user', 'author']) {
      Object.defineProperty(before, key, { configurable: true, get: () => void quiet.push(quietReads()) })
    }

    expect(themeTargets([before, after])).toEqual({ guildId: undefined, userId: '21' })
    expect(quiet).toEqual([true, true, true, true, true])
    expect(quietReads()).toBe(false)
  })
})

describe('a bound call’s wait for its app to be ready', () => {
  it('asks its first argument, which may be any value, whether it is an interaction, quietly', () => {
    const message = createMockMessage()
    const quiet: boolean[] = []
    for (const key of ['isAutocomplete', 'isRepliable']) {
      Object.defineProperty(message, key, { configurable: true, get: () => void quiet.push(quietReads()) })
    }

    expect(readyBoundOf([message])).toBeUndefined()
    expect(quiet).toEqual([true, true])
  })
})

describe('a function bound outside any call finds its app by its first argument’s client', () => {
  it('reads the client of an object of the app’s own that holds one', () => {
    const wrapper = { reason: 'idle' }
    const client = watch(wrapper, 'client')

    bindTheme((_wrapper: object) => undefined)(wrapper)

    expect(client.reads).toBe(1)
  })
})
