import 'reflect-metadata'
import {
  Attachment,
  AutocompleteInteraction,
  ButtonInteraction,
  ChatInputCommandInteraction,
  GuildMember,
  MessageContextMenuCommandInteraction,
  Role,
  SnowflakeUtil,
  TextChannel,
  ThreadChannel,
  User,
} from 'discord.js'
import { vi } from 'vitest'
import { Logger } from '@src/common/logger.js'
import { forgetDeprecationWarnings } from '@src/common/deprecation.js'
import { createMockChannel, createMockClient, createMockGuild, createMockInteraction, createMockMessage } from './mock-interaction.js'
import { createModalFields } from './modal-fields.js'
import { forgetStrictMocks, useStrictMocks } from './strict-mocks.js'

const NOW = Date.parse('2027-03-04T05:06:07.000Z')
const snowflake = /^\d{17,20}$/

let warned: string[]
beforeEach(() => {
  forgetStrictMocks()
  forgetDeprecationWarnings()
  warned = []
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
  vi.spyOn(Logger.prototype, 'warn').mockImplementation((text: unknown) => void warned.push(String(text)))
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})
afterAll(() => forgetStrictMocks())

const modes = [
  ['default mode', () => {}],
  ['useStrictMocks()', () => useStrictMocks()],
] as const

/** How many ids from the count every mock takes one from `run` takes. */
async function idsTakenBy(run: () => unknown): Promise<bigint> {
  const before = BigInt(createMockInteraction(User).id)
  await run()
  return BigInt(createMockInteraction(User).id) - before - 1n
}

describe("a message context menu's target", () => {
  it('is the targetMessage given, by its id', () => {
    const targetMessage = createMockMessage()
    const menu = createMockInteraction(MessageContextMenuCommandInteraction, { commandName: 'Report', targetMessage })

    expect([menu.targetId, menu.targetMessage]).toEqual([targetMessage.id, targetMessage])
  })

  it('moves with the targetMessage set after creation, and re-makes the message for a targetId set after creation', () => {
    const menu = createMockInteraction(MessageContextMenuCommandInteraction, { commandName: 'Report' })
    const other = createMockMessage()
    menu.targetMessage = other as never
    expect([menu.targetId, menu.targetMessage]).toEqual([other.id, other])

    menu.targetId = '1400000000000009999'
    expect([menu.targetId, menu.targetMessage.id]).toEqual(['1400000000000009999', '1400000000000009999'])
  })

  it('follows a targetMessage set after a targetId was set', () => {
    const menu = createMockInteraction(MessageContextMenuCommandInteraction, { commandName: 'Report' })
    menu.targetId = '1400000000000009999'
    const other = createMockMessage()
    menu.targetMessage = other as never

    expect([menu.targetId, menu.targetMessage]).toEqual([other.id, other])
  })

  it("reads a client set on a manager, over its server's", () => {
    const guild = createMockGuild()
    const other = createMockClient()
    ;(guild.members as { client: unknown }).client = other

    expect(guild.members.client).toBe(other)
  })

  it('gives a targetMessage with no id one, which targetId reads', () => {
    const targetMessage = { content: 'x' }
    const menu = createMockInteraction(MessageContextMenuCommandInteraction, { commandName: 'Report', targetMessage } as never)

    expect(menu.targetId).toMatch(snowflake)
    expect(menu.targetMessage.id).toBe(menu.targetId)
  })

  it("refuses a targetId other than its targetMessage's under useStrictMocks(), naming both, and keeps the message's with a warning otherwise", () => {
    const targetMessage = createMockMessage()
    const make = () => createMockInteraction(MessageContextMenuCommandInteraction, { commandName: 'Report', targetMessage, targetId: '1400000000000009999' })

    expect(make().targetId).toBe(targetMessage.id)
    expect(warned).toEqual([expect.stringMatching(new RegExp(`message ${targetMessage.id}.*1400000000000009999.*useStrictMocks\\(\\)`, 's'))])

    forgetStrictMocks()
    useStrictMocks()
    expect(make).toThrow(new RegExp(`message ${targetMessage.id}.*1400000000000009999`))
  })

  it('is a message made for a generated targetId when none is given', () => {
    const menu = createMockInteraction(MessageContextMenuCommandInteraction, { commandName: 'Report' })

    expect(menu.targetId).toMatch(snowflake)
    expect(menu.targetMessage.id).toBe(menu.targetId)
  })

  it.each(modes)("is made in the menu's channel and server, which a component on it agrees with, with no warning, in %s", (_mode, setUp) => {
    setUp()
    const guild = createMockGuild()
    const channel = createMockChannel(TextChannel, { guild })
    const { targetMessage } = createMockInteraction(MessageContextMenuCommandInteraction, { commandName: 'Report', guild, channel })

    expect(targetMessage.channel).toBe(channel)
    expect(targetMessage.guild).toBe(guild)
    expect([targetMessage.channelId, targetMessage.guildId]).toEqual([channel.id, guild.id])
    const button = createMockInteraction(ButtonInteraction, { customId: 'b', message: targetMessage, guild, channel })
    expect(button.message).toBe(targetMessage)
    expect(targetMessage.channel).toBe(channel)
    expect(warned).toEqual([])
  })

  it.each(modes)("makes and caches no channel when read, and reads the menu's channel the test caches later, in %s", (_mode, setUp) => {
    setUp()
    const guild = createMockGuild()
    const menu = createMockInteraction(MessageContextMenuCommandInteraction, { commandName: 'Report', guild, guildId: guild.id })
    const { targetMessage } = menu

    expect([guild.channels.cache.size, menu.client.channels.cache.size]).toEqual([0, 0])
    const channel = createMockChannel(TextChannel, { id: menu.channelId, guild })
    guild.channels.cache.set(channel.id, channel)
    expect([targetMessage.channelId, targetMessage.guildId]).toEqual([menu.channelId, guild.id])
    expect(targetMessage.channel).toBe(channel)
    expect(menu.channel).toBe(channel)
  })

  it("warns once on a read of its place where strict mocks place the menu elsewhere, and is in the menu's guild under useStrictMocks()", () => {
    const guild = createMockGuild()
    const make = () => createMockInteraction(MessageContextMenuCommandInteraction, { commandName: 'Report', guild }).targetMessage

    const target = make()
    expect([target.guild, target.guild, target.guildId]).toEqual([null, null, null])
    expect(warned).toEqual([
      expect.stringMatching(/^MessageContextMenuCommandInteraction\.targetMessage\.guild reads a DM's value.*useStrictMocks\(\)/s),
      expect.stringMatching(/^MessageContextMenuCommandInteraction\.targetMessage\.guildId reads a DM's value/),
    ])

    warned = []
    forgetStrictMocks()
    useStrictMocks()
    expect(make().guild).toBe(guild)
    expect(warned).toEqual([])
  })

  it.each(modes)("is made in the user's DM channel for a menu used in a DM, in %s", (_mode, setUp) => {
    setUp()
    const menu = createMockInteraction(MessageContextMenuCommandInteraction, { commandName: 'Report' })

    expect(menu.targetMessage.channel).toBe(menu.channel)
    expect(menu.targetMessage.guildId).toBeNull()
  })
})

describe('generated ids', () => {
  it.each([
    ['default mode', () => {}, () => createMockChannel(TextChannel).guildId],
    ['useStrictMocks()', () => useStrictMocks(), () => createMockChannel(ThreadChannel).ownerId],
  ])('come from the count every mock takes one from, so a run gives the same ids each time, in %s', (_mode, setUp, inPlace) => {
    setUp()
    // Each id a default gives, as an offset from where the count stood when the run began
    const run = () => {
      const start = BigInt(createMockInteraction(User).id)
      const command = createMockInteraction(ChatInputCommandInteraction, { commandName: 'x' })
      const ids = [
        createMockGuild().ownerId,
        createMockInteraction(Role, {}).id,
        command.commandId,
        command.applicationId,
        createMockInteraction(AutocompleteInteraction, { commandName: 'x' }).commandId,
        inPlace(),
      ]
      return ids.map(id => BigInt(id!) - start)
    }

    const first = run()
    expect(first.every(offset => offset > 0n && offset < 50n)).toBe(true)
    expect(run()).toEqual(first)
  })

  it.each(modes)('are taken once for a value, on its first read, so reading it again takes none, in %s', async (_mode, setUp) => {
    setUp()
    const menu = createMockInteraction(MessageContextMenuCommandInteraction, { commandName: 'Report' })
    const member = createMockInteraction(GuildMember)
    const role = createMockInteraction(Role, {})
    for (const value of [() => menu.targetMessage, () => member.user, () => role.guild]) {
      const first = value()
      expect(await idsTakenBy(() => expect(value()).toBe(first))).toBe(0n)
    }

    const command = createMockInteraction(ChatInputCommandInteraction, { commandName: 'x' })
    await command.reply('hi')
    const fetched = await command.fetchReply()
    let again = fetched
    expect(await idsTakenBy(async () => (again = await command.fetchReply()))).toBe(0n)
    expect(again.id).toBe(fetched.id)
    for (const key of ['author', 'channel', 'guild'] as const) expect(again[key]).toBe(fetched[key])
  })
})

describe('a user or attachment made with createMockInteraction', () => {
  it('has a snowflake id no other mock has, so it mentions and keys apart', () => {
    const [a, b] = [createMockInteraction(User), createMockInteraction(User)]
    const [first, second] = [createMockInteraction(Attachment), createMockInteraction(Attachment)]

    expect([a.id, b.id, first.id, second.id]).toEqual([expect.stringMatching(snowflake), expect.stringMatching(snowflake), expect.stringMatching(snowflake), expect.stringMatching(snowflake)])
    expect(new Set([a.id, b.id, first.id, second.id]).size).toBe(4)
    expect(String(a)).toBe(`<@${a.id}>`)
  })

  it('takes its id from the count every mock takes one from, in the order they are made', () => {
    const ids = [
      createMockInteraction(User).id,
      createMockInteraction(MessageContextMenuCommandInteraction, { commandName: 'Report' }).targetId,
      createMockInteraction(Attachment).id,
    ].map(BigInt)

    expect([ids[1] > ids[0], ids[2] > ids[1], ids[2] - ids[0] < 50n]).toEqual([true, true, true])
  })

  it('keys a modal upload by the attachment id', () => {
    const file = createMockInteraction(Attachment)

    expect([...createModalFields({ files: [file] }).getUploadedFiles('files')!.keys()]).toEqual([file.id])
  })

  it('was created when the mock was made under useStrictMocks(), and at its id with a warning otherwise', () => {
    const user = createMockInteraction(User)
    expect(user.createdTimestamp).toBe(SnowflakeUtil.timestampFrom(user.id))
    expect(warned).toEqual([expect.stringMatching(/^User\.createdTimestamp reads the time of its generated id/)])

    forgetStrictMocks()
    useStrictMocks()
    expect(createMockInteraction(User).createdTimestamp).toBe(NOW)
  })
})
