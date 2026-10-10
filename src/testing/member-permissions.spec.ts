import 'reflect-metadata'
import {
  ChatInputCommandInteraction,
  type GuildMember,
  OverwriteType,
  PermissionFlagsBits,
  PermissionsBitField,
  Role,
  TextChannel,
  ThreadChannel,
} from 'discord.js'
import { vi } from 'vitest'
import { Logger } from '@src/common/logger.js'
import { forgetDeprecationWarnings } from '@src/common/deprecation.js'
import { createMockChannel, createMockGuild, createMockInteraction, createMockRawMember } from './mock-interaction.js'
import { forgetStrictMocks, useStrictMocks } from './strict-mocks.js'

const { SendMessages, ViewChannel, ManageMessages, Administrator } = PermissionFlagsBits

let warned: string[]
beforeEach(() => {
  forgetStrictMocks()
  forgetDeprecationWarnings()
  warned = []
  vi.spyOn(Logger.prototype, 'warn').mockImplementation((text: unknown) => void warned.push(String(text)))
})
afterEach(() => vi.restoreAllMocks())
afterAll(() => forgetStrictMocks())

const bits = (...flags: bigint[]) => new PermissionsBitField(flags).freeze()

/** A server where `@everyone` is denied SendMessages in #general, and a command run there by a member with `roles`. */
function deniedChannel(permissions: bigint[] = [SendMessages, ViewChannel]) {
  const guild = createMockGuild()
  const channel = createMockChannel(TextChannel, { guild } as never)
  guild.channels.cache.set(channel.id, channel as never)
  channel.permissionOverwrites.cache.set(guild.id, { id: guild.id, type: OverwriteType.Role, allow: bits(), deny: bits(SendMessages) } as never)
  const role = createMockInteraction(Role, { id: '300000000000000005', position: 5, permissions: bits(...permissions), guild } as never)
  guild.roles.cache.set(role.id, role as never)
  const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName: 'post', guild, channel } as never)
  ;(interaction.member as GuildMember).roles.add(role)
  return { guild, channel, interaction, member: interaction.member as GuildMember }
}

describe('memberPermissions, under useStrictMocks()', () => {
  beforeEach(() => useStrictMocks())

  it("applies the channel's overwrites, as Discord computes it, agreeing with permissionsIn", () => {
    const { channel, interaction, member } = deniedChannel()

    expect(interaction.memberPermissions!.has(SendMessages)).toBe(false)
    expect(interaction.memberPermissions!.bitfield).toBe(member.permissionsIn(channel).bitfield)
  })

  it('applies them on top of the permissions a test sets on the member', () => {
    const { channel, interaction, member } = deniedChannel()
    Object.defineProperty(member, 'permissions', { value: bits(SendMessages, ViewChannel) })
    channel.permissionOverwrites.cache.set(member.id, { id: member.id, type: OverwriteType.Member, allow: bits(ManageMessages), deny: bits() } as never)

    expect([interaction.memberPermissions!.has(SendMessages), interaction.memberPermissions!.has(ManageMessages)]).toEqual([false, true])
  })

  it('gives every permission to an Administrator and to the server owner, as discord.js does', () => {
    const admin = deniedChannel([Administrator])
    const owner = deniedChannel()
    owner.guild.ownerId = owner.member.id

    for (const { interaction } of [admin, owner]) expect(interaction.memberPermissions!.bitfield).toBe(PermissionsBitField.All)
  })

  it("lets a role's allow win over @everyone's deny of the same permission, then the member's over the role's", () => {
    const { channel, interaction, member } = deniedChannel()
    const [role] = [...member.roles.cache.values()].filter(each => each.id !== member.guild.id)
    channel.permissionOverwrites.cache.set(role.id, { id: role.id, type: OverwriteType.Role, allow: bits(SendMessages), deny: bits(ViewChannel) } as never)
    channel.permissionOverwrites.cache.set(member.id, { id: member.id, type: OverwriteType.Member, allow: bits(ViewChannel), deny: bits() } as never)

    expect([interaction.memberPermissions!.has(SendMessages), interaction.memberPermissions!.has(ViewChannel)]).toEqual([true, true])
  })

  it("uses a thread's parent's overwrites", () => {
    const { guild, channel, member } = deniedChannel()
    const thread = createMockChannel(ThreadChannel, { guild, parentId: channel.id } as never)
    const inThread = createMockInteraction(ChatInputCommandInteraction, { commandName: 'post', guild, channel: thread, member } as never)

    expect(inThread.memberPermissions!.has(SendMessages)).toBe(false)
  })

  it("keeps a raw member's permissions as given", () => {
    const raw = createMockRawMember({ permissions: SendMessages })
    const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName: 'post', guildId: '1400000000000009999', member: raw })

    expect(interaction.memberPermissions!.has(SendMessages)).toBe(true)
  })
})

describe("memberPermissions, beside discord.js's own permissionsIn", () => {
  beforeEach(() => useStrictMocks())

  // For a member whose permissions come from its roles alone, both compute the same: a drift in discord.js's turns red
  it.each([
    ['@everyone denied', () => deniedChannel()],
    ['@everyone allowed', () => {
      const place = deniedChannel([ViewChannel])
      place.channel.permissionOverwrites.cache.set(place.guild.id, { id: place.guild.id, type: OverwriteType.Role, allow: bits(ManageMessages), deny: bits() } as never)
      return place
    }],
    ['a role over @everyone', () => {
      const place = deniedChannel()
      const [role] = [...place.member.roles.cache.values()].filter(each => each.id !== place.guild.id)
      place.channel.permissionOverwrites.cache.set(role.id, { id: role.id, type: OverwriteType.Role, allow: bits(SendMessages), deny: bits() } as never)
      return place
    }],
    ['the member over a role', () => {
      const place = deniedChannel()
      const [role] = [...place.member.roles.cache.values()].filter(each => each.id !== place.guild.id)
      place.channel.permissionOverwrites.cache.set(role.id, { id: role.id, type: OverwriteType.Role, allow: bits(), deny: bits(ViewChannel) } as never)
      place.channel.permissionOverwrites.cache.set(place.member.id, { id: place.member.id, type: OverwriteType.Member, allow: bits(ViewChannel), deny: bits() } as never)
      return place
    }],
    ['an Administrator', () => deniedChannel([Administrator])],
    ['the owner', () => {
      const place = deniedChannel()
      place.guild.ownerId = place.member.id
      return place
    }],
    ['a thread', () => {
      const place = deniedChannel()
      const thread = createMockChannel(ThreadChannel, { guild: place.guild, parentId: place.channel.id } as never)
      const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName: 'post', guild: place.guild, channel: thread, member: place.member } as never)
      return { ...place, channel: thread as never, interaction }
    }],
  ])('agrees for %s', (_case, make) => {
    const { channel, interaction, member } = make()

    expect(interaction.memberPermissions!.bitfield).toBe(member.permissionsIn(channel).bitfield)
  })
})

describe('memberPermissions, in default mode', () => {
  it("reads the member's permissions as before, and warns once with what strict mocks read", () => {
    const { interaction } = deniedChannel()

    expect(interaction.memberPermissions!.has(SendMessages)).toBe(true)
    expect(warned).toEqual([expect.stringMatching(/^ChatInputCommandInteraction\.memberPermissions .*overwrites.*5\.0.*SendMessages.*useStrictMocks\(\)/s)])
  })

  it('warns for an Administrator, whose every permission strict mocks read', () => {
    void deniedChannel([Administrator]).interaction.memberPermissions

    expect(warned).toEqual([expect.stringMatching(/memberPermissions .*Administrator.*5\.0.*with .*ManageGuild/s)])
  })

  it("says nothing where the channel's overwrites change nothing", () => {
    const { channel, interaction, guild } = deniedChannel([ViewChannel])
    channel.permissionOverwrites.cache.delete(guild.id)
    void interaction.memberPermissions

    expect(warned).toEqual([])
  })
})
