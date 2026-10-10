import 'reflect-metadata'
import { Attachment, MessageContextMenuCommandInteraction, SnowflakeUtil, User } from 'discord.js'
import { vi } from 'vitest'
import { Logger } from '@src/common/logger.js'
import { forgetDeprecationWarnings } from '@src/common/deprecation.js'
import { createMockClient, createMockGuild, createMockInteraction, createMockMessage } from './mock-interaction.js'
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
