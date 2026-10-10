import {
  ActionRowBuilder,
  AutocompleteInteraction,
  ButtonBuilder,
  ButtonStyle,
  ButtonInteraction,
  ChatInputCommandInteraction,
  DiscordjsError,
  DiscordjsErrorCodes,
  EmbedBuilder,
  MessageFlags,
  MessageFlagsBitField,
} from 'discord.js'
import { vi } from 'vitest'
import { Logger } from '@src/common/logger.js'
import { forgetDeprecationWarnings } from '@src/common/deprecation.js'
import { createMockInteraction } from './mock-interaction.js'
import { getResponse } from './response.js'
import { forgetStrictMocks, useStrictMocks } from './strict-mocks.js'

const ALREADY = 'The reply to this interaction has already been sent or deferred.'

let warned: string[]
beforeEach(() => {
  forgetStrictMocks()
  forgetDeprecationWarnings()
  warned = []
  vi.spyOn(Logger.prototype, 'warn').mockImplementation((text: unknown) => void warned.push(String(text)))
})
afterEach(() => vi.restoreAllMocks())
afterAll(() => forgetStrictMocks())

const command = () => createMockInteraction(ChatInputCommandInteraction, { commandName: 'ping' })
const button = () => createMockInteraction(ButtonInteraction, { customId: 'refresh' })

describe('the reply state a test-set answer leaves', () => {
  it.each([
    ['reply', command, 'replied'],
    ['deferReply', command, 'deferred'],
    ['showModal', command, 'replied'],
    ['update', button, 'replied'],
    ['deferUpdate', button, 'deferred'],
  ] as const)('%s given a value answers the interaction, as a real call would', async (method, make, state) => {
    const resolved = make() as any
    resolved[method].mockResolvedValue(undefined)
    await resolved[method]({ content: 'hi' })
    expect([getResponse(resolved).state, resolved.replied, resolved.deferred]).toEqual([state, state === 'replied', state === 'deferred'])

    const once = make() as any
    once[method].mockResolvedValueOnce(undefined)
    await once[method]({ content: 'hi' })
    expect(getResponse(once).state).toBe(state)
  })

  it.each(['followUp', 'editReply'] as const)('%s given a value after a deferral replies, as a real call would', async method => {
    const interaction = command()
    await interaction.deferReply()
    interaction[method].mockResolvedValue(undefined as never)

    await interaction[method]('Done.')

    expect([interaction.deferred, interaction.replied]).toEqual([true, true])
  })

  it('leaves the state as it was when the answer a test set rejects', async () => {
    const interaction = command()
    const refused = new Error('refused')
    interaction.reply.mockRejectedValueOnce(refused)

    await expect(interaction.reply('hi')).rejects.toBe(refused)

    expect([getResponse(interaction).state, interaction.replied, interaction.deferred]).toEqual(['unanswered', false, false])
    await expect(interaction.reply('again')).resolves.toBeUndefined()
  })

  it('refuses the second of two answers made without awaiting, as now', async () => {
    for (const first of ['reply', 'deferReply'] as const) {
      const interaction = command()
      const outcomes = await Promise.allSettled([(interaction[first] as (body: string) => Promise<unknown>)('a'), interaction.reply('b')])
      expect(outcomes.map(outcome => outcome.status)).toEqual(['fulfilled', 'rejected'])
    }
  })

  it('warns, and still runs, a second answer after one a test set, in default mode', async () => {
    const interaction = command()
    interaction.reply.mockResolvedValueOnce(undefined as never)
    await interaction.reply('first')

    await expect(interaction.reply('second')).resolves.toBeUndefined()
    await interaction.followUp('more')
    expect(warned).toEqual([expect.stringMatching(new RegExp(`reply\\(\\).*${ALREADY.replace('.', '\\.')}.*useStrictMocks\\(\\)`))])
  })

  it('refuses a second answer after one a test set, under useStrictMocks()', async () => {
    useStrictMocks()
    const interaction = command()
    interaction.reply.mockResolvedValueOnce(undefined as never)
    await interaction.reply('first')

    await expect(interaction.reply('second')).rejects.toThrow(ALREADY)
    expect(warned).toEqual([])
  })
})

describe('the original response', () => {
  it('holds what reply and update sent', async () => {
    const interaction = command()
    await interaction.reply({ content: 'hello' })
    expect((await interaction.fetchReply()).content).toBe('hello')

    const click = button()
    await click.update({ content: 'updated' })
    expect((await click.fetchReply()).content).toBe('updated')
  })

  it('is gone after deleteReply, and a fetch, an edit or a delete of it rejects with 10008', async () => {
    const interaction = command()
    await interaction.reply('hello')
    await interaction.deleteReply()

    for (const call of [() => interaction.fetchReply(), () => interaction.editReply('x'), () => interaction.deleteReply()]) {
      await expect(call()).rejects.toMatchObject({ code: 10008 })
    }
    expect(getResponse(interaction).calls.map(({ method, error }) => [method, (error as { code?: number } | undefined)?.code])).toEqual([
      ['reply', undefined],
      ['deleteReply', undefined],
      ['editReply', 10008],
      ['deleteReply', 10008],
    ])
  })

  it('is missing before any reply or deferral', async () => {
    await expect(command().fetchReply()).rejects.toMatchObject({ code: 10008 })
  })

  it('resolves followUp() to the follow-up it sent, as fetchReply() reads it back', async () => {
    const interaction = command()
    await interaction.deferReply()
    const embed = new EmbedBuilder().setTitle('Only you')
    const followUp = await interaction.followUp({ content: 'Only you see this.', embeds: [embed], flags: MessageFlags.Ephemeral })
    embed.setTitle('Changed after sending')

    const read = (message: typeof followUp) => [message.id, message.content, message.flags.has(MessageFlags.Ephemeral), message.embeds[0]?.toJSON().title]
    expect(read(followUp)).toEqual([followUp.id, 'Only you see this.', true, 'Only you'])
    expect(read(await interaction.fetchReply(followUp.id))).toEqual(read(followUp))
  })

  it('keeps follow-ups reachable by their id once it is deleted', async () => {
    const interaction = command()
    await interaction.deferReply()
    await interaction.deleteReply()
    const followUp = await interaction.followUp({ content: 'Only you see this.', flags: MessageFlags.Ephemeral })

    const edited = await interaction.editReply({ message: followUp.id, content: 'Updated.' })
    expect([edited.id, edited.content]).toEqual([followUp.id, 'Updated.'])
    expect((await interaction.fetchReply(followUp.id)).content).toBe('Updated.')
    await interaction.deleteReply(followUp.id)
    await expect(interaction.fetchReply(followUp.id)).rejects.toMatchObject({ code: 10008 })
  })

  it('is recorded when a test sets the reply, and marked gone when it sets the delete', async () => {
    const interaction = command()
    interaction.reply.mockResolvedValueOnce(undefined as never)
    await interaction.reply({ content: 'set by the test' })
    expect((await interaction.fetchReply()).content).toBe('set by the test')

    interaction.deleteReply.mockResolvedValueOnce(undefined as never)
    await interaction.deleteReply()
    await expect(interaction.fetchReply()).rejects.toMatchObject({ code: 10008 })
  })
})

describe('reply flags and errors as discord.js has them', () => {
  it.each([
    ['a number', MessageFlags.Ephemeral],
    ['an array', [MessageFlags.Ephemeral]],
    ['a name', 'Ephemeral'],
    ['a bitfield', new MessageFlagsBitField(MessageFlags.Ephemeral)],
    ['an array with Components V2', [MessageFlags.Ephemeral, MessageFlags.IsComponentsV2]],
  ])('reads ephemeral flags given as %s', async (_kind, flags) => {
    const replied = command()
    await replied.reply({ content: 'hi', flags: flags as never })
    const deferred = command()
    await deferred.deferReply({ flags: flags as never })

    expect([replied.ephemeral, deferred.ephemeral]).toEqual([true, true])
  })

  it('takes null flags as none, and refuses a bigint or an unknown name, as discord.js does', async () => {
    const none = command()
    await none.reply({ content: 'hi', flags: null as never })
    expect(none.ephemeral).toBe(false)

    for (const flags of [64n, 'NotAFlag']) {
      const interaction = command()
      await expect(interaction.reply({ content: 'hi', flags: flags as never })).rejects.toMatchObject({ name: expect.stringContaining('RangeError') })
      expect(getResponse(interaction).state).toBe('unanswered')
    }
  })

  it("throws discord.js's errors, with its codes, keeping the messages", async () => {
    const interaction = command()
    await interaction.reply('hi')
    const again = await interaction.reply('again').catch((error: unknown) => error)
    expect(again).toBeInstanceOf(DiscordjsError)
    expect(again).toMatchObject({ code: DiscordjsErrorCodes.InteractionAlreadyReplied, message: ALREADY })

    const early = await command().followUp('first').catch((error: unknown) => error)
    expect(early).toBeInstanceOf(DiscordjsError)
    expect(early).toMatchObject({ code: DiscordjsErrorCodes.InteractionNotReplied, message: 'Cannot call followUp() before replying or deferring.' })

    const autocomplete = createMockInteraction(AutocompleteInteraction)
    await autocomplete.respond([])
    await expect(autocomplete.respond([])).rejects.toMatchObject({ code: DiscordjsErrorCodes.InteractionAlreadyReplied, message: ALREADY })
  })
})

describe('what an answer sends, held as sent', () => {
  // Each answer that sends a message, and how to read back what it sent
  const answers = [
    ['reply', command, (i: any, body: object) => i.reply(body), (i: any) => i.fetchReply()],
    ['update', button, (i: any, body: object) => i.update(body), (i: any) => i.fetchReply()],
    ['followUp', command, async (i: any, body: object) => (await i.deferReply(), i.followUp(body)), (i: any, sent: any) => i.fetchReply(sent.id)],
  ] as const
  const labelless = () => new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId('b').setStyle(ButtonStyle.Primary))

  describe.each([
    ['default', () => {}],
    ['strict', () => useStrictMocks()],
  ])('in %s mode', (_mode, setUp) => {
    beforeEach(() => setUp())

    it.each(answers)('%s keeps what was sent when the builder changes afterwards', async (_method, make, send, read) => {
      const interaction = make()
      const embed = new EmbedBuilder().setTitle('Sent')
      const sent = await send(interaction, { embeds: [embed] })
      embed.setTitle('Changed after sending')

      expect((await read(interaction, sent)).embeds[0].toJSON().title).toBe('Sent')
    })
  })

  it.each(answers)('%s rejects a component discord.js refuses to build, under useStrictMocks(), and changes nothing', async (method, make, send) => {
    useStrictMocks()
    const interaction = make()
    const before = method === 'followUp' ? 'deferred' : 'unanswered'

    await expect(send(interaction, { components: [labelless()] })).rejects.toThrow()
    expect(getResponse(interaction).state).toBe(before)
  })

  it.each(answers)('%s sends a component discord.js refuses to build in default mode, with one warning', async (method, make, send) => {
    const interaction = make()

    await expect(send(interaction, { components: [labelless()] })).resolves.not.toThrow()
    await send(make(), { components: [labelless()] })
    expect(warned).toEqual([expect.stringMatching(new RegExp(`^${method}\\(\\) here sends what discord\\.js refuses to build.*5\\.0.*useStrictMocks\\(\\)`, 's'))])
  })
})
