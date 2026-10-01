import { Client, Events, GatewayDispatchEvents, GatewayIntentBits, type MessageReaction, Partials, Status } from 'discord.js'
import { vi } from 'vitest'
import { MeoCordFactory } from '@src/core/meocord-factory.js'
import { Controller, MeoCord, ReactionHandler } from '@src/decorator/index.js'

vi.mock('@src/util/meocord-config-loader.util.js', () => ({ loadMeoCordConfig: () => ({ discordToken: 'test-token' }) }))
vi.mock('@src/util/platform.util.js', () => ({ assertBuiltForThisPlatform: () => {} }))

const ana = { id: '200000000000000002', username: 'ana', discriminator: '0', bot: false, avatar: null, global_name: null }
const DM = '200000000000000001'
const MESSAGE = '200000000000000003'

const reacted: string[] = []

@Controller()
class Votes {
  @ReactionHandler('👍')
  up(reaction: MessageReaction) {
    reacted.push(`${reaction.message.channelId} ${reaction.emoji.name}`)
  }
}

@MeoCord({
  controllers: [Votes],
  clientOptions: {
    intents: [GatewayIntentBits.DirectMessages, GatewayIntentBits.DirectMessageReactions],
    partials: [Partials.Channel, Partials.Message, Partials.Reaction, Partials.User],
  },
})
class App {}

afterEach(() => {
  vi.restoreAllMocks()
})

// The app wires the delivery itself: a bot started from MeoCordFactory gets it with no setup of its own
it('delivers a reaction in a DM the bot has not cached to its @ReactionHandler', async () => {
  const clients: Client[] = []
  vi.spyOn(Client.prototype, 'login').mockImplementation(function (this: Client) {
    clients.push(this)
    return Promise.resolve('token')
  })
  vi.spyOn(Client.prototype, 'destroy').mockResolvedValue(undefined)
  const app = MeoCordFactory.create(App)
  await app.start()
  const [client] = clients
  // As a logged-in client is: ready, and knowing its own user
  ;(client.ws as unknown as { status: Status }).status = Status.Ready
  ;(client as unknown as { user: { id: string } }).user = { id: '100000000000000001' }
  const message = { id: MESSAGE, channel_id: DM, author: ana, content: 'vote here', timestamp: new Date(0).toISOString(), type: 0, attachments: [], embeds: [], mentions: [], mention_roles: [], pinned: false, tts: false, mention_everyone: false }
  const get = vi
    .spyOn(client.rest, 'get')
    .mockImplementation(route => Promise.resolve(route === `/channels/${DM}` ? { id: DM, type: 1, recipients: [ana] } : message))

  const packet = {
    op: 0,
    s: 1,
    t: GatewayDispatchEvents.MessageReactionAdd,
    d: { user_id: ana.id, channel_id: DM, message_id: MESSAGE, emoji: { id: null, name: '👍' }, burst: false, type: 0 },
  }
  client.emit(Events.Raw, packet, 0)
  ;(client.ws as unknown as { handlePacket(packet: object, shard: unknown): void }).handlePacket(packet, undefined)

  await vi.waitFor(() => expect(reacted).toEqual([`${DM} 👍`]))
  // The channel, once, then the message the bot holds by id alone, which the dispatcher reads whole
  expect(get.mock.calls.map(([route]) => route)).toEqual([`/channels/${DM}`, `/channels/${DM}/messages/${MESSAGE}`])
})
