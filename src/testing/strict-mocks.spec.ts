import 'reflect-metadata'
import {
  DMChannel,
  GuildMember,
  MessageReaction,
  OverwriteType,
  PermissionFlagsBits,
  PermissionsBitField,
  Role,
  TextChannel,
  ThreadChannel,
  VoiceChannel,
} from 'discord.js'
import { Logger } from '@src/common/logger.js'
import { forgetDeprecationWarnings } from '@src/common/deprecation.js'
import { forgetStrictMocks, useStrictMocks } from './strict-mocks.js'
import {
  createMockChannel,
  createMockClient,
  createMockGuild,
  createMockInteraction,
  createMockMember,
  createMockMessage,
  createMockUser,
} from './mock-interaction.js'

const role = (id: string, position: number, permissions: bigint[]) =>
  createMockInteraction(Role, { id, position, permissions: new PermissionsBitField(permissions).freeze() })

let warned: string[]
beforeEach(() => {
  forgetStrictMocks()
  forgetDeprecationWarnings()
  warned = []
  vi.spyOn(Logger.prototype, 'warn').mockImplementation((text: unknown) => void warned.push(String(text)))
  useStrictMocks()
})
afterEach(() => vi.restoreAllMocks())
afterAll(() => forgetStrictMocks())

/** A server with a text channel and `roles`, and the bot's member given `permissions` through a role at position 9. */
function server(permissions: bigint[] = [], roles: Role[] = []) {
  const channel = createMockChannel(TextChannel)
  const botRole = role('300000000000000009', 9, permissions)
  const guild = createMockGuild({ roles: [botRole, ...roles], channels: [channel] })
  guild.members.me!.roles.add(botRole)
  return { guild, channel }
}

describe('useStrictMocks', () => {
  it("computes a message's values as discord.js does, from its author and the bot's permissions", () => {
    const { guild, channel } = server()
    const own = createMockMessage({ guild, channel, author: guild.client.user })
    const theirs = createMockMessage({ guild, channel })

    expect([own.editable, own.deletable, own.pinnable, own.crosspostable, own.bulkDeletable]).toEqual([true, true, false, false, false])
    expect([theirs.editable, theirs.deletable, theirs.hasThread, theirs.partial]).toEqual([false, false, false, false])
  })

  it("lets a message be deleted in bulk and pinned once the bot's role has the permissions", () => {
    const { guild, channel } = server([PermissionFlagsBits.ManageMessages, PermissionFlagsBits.PinMessages])
    const theirs = createMockMessage({ guild, channel })

    expect([theirs.deletable, theirs.bulkDeletable, theirs.pinnable]).toEqual([true, true, true])
  })

  it('reads a direct message as discord.js does: pinnable, and deletable only when the bot sent it', () => {
    const client = createMockClient()
    const theirs = createMockMessage({ guild: null, client })
    const own = createMockMessage({ guild: null, client, author: client.user, channel: createMockChannel(DMChannel) })

    expect([theirs.pinnable, theirs.deletable, theirs.editable]).toEqual([true, false, false])
    expect(own.deletable).toBe(true)
  })

  it("reads a message's thread as the one its channel caches, else null", () => {
    const { guild, channel } = server()
    const message = createMockMessage({ guild, channel })
    expect(message.thread).toBeNull()

    const thread = createMockChannel(ThreadChannel)
    channel.threads.cache.set(message.id, thread as never)
    expect(message.thread).toBe(thread)
  })

  it('lets the bot kick, ban and time out a member its role ranks above, with the permissions', () => {
    const { guild } = server([PermissionFlagsBits.KickMembers, PermissionFlagsBits.BanMembers, PermissionFlagsBits.ModerateMembers])
    const member = createMockMember({ guild })
    const peer = createMockMember({ guild, roles: [role('300000000000000010', 10, [])] })

    expect([member.manageable, member.kickable, member.bannable, member.moderatable]).toEqual([true, true, true, true])
    expect([peer.manageable, peer.kickable]).toEqual([false, false])
  })

  it("lets the bot edit a role below its own, with ManageRoles, and not one it doesn't rank above", () => {
    const below = role('300000000000000001', 1, [])
    const above = role('300000000000000011', 11, [])
    server([PermissionFlagsBits.ManageRoles], [below, above])

    expect([below.editable, above.editable]).toEqual([true, false])
  })

  it('gives @everyone the permissions Discord gives it in a server made today', () => {
    const { everyone } = server().channel.guild.roles
    expect(everyone.permissions.bitfield).toBe(2248473465835073n)
    expect(everyone.permissions.has([PermissionFlagsBits.UseApplicationCommands, PermissionFlagsBits.SendMessagesInThreads])).toBe(true)
    expect(everyone.permissions.has(PermissionFlagsBits.SendTTSMessages)).toBe(false)
  })

  it("reads a channel as one the bot can view under Discord's default permissions, and not manage", () => {
    const { channel } = server()
    expect([channel.viewable, channel.manageable, channel.deletable]).toEqual([true, false, false])

    channel.permissionOverwrites.cache.set(channel.guild.id, {
      id: channel.guild.id,
      type: OverwriteType.Role,
      allow: new PermissionsBitField().freeze(),
      deny: new PermissionsBitField(PermissionFlagsBits.ViewChannel).freeze(),
    } as never)
    expect(channel.viewable).toBe(false)
  })

  it('reads a thread and a voice channel made on their own, each in a server of its own', () => {
    const thread = createMockChannel(ThreadChannel)
    const voice = createMockChannel(VoiceChannel)

    expect([thread.joinable, thread.joined, thread.sendable, thread.unarchivable, thread.viewable]).toEqual([true, false, true, false, true])
    expect([thread.archived, thread.locked]).toEqual([false, false])
    expect([voice.joinable, voice.speakable, voice.full]).toEqual([true, true, false])
  })

  it('reads users, channels and reactions as whole, not partial', () => {
    const reaction = createMockInteraction(MessageReaction)

    const partial = [createMockUser(), createMockChannel(TextChannel), createMockChannel(DMChannel), reaction].map(each => each.partial)

    expect(partial).toEqual([false, false, false, false])
  })

  it('logs none of the warnings a placeholder gives', () => {
    const { guild, channel } = server()
    const message = createMockMessage({ guild, channel })
    void [message.editable, message.thread, createMockMember({ guild }).kickable]

    expect(warned).toEqual([])
  })

  it('reads a value the test set over the computed one', () => {
    const { guild, channel } = server()
    const message = createMockMessage({ guild, channel })
    message.editable = true
    const member = createMockInteraction(GuildMember, { guild } as never)
    ;(member as { kickable: boolean }).kickable = true

    expect([message.editable, member.kickable]).toEqual([true, true])
  })
})

describe('useStrictMocks, called again or late', () => {
  it('does nothing when called again', () => {
    createMockUser()

    expect(() => useStrictMocks()).not.toThrow()
  })

  it('is refused once a mock exists, which was made without it', () => {
    forgetStrictMocks()
    createMockUser()

    expect(() => useStrictMocks()).toThrow(/before any mock is made.*setup file/)
  })
})
