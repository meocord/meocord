import 'reflect-metadata'
import { DMChannel, GuildMember, TextChannel, ThreadChannel, VoiceChannel } from 'discord.js'
import { Logger } from '@src/common/logger.js'
import { forgetDeprecationWarnings } from '@src/common/deprecation.js'
import { createMockChannel, createMockInteraction, createMockMessage } from './mock-interaction.js'

let warned: string[]
beforeEach(() => {
  forgetDeprecationWarnings()
  warned = []
  vi.spyOn(Logger.prototype, 'warn').mockImplementation((text: unknown) => void warned.push(String(text)))
})

describe('a boolean discord.js computes, which a mock reads as a placeholder', () => {
  it('warns once, saying 5.0 computes it and how to set it, and still reads as before', () => {
    const message = createMockMessage()

    expect(message.editable).toBeTruthy()
    void createMockMessage().editable
    void createMockInteraction(GuildMember).kickable

    expect(warned).toEqual([
      expect.stringMatching(/^Message\.editable reads a placeholder.*5\.0.*message\.editable = false/s),
      expect.stringMatching(/^GuildMember\.kickable reads a placeholder.*5\.0/s),
    ])
  })

  it("warns for a subclass's own getter of one, such as a voice channel's joinable", () => {
    void createMockChannel(VoiceChannel).joinable

    expect(warned).toEqual([expect.stringMatching(/^VoiceChannel\.joinable reads a placeholder.*useStrictMocks\(\)/s)])
  })

  it("names the variable to set in camel case, a class's leading acronym included", () => {
    void createMockChannel(DMChannel).partial

    expect(warned).toEqual([expect.stringContaining('such as dmChannel.partial = false')])
  })

  it('says nothing for one the test set', () => {
    const message = createMockMessage()
    message.editable = false

    expect(message.editable).toBe(false)
    expect(warned).toEqual([])
  })
})

describe("a mock message's thread", () => {
  it('is the thread its channel caches under its id', () => {
    const channel = createMockChannel(TextChannel)
    const message = createMockMessage({ channel })
    const thread = createMockChannel(ThreadChannel)
    // A text channel caches only non-forum threads, which discord.js types apart from a forum post
    channel.threads.cache.set(message.id, thread as never)

    expect(message.thread).toBe(thread)
    expect(warned).toEqual([])
  })

  it('is the placeholder thread otherwise, with a warning once that 5.0 gives null', () => {
    const message = createMockMessage()

    expect(message.thread).toBeInstanceOf(ThreadChannel)
    expect(message.thread).toBe(message.thread)
    expect(warned).toEqual([expect.stringMatching(/^Message\.thread reads a placeholder.*5\.0.*null.*threads\.cache\.set/s)])
  })
})
