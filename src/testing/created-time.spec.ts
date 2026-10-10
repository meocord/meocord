import 'reflect-metadata'
import { ButtonInteraction, Role, SnowflakeUtil, TextChannel, ThreadChannel } from 'discord.js'
import { vi } from 'vitest'
import { Logger } from '@src/common/logger.js'
import { forgetDeprecationWarnings } from '@src/common/deprecation.js'
import { createMockChannel, createMockGuild, createMockInteraction, createMockMessage, createMockUser } from './mock-interaction.js'
import { forgetStrictMocks, useStrictMocks } from './strict-mocks.js'

const NOW = Date.parse('2027-03-04T05:06:07.000Z')
// A snowflake made in 2021
const GIVEN = '900000000000000000'

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

/** Mocks made with a generated id, by name. */
const generated = () =>
  ({
    user: createMockUser(),
    guild: createMockGuild(),
    channel: createMockChannel(TextChannel),
    thread: createMockChannel(ThreadChannel),
    'interaction user': createMockInteraction(ButtonInteraction).user,
    "message's guild": createMockMessage().guild!,
    role: createMockInteraction(Role, {}),
  }) as Record<string, { id: string; createdTimestamp: number | null; createdAt: Date | null }>

describe('a generated mock, under useStrictMocks()', () => {
  beforeEach(() => useStrictMocks())

  it('was created when the mock was made, while its id keeps its own time', () => {
    for (const [name, mock] of Object.entries(generated())) {
      expect([name, mock.createdTimestamp, mock.createdAt?.getTime()]).toEqual([name, NOW, NOW])
      expect([name, SnowflakeUtil.timestampFrom(mock.id) === NOW]).toEqual([name, false])
    }
    expect(warned).toEqual([])
  })
})

describe.each([
  ['default', () => {}],
  ['strict', () => useStrictMocks()],
])('a mock given an id, in %s mode', (_mode, setUp) => {
  beforeEach(() => setUp())

  it("was created at its id's time, a thread included", () => {
    const time = SnowflakeUtil.timestampFrom(GIVEN)
    const mocks = [createMockUser({ id: GIVEN }), createMockGuild({ id: GIVEN }), createMockChannel(TextChannel, { id: GIVEN }), createMockChannel(ThreadChannel, { id: GIVEN })]

    expect(mocks.map(mock => [mock.createdTimestamp, mock.createdAt?.getTime()])).toEqual(mocks.map(() => [time, time]))
    expect(warned).toEqual([])
  })
})

describe('a generated mock, in default mode', () => {
  it("was created at its generated id's time, a valid date for a thread too, with one warning per kind", () => {
    for (const [name, mock] of Object.entries(generated())) {
      expect([name, mock.createdTimestamp]).toEqual([name, SnowflakeUtil.timestampFrom(mock.id)])
      expect([name, Number.isNaN(mock.createdAt?.getTime())]).toEqual([name, false])
    }
    void createMockUser().createdAt

    expect(warned).toEqual(
      ['User', 'Guild', 'TextChannel', 'ThreadChannel', 'Role'].map(name =>
        expect.stringMatching(new RegExp(`^${name}\\.createdTimestamp reads .*generated id.*2025.*5\\.0.*time the mock was made.*useStrictMocks\\(\\)`, 's')),
      ),
    )
  })
})
