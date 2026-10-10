import 'reflect-metadata'
import { ButtonInteraction, ChatInputCommandInteraction, DMChannel, TextChannel } from 'discord.js'
import { vi } from 'vitest'
import { Logger } from '@src/common/logger.js'
import { forgetDeprecationWarnings } from '@src/common/deprecation.js'
import { createMockChannel, createMockGuild, createMockInteraction, createMockMember, createMockMessage } from './mock-interaction.js'
import { forgetStrictMocks, useStrictMocks } from './strict-mocks.js'

let warned: string[]
beforeEach(() => {
  forgetStrictMocks()
  forgetDeprecationWarnings()
  warned = []
  vi.spyOn(Logger.prototype, 'warn').mockImplementation((text: unknown) => void warned.push(String(text)))
})
afterEach(() => vi.restoreAllMocks())
afterAll(() => forgetStrictMocks())

/** A text channel of a server, cached there. */
function serverChannel() {
  const guild = createMockGuild()
  const channel = createMockChannel(TextChannel, { guild } as never)
  guild.channels.cache.set(channel.id, channel as never)
  return { guild, channel }
}

describe.each([
  ['default', () => {}],
  ['strict', () => useStrictMocks()],
])('a message the bot sends, in %s mode', (_mode, setUp) => {
  beforeEach(() => setUp())

  it("is in the channel and server it was sent in, holding what was sent", async () => {
    const { guild, channel } = serverChannel()

    const sent = await channel.send({ content: 'hello', embeds: [{ title: 'Hi' }] })

    expect([sent.channel, sent.guild, sent.channelId, sent.content, sent.embeds[0].toJSON().title]).toEqual([channel, guild, channel.id, 'hello', 'Hi'])
    expect((await channel.send('plain')).content).toBe('plain')
  })

  it("replies in the message's channel, and edits the message itself", async () => {
    const { channel } = serverChannel()
    const message = createMockMessage({ channel: channel as never, content: 'first' })

    const reply = await message.reply('a reply')
    const edited = await message.edit({ content: 'second' })

    expect([reply.channel, reply.content]).toEqual([channel, 'a reply'])
    expect([edited, message.content, typeof message.editedTimestamp]).toEqual([message, 'second', 'number'])
    expect(await message.crosspost()).toBe(message)
  })

  it('forwards a message into the channel it is forwarded to', async () => {
    const { channel } = serverChannel()
    const other = serverChannel().channel

    const forwarded = await createMockMessage({ channel: channel as never }).forward(other as never)

    expect(forwarded.channel).toBe(other)
  })

  it('answers an interaction in its channel', async () => {
    const { guild, channel } = serverChannel()
    const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName: 'ping', guild, channel } as never)
    await interaction.reply('hi')

    for (const message of [await interaction.fetchReply(), await interaction.editReply('edited'), await interaction.followUp('more')]) {
      expect([message.channel, message.guild]).toEqual([channel, guild])
    }
  })

  it('fetches a message in the channel it was fetched from, and never the bot', async () => {
    const { channel } = serverChannel()

    const fetched = await channel.messages.fetch('1400000000000009999')

    expect([fetched.channel, fetched.channelId, fetched.author.id === channel.client.user.id]).toEqual([channel, channel.id, false])
  })

  it("bans without caching anything, resolving to the member it was given, as discord.js's create does", async () => {
    const { guild } = serverChannel()
    const member = createMockMember({ guild })

    expect([await guild.bans.create(member), guild.bans.cache.size]).toEqual([member, 0])
  })

  it('caches a channel a server makes, as discord.js does', async () => {
    const { guild } = serverChannel()

    const made = await guild.channels.create({ name: 'new' })

    expect(guild.channels.cache.get(made.id)).toBe(made)
  })

  it('makes and fetches a role in its server, and caches one it makes', async () => {
    const { guild } = serverChannel()

    const made = await guild.roles.create({ name: 'New' })
    const fetched = await guild.roles.fetch('1400000000000009998')

    expect([made.guild, fetched!.guild, guild.roles.cache.get(made.id)]).toEqual([guild, guild, made])
  })
})

describe('a message the bot sends, under useStrictMocks()', () => {
  beforeEach(() => useStrictMocks())

  it('is the bot\'s own, so it is editable', async () => {
    const { channel } = serverChannel()

    const sent = await channel.send('mine')

    expect([sent.author, sent.editable]).toEqual([channel.client.user, true])
  })

  it('is in the DM it was sent in', async () => {
    const dm = createMockChannel(DMChannel)

    const sent = await dm.send('hi')

    expect([sent.channel, sent.inGuild(), sent.guild, sent.member]).toEqual([dm, false, null, null])
  })
})

describe('a message the bot sends, in default mode', () => {
  it("reads its author as before, with a warning that strict mocks read the bot's own", async () => {
    const { channel } = serverChannel()
    const sent = await channel.send('mine')

    expect(sent.author.id).not.toBe(channel.client.user.id)
    void sent.author
    expect(warned).toEqual([expect.stringMatching(/^Message\.author .*bot sent.*5\.0.*client\.user.*useStrictMocks\(\)/s)])
  })

  it("reads where an interaction is to place its answers without the warning a test's own read gets", async () => {
    const click = createMockInteraction(ButtonInteraction, { customId: 'refresh', message: createMockMessage() })
    await click.reply('hi')

    await click.fetchReply()

    expect(warned).toEqual([])
  })

  it('warns only for the member read on a DM send, not for the author it reads in turn', async () => {
    const sent = await createMockChannel(DMChannel).send('hi')

    void sent.member

    expect(warned).toEqual([expect.stringMatching(/^Message\.member /)])
  })

  it('reads a DM send as in a server as before, with a warning that strict mocks read a DM', async () => {
    const sent = await createMockChannel(DMChannel).send('hi')

    expect(sent.inGuild()).toBe(true)
    expect(warned).toEqual([expect.stringMatching(/^Message\.inGuild\(\) .*DM.*5\.0.*useStrictMocks\(\)/s)])
  })
})
