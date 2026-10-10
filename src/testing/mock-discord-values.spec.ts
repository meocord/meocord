import 'reflect-metadata'
import {
  ChatInputCommandInteraction,
  Collection,
  GuildFeature,
  GuildMemberFlagsBitField,
  MessageReaction,
  ModalSubmitInteraction,
  StageChannel,
  TextChannel,
  ThreadChannel,
  UserFlagsBitField,
  VoiceChannel,
} from 'discord.js'
import { vi } from 'vitest'
import { Logger } from '@src/common/logger.js'
import { forgetDeprecationWarnings } from '@src/common/deprecation.js'
import { Controller, ReactionHandler } from '@src/decorator/index.js'
import {
  createChatInputOptions,
  createMockChannel,
  createMockGuild,
  createMockInteraction,
  createMockMember,
  createMockMessage,
  createMockUser,
} from './mock-interaction.js'
import { MeoCordTestingModule } from './meocord-testing-module.js'
import { forgetStrictMocks, useStrictMocks } from './strict-mocks.js'

let warned: string[]
beforeEach(() => {
  forgetStrictMocks()
  forgetDeprecationWarnings()
  warned = []
  vi.spyOn(Logger.prototype, 'warn').mockImplementation((text: unknown) => void warned.push(String(text)))
})
afterEach(() => vi.restoreAllMocks())
afterAll(() => forgetStrictMocks())

describe.each([
  ['default', () => {}],
  ['strict', () => useStrictMocks()],
])('what discord.js always sets, in %s mode', (_mode, setUp) => {
  beforeEach(() => setUp())

  it("reads a slash command's options back as discord.js's toString() writes them", () => {
    const options = (opts: Parameters<typeof createChatInputOptions>[0]) =>
      createMockInteraction(ChatInputCommandInteraction, { commandName: 'settings', options: createChatInputOptions(opts) })

    expect(String(options({ subcommand: 'email', address: 'a@b.c' }))).toBe('/settings email address:a@b.c')
    expect(String(options({ subcommandGroup: 'notify', subcommand: 'email', on: true }))).toBe('/settings notify email on:true')
    expect(String(createMockInteraction(ChatInputCommandInteraction, { commandName: 'ping' }))).toBe('/ping')
  })

  it('gives an interaction without options an empty resolver', () => {
    const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName: 'ping' })

    expect([interaction.options.getString('name'), interaction.options.getSubcommand(false), interaction.options.data]).toEqual([null, null, []])
  })

  it("answers a mention check with discord.js's options", () => {
    const user = createMockUser()
    const message = createMockMessage({ content: `hi <@${user.id}>` })
    message.client.users.cache.set(user.id, user as never)

    expect(message.mentions.has(user, { ignoreRepliedUser: true })).toBe(message.mentions.users.has(user.id))
    expect(message.mentions.has(createMockUser(), { ignoreRepliedUser: true })).toBe(false)
    expect([message.mentions.parsedUsers, message.mentions.crosspostedChannels]).toEqual([expect.any(Collection), new Collection()])
  })

  it('makes empty collections and bitfields of what discord.js always sets, whose managers answer as they do', async () => {
    const message = createMockMessage()
    const reaction = createMockInteraction(MessageReaction)

    expect(message.reactions.cache.get('⭐')).toBeUndefined()
    expect(message.messageSnapshots.first()).toBeUndefined()
    expect(createMockMember().flags).toEqual(new GuildMemberFlagsBitField().freeze())
    expect(createMockMember().flags.has(1)).toBe(false)
    expect(createMockUser().flags).toEqual(new UserFlagsBitField())
    expect(createMockInteraction(ChatInputCommandInteraction).entitlements.some(() => true)).toBe(false)
    expect(reaction.users.cache.has('1')).toBe(false)
    await expect(reaction.users.fetch()).resolves.toEqual(new Collection())
    expect(vi.isMockFunction(message.reactions.removeAll)).toBe(true)
  })
})

describe.each([
  ['default', () => {}],
  ['strict', () => useStrictMocks()],
])("a manager's lookups through discord.js's own cache, in %s mode", (_mode, setUp) => {
  beforeEach(() => setUp())

  it("resolves a member's presence, and a thread's member, by id or to null", () => {
    const guild = createMockGuild()
    const member = createMockMember({ guild })
    const presence = { status: 'online' }
    guild.presences.cache.set(member.id, presence as never)
    const thread = createMockChannel(ThreadChannel)

    expect([guild.presences.resolve(member.id), guild.presences.resolve('1400000000000000999')]).toEqual([presence, null])
    expect(thread.members.resolve('1400000000000000999')).toBeNull()
  })
})

describe('what discord.js gives empty, under useStrictMocks()', () => {
  beforeEach(() => useStrictMocks())

  it('reads it as discord.js does, with no warning', () => {
    const guild = createMockGuild()
    const member = createMockMember({ guild })
    const channel = createMockChannel(TextChannel, { guild } as never)
    const edited = createMockMessage({ editedTimestamp: 1_700_000_000_000 })

    expect([createMockInteraction(MessageReaction).me, createMockMessage().mentions.repliedUser, createMockMessage().editedAt]).toEqual([false, null, null])
    expect(edited.editedAt).toEqual(new Date(1_700_000_000_000))
    expect([member.presence, guild.verified, guild.systemChannel, channel.parent]).toEqual([null, false, null, null])
    expect(createMockInteraction(ModalSubmitInteraction).message).toBeNull()
    expect(warned).toEqual([])
  })

  it('computes it from what the test gives', () => {
    const guild = createMockGuild()
    guild.features = [GuildFeature.Verified]
    const presence = { status: 'online' }
    const member = createMockMember({ guild })
    guild.presences.cache.set(member.id, presence as never)
    const category = createMockChannel(TextChannel, { guild } as never)
    guild.channels.cache.set(category.id, category as never)
    const channel = createMockChannel(TextChannel, { guild, parentId: category.id } as never)

    expect([guild.verified, member.presence, channel.parent]).toEqual([true, presence, category])
  })
})

describe('what discord.js gives empty, in default mode', () => {
  it.each([
    ['MessageReaction.me', () => createMockInteraction(MessageReaction).me, 'messageReaction.me = false'],
    ['MessageMentions.repliedUser', () => createMockMessage().mentions.repliedUser, 'messageMentions.repliedUser = null'],
    ['Message.editedAt', () => createMockMessage().editedAt, 'message.editedAt = null'],
    ['GuildMember.presence', () => createMockMember().presence, 'guildMember.presence = null'],
    ['Guild.verified', () => createMockGuild().verified, 'guild.verified = false'],
    ['Guild.systemChannel', () => createMockGuild().systemChannel, 'guild.systemChannel = null'],
    ['TextChannel.parent', () => createMockChannel(TextChannel).parent, 'textChannel.parent = null'],
    ['ModalSubmitInteraction.message', () => createMockInteraction(ModalSubmitInteraction).message, 'modalSubmitInteraction.message = null'],
    ['MessageReaction.message', () => createMockInteraction(MessageReaction).message, 'messageReaction.message = createMockMessage()'],
  ])('reads %s as before, and warns once that strict mocks read it as discord.js does', (name, read, example) => {
    expect(read()).toBeTruthy()
    read()

    expect(warned).toEqual([expect.stringMatching(new RegExp(`^${name.replace('.', '\\.')} reads a placeholder.*5\\.0.*${example.replace('.', '\\.')}.*useStrictMocks\\(\\)`, 's'))])
  })
})

it('warns on reading repliedUser after mentions.has() read it without a warning', () => {
  const message = createMockMessage()
  message.mentions.has(createMockUser())
  expect(warned).toEqual([])

  void message.mentions.repliedUser

  expect(warned).toEqual([expect.stringMatching(/^MessageMentions\.repliedUser reads a placeholder/)])
})

describe("a voice channel's full", () => {
  it.each([VoiceChannel, StageChannel])('warns in default mode as its neighbours do, and is computed under useStrictMocks()', Channel => {
    expect(createMockChannel(Channel as typeof VoiceChannel).full).toBeTruthy()
    expect(warned).toEqual([expect.stringMatching(new RegExp(`^${Channel.name}\\.full reads a placeholder`))])

    forgetStrictMocks()
    useStrictMocks()
    expect(createMockChannel(Channel as typeof VoiceChannel).full).toBe(false)
  })
})

describe("the dispatcher's reads of a reaction's partial", () => {
  const ran: string[] = []

  @Controller()
  class Stars {
    @ReactionHandler('⭐')
    star() {
      ran.push('star')
    }
  }

  beforeEach(() => void (ran.length = 0))

  it('neither warns nor fetches under useStrictMocks(), for a reaction alone or on a message', async () => {
    useStrictMocks()
    const module = MeoCordTestingModule.create({ controllers: [Stars] }).compile()

    for (const reaction of [createMockInteraction(MessageReaction, { emoji: { name: '⭐' } } as never), createMockInteraction(MessageReaction, { emoji: { name: '⭐' }, message: createMockMessage() } as never)]) {
      await module.dispatch(reaction, { user: createMockUser() })
      expect([reaction.fetch, reaction.message.fetch].map(fetch => vi.mocked(fetch).mock.calls.length)).toEqual([0, 0])
    }
    expect(ran).toEqual(['star', 'star'])
    expect(warned).toEqual([])
  })

  it('still fetches in default mode, with a warning that says MeoCord read it while dispatching', async () => {
    const module = MeoCordTestingModule.create({ controllers: [Stars] }).compile()
    const reaction = createMockInteraction(MessageReaction, { emoji: { name: '⭐' }, message: createMockMessage() } as never)

    await module.dispatch(reaction, { user: createMockUser() })

    expect(vi.mocked(reaction.fetch).mock.calls).toHaveLength(1)
    expect(warned).toEqual([
      expect.stringMatching(/^MessageReaction\.partial reads a placeholder.*dispatch.*fetch.*reaction\.partial = false.*reaction\.message\.partial = false.*useStrictMocks\(\)/s),
    ])
  })

  it('names the message once the reaction is set whole', async () => {
    const module = MeoCordTestingModule.create({ controllers: [Stars] }).compile()
    const reaction = createMockInteraction(MessageReaction, { emoji: { name: '⭐' }, message: createMockMessage(), partial: false } as never)

    await module.dispatch(reaction, { user: createMockUser() })

    expect(vi.mocked(reaction.message.fetch).mock.calls).toHaveLength(1)
    expect(warned).toEqual([expect.stringMatching(/^Message\.partial reads a placeholder.*dispatch.*reaction\.message\.partial = false/s)])
  })
})
