import 'reflect-metadata'
import { ChatInputCommandInteraction, TextChannel } from 'discord.js'
import { vi } from 'vitest'
import { Logger } from '@src/common/logger.js'
import { forgetDeprecationWarnings } from '@src/common/deprecation.js'
import { Command, Controller } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { forgetStrictMocks, useStrictMocks } from './strict-mocks.js'
import { createMockChannel, createMockGuild, createMockInteraction, createMockMessage, MeoCordTestingModule } from './index.js'

let warned: string[]
beforeEach(() => {
  forgetStrictMocks()
  forgetDeprecationWarnings()
  warned = []
  vi.spyOn(Logger.prototype, 'warn').mockImplementation((text: unknown) => void warned.push(String(text)))
})
afterEach(() => vi.restoreAllMocks())
afterAll(() => forgetStrictMocks())

const text = () => createMockChannel(TextChannel, { guild: createMockGuild() })
const CACHE_WARNING = /^GuildMessageManager\.cache here lacks messages made in its channel.*5\.0.*useStrictMocks\(\)/s

describe.each([
  ['in default mode', () => undefined],
  ['under useStrictMocks()', () => useStrictMocks()],
])('a message made in a mock channel, %s', (_, mode) => {
  beforeEach(() => mode())

  it('is the message its channel fetches by its id', async () => {
    const channel = text()
    const message = createMockMessage({ content: 'hello', channel })
    const fetched = await channel.messages.fetch(message.id)

    expect(fetched).toBe(message)
    expect(fetched.content).toBe('hello')
  })
})

describe('the messages a mock channel caches', () => {
  it('are each message made or sent there, under useStrictMocks(), as discord.js caches them', async () => {
    useStrictMocks()
    const channel = text()
    const message = createMockMessage({ content: 'hello', channel })
    const sent = await channel.send('hi')
    const reply = await message.reply('back')

    expect([channel.messages.cache.get(message.id), channel.messages.cache.get(sent.id), channel.messages.cache.get(reply.id)]).toEqual([message, sent, reply])
    expect(warned).toEqual([])
  })

  it('are none of them in default mode, with one warning on the first read that lacks one', async () => {
    const channel = text()
    const message = createMockMessage({ content: 'hello', channel })
    await channel.send('hi')

    expect([channel.messages.cache.size, channel.messages.cache.has(message.id)]).toEqual([0, false])
    expect(warned).toEqual([expect.stringMatching(CACHE_WARNING)])
  })

  it("stay quiet in default mode for the mock's own reads and a dispatch that fetches through the channel", async () => {
    const channel = text()
    const earlier = createMockMessage({ content: 'earlier', channel })
    @Controller()
    class Quote {
      @Command('quote', CommandType.SLASH)
      async quote(interaction: ChatInputCommandInteraction) {
        const found = await interaction.channel!.messages.fetch(earlier.id)
        await interaction.reply(found.content)
      }
    }
    const module = MeoCordTestingModule.create({ controllers: [Quote] }).compile()
    const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName: 'quote', channel, guild: channel.guild, guildId: channel.guildId })

    await module.dispatch(interaction)

    expect(interaction.reply).toHaveBeenCalledWith('earlier')
    expect(warned.filter(line => CACHE_WARNING.test(line))).toEqual([])
  })
})
