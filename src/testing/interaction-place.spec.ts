import 'reflect-metadata'
import { ButtonInteraction, ChatInputCommandInteraction, DMChannel, GuildMember, TextChannel } from 'discord.js'
import { vi } from 'vitest'
import { Logger } from '@src/common/logger.js'
import { forgetDeprecationWarnings } from '@src/common/deprecation.js'
import { createMockChannel, createMockGuild, createMockInteraction, createMockMember, createMockMessage, isRawMember } from './mock-interaction.js'
import { forgetStrictMocks, useStrictMocks } from './strict-mocks.js'

const ELSEWHERE = '1400000000000009999'

let warned: string[]
beforeEach(() => {
  forgetStrictMocks()
  forgetDeprecationWarnings()
  warned = []
  vi.spyOn(Logger.prototype, 'warn').mockImplementation((text: unknown) => void warned.push(String(text)))
})
afterEach(() => vi.restoreAllMocks())
afterAll(() => forgetStrictMocks())

const click = (props: object) => createMockInteraction(ButtonInteraction, { customId: 'refresh', ...props } as never)
const slash = (props: object) => createMockInteraction(ChatInputCommandInteraction, { commandName: 'ping', ...props } as never)
const place = (interaction: { guildId: unknown; guild: unknown; channelId: unknown; channel: unknown }) => [
  interaction.guildId,
  interaction.guild,
  interaction.channelId,
  interaction.channel,
]

describe('where a mock interaction is, under useStrictMocks()', () => {
  beforeEach(() => useStrictMocks())

  it("is where its message is: the message's channel and server", () => {
    const message = createMockMessage()
    const interaction = click({ message })

    expect(place(interaction)).toEqual([message.guildId, message.guild, message.channelId, message.channel])
    expect([interaction.inGuild(), interaction.member instanceof GuildMember, (interaction.member as GuildMember).guild]).toEqual([true, true, message.guild])
  })

  it("is in a DM when its message is, in the message's channel", () => {
    const message = createMockMessage({ guild: null })
    const interaction = click({ message })

    expect([interaction.guildId, interaction.guild, interaction.channel, interaction.member]).toEqual([null, null, message.channel, null])
    expect(interaction.channel).toBeInstanceOf(DMChannel)
  })

  it('is in the server given as its guild, or as its member', () => {
    const guild = createMockGuild()
    const member = createMockMember({ guild })

    for (const interaction of [slash({ guild }), slash({ member })]) {
      expect([interaction.guildId, interaction.guild, interaction.inGuild(), (interaction.member as GuildMember).guild]).toEqual([guild.id, guild, true, guild])
      expect((interaction.channel as TextChannel).guild).toBe(guild)
    }
  })

  it("is in a server the bot isn't in when given a guildId alone: no guild or channel, and a raw member", () => {
    const interaction = slash({ guildId: ELSEWHERE })

    expect([interaction.guild, interaction.channel, interaction.inRawGuild(), isRawMember(interaction.member)]).toEqual([null, null, true, true])
    expect((interaction.member as { user: { id: string } }).user.id).toBe(interaction.user.id)
  })

  it("is refused a channel, a guild or a guildId other than the one a test gave its message, naming both", () => {
    const message = createMockMessage({ guild: createMockGuild() })
    const guild = createMockGuild()

    expect(() => click({ message, channel: createMockChannel(TextChannel, { guild } as never) })).toThrow(new RegExp(`message.*${message.channelId}.*channel`, 's'))
    expect(() => click({ message, guild })).toThrow(new RegExp(`message.*${message.guildId}.*${guild.id}`, 's'))
    expect(() => click({ message, guildId: ELSEWHERE })).toThrow(new RegExp(`message.*${message.guildId}.*${ELSEWHERE}`, 's'))
  })

  it('moves a message whose place the mock made into the guild, guildId or channel the test gave the interaction', () => {
    const guild = createMockGuild()
    const channel = createMockChannel(TextChannel, { guild } as never)

    const inGuild = click({ message: createMockMessage(), guild, guildId: guild.id })
    expect([inGuild.guild, inGuild.guildId, inGuild.message.guild, inGuild.message.guildId]).toEqual([guild, guild.id, guild, guild.id])
    expect(inGuild.message.channel).toBe(inGuild.channel)

    const inChannel = click({ message: createMockMessage(), channel })
    expect([inChannel.channel, inChannel.message.channel, inChannel.message.guild]).toEqual([channel, channel, guild])
  })

  it("takes a channel, guild and guildId that are its message's", () => {
    const message = createMockMessage()

    expect(place(click({ message, channel: message.channel, guild: message.guild, guildId: message.guildId }))).toEqual([
      message.guildId,
      message.guild,
      message.channelId,
      message.channel,
    ])
  })
})

describe('where a mock interaction is, in default mode', () => {
  it('stays a DM when given a message in a server, and warns once on reading where it is', () => {
    const message = createMockMessage()
    const interaction = click({ message })

    expect([interaction.guildId, interaction.guild, interaction.inGuild()]).toEqual([null, null, false])
    void [interaction.guildId, interaction.channel]
    expect(warned).toEqual([
      expect.stringMatching(/^ButtonInteraction\.guildId .*message.*5\.0.*useStrictMocks\(\)/s),
      expect.stringMatching(/^ButtonInteraction\.guild .*message.*5\.0.*useStrictMocks\(\)/s),
      expect.stringMatching(/^ButtonInteraction\.channel .*message.*5\.0.*useStrictMocks\(\)/s),
    ])
  })

  it('stays a DM when given a guild alone, with a warning', () => {
    const interaction = slash({ guild: createMockGuild() })

    expect(interaction.guildId).toBeNull()
    expect(warned).toEqual([expect.stringMatching(/^ChatInputCommandInteraction\.guildId .*guild.*5\.0.*useStrictMocks\(\)/s)])
  })

  it('keeps a guild when given a guildId alone, with a warning that strict mocks read none', () => {
    const interaction = slash({ guildId: ELSEWHERE })

    expect(interaction.guild).toBeTruthy()
    expect(warned).toEqual([expect.stringMatching(/^ChatInputCommandInteraction\.guild .*guildId.*isn't in.*null.*useStrictMocks\(\)/s)])
  })

  it('names no conflict for a message whose place the mock made, beside a guild the test gave', () => {
    const guild = createMockGuild()
    void click({ message: createMockMessage(), guild, guildId: guild.id }).channel

    expect(warned.filter(text => text.includes('refused'))).toEqual([])
  })

  it('says nothing where it is placed as strict mocks place it', () => {
    const message = createMockMessage()
    const guild = createMockGuild()
    const channel = createMockChannel(TextChannel, { guild } as never)

    for (const interaction of [click({ message, channel: message.channel }), slash({}), slash({ guild, channel }), slash({ guild, guildId: guild.id })]) {
      void [interaction.guildId, interaction.guild, interaction.channelId, interaction.channel, interaction.member]
    }

    expect(warned).toEqual([])
  })
})
