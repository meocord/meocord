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

  it('keeps every permission for an Administrator and for the server owner', () => {
    const admin = deniedChannel([Administrator])
    const owner = deniedChannel()
    owner.guild.ownerId = owner.member.id

    for (const { interaction } of [admin, owner]) expect(interaction.memberPermissions!.has(SendMessages)).toBe(true)
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

describe('memberPermissions, in default mode', () => {
  it("reads the member's permissions as before, and warns once with what strict mocks read", () => {
    const { interaction } = deniedChannel()

    expect(interaction.memberPermissions!.has(SendMessages)).toBe(true)
    expect(warned).toEqual([expect.stringMatching(/^ChatInputCommandInteraction\.memberPermissions .*overwrites.*5\.0.*SendMessages.*useStrictMocks\(\)/s)])
  })

  it("says nothing where the channel's overwrites change nothing", () => {
    const { channel, interaction, guild } = deniedChannel([ViewChannel])
    channel.permissionOverwrites.cache.delete(guild.id)
    void interaction.memberPermissions
    void deniedChannel([Administrator]).interaction.memberPermissions

    expect(warned).toEqual([])
  })
})
