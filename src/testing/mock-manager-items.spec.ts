import 'reflect-metadata'
import { ChannelType, Role, TextChannel, ThreadChannel, VoiceChannel } from 'discord.js'
import { vi } from 'vitest'
import { Logger } from '@src/common/logger.js'
import { forgetDeprecationWarnings } from '@src/common/deprecation.js'
import { forgetStrictMocks, useStrictMocks } from './strict-mocks.js'
import { createMockChannel, createMockGuild, createMockInteraction, createMockMember } from './index.js'

let warned: string[]
beforeEach(() => {
  forgetStrictMocks()
  forgetDeprecationWarnings()
  warned = []
  vi.spyOn(Logger.prototype, 'warn').mockImplementation((text: unknown) => void warned.push(String(text)))
})
afterEach(() => vi.restoreAllMocks())
afterAll(() => forgetStrictMocks())

const MODES = [
  ['in default mode', () => undefined],
  ['under useStrictMocks()', () => useStrictMocks()],
] as const

const W_TEXT_ONLY = /^GuildChannelManager\.create\(\) here makes a text channel whatever type its options name; under useStrictMocks\(\)/
const W_NEW_ITEM = /^RoleManager\.edit\(\) here resolves to a new item with an id of its own, not the item named; under useStrictMocks\(\)/
const MUTED_ID = '500000000000000001'
const OTHER_ID = '500000000000000002'

describe("a mock guild's managers", () => {
  it('create a channel of the type its options name under useStrictMocks(), and cache it', async () => {
    useStrictMocks()
    const guild = createMockGuild()
    const voice = await guild.channels.create({ type: ChannelType.GuildVoice, name: 'Voice' })

    expect(voice).toBeInstanceOf(VoiceChannel)
    expect([voice.type, voice.isVoiceBased()]).toEqual([ChannelType.GuildVoice, true])
    expect(guild.channels.cache.get(voice.id)).toBe(voice)
    expect(await guild.channels.create({ name: 'general' })).toBeInstanceOf(TextChannel)
  })

  it('create a text channel in default mode, as before, with a warning for another type', async () => {
    const guild = createMockGuild()
    const typeWarnings = () => warned.filter(text => W_TEXT_ONLY.test(text))
    const general = await guild.channels.create({ name: 'general' })
    expect(typeWarnings()).toEqual([])
    const voice = await guild.channels.create({ type: ChannelType.GuildVoice, name: 'Voice' })

    expect([general, voice].map(channel => channel instanceof TextChannel)).toEqual([true, true])
    expect(guild.channels.cache.get(voice.id)).toBe(voice)
    expect(typeWarnings()).toHaveLength(1)
  })

  it('edit the item with the id given under useStrictMocks(), the one the cache holds', async () => {
    useStrictMocks()
    const muted = createMockInteraction(Role, { id: MUTED_ID, name: 'Muted' })
    const guild = createMockGuild({ roles: [muted] })
    const member = createMockMember({ guild })

    expect(await guild.roles.edit(muted.id, { color: 0xff0000 })).toBe(muted)
    expect(await guild.roles.edit(muted, {})).toBe(muted)
    expect((await guild.members.edit(member.id, {})).id).toBe(member.id)
    const other = await guild.roles.edit(OTHER_ID, {})
    expect([other.id, guild.roles.cache.get(OTHER_ID)]).toEqual([OTHER_ID, other])
    expect(warned).toEqual([])
  })

  it('edit a new item in default mode, as before, with a warning', async () => {
    const muted = createMockInteraction(Role, { id: MUTED_ID, name: 'Muted' })
    const guild = createMockGuild({ roles: [muted] })
    const edited = await guild.roles.edit(muted.id, { color: 0xff0000 })

    expect([edited === muted, edited.id === MUTED_ID, guild.roles.cache.get(MUTED_ID)]).toEqual([false, false, muted])
    expect(warned).toEqual([expect.stringMatching(W_NEW_ITEM)])
  })
})

describe('a name given to create() or edit()', () => {
  it('names the item under useStrictMocks(), as discord.js does', async () => {
    useStrictMocks()
    const muted = createMockInteraction(Role, { id: MUTED_ID, name: 'Muted' })
    const guild = createMockGuild({ roles: [muted] })

    expect((await guild.channels.create({ type: ChannelType.GuildVoice, name: 'Voice' })).name).toBe('Voice')
    expect((await guild.roles.create({ name: 'Helper' })).name).toBe('Helper')
    await guild.roles.edit(muted.id, { name: 'Silenced' })
    expect(guild.roles.cache.get(muted.id)?.name).toBe('Silenced')
    expect(warned).toEqual([])
  })

  it('keeps the name the mock gave in default mode, with a warning once', async () => {
    const guild = createMockGuild()
    const role = await guild.roles.create({ name: 'Helper' })
    await guild.roles.create({ name: 'Mod' })

    expect(role.name).not.toBe('Helper')
    expect(warned).toEqual([expect.stringMatching(/^RoleManager\.create\(\) here leaves the item with the mock's name, not the name its options give.*useStrictMocks\(\)/s)])
  })
})

describe.each(MODES)("a thread made by a mock channel's thread manager, %s", (_, mode) => {
  beforeEach(() => mode())

  it.each([
    ['created', (channel: TextChannel) => channel.threads.create({ name: 'Bug 42' })],
    ['fetched', (channel: TextChannel) => channel.threads.fetch('600000000000000001')],
  ] as const)('is in that channel and its server when %s', async (_how, make) => {
    const guild = createMockGuild()
    const channel = createMockChannel(TextChannel, { guild })
    const thread = (await make(channel as unknown as TextChannel))!

    expect([thread.parentId, thread.parent, thread.guild, thread.guildId]).toEqual([channel.id, channel, guild, guild.id])
    expect(thread.parent).toBe(channel)
    expect(thread.guild).toBe(guild)
  })
})

describe("the server's channel cache, when a mock channel's thread manager makes a thread", () => {
  it.each([
    ['in default mode', () => undefined, 0],
    ['under useStrictMocks()', () => useStrictMocks(), 1],
  ] as const)('holds the parent under strict mocks, as discord.js finds it there, and is left as it was in default mode, %s', async (_, mode, size) => {
    mode()
    const guild = createMockGuild()
    const channel = createMockChannel(TextChannel, { guild })
    const thread = await (channel as unknown as TextChannel).threads.create({ name: 'Bug 42' })

    expect(guild.channels.cache.size).toBe(size)
    expect(thread.parent).toBe(channel)
  })
})

describe("a thread a mock channel's thread manager creates, in default mode", () => {
  it('has the own keys of one made alone, so a test comparing a whole thread sees them as before', async () => {
    const channel = createMockChannel(TextChannel, { guild: createMockGuild() })
    const thread = await channel.threads.create({ name: 'Bug 42' })

    expect(Object.keys(thread)).toEqual(Object.keys(createMockChannel(ThreadChannel, { id: thread.id })))
  })
})
