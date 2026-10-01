import { Client, MessageReaction, type Message, type TextBasedChannel, type User } from 'discord.js'
import { vi } from 'vitest'
import { Controller, MeoCord, ReactionHandler } from '@src/decorator/index.js'
import { MeoCordTestingModule } from '@src/testing/index.js'

const seen: { content: string | null; count: number | null }[] = []

@Controller()
class Votes {
  @ReactionHandler('👍')
  up(reaction: MessageReaction) {
    seen.push({ content: reaction.message.content, count: reaction.count })
  }
}

@MeoCord({ controllers: [Votes], clientOptions: { intents: [] } })
class App {}

const author = { id: '200000000000000002', username: 'ana', discriminator: '0', bot: false, avatar: null, global_name: null }
const complete = {
  id: '200000000000000003',
  channel_id: '200000000000000001',
  author,
  content: 'vote here',
  timestamp: new Date(0).toISOString(),
  type: 0,
  attachments: [],
  embeds: [],
  mentions: [],
  mention_roles: [],
  pinned: false,
  tts: false,
  mention_everyone: false,
  reactions: [{ emoji: { id: null, name: '👍' }, count: 4, me: false, count_details: { burst: 0, normal: 4 } }],
}

// discord.js makes reactions itself, from the gateway's events
const Reaction = MessageReaction as unknown as new (client: Client, data: object, message: Message) => MessageReaction

/** A real client, its REST GETs counted, with a DM channel and a message in it, cached whole or only by id. */
function setUp(cached: 'whole' | 'id') {
  const client = new Client({ intents: [] })
  const channel = (client.channels as never as { _add(data: object): TextBasedChannel })._add({
    id: complete.channel_id,
    type: 1,
    recipients: [author],
  })
  const messages = channel.messages as never as { _add(data: object): Message }
  const message = messages._add(cached === 'whole' ? complete : { id: complete.id, channel_id: complete.channel_id })
  const get = vi.spyOn(client.rest, 'get').mockResolvedValue(complete)
  const user = (client.users as never as { _add(data: object): User })._add(author)
  const module = MeoCordTestingModule.create({ app: App, controllers: [Votes] }).compile()
  // A count of null is a partial reaction, as discord.js makes one for a message it holds only by id
  const react = (count: number | null) =>
    module.dispatch(new Reaction(client, { emoji: { id: null, name: '👍' }, me: false, count }, message), { user })
  return { client, message, get, react }
}

describe('a reaction to a message', () => {
  beforeEach(() => {
    seen.length = 0
  })

  it('reads a message the gateway keeps whole from the cache, with no request', async () => {
    const { client, message, get, react } = setUp('whole')
    expect(message.partial).toBe(false)

    for (let call = 0; call < 3; call++) await react(1)

    expect(get).not.toHaveBeenCalled()
    expect(seen).toEqual(Array(3).fill({ content: 'vote here', count: 1 }))
    await client.destroy()
  })

  it('fetches a message known only by its id, once, so the handler reads it whole', async () => {
    const { client, message, get, react } = setUp('id')
    expect(message.partial).toBe(true)

    await react(1)

    expect(get).toHaveBeenCalledTimes(1)
    expect(seen).toEqual([{ content: 'vote here', count: 1 }])
    await client.destroy()
  })

  // Under Partials.Reaction a reaction can arrive without its count; fetching it fetches its message too
  it('fetches a reaction without its count, once, so the handler reads the count', async () => {
    const { client, get, react } = setUp('whole')

    await react(null)

    expect(get).toHaveBeenCalledTimes(1)
    expect(seen).toEqual([{ content: 'vote here', count: 4 }])
    await client.destroy()
  })

  it('skips a reaction whose message it can no longer read', async () => {
    const { client, get, react } = setUp('id')
    get.mockRejectedValueOnce(new Error('Unknown Message'))

    await react(1)

    expect(get).toHaveBeenCalledTimes(1)
    expect(seen).toEqual([])
    await client.destroy()
  })
})
