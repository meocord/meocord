import 'reflect-metadata'
import { vi } from 'vitest'
import { ButtonInteraction, Collection, PermissionFlagsBits, Role, TextChannel, UserContextMenuCommandInteraction } from 'discord.js'
import {
  createMockChannel,
  createMockClient,
  createMockGuild,
  createMockInteraction,
  createMockMember,
  createMockMessage,
  createMockUser,
} from '@src/testing/mock-interaction.js'
import { forgetStrictMocks, useStrictMocks } from '@src/testing/strict-mocks.js'
import { Logger } from '@src/common/logger.js'
import { forgetDeprecationWarnings } from '@src/common/deprecation.js'

describe('the values a mock reads as Discord sends them', () => {
  it('reads a role as a plain one: not hoisted, managed or mentionable, with no icon, tags or colours', () => {
    const role = createMockInteraction(Role, { position: 3 })

    expect([role.hoist, role.managed, role.mentionable, role.icon, role.unicodeEmoji, role.tags]).toEqual([false, false, false, null, null, null])
    expect(role.rawPosition).toBe(3)
    expect(role.hexColor).toBe('#000000')
    expect(role.createdAt).toBeInstanceOf(Date)
  })

  it('reads a member as one in the server since it was made, not partial and not timed out', () => {
    const member = createMockMember()

    expect(member.joinedTimestamp).toEqual(expect.any(Number))
    expect(member.joinedAt).toBeInstanceOf(Date)
    expect(member.partial).toBe(false)
    expect(member.isCommunicationDisabled()).toBe(false)
  })

  it('reads a message as a plain one: no reference, poll, stickers or interaction', () => {
    const message = createMockMessage()

    expect([message.reference, message.poll, message.interactionMetadata]).toEqual([null, null, null])
    expect(message.stickers).toEqual(new Collection())
  })

  it('gives no avatar or icon URL for a user or guild with none, and a default avatar URL', () => {
    const user = createMockUser()

    expect(user.avatarURL()).toBeNull()
    expect(user.displayAvatarURL()).toMatch(/^https:\/\/cdn\.discordapp\.com\/embed\/avatars\/\d\.png$/)
    expect(createMockGuild().iconURL()).toBeNull()
  })

  it('reads a mock client as ready', () => {
    expect(createMockClient().isReady()).toBe(true)
  })

  it("gives an interaction in a server the bot member's permissions in its channel", () => {
    const channel = createMockChannel(TextChannel)
    const guild = createMockGuild({ channels: [channel] })
    const everyone = guild.roles.everyone
    ;(everyone as { permissions: unknown }).permissions = everyone.permissions.add(PermissionFlagsBits.SendMessages).freeze()

    const click = createMockInteraction(ButtonInteraction, { guild, guildId: guild.id, channel })

    expect(click.appPermissions.has(PermissionFlagsBits.SendMessages)).toBe(true)
    expect(click.appPermissions.has(PermissionFlagsBits.BanMembers)).toBe(false)
  })
})

const W_OTHER_MEMBER = /^UserContextMenuCommandInteraction\.targetMember here is the member of another user with the targetUser's id; under useStrictMocks\(\)/

describe("a user context menu's target", () => {
  let warned: string[]
  beforeEach(() => {
    forgetDeprecationWarnings()
    warned = []
    vi.spyOn(Logger.prototype, 'warn').mockImplementation((text: unknown) => void warned.push(String(text)))
  })
  afterEach(() => {
    forgetStrictMocks()
    vi.restoreAllMocks()
  })

  it('is a user with the targetId, the cached one or one made, and in a server their member', () => {
    const guild = createMockGuild()
    const target = createMockUser()
    const menu = createMockInteraction(UserContextMenuCommandInteraction, { guild, guildId: guild.id, targetId: target.id })
    menu.client.users.cache.set(target.id, target)

    expect(menu.targetUser).toBe(target)
    expect(menu.targetMember).toBe(guild.members.cache.get(target.id))
  })

  it('is the targetUser given under useStrictMocks(), cached on the client, and in a server its member', () => {
    useStrictMocks()
    const guild = createMockGuild()
    const target = createMockUser({ username: 'ada' })
    const menu = createMockInteraction(UserContextMenuCommandInteraction, { commandName: 'Report', guild, guildId: guild.id, targetUser: target })

    expect(menu.client.users.cache.get(target.id)).toBe(target)
    expect([menu.targetUser, menu.targetMember?.user]).toEqual([target, target])
    expect(menu.targetMember?.user).toBe(target)
    expect(warned).toEqual([])
  })

  it("keeps the member's own user in default mode, with a warning, where the targetUser given is another", () => {
    const guild = createMockGuild()
    const target = createMockUser({ username: 'ada' })
    const menu = createMockInteraction(UserContextMenuCommandInteraction, { commandName: 'Report', guild, guildId: guild.id, targetUser: target })

    expect(menu.targetUser).toBe(target)
    expect([menu.targetMember?.user.id, menu.targetMember?.user === target, menu.client.users.cache.get(target.id) === target]).toEqual([target.id, false, false])
    expect(warned).toEqual([expect.stringMatching(W_OTHER_MEMBER)])
  })

  it('warns in default mode only when a test reads targetMember, in a server, where there is a member', () => {
    const guild = createMockGuild()
    const target = createMockUser()
    const unread = createMockInteraction(UserContextMenuCommandInteraction, { commandName: 'Report', guild, guildId: guild.id, targetUser: target })
    const inDm = createMockInteraction(UserContextMenuCommandInteraction, { commandName: 'Report', targetUser: createMockUser() })

    expect([unread.targetUser, inDm.targetMember]).toEqual([target, null])
    expect(warned).toEqual([])
  })

  it('is a new user with an id of its own when none is given, and stays writable', () => {
    const menu = createMockInteraction(UserContextMenuCommandInteraction)

    expect(menu.targetUser.id).toBe(menu.targetId)
    expect(menu.targetMember).toBeNull()
    menu.targetUser.id = '500000000000000001'
    expect(menu.targetUser.id).toBe('500000000000000001')
    menu.targetId = '500000000000000002'
    expect(menu.targetUser.id).toBe('500000000000000002')
  })
})
