import 'reflect-metadata'
import { ButtonInteraction, ChatInputCommandInteraction, PermissionFlagsBits, TextChannel } from 'discord.js'
import { type Mock, vi } from 'vitest'
import { Logger } from '@src/common/logger.js'
import { forgetDeprecationWarnings } from '@src/common/deprecation.js'
import { createMockChannel, createMockGuild, createMockInteraction, createMockMessage, createMockUser } from './mock-interaction.js'
import { forgetStrictMocks, useStrictMocks } from './strict-mocks.js'

beforeEach(() => {
  forgetStrictMocks()
  forgetDeprecationWarnings()
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())
afterAll(() => forgetStrictMocks())

// A read the mock makes for itself changes nothing the test sees and uses up no stub the test set for its own code
describe.each([
  ['default', () => {}],
  ['strict', () => useStrictMocks()],
])("the mock's own reads, in %s mode", (_mode, setUp) => {
  beforeEach(() => setUp())

  it("memberPermissions caches no channel, so a channel the test caches afterwards is the interaction's", () => {
    const guild = createMockGuild()
    const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName: 'post', user: createMockUser(), guild, guildId: guild.id })
    const sizes = () => [guild.channels.cache.size, interaction.client.channels.cache.size]
    const before = sizes()

    void interaction.memberPermissions
    expect(sizes()).toEqual(before)
    const tickets = createMockChannel(TextChannel, { id: interaction.channelId, guild, name: 'tickets' } as never)
    guild.channels.cache.set(tickets.id, tickets as never)

    expect(interaction.channel).toBe(tickets)
  })

  it("interaction.channel reads its server's cache on each read, as discord.js reads the client's", () => {
    const guild = createMockGuild()
    const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName: 'post', guild, guildId: guild.id })
    expect((interaction.channel as TextChannel).name).toBe('channel')
    const tickets = createMockChannel(TextChannel, { id: interaction.channelId, guild, name: 'tickets' } as never)
    guild.channels.cache.set(tickets.id, tickets as never)

    expect(interaction.channel).toBe(tickets)
  })

  it("memberPermissions leaves the test's overwritesFor stub for its own caller", () => {
    const guild = createMockGuild()
    const channel = createMockChannel(TextChannel, { guild } as never)
    guild.channels.cache.set(channel.id, channel as never)
    const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName: 'post', guild, channel } as never)
    // Private in discord.js's typings
    const stubbed = channel as unknown as { overwritesFor: Mock<(member: unknown) => unknown> }
    const overwrites = { roles: ['stubbed'] }
    stubbed.overwritesFor.mockReturnValueOnce(overwrites)

    void interaction.memberPermissions

    expect(stubbed.overwritesFor(interaction.member)).toBe(overwrites)
  })

  it("message.member resolves nothing through the manager, so the test's resolve stub stays for its own caller", () => {
    const message = createMockMessage()
    const author = message.member
    vi.mocked(message.guild!.members.resolve).mockReturnValueOnce(null)

    expect([message.member, message.member]).toEqual([author, author])
    expect(message.guild!.members.resolve(message.author)).toBeNull()
  })

  it("appPermissions leaves the test's permissionsFor stub for its own caller, and caches neither the bot's member nor a channel", () => {
    const guild = createMockGuild()
    ;(guild.roles.everyone as { permissions: unknown }).permissions = guild.roles.everyone.permissions.add(PermissionFlagsBits.SendMessages).freeze()
    const channel = createMockChannel(TextChannel, { guild } as never)
    guild.channels.cache.set(channel.id, channel as never)
    const click = createMockInteraction(ButtonInteraction, { customId: 'go', guild, guildId: guild.id, channel } as never)
    const elsewhere = createMockInteraction(ButtonInteraction, { customId: 'go', guild, guildId: guild.id } as never)
    const sizes = () => [guild.members.cache.size, guild.channels.cache.size]
    const before = sizes()
    vi.mocked(channel.permissionsFor).mockReturnValueOnce(null)

    expect([click.appPermissions.has(PermissionFlagsBits.SendMessages), elsewhere.appPermissions.has(PermissionFlagsBits.SendMessages)]).toEqual([true, true])
    expect(sizes()).toEqual(before)
    expect(channel.permissionsFor(guild.members.me!)).toBeNull()
  })
})
