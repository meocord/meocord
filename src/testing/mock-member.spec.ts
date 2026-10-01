import 'reflect-metadata'
import { ChatInputCommandInteraction, DMChannel, GuildMember, PermissionFlagsBits, PermissionsBitField, Role, User } from 'discord.js'
import { createMockGuild, createMockInteraction, createMockMember, createMockMessage, createMockUser } from './mock-interaction.js'

const role = (permissions: bigint[] = [], position = 0) => createMockInteraction(Role, { permissions: new PermissionsBitField(permissions), position })

describe('a mock user', () => {
  it('is a person however it is made, as Discord sends one', () => {
    for (const user of [createMockInteraction(User), createMockUser(), createMockMessage().author]) {
      expect([user.bot, user.system]).toEqual([false, false])
    }
  })
})

describe('a direct message', () => {
  it('goes through the one DM channel of the user, whether sent to the user or to a member of theirs', async () => {
    const member = createMockMember()
    const channel = await member.user.createDM()

    await member.send('through the member')
    await member.user.send('to the user')

    expect(channel).toBeInstanceOf(DMChannel)
    expect(await member.createDM()).toBe(channel)
    expect(member.user.send).toHaveBeenCalledWith('through the member')
    expect(channel.send).toHaveBeenNthCalledWith(1, 'through the member')
    expect(channel.send).toHaveBeenNthCalledWith(2, 'to the user')
  })
})

describe('createMockMember', () => {
  it('is a member of the user and server given, with the roles given in its cache', () => {
    const user = createMockUser()
    const guild = createMockGuild()
    const moderator = role()

    const member = createMockMember({ user, guild, roles: [moderator], nickname: 'Ada' })

    expect(member).toBeInstanceOf(GuildMember)
    expect([member.user, member.id, member.guild, member.nickname, member.displayName]).toEqual([user, user.id, guild, 'Ada', 'Ada'])
    expect(member.roles.cache.get(moderator.id)).toBe(moderator)
    expect(guild.members.cache.get(user.id)).toBe(member)
  })

  it('takes its permissions from its roles, and every permission as the server owner', () => {
    const member = createMockMember({ roles: [role([PermissionFlagsBits.KickMembers]), role([PermissionFlagsBits.BanMembers])] })
    const owner = createMockMember()
    Object.assign(owner.guild, { ownerId: owner.id })

    expect(member.permissions.has([PermissionFlagsBits.KickMembers, PermissionFlagsBits.BanMembers])).toBe(true)
    expect(member.permissions.has(PermissionFlagsBits.ManageGuild)).toBe(false)
    expect(owner.permissions.has(PermissionsBitField.All)).toBe(true)
  })

  it('adds and removes roles as discord.js does, resolving to the member, and names the highest', async () => {
    const low = role([], 1)
    const high = role([PermissionFlagsBits.ManageGuild], 5)
    const member = createMockMember({ roles: [low] })

    await expect(member.roles.add(high)).resolves.toBe(member)
    expect(member.roles.highest).toBe(high)
    expect(member.permissions.has(PermissionFlagsBits.ManageGuild)).toBe(true)

    await member.roles.remove(high.id)
    expect([...member.roles.cache.keys()]).toEqual([member.guild.id, low.id])
  })

  it('is the member of an interaction from its user in its server, roles and permissions included', () => {
    const user = createMockUser()
    const guild = createMockGuild({ members: [createMockMember({ user, roles: [role([PermissionFlagsBits.ManageGuild])] })] })

    const interaction = createMockInteraction(ChatInputCommandInteraction, { user, guildId: guild.id, guild })

    expect(interaction.member).toBe(guild.members.cache.get(user.id))
    expect((interaction.member as GuildMember).guild).toBe(guild)
    expect(interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)).toBe(true)
  })
})

describe("a mock server's @everyone role", () => {
  it('is a role with the id of its server, at position 0, unless the test gives one with that id', () => {
    const guild = createMockGuild()
    const id = '100000000000000042'
    const given = createMockInteraction(Role, { id, permissions: new PermissionsBitField([PermissionFlagsBits.SendMessages]) })
    const configured = createMockGuild({ id, roles: [given] })

    expect(guild.roles.everyone).toBeInstanceOf(Role)
    expect([guild.roles.everyone.id, guild.roles.everyone.position]).toEqual([guild.id, 0])
    expect(guild.roles.cache.get(guild.id)).toBe(guild.roles.everyone)
    expect(configured.roles.everyone).toBe(given)
    expect(given.position).toBe(0)
  })

  it('ranks below a role made without a position, so that role is the highest of a member who has it', () => {
    const plain = createMockInteraction(Role, {})

    expect(createMockMember({ roles: [plain] }).roles.highest).toBe(plain)
  })

  it("counts in every member's permissions, first in its role cache, as discord.js has it", () => {
    const id = '100000000000000043'
    const guild = createMockGuild({ id, roles: [createMockInteraction(Role, { id, permissions: new PermissionsBitField([PermissionFlagsBits.SendMessages]) })] })

    const member = createMockMember({ guild, roles: [role([PermissionFlagsBits.KickMembers], 2)] })

    expect(member.roles.cache.firstKey()).toBe(id)
    expect(member.permissions.has([PermissionFlagsBits.SendMessages, PermissionFlagsBits.KickMembers])).toBe(true)
  })

  it('ranks roles at one position by id, the lower first, as discord.js compares them', () => {
    const older = createMockInteraction(Role, { id: '100000000000000001', position: 3 })
    const newer = createMockInteraction(Role, { id: '100000000000000002', position: 3 })

    expect(createMockMember({ roles: [newer, older] }).roles.highest).toBe(older)
  })
})

describe("a mock member's roles and permissions, where the test gives none", () => {
  it("are the server's @everyone role alone and no permissions, for a member made any way", () => {
    const members = [createMockMessage().member!, createMockMember(), createMockGuild({ members: [createMockMember()] }).members.cache.first()!]

    for (const member of members) {
      expect([...member.roles.cache.values()]).toEqual([member.guild.roles.everyone])
      expect(member.roles.highest).toBe(member.guild.roles.everyone)
      expect(member.permissions.has(PermissionFlagsBits.SendMessages)).toBe(false)
    }
  })

  // A guildId without a guild is a server the bot isn't in, where the interaction still comes from a member
  it("are an @everyone role with the server's id for a member of a server the mock has only the id of", () => {
    const member = createMockInteraction(ChatInputCommandInteraction, { guildId: '100000000000000001' }).member as GuildMember

    expect([...member.roles.cache.keys()]).toEqual(['100000000000000001'])
    expect(member.roles.highest?.id).toBe('100000000000000001')
    expect(member.roles.highest).toBe(member.roles.cache.first())
    expect(member.permissions.has(PermissionFlagsBits.SendMessages)).toBe(false)
  })

  it('are no roles, and no highest, for a member made with nothing to say what server it is in', () => {
    const member = createMockInteraction(GuildMember)

    expect(member.roles.cache.size).toBe(0)
    expect(member.roles.highest).toBeUndefined()
    expect(member.permissions.has(PermissionFlagsBits.SendMessages)).toBe(false)
  })

  it("give an interaction in a server its member's permissions, and one in a direct message none", () => {
    const inServer = createMockInteraction(ChatInputCommandInteraction, { guildId: '100000000000000001' })
    const direct = createMockInteraction(ChatInputCommandInteraction)

    expect(inServer.memberPermissions).toBeInstanceOf(PermissionsBitField)
    expect(inServer.memberPermissions?.has(PermissionFlagsBits.ManageGuild)).toBe(false)
    expect(direct.memberPermissions).toBeNull()
  })
})
