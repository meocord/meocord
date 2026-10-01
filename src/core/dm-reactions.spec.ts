import { Client, Events, GatewayDispatchEvents, GatewayIntentBits, Partials, Status, version } from 'discord.js'
import { vi } from 'vitest'
import { deliverUncachedDmReactions } from '@src/core/dm-reactions.js'
import { type Logger } from '@src/common/logger.js'

const ana = { id: '200000000000000002', username: 'ana', discriminator: '0', bot: false, avatar: null, global_name: null }
const DM = '200000000000000001'
const MESSAGE = '200000000000000003'
const GUILD = '300000000000000001'

/** A reaction event's payload, as Discord sends it for a DM, or for a server with `guild_id`. */
const reactionPayload = (emoji: string, guildId?: string) => ({
  user_id: ana.id,
  channel_id: DM,
  message_id: MESSAGE,
  emoji: { id: null, name: emoji },
  burst: false,
  type: 0,
  ...(guildId === undefined ? {} : { guild_id: guildId }),
})

/**
 * A real client, ready, with the delivery attached and its REST GETs answered by `channel`. `send` hands it a gateway
 * event as discord.js's own gateway does: emitted raw, then handled in the same turn.
 */
function setUp({ intents = [GatewayIntentBits.DirectMessages, GatewayIntentBits.DirectMessageReactions] } = {}) {
  const client = new Client({ intents, partials: [Partials.Channel, Partials.Message, Partials.Reaction, Partials.User] })
  // As a logged-in client is: ready, and knowing its own user
  ;(client.ws as unknown as { status: Status }).status = Status.Ready
  ;(client as unknown as { user: { id: string } }).user = { id: '100000000000000001' }
  const get = vi.spyOn(client.rest, 'get').mockResolvedValue({ id: DM, type: 1, recipients: [ana] })
  const logger = { warn: vi.fn(), debug: vi.fn() }
  deliverUncachedDmReactions(client, logger as unknown as Logger)
  const delivered: string[] = []
  client.on(Events.MessageReactionAdd, reaction => void delivered.push(`add ${reaction.emoji.name}`))
  client.on(Events.MessageReactionRemove, reaction => void delivered.push(`remove ${reaction.emoji.name}`))
  const send = (t: GatewayDispatchEvents, d: object) => {
    const packet = { op: 0, s: 1, t, d }
    client.emit(Events.Raw, packet, 0)
    ;(client.ws as unknown as { handlePacket(packet: object, shard: unknown): void }).handlePacket(packet, undefined)
  }
  return { client, get, logger, delivered, send }
}

/** Lets the fetch and the replays that follow it run. */
const settle = () => new Promise(resolve => setTimeout(resolve, 10))

describe('a reaction in a direct message the bot has not cached', () => {
  it.each([
    [GatewayDispatchEvents.MessageReactionAdd, 'add 👍'],
    [GatewayDispatchEvents.MessageReactionRemove, 'remove 👍'],
  ])('is delivered once, %s, after one fetch of its channel', async (event, expected) => {
    const { client, get, delivered, send } = setUp()

    send(event, reactionPayload('👍'))
    await settle()

    expect(delivered).toEqual([expected])
    expect(get.mock.calls.map(([route]) => route)).toEqual([`/channels/${DM}`])
    await client.destroy()
  })

  it('makes no request for a later reaction in the same DM, which discord.js delivers itself', async () => {
    const { client, get, delivered, send } = setUp()
    send(GatewayDispatchEvents.MessageReactionAdd, reactionPayload('👍'))
    await settle()

    send(GatewayDispatchEvents.MessageReactionRemove, reactionPayload('👍'))
    await settle()

    expect(delivered).toEqual(['add 👍', 'remove 👍'])
    expect(get).toHaveBeenCalledTimes(1)
    await client.destroy()
  })

  it('fetches the channel once for reactions that arrive while it is fetched, and delivers them in order', async () => {
    const { client, get, delivered, send } = setUp()
    let answer!: () => void
    get.mockImplementationOnce(() => new Promise(resolve => (answer = () => resolve({ id: DM, type: 1, recipients: [ana] }))))

    send(GatewayDispatchEvents.MessageReactionAdd, reactionPayload('👍'))
    send(GatewayDispatchEvents.MessageReactionAdd, reactionPayload('🎉'))
    send(GatewayDispatchEvents.MessageReactionRemove, reactionPayload('👍'))
    await settle()
    answer()
    await settle()

    expect(get).toHaveBeenCalledTimes(1)
    expect(delivered).toEqual(['add 👍', 'add 🎉', 'remove 👍'])
    await client.destroy()
  })

  it('is skipped, at debug, when its channel cannot be fetched', async () => {
    const { client, get, logger, delivered, send } = setUp()
    get.mockRejectedValueOnce(new Error('Missing Access'))

    send(GatewayDispatchEvents.MessageReactionAdd, reactionPayload('👍'))
    await settle()

    expect(delivered).toEqual([])
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('could not be fetched: Error: Missing Access'))
    await client.destroy()
  })
})

describe('a reaction discord.js handles itself', () => {
  it('in a DM it has cached is delivered once, with no request', async () => {
    const { client, get, delivered, send } = setUp()
    ;(client.channels as unknown as { _add(data: object): unknown })._add({ id: DM, type: 1, recipients: [ana] })

    send(GatewayDispatchEvents.MessageReactionAdd, reactionPayload('👍'))
    await settle()

    expect(delivered).toEqual(['add 👍'])
    expect(get).not.toHaveBeenCalled()
    await client.destroy()
  })

  it('in a server is left to discord.js, with no request', async () => {
    const { client, get, send } = setUp()

    send(GatewayDispatchEvents.MessageReactionAdd, reactionPayload('👍', GUILD))
    await settle()

    expect(get).not.toHaveBeenCalled()
    await client.destroy()
  })
})

describe('the delivery', () => {
  it('is not attached without the DirectMessageReactions intent, when no DM reaction arrives', async () => {
    const { client, get, delivered, send } = setUp({ intents: [GatewayIntentBits.DirectMessages] })

    send(GatewayDispatchEvents.MessageReactionAdd, reactionPayload('👍'))
    await settle()

    expect(delivered).toEqual([])
    expect(get).not.toHaveBeenCalled()
    await client.destroy()
  })

  it('warns, naming the discord.js version, and stays off when discord.js has no reaction actions where expected', async () => {
    const client = new Client({ intents: [GatewayIntentBits.DirectMessageReactions] })
    Object.defineProperty(client, 'actions', { value: {} })
    const logger = { warn: vi.fn(), debug: vi.fn() }
    const raw = vi.spyOn(client, 'on')

    deliverUncachedDmReactions(client, logger as unknown as Logger)

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(`discord.js ${version} does not handle reaction events`))
    expect(raw).not.toHaveBeenCalled()
    await client.destroy()
  })
})
