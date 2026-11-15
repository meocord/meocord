import 'reflect-metadata'
import {
  AuthorizingIntegrationOwners,
  ButtonInteraction,
  ChatInputCommandInteraction,
  type Client,
  type CollectedInteraction,
  Collection,
  ComponentType,
  DMChannel,
  Guild,
  type Interaction,
  InteractionCollector,
  type InteractionResponse,
  type Message,
  StringSelectMenuInteraction,
  TextChannel,
} from 'discord.js'
import { vi } from 'vitest'
import { Logger } from '@src/common/index.js'
import { forgetDeprecationWarnings } from '@src/common/deprecation.js'
import { createMockChannel, createMockClient, createMockGuild, createMockInteraction, createMockMessage } from '@src/testing/index.js'
import { forgetStrictMocks, useStrictMocks } from '@src/testing/strict-mocks.js'

// discord.js's own InteractionCollector on a mock client, under strict mocks. It reads, in its constructor, a message's
// id, channelId and guildId (and the raw channel_id and guild_id), a response's id and its interaction's message,
// channelId and guildId, and resolves a channel's or a guild's id through the client's managers; collect() then reads
// each interaction's type, componentType, message.id, message.interactionMetadata.id, channelId and guildId
// (discord.js 14.27.0, src/structures/InteractionCollector.js:65-90 and 190-210).

beforeEach(() => {
  forgetStrictMocks()
  forgetDeprecationWarnings()
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  useStrictMocks()
})
afterEach(() => {
  forgetStrictMocks()
  vi.restoreAllMocks()
})

/** What a collector collected once `interactions` reached the client, as the gateway delivers them. */
async function collected(collector: InteractionCollector<CollectedInteraction>, client: Client, ...interactions: Interaction[]): Promise<string[]> {
  const ids: string[] = []
  collector.on('collect', interaction => void ids.push(interaction.id))
  for (const interaction of interactions) client.emit('interactionCreate', interaction)
  // handleCollect awaits collect() before it emits 'collect'
  await new Promise(resolve => setImmediate(resolve))
  collector.stop()
  return ids
}

/** A command answered in `channel`, with the message it sent. */
async function answered(client: Client<true>, channel: TextChannel | DMChannel) {
  const command = createMockInteraction(ChatInputCommandInteraction, { commandName: 'panel', client, channel } as never)
  const response = (await command.reply({ content: 'Pick one.' })) as unknown as InteractionResponse
  const message = (await command.fetchReply()) as Message
  return { command, response, message }
}

const click = (client: Client<true>, props: Record<string, unknown>) =>
  createMockInteraction(ButtonInteraction, { customId: 'pick', client, ...props } as never) as unknown as Interaction

describe("discord.js's InteractionCollector on a mock client, under strict mocks", () => {
  it('collects the clicks on the message it was given, in a server', async () => {
    const client = createMockClient()
    const channel = createMockChannel(TextChannel)
    const { message } = await answered(client, channel)
    const other = createMockMessage({ channel } as never)
    const collector = new InteractionCollector(client, { message })

    const ids = await collected(collector, client, click(client, { message, channel, id: '100000000000000101' }), click(client, { message: other, channel, id: '100000000000000102' }))

    expect(collector.guildId).toBe(channel.guild.id)
    expect(ids).toEqual(['100000000000000101'])
  })

  it('collects the clicks on the message it was given, in a direct message', async () => {
    const client = createMockClient()
    const channel = createMockChannel(DMChannel)
    const { message } = await answered(client, channel)
    const collector = new InteractionCollector(client, { message })

    const ids = await collected(collector, client, click(client, { message, channel, id: '100000000000000103' }))

    expect(collector.guildId).toBeNull()
    expect(collector.channelId).toBe(channel.id)
    expect(ids).toEqual(['100000000000000103'])
  })

  // It matches a click by the interaction its message names, and passes one on a message that names none (:196-201)
  it("collects the clicks on a response's message, as createMessageComponentCollector() builds it", async () => {
    const client = createMockClient()
    const channel = createMockChannel(TextChannel)
    const { command, response, message } = await answered(client, channel)
    const { message: another } = await answered(client, channel)
    const plain = createMockMessage({ channel } as never)
    const collector = new InteractionCollector(client, { interactionResponse: response })

    const ids = await collected(
      collector,
      client,
      click(client, { message, channel, id: '100000000000000104' }),
      click(client, { message: another, channel, id: '100000000000000105' }),
      click(client, { message: plain, channel, id: '100000000000000112' }),
    )

    expect(collector.messageId).toBeNull()
    expect(collector.messageInteractionId).toBe(response.id)
    expect(message.interactionMetadata?.id).toBe(command.id)
    expect(ids).toEqual(['100000000000000104', '100000000000000112'])
  })

  it('collects only the clicks in the channel it was given', async () => {
    const client = createMockClient()
    const guild = createMockGuild()
    const channel = createMockChannel(TextChannel, { guild } as never)
    const elsewhere = createMockChannel(TextChannel, { guild } as never)
    const collector = new InteractionCollector(client, { channel })

    const ids = await collected(collector, client, click(client, { channel, id: '100000000000000106' }), click(client, { channel: elsewhere, id: '100000000000000107' }))

    expect(collector.channelId).toBe(channel.id)
    expect(ids).toEqual(['100000000000000106'])
  })

  it('collects only the clicks in the server it was given', async () => {
    const client = createMockClient()
    const guild = createMockGuild()
    const other = createMockGuild()
    const collector = new InteractionCollector(client, { guild: guild as unknown as Guild })

    const ids = await collected(
      collector,
      client,
      click(client, { channel: createMockChannel(TextChannel, { guild } as never), id: '100000000000000108' }),
      click(client, { channel: createMockChannel(TextChannel, { guild: other } as never), id: '100000000000000109' }),
    )

    expect(collector.guildId).toBe(guild.id)
    expect(ids).toEqual(['100000000000000108'])
  })

  it('collects only the component type it was given', async () => {
    const client = createMockClient()
    const collector = new InteractionCollector(client, { componentType: ComponentType.StringSelect })
    const select = createMockInteraction(StringSelectMenuInteraction, { customId: 'pick', client, id: '100000000000000110' } as never)

    const ids = await collected(collector, client, click(client, { id: '100000000000000111' }), select as unknown as Interaction)

    expect(ids).toEqual(['100000000000000110'])
  })

  it.each([
    ['its message', 'messageDelete', (message: Message) => [message]],
    ['its channel', 'channelDelete', (message: Message) => [message.channel]],
    ['its server', 'guildDelete', (message: Message) => [message.guild]],
    ['in a bulk delete', 'messageDeleteBulk', (message: Message) => [new Collection([[message.id, message]]), message.channel]],
  ] as const)('ends when %s is deleted', async (_label, event, args) => {
    const client = createMockClient()
    const { message } = await answered(client, createMockChannel(TextChannel))
    const collector = new InteractionCollector(client, { message })
    const ended = new Promise(resolve => collector.once('end', (_collected, reason) => resolve(reason)))

    client.emit(event, ...(args(message) as [never]))

    await expect(ended).resolves.toBe(event === 'messageDeleteBulk' ? 'messageDelete' : event)
  })
})

// discord.js builds interactionMetadata from Discord's interaction_metadata (src/util/Transformers.js:52-66)
describe("the messages a mock interaction sends, under strict mocks", () => {
  it('name the interaction, and a follow-up the original response', async () => {
    const client = createMockClient()
    const { command, message } = await answered(client, createMockChannel(TextChannel))
    const followUp = (await command.followUp({ content: 'More.' })) as Message

    expect(message.interactionMetadata).toMatchObject({ id: command.id, type: command.type, user: command.user, originalResponseMessageId: null, interactedMessageId: null })
    expect(followUp.interactionMetadata).toMatchObject({ id: command.id, originalResponseMessageId: message.id })
    expect((await command.fetchReply(followUp.id)).interactionMetadata?.originalResponseMessageId).toBe(message.id)
  })

  // An interaction's own, as discord.js builds it, and the message's built again from the same data
  it('carry the integration owners: the server the app is installed to, or "0" in a direct message with the bot', async () => {
    const client = createMockClient()
    const { command, message } = await answered(client, createMockChannel(TextChannel))
    const { message: inDm } = await answered(client, createMockChannel(DMChannel))
    const owners = message.interactionMetadata?.authorizingIntegrationOwners

    expect(command.authorizingIntegrationOwners).toBeInstanceOf(AuthorizingIntegrationOwners)
    expect(command.authorizingIntegrationOwners.guildId).toBe(command.guildId)
    expect(owners).toBeInstanceOf(AuthorizingIntegrationOwners)
    expect(owners).not.toBe(command.authorizingIntegrationOwners)
    expect(owners?.guildId).toBe(command.guildId)
    expect(inDm.interactionMetadata?.authorizingIntegrationOwners.guildId).toBe('0')
  })

  it("name, on a component's reply, the message the component was on, and leave the updated message's own", async () => {
    const client = createMockClient()
    const panel = createMockMessage()
    const clicked = createMockInteraction(ButtonInteraction, { customId: 'pick', client, message: panel } as never)
    await clicked.reply({ content: 'Picked.' })
    const reply = (await clicked.fetchReply()) as Message

    expect(reply.interactionMetadata).toMatchObject({ id: clicked.id, interactedMessageId: panel.id })

    const updating = createMockInteraction(ButtonInteraction, { customId: 'pick', client, message: panel } as never)
    await updating.update({ content: 'Updated.' })

    expect((await updating.fetchReply()).interactionMetadata).toBeNull()
  })
})

describe('without strict mocks', () => {
  beforeEach(() => forgetStrictMocks())

  it("read a command's message, a message's raw ids and a reply's interactionMetadata as before, warning once", async () => {
    const warned: string[] = []
    vi.mocked(Logger.prototype.warn).mockImplementation((text: unknown) => void warned.push(String(text)))
    const command = createMockInteraction(ChatInputCommandInteraction, { commandName: 'panel' })
    await command.reply({ content: 'Pick one.' })
    const message = (await command.fetchReply()) as Message & { guild_id?: unknown }

    // The mock's placeholder for a property it has no value for
    expect((command as unknown as { message: unknown }).message).toBeTypeOf('object')
    expect(message.guild_id).toBeTypeOf('object')
    expect(message.interactionMetadata).toBeNull()
    expect(command.authorizingIntegrationOwners).not.toBeInstanceOf(AuthorizingIntegrationOwners)
    expect(warned.filter(text => text.includes('.message') || text.includes('guild_id'))).toHaveLength(2)
  })
})
