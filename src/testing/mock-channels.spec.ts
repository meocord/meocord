import 'reflect-metadata'
import { vi } from 'vitest'
import {
  ChatInputCommandInteraction,
  DMChannel,
  ForumChannel,
  GuildMember,
  Role,
  TextChannel,
  ThreadChannel,
  User,
  VoiceChannel,
} from 'discord.js'
import {
  createMockChannel,
  createMockClient,
  createMockGuild,
  createMockInteraction,
  createMockMember,
  createMockMessage,
  createMockUser,
} from './mock-interaction.js'

describe("a mock channel's type guards", () => {
  // discord.js answers them from the channel's type and the managers it has, so the mock's answer what it is
  it.each([
    ['a text channel', TextChannel, { isTextBased: true, isSendable: true, isDMBased: false, isThread: false, isVoiceBased: false, isThreadOnly: false }],
    ['a DM', DMChannel, { isTextBased: true, isSendable: true, isDMBased: true, isThread: false, isVoiceBased: false, isThreadOnly: false }],
    ['a thread', ThreadChannel, { isTextBased: true, isSendable: true, isDMBased: false, isThread: true, isVoiceBased: false, isThreadOnly: false }],
    ['a voice channel', VoiceChannel, { isTextBased: true, isSendable: true, isDMBased: false, isThread: false, isVoiceBased: true, isThreadOnly: false }],
    ['a forum', ForumChannel, { isTextBased: false, isSendable: false, isDMBased: false, isThread: false, isVoiceBased: false, isThreadOnly: true }],
  ] as const)('answer as discord.js does for %s', (_name, Class, expected) => {
    const channel = createMockChannel(Class as never) as unknown as Record<keyof typeof expected, () => boolean>
    const answers = Object.fromEntries(Object.keys(expected).map(guard => [guard, channel[guard as keyof typeof expected]()]))
    expect(answers).toEqual(expected)
  })
})

describe("a mock interaction's channel", () => {
  it("is a text channel of its server, the one the server's cache holds under its channelId", async () => {
    const guild = createMockGuild()
    const interaction = createMockInteraction(ChatInputCommandInteraction, { guildId: guild.id, guild })

    const channel = interaction.channel as TextChannel
    expect(channel).toBeInstanceOf(TextChannel)
    expect([channel.id, channel.guild, channel.guildId]).toEqual([interaction.channelId, guild, guild.id])
    expect(guild.channels.cache.get(interaction.channelId)).toBe(channel)
    expect(channel.isTextBased()).toBe(true)
    await expect(channel.send('posted')).resolves.toBeDefined()
    expect(channel.send).toHaveBeenCalledWith('posted')
  })

  it('is the one channel a cached guild already has under its channelId', () => {
    const existing = createMockChannel(TextChannel)
    const guild = createMockGuild({ channels: [existing as never] })

    const interaction = createMockInteraction(ChatInputCommandInteraction, { guildId: guild.id, guild, channelId: existing.id })

    expect(interaction.channel).toBe(existing)
  })

  it('is a text channel with the server id alone in a server the mock has only the id of', () => {
    const interaction = createMockInteraction(ChatInputCommandInteraction, { guildId: '100000000000000001' })

    const channel = interaction.channel as TextChannel
    expect(channel).toBeInstanceOf(TextChannel)
    expect([channel.id, channel.guildId]).toEqual([interaction.channelId, '100000000000000001'])
    expect(interaction.channel).toBe(channel)
  })

  it("is the user's DM channel in a direct message", () => {
    const interaction = createMockInteraction(ChatInputCommandInteraction)

    const channel = interaction.channel as unknown as DMChannel
    expect(channel).toBeInstanceOf(DMChannel)
    expect([channel.id, channel.recipientId]).toEqual([interaction.channelId, interaction.user.id])
    expect(channel.isDMBased()).toBe(true)
  })

  it('is the channel the test gives', () => {
    const channel = createMockChannel(ThreadChannel)
    expect(createMockInteraction(ChatInputCommandInteraction, { channel: channel as never }).channel).toBe(channel)
  })
})

describe("a mock message's channel", () => {
  it("is a text channel of its server, in the server's cache, with the guards and managers discord.js gives it", () => {
    const message = createMockMessage()

    const channel = message.channel as TextChannel
    expect(channel).toBeInstanceOf(TextChannel)
    expect([channel.id, channel.guild]).toEqual([message.channelId, message.guild])
    expect(message.guild!.channels.cache.get(message.channelId)).toBe(channel)
    expect(channel.isTextBased()).toBe(true)
    expect(channel.messages.cache.size).toBe(0)
  })

  it("is the author's DM channel in a direct message", () => {
    const author = createMockUser()
    const message = createMockMessage({ author, guild: null })

    const channel = message.channel as unknown as DMChannel
    expect(channel).toBeInstanceOf(DMChannel)
    expect([channel.id, channel.recipientId, message.channelId]).toEqual([channel.id, author.id, channel.id])
  })

  it('is the channel the test gives, its id the channelId', () => {
    const channel = createMockChannel(ThreadChannel)
    const message = createMockMessage({ channel })

    expect(message.channel).toBe(channel)
    expect(message.channelId).toBe(channel.id)
  })
})

describe("a user's DM channel", () => {
  it('is one channel, the same through createDM(), send(), a DM interaction and a DM message', async () => {
    const user = createMockUser()
    const dm = await user.createDM()
    const interaction = createMockInteraction(ChatInputCommandInteraction, { user })
    const message = createMockMessage({ author: user, guild: null })

    expect([interaction.channel, message.channel]).toEqual([dm, dm])
    expect(interaction.channel).toBe(dm)
    expect(message.channel).toBe(dm)

    await user.send('through the user')
    await createMockMember({ user }).send('through a member')
    await (interaction.channel as unknown as DMChannel).send('through the interaction')
    await (message.channel as unknown as DMChannel).send('through the message')

    expect(vi.mocked(dm.send).mock.calls.map(([content]) => content)).toEqual([
      'through the user',
      'through a member',
      'through the interaction',
      'through the message',
    ])
  })
})

describe("a mock manager's fetch of one item", () => {
  it('resolves to the cached item with that id, as discord.js looks in its cache first', async () => {
    const member = createMockMember()
    const guild = createMockGuild({ members: [member] })

    await expect(guild.members.fetch(member.id)).resolves.toBe(member)
    await expect(guild.members.fetch({ user: member.id })).resolves.toBe(member)
  })

  it('makes an item with the id asked for when none is cached, and caches it', async () => {
    const guild = createMockGuild()
    const client = createMockClient()
    const id = '123456789012345678'

    const member = await guild.members.fetch(id)
    const user = await client.users.fetch(id)
    const role = await guild.roles.fetch(id)
    const channel = await client.channels.fetch(id)

    expect(member).toBeInstanceOf(GuildMember)
    expect([member.id, member.user.id, member.guild]).toEqual([id, id, guild])
    expect(user).toBeInstanceOf(User)
    expect(role).toBeInstanceOf(Role)
    expect([user.id, role!.id, channel!.id]).toEqual([id, id, id])
    await expect(guild.members.fetch(id)).resolves.toBe(member)
    expect(client.users.cache.get(id)).toBe(user)
  })
})
