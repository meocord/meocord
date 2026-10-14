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
const FETCH_WARNING = /^GuildMessageManager\.fetch\(\) here resolves to no messages, though messages were made, sent or cached in its channel.*under useStrictMocks\(\) fetch\(\) lists them\.$/s
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

describe("a mock channel's messages.fetch() with no id", () => {
  // Three messages, oldest first, as a channel holds them once made and sent there
  const threeIn = async () => {
    const channel = text()
    const first = createMockMessage({ content: 'one', channel })
    const second = await channel.send('two')
    const third = await channel.send('three')
    return { channel, ids: [first.id, second.id, third.id] }
  }
  const idsOf = (fetched: { keys(): Iterable<string> }) => [...fetched.keys()]

  it('lists the messages made or sent there, newest first, under useStrictMocks(), as discord.js lists recent ones', async () => {
    useStrictMocks()
    const { channel, ids } = await threeIn()

    expect(idsOf(await channel.messages.fetch())).toEqual([...ids].reverse())
    expect(warned).toEqual([])
  })

  it('honours limit, before, after and around under useStrictMocks()', async () => {
    useStrictMocks()
    const { channel, ids } = await threeIn()
    const [first, second, third] = ids

    expect(idsOf(await channel.messages.fetch({ limit: 2 }))).toEqual([third, second])
    expect(idsOf(await channel.messages.fetch({ before: third }))).toEqual([second, first])
    expect(idsOf(await channel.messages.fetch({ after: first }))).toEqual([third, second])
    expect(idsOf(await channel.messages.fetch({ around: second, limit: 3 }))).toEqual([third, second, first])
    expect(idsOf(await channel.messages.fetch({ before: '1' }))).toEqual([])
  })

  it('resolves to an empty collection in default mode, as before, a message the test cached included', async () => {
    const { channel } = await threeIn()
    const cached = createMockMessage({ content: 'cached', channel })
    channel.messages.cache.set(cached.id, cached as never)

    expect((await channel.messages.fetch()).size).toBe(0)
  })

  it('warns once per channel in default mode where messages were made or sent in it', async () => {
    const { channel } = await threeIn()
    const other = (await threeIn()).channel
    await channel.messages.fetch()
    await channel.messages.fetch({ limit: 2 })
    await other.messages.fetch()

    expect(warned.filter(text => FETCH_WARNING.test(text))).toHaveLength(2)
  })

  it('warns in default mode for a channel that holds only a message the test cached, which strict mocks list', async () => {
    const channel = text()
    const elsewhere = createMockMessage({ content: 'elsewhere' })
    channel.messages.cache.set(elsewhere.id, elsewhere as never)

    expect((await channel.messages.fetch()).size).toBe(0)
    expect(warned.filter(text => FETCH_WARNING.test(text))).toHaveLength(1)
  })

  it('stays quiet in default mode for a channel nothing was made or sent in, and for a fetch by id', async () => {
    const empty = text()
    await empty.messages.fetch()
    const { channel, ids } = await threeIn()
    await channel.messages.fetch(ids[0])

    expect(warned.filter(text => FETCH_WARNING.test(text))).toEqual([])
  })
})
