import 'reflect-metadata'
import { ChatInputCommandInteraction, InteractionContextType } from 'discord.js'
import { vi } from 'vitest'
import { Logger } from '@src/common/logger.js'
import { forgetDeprecationWarnings } from '@src/common/deprecation.js'
import { respond } from '@src/common/index.js'
import { Command, Controller } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { createMockGuild, createMockInteraction, MeoCordTestingModule } from './index.js'

let warned: string[]
beforeEach(() => {
  forgetDeprecationWarnings()
  warned = []
  vi.spyOn(Logger.prototype, 'warn').mockImplementation((text: unknown) => void warned.push(String(text)))
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
})
afterEach(() => vi.restoreAllMocks())

const PLACE = /^ChatInputCommandInteraction\.guildId reads a DM's value, though the mock was given a guild here/

@Controller()
class Ping {
  @Command('ping', CommandType.SLASH)
  async ping(interaction: ChatInputCommandInteraction) {
    await respond(interaction).send('pong')
  }

  @Command('fail', CommandType.SLASH)
  fail() {
    throw new Error('down')
  }
}

const inGuild = (commandName: string) => createMockInteraction(ChatInputCommandInteraction, { commandName, guild: createMockGuild() })

// MeoCord reads where an interaction is to answer it; in default mode only a test's own read of it warns
describe('a default-mode mock given a guild but no guildId', () => {
  it.each(['ping', 'fail'])('is answered with no place warning, by its handler or the error reply, for %s', async commandName => {
    const module = MeoCordTestingModule.create({ controllers: [Ping] }).compile()

    await module.dispatch(inGuild(commandName)).catch(() => undefined)

    expect(warned.filter(text => PLACE.test(text))).toEqual([])
  })

  it("still warns when the test reads its guildId", () => {
    void inGuild('ping').guildId

    expect(warned).toEqual([expect.stringMatching(PLACE)])
  })

  it("keeps a response's own keys, location where it was, so a spread or toEqual of one reads as before", () => {
    // The keys a response had before location was read on demand, in their order
    const keys = ['interaction', 'location', 'phase', 'acknowledging', 'queue', 'pending', 'modalShown', 'v2', 'lastMessage', 'answer', 'calls']
    const more = ['snapshot', 'held', 'lockEntry', 'loadingView', 'privateDeferral', 'settled', 'suppressNotifications', 'underDefer', 'timer', 'pendingLock']

    expect(Object.keys(respond(inGuild('ping')))).toEqual([...keys, ...more])
  })

  it("still reports where the response is, read on demand, with Discord's context", async () => {
    const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName: 'ping', context: InteractionContextType.Guild })

    expect(respond(interaction).location).toEqual({ where: 'guild', botInstalled: true })
  })
})
