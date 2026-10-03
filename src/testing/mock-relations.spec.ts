import 'reflect-metadata'
import { Collection, OverwriteType, PermissionFlagsBits, PermissionsBitField, Role, TextChannel } from 'discord.js'
import {
  createMockChannel,
  createMockClient,
  createMockGuild,
  createMockInteraction,
  createMockMember,
  createMockMessage,
  createMockUser,
} from './mock-interaction.js'

const role = (id: string, position: number, permissions: bigint[] = []) =>
  createMockInteraction(Role, { id, position, permissions: new PermissionsBitField(permissions).freeze() })

describe('a mock guild and what is in it', () => {
  it('share one client, which a guild a message makes for itself takes from the message', () => {
    const guild = createMockGuild({ roles: [role('300000000000000001', 1)], channels: [createMockChannel(TextChannel)] })
    const member = createMockMember({ guild })

    for (const each of [member, guild.members, guild.roles.everyone, guild.roles.cache.get('300000000000000001'), guild.channels.cache.first()]) {
      expect(each!.client).toBe(guild.client)
    }
    const message = createMockMessage()
    expect(message.guild!.client).toBe(message.client)
  })

  it('homes the roles given, and @everyone, in the guild', () => {
    const guild = createMockGuild({ roles: [role('300000000000000001', 1)] })

    expect(guild.roles.everyone!.guild).toBe(guild)
    expect(guild.roles.cache.get('300000000000000001')!.guild).toBe(guild)
  })

  it('resolves a member, role, channel or user from the caches, as discord.js managers do', () => {
    const channel = createMockChannel(TextChannel)
    const moderator = role('300000000000000001', 1)
    const guild = createMockGuild({ roles: [moderator], channels: [channel] })
    const member = createMockMember({ guild })

    expect(guild.members.resolve(member.id)).toBe(member)
    expect(guild.members.resolve(member)).toBe(member)
    expect(guild.members.resolve(member.user)).toBe(member)
    expect(guild.members.resolveId(member.user)).toBe(member.id)
    expect(guild.members.resolve('900000000000000009')).toBeNull()
    expect(guild.roles.resolve(moderator.id)).toBe(moderator)
    expect(guild.channels.resolve(channel.id)).toBe(channel)
    expect(guild.client.users.resolve(member.user)).toBe(member.user)
  })

  it("gives the bot's member as members.me: the one cached, or one with @everyone made once", () => {
    const guild = createMockGuild()

    const me = guild.members.me!
    expect([me.id, me.user.id, me.guild]).toEqual([guild.client.user.id, guild.client.user.id, guild])
    expect([...me.roles.cache.keys()]).toEqual([guild.id])
    expect(guild.members.me).toBe(me)
    expect(guild.members.resolve(guild.client.user.id)).toBe(me)
  })
})

describe('a mock client', () => {
  it('caches the guilds of the messages and interactions made with it', () => {
    const client = createMockClient()
    const guild = createMockGuild()
    createMockMessage({ guild, client })

    expect(client.guilds.cache.get(guild.id)).toBe(guild)
    expect(client.guilds.resolve(guild.id)).toBe(guild)
  })
})

describe("a mock guild's roles", () => {
  it('compare by position, then the lower id at an equal one, as discord.js ranks them', () => {
    const [low, high, tieOlder, tieNewer] = [
      role('300000000000000001', 1),
      role('300000000000000002', 5),
      role('300000000000000003', 3),
      role('300000000000000004', 3),
    ]
    createMockGuild({ roles: [low, high, tieOlder, tieNewer] })

    expect(high.comparePositionTo(low)).toBeGreaterThan(0)
    expect(low.comparePositionTo(high)).toBeLessThan(0)
    expect(tieOlder.comparePositionTo(tieNewer)).toBeGreaterThan(0)
    expect(high.guild.roles.comparePositions(low, high)).toBeLessThan(0)
  })
})

describe("a mock channel's permissions", () => {
  it("are the member's roles' in the channel, with the channel's overwrites applied", () => {
    const moderator = role('300000000000000001', 1, [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])
    const channel = createMockChannel(TextChannel)
    const guild = createMockGuild({ roles: [moderator], channels: [channel] })
    const member = createMockMember({ guild, roles: [moderator] })
    const muted = createMockMember({ guild, roles: [moderator] })
    channel.permissionOverwrites.cache.set(muted.id, {
      id: muted.id,
      type: OverwriteType.Member,
      allow: new PermissionsBitField().freeze(),
      deny: new PermissionsBitField(PermissionFlagsBits.SendMessages).freeze(),
    } as never)

    expect(channel.permissionsFor(member)!.has(PermissionFlagsBits.SendMessages)).toBe(true)
    expect(channel.permissionsFor(muted)!.has(PermissionFlagsBits.SendMessages)).toBe(false)
    expect(muted.permissionsIn(channel).has(PermissionFlagsBits.ViewChannel)).toBe(true)
    expect(channel.permissionsFor(moderator)!.has(PermissionFlagsBits.SendMessages)).toBe(true)
    expect(channel.permissionOverwrites.cache).toBeInstanceOf(Collection)
  })
})

describe("a mock message's mentions", () => {
  it('say whether they mention a user, as discord.js reads them', () => {
    const client = createMockClient()
    const other = createMockUser()

    const message = createMockMessage({ content: `<@${client.user.id}> help`, client })

    expect(message.mentions.has(client.user)).toBe(true)
    expect(message.mentions.has(other)).toBe(false)
  })
})

describe("a mock message's member", () => {
  it("is the guild's cached member for its author, and none once the cache has no member for them", () => {
    const guild = createMockGuild()
    const message = createMockMessage({ guild })

    expect(message.member).toBe(guild.members.cache.get(message.author.id))
    guild.members.cache.delete(message.author.id)
    expect(message.member).toBeNull()

    const given = createMockMember({ guild })
    message.member = given
    expect(message.member).toBe(given)
  })
})
