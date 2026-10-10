import 'reflect-metadata'
import { Attachment, MessageContextMenuCommandInteraction, SnowflakeUtil, User } from 'discord.js'
import { vi } from 'vitest'
import { Logger } from '@src/common/logger.js'
import { forgetDeprecationWarnings } from '@src/common/deprecation.js'
import { createMockInteraction, createMockMessage } from './mock-interaction.js'
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
