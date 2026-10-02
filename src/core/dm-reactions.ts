import { type Client, Events, GatewayDispatchEvents, GatewayIntentBits, IntentsBitField, Status, version } from 'discord.js'
import { type Logger } from '@src/common/logger.js'

/** The discord.js action that turns each reaction event's payload into its client event. */
const ACTIONS = {
  [GatewayDispatchEvents.MessageReactionAdd]: 'MessageReactionAdd',
  [GatewayDispatchEvents.MessageReactionRemove]: 'MessageReactionRemove',
} as const

type ReactionAction = (typeof ACTIONS)[keyof typeof ACTIONS]
type ReactionActions = Record<ReactionAction, { handle(data: unknown): unknown }>

/** The part of a reaction event's payload this reads. */
interface ReactionPayload {
  channel_id: string
  guild_id?: string
}

/**
 * Delivers DM reactions discord.js drops: from 14.26.2 it makes an uncached channel only for an event marked as a DM,
 * which a reaction's is not, so a reaction in a DM unseen since startup reaches no listener, even with
 * `Partials.Channel`. This fetches such a channel once and hands the event back. Without the `DirectMessageReactions`
 * intent it does nothing; without the reaction actions it expects, it warns and does nothing.
 */
export function deliverUncachedDmReactions(client: Client, logger: Logger): void {
  const intents = client.options?.intents
  if (!intents || !new IntentsBitField(intents).has(GatewayIntentBits.DirectMessageReactions)) return
  const actions = (client as unknown as { actions?: Partial<ReactionActions> }).actions
  if (!Object.values(ACTIONS).every(name => typeof actions?.[name]?.handle === 'function')) {
    logger.warn(
      `discord.js ${version} does not handle reaction events where MeoCord expects, so a reaction in a direct message ` +
        'the bot has not cached since it started is not delivered.',
    )
    return
  }
  const handlers = actions as ReactionActions

  // Each uncached DM channel's reactions, in the order they arrived, behind the one fetch of the channel
  const queues = new Map<string, Promise<boolean>>()
  const fetchChannel = (id: string) =>
    client.channels.fetch(id).then(
      () => true,
      (error: unknown) => {
        logger.debug(`Skipping a reaction in a direct message whose channel could not be fetched: ${String(error)}`)
        return false
      },
    )
  const replay = (action: ReactionAction, data: ReactionPayload) => {
    const channelId = data.channel_id
    const tail = (queues.get(channelId) ?? fetchChannel(channelId)).then(fetched => {
      try {
        if (fetched) handlers[action].handle(data)
      } catch (error) {
        logger.debug(`Could not deliver a reaction in a direct message: ${String(error)}`)
      }
      return fetched
    })
    queues.set(channelId, tail)
    void tail.then(() => {
      if (queues.get(channelId) === tail) queues.delete(channelId)
    })
  }

  client.on(Events.Raw, (packet: { t?: string; d?: unknown }) => {
    const action = packet.t ? ACTIONS[packet.t as keyof typeof ACTIONS] : undefined
    const data = packet.d as ReactionPayload | undefined
    // A reaction without a guild is in a DM. Before ready, discord.js holds events back and handles them later
    if (!action || !data || data.guild_id !== undefined || client.ws.status !== Status.Ready) return
    // discord.js handles the event right after emitting it raw, in the same turn; once it has, a channel it now
    // holds means it delivered the reaction itself, and one it still lacks means the reaction was dropped
    queueMicrotask(() => {
      if (!client.channels.cache.has(data.channel_id)) replay(action, data)
    })
  })
}
