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
  // @everyone has none of its own, so the member's permissions are its role's alone, in both modes
  ;(guild.roles.everyone as { permissions: unknown }).permissions = bits()
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

  it("reads the member it has without resolving it again, so a test's resolve stub stays for its own caller", () => {
    const { interaction, member } = deniedChannel()
    vi.mocked(member.guild.members.resolve).mockReturnValueOnce(null)

    expect(interaction.memberPermissions!.has(SendMessages)).toBe(false)
    expect(member.guild.members.resolve(member.id)).toBeNull()
  })

  it("keeps a raw member's permissions as given", () => {
    const raw = createMockRawMember({ permissions: SendMessages })
    const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName: 'post', guildId: '1400000000000009999', member: raw })

    expect(interaction.memberPermissions!.has(SendMessages)).toBe(true)
  })
})

it("reads @everyone with a new server's permissions under useStrictMocks(), without a warning", () => {
  useStrictMocks()
  const guild = createMockGuild()
  const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName: 'post', guild, guildId: guild.id })

  expect(interaction.memberPermissions!.bitfield).toBe(new PermissionsBitField(guild.roles.everyone.permissions).bitfield)
  expect(guild.roles.everyone.permissions.has(SendMessages)).toBe(true)
  expect(warned).toEqual([])
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

  it("warns once where the server's @everyone role has no permissions set, which strict mocks give a new server's", () => {
    const guild = createMockGuild()
    const inGuild = () => createMockInteraction(ChatInputCommandInteraction, { commandName: 'post', guild, guildId: guild.id })

    void [inGuild().memberPermissions, inGuild().memberPermissions]
    expect(warned).toEqual([expect.stringMatching(/^ChatInputCommandInteraction\.memberPermissions reads the server's @everyone role here with no permissions.*5\.0.*guild\.roles\.everyone\.permissions.*useStrictMocks\(\)/s)])

    forgetDeprecationWarnings()
    warned.length = 0
    ;(guild.roles.everyone as { permissions: unknown }).permissions = bits()
    void inGuild().memberPermissions
    expect(warned).toEqual([])
  })

  it("says nothing where the channel's overwrites change nothing", () => {
    const { channel, interaction, guild } = deniedChannel([ViewChannel])
    channel.permissionOverwrites.cache.delete(guild.id)
    void interaction.memberPermissions

    expect(warned).toEqual([])
  })
})

it("warns once on appPermissions where the server's @everyone role has no permissions set, as the bot's member has it too", () => {
  const guild = createMockGuild()
  const inGuild = () => createMockInteraction(ChatInputCommandInteraction, { commandName: 'post', guild, guildId: guild.id })

  void [inGuild().appPermissions, inGuild().appPermissions]
  expect(warned).toEqual([expect.stringMatching(/^ChatInputCommandInteraction\.appPermissions reads the server's @everyone role here with no permissions.*5\.0/s)])

  forgetDeprecationWarnings()
  warned.length = 0
  ;(guild.roles.everyone as { permissions: unknown }).permissions = bits()
  void inGuild().appPermissions
  expect(warned).toEqual([])
})

describe("appPermissions, beside discord.js's own permissionsFor", () => {
  /** A server and #general, where the bot's roles are `permissions` and @everyone is denied SendMessages. */
  function botIn(permissions: bigint[]) {
    const { guild, channel } = deniedChannel()
    const me = guild.members.me!
    const role = createMockInteraction(Role, { id: '300000000000000006', position: 6, permissions: bits(...permissions), guild } as never)
    guild.roles.cache.set(role.id, role as never)
    me.roles.add(role)
    return { guild, channel, me }
  }

  it.each([
    ['@everyone denied', () => botIn([SendMessages, ViewChannel])],
    ['an Administrator', () => botIn([Administrator])],
    ['the owner', () => {
      const place = botIn([ViewChannel])
      place.guild.ownerId = place.me.id
      return place
    }],
    ['a role over @everyone', () => {
      const place = botIn([SendMessages, ViewChannel])
      const [role] = [...place.me.roles.cache.values()].filter(each => each.id !== place.guild.id)
      place.channel.permissionOverwrites.cache.set(role.id, { id: role.id, type: OverwriteType.Role, allow: bits(SendMessages), deny: bits() } as never)
      return place
    }],
  ])('agrees for %s, in a channel and in a thread of it', (_case, make) => {
    const { guild, channel, me } = make()
    const thread = createMockChannel(ThreadChannel, { guild, parentId: channel.id } as never)
    const expected = channel.permissionsFor(me)!.bitfield

    for (const place of [channel, thread]) {
      const click = createMockInteraction(ChatInputCommandInteraction, { commandName: 'post', guild, channel: place } as never)
      expect(click.appPermissions.bitfield).toBe(expected)
    }
  })
})

it("memberPermissions in a thread made without a parent makes and caches none, and uses the one a test reads, under useStrictMocks()", () => {
  useStrictMocks()
  const { guild, member } = deniedChannel()
  const thread = createMockChannel(ThreadChannel, { guild } as never)
  const inThread = () => createMockInteraction(ChatInputCommandInteraction, { commandName: 'post', guild, channel: thread, member } as never)
  const first = inThread()
  const size = guild.channels.cache.size

  expect(first.memberPermissions!.has(SendMessages)).toBe(true)
  expect(guild.channels.cache.size).toBe(size)
  const parent = guild.channels.cache.get(thread.parentId!) as TextChannel
  parent.permissionOverwrites.cache.set(guild.id, { id: guild.id, type: OverwriteType.Role, allow: bits(), deny: bits(SendMessages) } as never)
  expect(inThread().memberPermissions!.has(SendMessages)).toBe(false)
})
