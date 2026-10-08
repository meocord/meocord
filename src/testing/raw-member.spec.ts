import 'reflect-metadata'
import { ChatInputCommandInteraction, PermissionFlagsBits, PermissionsBitField, TextChannel, User } from 'discord.js'
import { Command, Controller, Guard, UseGuard } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { type GuardInterface } from '@src/interface/index.js'
import { MeoCordTestingModule } from './meocord-testing-module.js'
import { createChatInputOptions, createMockChannel, createMockGuild, createMockInteraction, createMockRawMember, createMockUser } from './mock-interaction.js'
import { getResponse } from './response.js'
import { Logger } from '@src/common/logger.js'
import { forgetDeprecationWarnings } from '@src/common/deprecation.js'

const SERVER = '100000000000000001'

describe('createMockRawMember', () => {
  it('builds the member Discord sends from a server the bot is not in: role ids, a permissions string, the rest as sent', () => {
    const member = createMockRawMember()

    expect(member).toEqual({
      user: { id: expect.any(String), username: 'user', discriminator: '0', global_name: null, avatar: null },
      roles: [],
      permissions: String(PermissionsBitField.Default),
      nick: null,
      avatar: null,
      banner: null,
      premium_since: null,
      communication_disabled_until: null,
      joined_at: expect.any(String),
      deaf: false,
      mute: false,
      pending: false,
      flags: 0,
    })
    expect(Number.isNaN(Date.parse(member.joined_at!))).toBe(false)
  })

  it('takes the roles, permissions and user given, the permissions as Discord writes them', () => {
    const member = createMockRawMember({
      roles: ['300000000000000001'],
      permissions: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.KickMembers],
      user: { id: '200000000000000001', username: 'ada' },
      nick: 'Ada',
    })

    expect(member.roles).toEqual(['300000000000000001'])
    expect(member.permissions).toBe(String(PermissionFlagsBits.SendMessages | PermissionFlagsBits.KickMembers))
    expect([member.user.id, member.user.username, member.nick]).toEqual(['200000000000000001', 'ada', 'Ada'])
  })
})

describe('an interaction given a raw member', () => {
  it('reads as one from a server the bot is not in, as discord.js reads it', () => {
    const member = createMockRawMember({ user: { id: '200000000000000001', username: 'ada' }, permissions: [PermissionFlagsBits.SendMessages] })

    const command = createMockInteraction(ChatInputCommandInteraction, { guildId: SERVER, member })

    expect([command.guildId, command.guild, command.member]).toEqual([SERVER, null, member])
    expect(command.member).toBe(member)
    expect([command.inGuild(), command.inCachedGuild(), command.inRawGuild()]).toEqual([true, false, true])
    expect(command.user).toBeInstanceOf(User)
    expect([command.user.id, command.user.username]).toEqual(['200000000000000001', 'ada'])
    expect(command.client.users.cache.get('200000000000000001')).toBe(command.user)
    expect(command.memberPermissions!.has(PermissionFlagsBits.SendMessages)).toBe(true)
    expect(command.memberPermissions!.has(PermissionFlagsBits.BanMembers)).toBe(false)
  })

  it('has no channel, only its channelId, as discord.js caches none from a server it is not in', () => {
    const command = createMockInteraction(ChatInputCommandInteraction, { guildId: SERVER, member: createMockRawMember() })

    expect(command.channel).toBeNull()
    expect(command.channelId).toEqual(expect.any(String))
  })

  it("gives a user option's member as the resolved member Discord sends, with no user of its own", () => {
    const target = createMockUser()
    const command = createMockInteraction(ChatInputCommandInteraction, {
      guildId: SERVER,
      member: createMockRawMember(),
      options: createChatInputOptions({ target }),
    })

    const resolved = command.options.getMember('target') as unknown as Record<string, unknown>

    expect(resolved).toEqual(expect.objectContaining({ roles: [], permissions: String(PermissionsBitField.Default), nick: null }))
    expect('user' in resolved).toBe(false)
    expect(command.options.getUser('target')).toBe(target)
  })

  it.each([
    ['without a guildId', () => ({}), /server the bot isn't in.*guildId/],
    ['with another user', () => ({ guildId: SERVER, user: createMockUser({ id: '200000000000000002' }) }), /200000000000000001.*200000000000000002/],
    ['with a channel', () => ({ guildId: SERVER, channel: createMockChannel(TextChannel) }), /server the bot isn't in.*channel/],
  ] as const)('is refused %s, naming what disagrees', (_name, more, message) => {
    const member = createMockRawMember({ user: { id: '200000000000000001' } })

    expect(() => createMockInteraction(ChatInputCommandInteraction, { member, ...more() } as never)).toThrow(message)
  })

  it('keeps a raw-shaped member given with a guild as before, a cached server, and warns once to leave the guild out', () => {
    const warned: string[] = []
    forgetDeprecationWarnings()
    vi.spyOn(Logger.prototype, 'warn').mockImplementation((text: unknown) => void warned.push(String(text)))
    const guild = createMockGuild({ id: SERVER })
    const member = createMockRawMember()

    const command = createMockInteraction(ChatInputCommandInteraction, { guildId: SERVER, guild, member } as never)
    createMockInteraction(ChatInputCommandInteraction, { guildId: SERVER, guild, member: createMockRawMember() } as never)

    expect([command.guild, command.member, command.inCachedGuild(), command.inRawGuild(), command.memberPermissions]).toEqual([guild, member, true, false, null])
    expect(warned).toEqual([expect.stringMatching(/raw member.*guild.*leave the guild out/)])
    vi.restoreAllMocks()
  })

  it('runs through dispatch as in Discord: a guard that reads a cached member throws, and the answers are reported', async () => {
    @Guard()
    class Staff implements GuardInterface {
      canActivate(interaction: ChatInputCommandInteraction) {
        return (interaction.member as unknown as { roles: { cache: Map<string, unknown> } }).roles.cache.has('300000000000000001')
      }
    }
    @Controller()
    class Reports {
      @Command('report', CommandType.SLASH)
      async report(interaction: ChatInputCommandInteraction) {
        await interaction.reply({ content: interaction.inRawGuild() ? 'raw' : 'cached' })
      }

      @Command('audit', CommandType.SLASH)
      @UseGuard(Staff)
      async audit() {}
    }
    const module = MeoCordTestingModule.create({ controllers: [Reports] }).compile()
    const report = createMockInteraction(ChatInputCommandInteraction, { commandName: 'report', guildId: SERVER, member: createMockRawMember() })

    await module.dispatch(report)
    expect(getResponse(report).calls).toEqual([expect.objectContaining({ method: 'reply', payload: { content: 'raw' } })])

    const audit = createMockInteraction(ChatInputCommandInteraction, { commandName: 'audit', guildId: SERVER, member: createMockRawMember() })
    await expect(module.dispatch(audit)).rejects.toThrow(TypeError)
  })
})
