import 'reflect-metadata'
import { ChannelType, ChatInputCommandInteraction } from 'discord.js'
import { vi } from 'vitest'
import { Logger } from '@src/common/logger.js'
import { forgetDeprecationWarnings } from '@src/common/deprecation.js'
import { forgetStrictMocks, useStrictMocks } from './strict-mocks.js'
import { Cooldown, Controller, MeoCord, MessageHandler } from '@src/decorator/index.js'
import { createMockClient, createMockGuild, createMockInteraction, createMockMessage, createMockUser, MeoCordTestingModule } from './index.js'

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
const FIRST = '200000000000000001'
const SECOND = '200000000000000002'
const W_SHARED = /^UserManager\.createDM\(\) here gives every user the same DM channel; under useStrictMocks\(\)/
const W_EMPTY_SEND = /^UserManager\.send\(\) here resolves to a message that doesn't hold what was sent; under useStrictMocks\(\)/
const W_OWN_CLIENT = /^A mock user's DM channel here has a client of its own, not the user's; under useStrictMocks\(\)/
const expectWarned = (warnings: readonly RegExp[]) => expect(warned).toEqual(warnings.map(text => expect.stringMatching(text)))

describe("a mock user's DM channel", () => {
  it.each(MODES)("is the user's own: createDM() and dmChannel agree, and its recipient is the user, %s", async (_, mode) => {
    mode()
    const user = createMockUser()
    const channel = await user.createDM()

    expect(await user.createDM()).toBe(channel)
    expect(user.dmChannel).toBe(channel)
    expect(channel.recipient).toBe(user)
    expect(channel.recipientId).toBe(user.id)
  })

  it.each([
    ['in default mode', () => undefined, false, [W_OWN_CLIENT]],
    ['under useStrictMocks()', () => useStrictMocks(), true, []],
  ] as const)("shares the user's client under strict mocks, %s", async (_, mode, shared, warnings) => {
    mode()
    const user = createMockUser()
    const channel = await user.createDM()

    expect(channel.client === user.client).toBe(shared)
    expectWarned(warnings)
  })
})

describe("a mock user's DM channel's own keys", () => {
  it.each(MODES)('are those of one made before the user was its recipient, so a test comparing a whole channel sees them as before, %s', async (_, mode) => {
    mode()
    const user = createMockUser()
    const channel = await user.createDM()

    expect(Object.keys(channel)).toEqual(['id', 'messages', 'recipientId'])
    expect(Object.keys(user)).not.toContain('dmChannel')
  })
})

describe("a mock DM interaction's channel", () => {
  it("is the user's DM channel, with no warning until the test reads its client", async () => {
    const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName: 'ping' })
    const dm = await interaction.user.createDM()

    expect(interaction.channel).toBe(dm)
    expectWarned([])
    void dm.client
    expectWarned([W_OWN_CLIENT])
  })

  it('warns of nothing when only the mock reads it', () => {
    const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName: 'ping' })

    expect(interaction.channel?.isDMBased()).toBe(true)
    expectWarned([])
  })
})

describe("a mock client's users.createDM()", () => {
  it.each([
    ['in default mode', () => undefined, true, [W_SHARED]],
    ['under useStrictMocks()', () => useStrictMocks(), false, []],
  ] as const)('gives each user their own channel under strict mocks, %s', async (_, mode, same, warnings) => {
    mode()
    const client = createMockClient()
    const first = await client.users.createDM(FIRST)
    const second = await client.users.createDM(SECOND)

    expect(first === second).toBe(same)
    expect(await client.users.createDM(FIRST)).toBe(first)
    expectWarned(warnings)
  })

  it("is the user's own under useStrictMocks(): cached on the client, whose cache has the recipient", async () => {
    useStrictMocks()
    const client = createMockClient()
    const user = createMockUser()
    const channel = await client.users.createDM(FIRST)

    expect(channel.recipientId).toBe(FIRST)
    expect(client.users.cache.get(FIRST)?.dmChannel).toBe(channel)
    expect(channel.client).toBe(client)
    expect(channel.client.users.cache.get(FIRST)).toBe(channel.recipient)
    expect(await client.users.createDM(user)).toBe(await user.createDM())
    expectWarned([])
  })
})

describe("a mock client's users.send()", () => {
  it.each([
    ['in default mode', () => undefined, false, [W_EMPTY_SEND]],
    ['under useStrictMocks()', () => useStrictMocks(), true, []],
  ] as const)('resolves to a message holding what was sent under strict mocks, %s', async (_, mode, holds, warnings) => {
    mode()
    const client = createMockClient()
    const message = await client.users.send(FIRST, 'hello')

    expect(message.content === 'hello').toBe(holds)
    expectWarned(warnings)
  })

  it("sends through the user's DM channel under useStrictMocks(), where the message is", async () => {
    useStrictMocks()
    const client = createMockClient()
    const message = await client.users.send(FIRST, 'hello')
    const channel = await client.users.createDM(FIRST)

    expect(channel.send).toHaveBeenCalledWith('hello')
    expect(message.channel).toBe(channel)
    expect(message.channel.type).toBe(ChannelType.DM)
  })
})

// MeoCord DMs a message's author itself, as dmOnCooldown does; only a test's own read of the channel's client warns
describe("a default-mode DM channel's client", () => {
  @Controller()
  class Daily {
    @MessageHandler('daily')
    @Cooldown({ seconds: 60 })
    claim() {}
  }

  @MeoCord({ controllers: [Daily], messages: { prefix: '!', dmOnCooldown: true }, clientOptions: { intents: [] } })
  class App {}

  it('stays quiet when MeoCord DMs the author on a cooldown', async () => {
    const module = MeoCordTestingModule.fromApp(App).compile()
    const author = createMockUser()
    const guild = createMockGuild()
    const first = createMockMessage({ content: '!daily', author, guild })
    const second = createMockMessage({ content: '!daily', author, guild })
    await module.dispatch(first)
    await module.dispatch(second)

    expect(author.send).toHaveBeenCalledTimes(1)
    expectWarned([])
  })
})
