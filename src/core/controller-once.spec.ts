import { vi } from 'vitest'
import { Client, type Message, MessageReaction, type TextBasedChannel, type User } from 'discord.js'

vi.mock('@src/util/meocord-config-loader.util.js', () => ({ loadMeoCordConfig: () => ({ discordToken: 'token' }) }))
vi.mock('@src/util/platform.util.js', () => ({ assertBuiltForThisPlatform: () => {} }))

import { Controller, MeoCord, MessageHandler, ReactionHandler } from '@src/decorator/index.js'
import { MeoCordFactory } from '@src/core/meocord-factory.js'
import { createMockMessage, MeoCordTestingModule } from '@src/testing/index.js'

const ran: string[] = []

@Controller()
class Log {
  @MessageHandler()
  all() {
    ran.push('listener')
  }

  @ReactionHandler('👍')
  thumbs() {
    ran.push('reaction')
  }
}

const author = { id: '200000000000000002', username: 'ana', discriminator: '0', bot: false, avatar: null, global_name: null }

// discord.js makes reactions itself, from the gateway's events
const Reaction = MessageReaction as unknown as new (client: Client, data: object, message: Message) => MessageReaction

/** A 👍 on a message cached whole in a DM, by a user the client knows. */
function thumbsUp(client: Client) {
  const channel = (client.channels as never as { _add(data: object): TextBasedChannel })._add({ id: '200000000000000001', type: 1, recipients: [author] })
  const message = (channel.messages as never as { _add(data: object): Message })._add({
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
  })
  const user = (client.users as never as { _add(data: object): User })._add({ ...author, id: '200000000000000004' })
  return { reaction: new Reaction(client, { emoji: { id: null, name: '👍' }, me: false, count: 1 }, message), user }
}

/** A message the bot receives from a user. */
function message(client: Client) {
  const received = createMockMessage({ content: 'hi' })
  Object.assign(received.author, { bot: false, id: 'user-1' })
  Object.defineProperty(received, 'client', { value: client })
  return received
}

describe('a controller listed twice', () => {
  beforeEach(() => void (ran.length = 0))
  afterEach(() => {
    vi.restoreAllMocks()
    process.removeAllListeners('SIGINT')
    process.removeAllListeners('SIGTERM')
  })

  it('runs its listener and reaction handler once each, in the bot', async () => {
    const clients: Client[] = []
    vi.spyOn(Client.prototype, 'login').mockImplementation(function (this: Client) {
      clients.push(this)
      return Promise.resolve('token')
    })
    @MeoCord({ controllers: [Log, Log], clientOptions: { intents: [] } })
    class App {}
    await MeoCordFactory.create(App).start()
    const client = clients[0]
    Object.defineProperty(client, 'user', { value: { id: '111', setActivity: () => {} }, configurable: true })
    const { reaction, user } = thumbsUp(client)

    for (const listener of client.listeners('messageCreate')) await (listener as (m: unknown) => Promise<void>)(message(client))
    for (const listener of client.listeners('messageReactionAdd')) await (listener as (r: unknown, u: unknown) => Promise<void>)(reaction, user)

    expect(ran).toEqual(['listener', 'reaction'])
  })

  it('runs its listener and reaction handler once each, in MeoCordTestingModule.create', async () => {
    const module = MeoCordTestingModule.create({ controllers: [Log, Log] }).compile()
    const { reaction, user } = thumbsUp(new Client({ intents: [] }))

    const { handlers } = await module.dispatch(createMockMessage({ content: 'hi' }))
    await module.dispatch(reaction, { user })

    expect(handlers).toHaveLength(1)
    expect(ran).toEqual(['listener', 'reaction'])
  })
})
