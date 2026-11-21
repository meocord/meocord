import 'reflect-metadata'
import {
  ButtonInteraction,
  ChatInputCommandInteraction,
  DiscordAPIError,
  MessageContextMenuCommandInteraction,
  ModalSubmitInteraction,
  PrimaryEntryPointCommandInteraction,
  StringSelectMenuInteraction,
  UserContextMenuCommandInteraction,
} from 'discord.js'
import { vi } from 'vitest'
import { Logger } from '@src/common/logger.js'
import { respond, responseOf } from '@src/common/response/response-state.js'
import { createMockInteraction, createMockMessage } from '@src/testing/mock-interaction.js'
import { getResponse } from '@src/testing/response.js'
import { forgetStrictMocks, useStrictMocks } from '@src/testing/strict-mocks.js'

// withdraw() ends a call a stop dropped before it started: it deletes the deferred reply its own acknowledgement made,
// and nothing else

/** Discord's code for an interaction it no longer knows. */
const UNKNOWN_INTERACTION = 10062
/** Discord's code for an interaction something else acknowledged first. */
const ALREADY_ACKNOWLEDGED = 40060

const sent = (interaction: object) => getResponse(interaction as never).calls.map(call => call.method)

describe.each([
  ['default mode', false],
  ['strict mode', true],
])('withdraw() of a dropped call, in %s', (_mode, strict) => {
  let logged: string[]
  beforeEach(() => {
    forgetStrictMocks()
    if (strict) useStrictMocks()
    logged = []
    for (const level of ['debug', 'error', 'warn'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation((text: unknown) => void logged.push(`${level} ${String(text)}`))
    }
  })
  afterEach(() => vi.restoreAllMocks())
  afterAll(() => forgetStrictMocks())

  const slash = () => createMockInteraction(ChatInputCommandInteraction, { commandName: 'slow' })

  it.each([
    ['a slash command', slash],
    ['a user context menu', () => createMockInteraction(UserContextMenuCommandInteraction, { commandName: 'Profile' })],
    ['a message context menu', () => createMockInteraction(MessageContextMenuCommandInteraction, { commandName: 'Quote' })],
    ['a primary entry point', () => createMockInteraction(PrimaryEntryPointCommandInteraction, { commandName: 'launch' })],
    ['a modal not from a message', () => createMockInteraction(ModalSubmitInteraction, { customId: 'form' })],
  ])('deletes the deferred reply its own acknowledgement made on %s', async (_name, make) => {
    const interaction = make()
    await respond(interaction).acknowledge()

    await expect(responseOf(interaction).withdraw()).resolves.toEqual({ deleted: true })

    expect(sent(interaction)).toEqual(['deferReply', 'deleteReply'])
    expect(logged).toEqual([])
  })

  it('deletes a private deferred reply as well', async () => {
    const interaction = slash()
    await respond(interaction).acknowledge({ ephemeral: true })

    await responseOf(interaction).withdraw()

    expect(sent(interaction)).toEqual(['deferReply', 'deleteReply'])
  })

  it.each([
    ['a button', () => createMockInteraction(ButtonInteraction, { customId: 'go' })],
    ['a select menu', () => createMockInteraction(StringSelectMenuInteraction, { customId: 'pick', values: ['a'] })],
    ['a modal from a message', () => createMockInteraction(ModalSubmitInteraction, { customId: 'form', message: createMockMessage() } as never)],
  ])('claims nothing for the deferred update of %s, which shows nothing', async (_name, make) => {
    const interaction = make()
    await respond(interaction).acknowledge()

    expect(responseOf(interaction).withdraw()).toBeUndefined()
    await respond(interaction).send('Still answered')

    expect(sent(interaction)).toEqual(['deferUpdate', 'editReply'])
  })

  it("claims nothing for a component's acknowledgement still on its way, which deletes no message", async () => {
    const interaction = createMockInteraction(ButtonInteraction, { customId: 'go' })
    const acknowledged = Promise.withResolvers<void>()
    const deferUpdate = interaction.deferUpdate.bind(interaction)
    Object.assign(interaction, { deferUpdate: async () => (await acknowledged.promise, deferUpdate()) })
    const acknowledging = respond(interaction).acknowledge()

    expect(responseOf(interaction).withdraw()).toBeUndefined()
    acknowledged.resolve()
    await acknowledging
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(vi.mocked(interaction.deleteReply)).not.toHaveBeenCalled()
  })

  it('claims nothing for an interaction nothing acknowledged, and cancels a scheduled acknowledgement', async () => {
    const interaction = slash()
    responseOf(interaction).scheduleAcknowledge(20)

    expect(responseOf(interaction).withdraw()).toBeUndefined()
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(sent(interaction)).toEqual([])
  })

  it('claims nothing once something was sent into the deferred reply', async () => {
    const interaction = slash()
    await respond(interaction).acknowledge()
    await respond(interaction).send('Working')

    expect(responseOf(interaction).withdraw()).toBeUndefined()

    expect(sent(interaction)).toEqual(['deferReply', 'editReply'])
  })

  it('claims nothing for a deferred reply a raw discord.js call made', async () => {
    const interaction = slash()
    await interaction.deferReply()

    expect(responseOf(interaction).withdraw()).toBeUndefined()

    expect(vi.mocked(interaction.deleteReply)).not.toHaveBeenCalled()
  })

  it('claims nothing for a raw deferred reply its own acknowledgement found made, as @Defer after an observer does', async () => {
    const interaction = slash()
    await interaction.deferReply()
    await respond(interaction).acknowledge()

    expect(responseOf(interaction).withdraw()).toBeUndefined()

    expect(vi.mocked(interaction.deleteReply)).not.toHaveBeenCalled()
  })

  it('deletes the deferred reply of an acknowledgement made again after a failed one', async () => {
    const interaction = slash()
    vi.mocked(interaction.deferReply).mockRejectedValueOnce(new Error('socket hang up'))
    await expect(respond(interaction).acknowledge()).rejects.toThrow('socket hang up')
    await respond(interaction).acknowledge()

    await responseOf(interaction).withdraw()

    expect(sent(interaction)).toEqual(['deferReply', 'deferReply', 'deleteReply'])
  })

  it('deletes nothing after an acknowledgement Discord refused as made elsewhere, whose answer may be a reply', async () => {
    const interaction = slash()
    vi.mocked(interaction.deferReply).mockRejectedValueOnce(
      new DiscordAPIError({ code: ALREADY_ACKNOWLEDGED, message: 'Interaction has already been acknowledged.' }, ALREADY_ACKNOWLEDGED, 400, 'POST', '/x', {}),
    )
    await respond(interaction).acknowledge()

    await expect(responseOf(interaction).withdraw()).resolves.toEqual({ deleted: false })

    expect(sent(interaction)).toEqual(['deferReply'])
  })

  it('waits for an acknowledgement still on its way, then deletes its deferred reply', async () => {
    const interaction = slash()
    const acknowledged = Promise.withResolvers<void>()
    // The mock's own deferReply, which marks the interaction as discord.js does, held until Discord answers
    const deferReply = interaction.deferReply.bind(interaction)
    Object.assign(interaction, { deferReply: async (...args: Parameters<typeof deferReply>) => (await acknowledged.promise, deferReply(...args)) })
    const acknowledging = respond(interaction).acknowledge()
    // On its way to Discord, not yet answered
    await vi.waitFor(() => expect(responseOf(interaction).history.map(call => call.method)).toEqual(['deferReply']))

    const withdrawal = responseOf(interaction).withdraw()
    expect(withdrawal).toBeDefined()
    acknowledged.resolve()
    await acknowledging

    await expect(withdrawal).resolves.toEqual({ deleted: true })
    expect(sent(interaction)).toEqual(['deferReply', 'deleteReply'])
  })

  it('deletes nothing when the acknowledgement still on its way fails', async () => {
    const interaction = slash()
    const acknowledged = Promise.withResolvers<void>()
    vi.mocked(interaction.deferReply).mockImplementationOnce(async () => {
      await acknowledged.promise
      throw new Error('socket hang up')
    })
    const acknowledging = respond(interaction).acknowledge().catch(() => undefined)

    const withdrawal = responseOf(interaction).withdraw()
    acknowledged.resolve()
    await acknowledging

    await expect(withdrawal).resolves.toEqual({ deleted: false })
    expect(sent(interaction)).toEqual(['deferReply'])
  })

  it('lets an answer asked for before it win: the answer goes out and nothing is deleted', async () => {
    const interaction = slash()
    const acknowledged = Promise.withResolvers<void>()
    const deferReply = interaction.deferReply.bind(interaction)
    Object.assign(interaction, { deferReply: async (...args: Parameters<typeof deferReply>) => (await acknowledged.promise, deferReply(...args)) })
    const acknowledging = respond(interaction).acknowledge()
    const answering = respond(interaction).send('Working')

    expect(responseOf(interaction).withdraw()).toBeUndefined()
    acknowledged.resolve()
    await Promise.all([acknowledging, answering])

    expect(sent(interaction)).toEqual(['deferReply', 'editReply'])
  })

  it('refuses an answer asked for after it, so the reply is never both edited and deleted', async () => {
    const interaction = slash()
    await respond(interaction).acknowledge()

    const withdrawal = responseOf(interaction).withdraw()
    const answering = respond(interaction).send('Too late')
    const following = respond(interaction).followUp('Too late')
    await respond(interaction).error(new Error('too late'))
    await responseOf(interaction).release()
    await responseOf(interaction).abandon()

    await expect(answering).rejects.toThrow('The bot stopped before this call started')
    await expect(following).rejects.toThrow('The bot stopped before this call started')
    await withdrawal
    expect(sent(interaction)).toEqual(['deferReply', 'deleteReply'])
    expect(logged).toEqual([])
  })

  it('deletes once when called twice, giving the same deletion', async () => {
    const interaction = slash()
    await respond(interaction).acknowledge()

    const first = responseOf(interaction).withdraw()
    const second = responseOf(interaction).withdraw()
    await first

    expect(second).toBe(first)
    expect(sent(interaction)).toEqual(['deferReply', 'deleteReply'])
  })

  it('claims nothing on a second call after a first that claimed nothing', async () => {
    const interaction = slash()
    expect(responseOf(interaction).withdraw()).toBeUndefined()
    await respond(interaction).acknowledge()

    expect(responseOf(interaction).withdraw()).toBeUndefined()

    expect(sent(interaction)).toEqual(['deferReply'])
  })

  it.each([
    ['refused by Discord', new DiscordAPIError({ code: UNKNOWN_INTERACTION, message: 'Unknown interaction' }, UNKNOWN_INTERACTION, 404, 'DELETE', '/x', {})],
    ['failing on the network', new Error('socket hang up')],
  ])('resolves a deletion %s with its error, for the stop to report, and logs nothing itself', async (_name, failure) => {
    const interaction = slash()
    await respond(interaction).acknowledge()
    vi.mocked(interaction.deleteReply).mockRejectedValue(failure)

    await expect(responseOf(interaction).withdraw()).resolves.toEqual({ deleted: false, error: failure })

    expect(logged).toEqual([])
  })
})
