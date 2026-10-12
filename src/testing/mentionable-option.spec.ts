import 'reflect-metadata'
import { ChatInputCommandInteraction, GuildMember, Role } from 'discord.js'
import { vi } from 'vitest'
import { Logger } from '@src/common/logger.js'
import { forgetDeprecationWarnings } from '@src/common/deprecation.js'
import { createChatInputOptions, createMockGuild, createMockInteraction, createMockUser } from './index.js'
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

/** A command with a mentionable option `who` holding `who`, in a server unless `dm`. */
const command = (who: object, dm = false) => {
  const guild = createMockGuild()
  return createMockInteraction(ChatInputCommandInteraction, {
    commandName: 'warn',
    ...(!dm && { guildId: guild.id, guild }),
    options: createChatInputOptions({ who: who as never }),
  })
}

describe("a mentionable option holding a user, read with getMentionable()", () => {
  it("is the user's member in a server under useStrictMocks(), as discord.js reads it", () => {
    useStrictMocks()
    const user = createMockUser()
    const interaction = command(user)
    const member = interaction.options.getMentionable('who')

    expect(member).toBeInstanceOf(GuildMember)
    expect(member).toBe(interaction.options.getMember('who'))
    expect(warned).toEqual([])
  })

  it('is the user in a direct message, where Discord sends no member', () => {
    useStrictMocks()
    const user = createMockUser()
    expect(command(user, true).options.getMentionable('who')).toBe(user)
  })

  it('is the user in default mode, with one warning that discord.js gives the member', () => {
    const user = createMockUser()
    const interaction = command(user)

    expect([interaction.options.getMentionable('who'), interaction.options.getMentionable('who')]).toEqual([user, user])
    expect(warned).toEqual([expect.stringMatching(/^getMentionable\('who'\) returns the user here, where discord\.js returns the user's member/)])
  })

  it.each([
    ['in default mode', () => undefined],
    ['under useStrictMocks()', () => useStrictMocks()],
  ])('reads a role as given, %s', (_, mode) => {
    mode()
    const role = createMockInteraction(Role, {})
    expect(command(role).options.getMentionable('who')).toBe(role)
    expect(warned).toEqual([])
  })
})
