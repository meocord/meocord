import {
  AutocompleteInteraction,
  ButtonInteraction,
  ChannelType,
  ChatInputCommandInteraction,
  DMChannel,
  ForumChannel,
  GuildMember,
  GuildNSFWLevel,
  GuildPremiumTier,
  GuildVerificationLevel,
  Locale,
  MessageType,
  NewsChannel,
  SnowflakeUtil,
  TextChannel,
  ThreadChannel,
  VoiceChannel,
} from 'discord.js'
import { createTranslator } from '@src/common/index.js'
import { Command, Controller, Cooldown, MeoCord, MessageHandler } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { createMockChannel, createMockClient, createMockGuild, createMockInteraction, createMockMessage, createMockUser, MeoCordTestingModule } from '@src/testing/index.js'

const SNOWFLAKE = /^\d{17,20}$/

describe('mock ids', () => {
  it('gives an interaction, its user and its channel snowflake ids, distinct per mock and stable per read', () => {
    const [a, b] = [createMockInteraction(ButtonInteraction), createMockInteraction(ButtonInteraction)]

    for (const id of [a.id, a.user.id, a.channelId, b.id, b.user.id]) expect(id).toMatch(SNOWFLAKE)
    expect(new Set([a.id, b.id, a.user.id, b.user.id, a.channelId]).size).toBe(5)
    expect(a.user.id).toBe(a.user.id)
    expect(a.user.bot).toBe(false)
  })

  it('gives users, guilds, channels and messages snowflake ids, the message consistent with its guild and channel', () => {
    const [user, other] = [createMockUser(), createMockUser()]
    expect(user.id).toMatch(SNOWFLAKE)
    expect(user.id).not.toBe(other.id)
    expect(createMockGuild().id).toMatch(SNOWFLAKE)
    expect(createMockChannel(TextChannel).id).toMatch(SNOWFLAKE)

    const message = createMockMessage()
    for (const id of [message.id, message.author.id, message.channelId, message.guildId]) expect(id).toMatch(SNOWFLAKE)
    expect(message.channelId).toBe(message.channel.id)
    expect(message.guildId).toBe(message.guild?.id)
  })

  it('keeps ids a test gives', () => {
    const interaction = createMockInteraction(ChatInputCommandInteraction, { id: '1', channelId: '2', user: { id: '3' } as never })
    expect([interaction.id, interaction.channelId, interaction.user.id]).toEqual(['1', '2', '3'])
    expect(createMockMessage({ id: '4' }).id).toBe('4')
  })

  it('counts two default users apart in a per-user cooldown', async () => {
    @Controller()
    class Daily {
      @Command('daily', CommandType.SLASH)
      @Cooldown({ seconds: 60 })
      async daily(_interaction: ChatInputCommandInteraction) {}
    }
    const module = MeoCordTestingModule.create({ controllers: [Daily] }).compile()
    const call = () => createMockInteraction(ChatInputCommandInteraction, { commandName: 'daily' })

    await module.invoke(Daily, 'daily', call())
    await expect(module.invoke(Daily, 'daily', call())).resolves.toEqual({ ran: true })
  })
})

describe('a mock made without a server', () => {
  it('has no guildId, guild or member, as a direct message does', () => {
    const interaction = createMockInteraction(ChatInputCommandInteraction)
    expect(interaction.guildId).toBeNull()
    expect(interaction.guild).toBeNull()
    expect(interaction.member).toBeNull()
    expect(interaction.inGuild()).toBe(false)
  })

  it('is in a server once given a guildId, with a member', () => {
    const interaction = createMockInteraction(ChatInputCommandInteraction, { guildId: '100000000000000001' })
    expect(interaction.guildId).toBe('100000000000000001')
    expect(interaction.member).toBeTruthy()
    expect(interaction.inGuild()).toBe(true)
  })
})

describe('the autocomplete mock', () => {
  it('refuses more than 25 choices, as Discord does', async () => {
    const choices = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `c${i}`, value: `c${i}` }))
    await expect(createMockInteraction(AutocompleteInteraction).respond(choices(26))).rejects.toThrow(/25/)
    await expect(createMockInteraction(AutocompleteInteraction).respond(choices(25))).resolves.toBeUndefined()
  })
})

/** Every value is read twice: a default is made once, then kept, as the property is on a real object. */
const read = (mock: object, key: string): unknown => {
  const value = (mock as Record<string, unknown>)[key]
  expect((mock as Record<string, unknown>)[key]).toBe(value)
  return value
}

describe("a mock's data, where the test gives none", () => {
  it.each([
    ['name', 'Guild'],
    ['preferredLocale', 'en-US'],
    ['memberCount', 1],
    ['available', true],
    ['large', false],
    ['features', []],
    ['description', null],
    ['icon', null],
    ['banner', null],
    ['splash', null],
    ['systemChannelId', null],
    ['shardId', 0],
    ['nsfwLevel', GuildNSFWLevel.Default],
    ['verificationLevel', GuildVerificationLevel.None],
    ['premiumTier', GuildPremiumTier.None],
  ])("gives a guild's %s as Discord does", (key, expected) => {
    expect(read(createMockGuild(), key)).toEqual(expected)
  })

  it("gives a guild an owner's id, and the time its id was made", () => {
    const guild = createMockGuild()
    expect(read(guild, 'ownerId')).toMatch(SNOWFLAKE)
    expect(guild.createdTimestamp).toBe(SnowflakeUtil.timestampFrom(guild.id))
    expect(guild.createdAt).toEqual(new Date(guild.createdTimestamp))
  })

  it("gives a message's guild the same data as a guild of its own", () => {
    const guild = createMockMessage().guild!
    expect([guild.name, guild.preferredLocale, guild.memberCount]).toEqual(['Guild', 'en-US', 1])
  })

  it.each([
    ['username', 'user'],
    ['globalName', null],
    ['discriminator', '0'],
    ['avatar', null],
    ['system', false],
    ['tag', 'user'],
    ['displayName', 'user'],
  ])("gives a user's %s as Discord does", (key, expected) => {
    expect(read(createMockUser(), key)).toEqual(expected)
  })

  it("names a user by the names the test gives, and the bot 'bot'", () => {
    const user = Object.assign(createMockUser(), { username: 'ada', globalName: 'Ada' })
    expect([user.tag, user.displayName]).toEqual(['ada', 'Ada'])
    expect(user.createdTimestamp).toBe(SnowflakeUtil.timestampFrom(user.id))
    expect(createMockClient().user?.username).toBe('bot')
  })

  it.each([
    ['nickname', null],
    ['avatar', null],
    ['joinedTimestamp', null],
    ['premiumSinceTimestamp', null],
    ['communicationDisabledUntilTimestamp', null],
    ['pending', false],
  ])("gives a member's %s as Discord does", (key, expected) => {
    expect(read(createMockInteraction(ChatInputCommandInteraction, { guildId: '100000000000000001' }).member!, key)).toEqual(expected)
  })

  it("makes an interaction's member its user, named by it", () => {
    const interaction = createMockInteraction(ChatInputCommandInteraction, { guildId: '100000000000000001' })
    const member = interaction.member as GuildMember
    expect(member.user).toBe(interaction.user)
    expect(member.id).toBe(interaction.user.id)
    expect(member.displayName).toBe('user')
  })

  it.each([
    ['pinned', false],
    ['tts', false],
    ['type', MessageType.Default],
    ['system', false],
    ['webhookId', null],
    ['applicationId', null],
    ['nonce', null],
    ['position', null],
    ['activity', null],
  ])("gives a message's %s as Discord does", (key, expected) => {
    expect(read(createMockMessage(), key)).toEqual(expected)
  })

  it("gives a message its link, from its guild's, channel's and own ids", () => {
    const message = createMockMessage()
    expect(message.inGuild()).toBe(true)
    expect(message.url).toBe(`https://discord.com/channels/${message.guildId}/${message.channelId}/${message.id}`)
  })

  it('gives a message in a server its author as a member, and a direct message no member', () => {
    const message = createMockMessage()
    expect(message.member?.user).toBe(message.author)
    expect(message.member?.id).toBe(message.author.id)

    const direct = createMockMessage({ guild: null })
    expect([direct.member, direct.inGuild()]).toEqual([null, false])
    expect(direct.url).toBe(`https://discord.com/channels/@me/${direct.channelId}/${direct.id}`)
  })

  it.each([
    ['version', 1],
    ['context', null],
    ['commandGuildId', null],
  ])("gives an interaction's %s as Discord does", (key, expected) => {
    expect(read(createMockInteraction(ChatInputCommandInteraction), key)).toEqual(expected)
  })

  it("gives an interaction its command's and application's ids, and a token", () => {
    const interaction = createMockInteraction(ChatInputCommandInteraction)
    expect(read(interaction, 'commandId')).toMatch(SNOWFLAKE)
    expect(read(interaction, 'applicationId')).toMatch(SNOWFLAKE)
    expect(read(createMockInteraction(AutocompleteInteraction), 'commandId')).toMatch(SNOWFLAKE)
    expect(typeof read(interaction, 'token')).toBe('string')
  })

  it('leaves what says which handler a call is for to the test', () => {
    expect(typeof createMockInteraction(ChatInputCommandInteraction).commandName).not.toBe('string')
    expect(typeof createMockInteraction(ButtonInteraction).customId).not.toBe('string')
    expect(typeof createMockMessage().content).not.toBe('string')
  })

  it.each([
    ['TextChannel', TextChannel, ChannelType.GuildText],
    ['NewsChannel', NewsChannel, ChannelType.GuildAnnouncement],
    ['VoiceChannel', VoiceChannel, ChannelType.GuildVoice],
    ['ForumChannel', ForumChannel, ChannelType.GuildForum],
    ['ThreadChannel', ThreadChannel, ChannelType.PublicThread],
    ['DMChannel', DMChannel, ChannelType.DM],
  ] as const)('gives a %s its channel type', (_name, Class, type) => {
    expect(read(createMockChannel(Class as never), 'type')).toBe(type)
  })

  it.each([
    ['name', 'channel'],
    ['nsfw', false],
    ['topic', null],
    ['rateLimitPerUser', 0],
    ['position', 0],
    ['rawPosition', 0],
    ['parentId', null],
  ])("gives a text channel's %s as Discord does", (key, expected) => {
    expect(read(createMockChannel(TextChannel), key)).toEqual(expected)
  })

  it("gives a channel its guild's id, and the time its id was made", () => {
    const channel = createMockChannel(TextChannel)
    expect(read(channel, 'guildId')).toMatch(SNOWFLAKE)
    expect(channel.createdTimestamp).toBe(SnowflakeUtil.timestampFrom(channel.id))
  })

  it('gives a client the time it logged in, and no token', () => {
    const client = createMockClient()
    expect(read(client, 'readyTimestamp')).toBeTypeOf('number')
    expect(client.uptime).toBeGreaterThanOrEqual(0)
    expect(client.token).toBeNull()
  })

  it('keeps the data a test gives or sets', () => {
    const guild = createMockGuild({ name: 'Kopi', preferredLocale: Locale.Indonesian })
    expect([guild.name, guild.preferredLocale]).toEqual(['Kopi', 'id'])

    const message = createMockMessage()
    ;(message as { pinned: boolean }).pinned = true
    expect(message.pinned).toBe(true)
  })
})

describe("a mock guild's language", () => {
  const t = createTranslator({
    default: 'en-US',
    locales: {
      'en-US': { hello: 'Hello' },
      id: {
        hello: 'Halo',
        meocord: { usage: { heading: 'Cara pakai: {usage}', notValid: '{label}: "{word}" bukan {type} yang sah' }, types: { int: 'bilangan bulat' } },
      },
    },
  })

  @Controller()
  class Dice {
    @MessageHandler('roll {sides:int}')
    roll() {}
  }

  @MeoCord({ controllers: [Dice], clientOptions: { intents: [] }, messages: { prefix: '!' }, i18n: t })
  class App {}

  const usageReply = async (guild?: ReturnType<typeof createMockGuild>) => {
    const module = await MeoCordTestingModule.fromApp(App).compile()
    const message = createMockMessage({ content: '!roll lots', ...(guild && { guild }) })
    await module.dispatch(message)
    return (vi.mocked(message.reply).mock.calls[0]?.[0] as { content: string } | undefined)?.content
  }

  it("is English unless the test gives one, as a new server's is", () => {
    expect(t.forGuild(createMockGuild())('hello')).toBe('Hello')
    expect(t.forGuild(createMockGuild({ preferredLocale: Locale.Indonesian }))('hello')).toBe('Halo')
  })

  it("answers a message on a bare mock guild, or a message's own, in English", async () => {
    const english = 'Usage: !roll <sides>\nsides: "lots" is not a valid whole number'
    expect(await usageReply(createMockGuild())).toBe(english)
    expect(await usageReply()).toBe(english)
  })

  it("answers a message in the language the test gives its guild", async () => {
    expect(await usageReply(createMockGuild({ preferredLocale: Locale.Indonesian }))).toBe('Cara pakai: !roll <sides>\nsides: "lots" bukan bilangan bulat yang sah')
  })
})
