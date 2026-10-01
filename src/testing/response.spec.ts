import {
  AutocompleteInteraction,
  ButtonInteraction,
  ChatInputCommandInteraction,
  InteractionContextType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  LabelBuilder,
} from 'discord.js'
import { respond } from '@src/common/index.js'
import { responseOf } from '@src/common/response/response-state.js'
import { createDiscordError, createMockInteraction, createMockMessage, getResponse } from '@src/testing/index.js'

describe('getResponse', () => {
  it('reports the answers a handler made with discord.js directly, in order, with what each sent', async () => {
    const replied = createMockInteraction(ChatInputCommandInteraction)
    await replied.reply({ content: 'raw', withResponse: true })
    await replied.followUp('more')
    const deferred = createMockInteraction(ButtonInteraction)
    await deferred.deferUpdate()
    await deferred.editReply({ content: 'done' })

    expect(getResponse(replied)).toEqual({
      state: 'replied',
      sent: true,
      calls: [
        { method: 'reply', payload: { content: 'raw' } },
        { method: 'followUp', payload: 'more' },
      ],
    })
    expect(getResponse(deferred)).toEqual({
      state: 'replied',
      sent: true,
      calls: [
        { method: 'deferUpdate', payload: undefined },
        { method: 'editReply', payload: { content: 'done' } },
      ],
    })
    expect(getResponse(createMockInteraction(ChatInputCommandInteraction))).toEqual({ state: 'unanswered', sent: false, calls: [] })
  })

  it('reports answers made directly and through respond() together, each once, in the order made', async () => {
    const interaction = createMockInteraction(ChatInputCommandInteraction)
    await interaction.deferReply()

    await respond(interaction).send('answer')
    await interaction.followUp('after')

    expect(getResponse(interaction).calls.map(call => call.method)).toEqual(['deferReply', 'editReply', 'followUp'])
  })

  it('keeps a direct answer Discord refused, with its error, and counts nothing as sent', async () => {
    const interaction = createMockInteraction(ChatInputCommandInteraction)
    interaction.reply.mockRejectedValueOnce(createDiscordError(10062))

    await expect(interaction.reply('late')).rejects.toMatchObject({ code: 10062 })

    expect(getResponse(interaction)).toEqual({
      state: 'unanswered',
      sent: false,
      calls: [{ method: 'reply', payload: 'late', error: expect.objectContaining({ code: 10062 }) }],
    })
  })

  // Recording a rejection must not handle it: on a bot, a direct answer nobody awaits that Discord refuses is unhandled
  it('leaves a refused direct answer nobody awaits unhandled, as on a bot, and still records its error', async () => {
    const interaction = createMockInteraction(ChatInputCommandInteraction)
    interaction.reply.mockRejectedValueOnce(createDiscordError(10062))
    // The test runner's own listeners would fail the run on it, so they step aside for this one rejection
    const runners = process.listeners('unhandledRejection')
    process.removeAllListeners('unhandledRejection')
    try {
      const unhandled = new Promise<unknown>(resolve => process.once('unhandledRejection', resolve))

      void interaction.reply('late')

      // Handled, it would never be reported: the race then settles on 'handled'
      const settled = await Promise.race([unhandled, new Promise(resolve => setTimeout(() => resolve('handled'), 500))])
      expect(settled).toMatchObject({ code: 10062 })
      expect(getResponse(interaction).calls).toEqual([{ method: 'reply', payload: 'late', error: expect.objectContaining({ code: 10062 }) }])
    } finally {
      process.removeAllListeners('unhandledRejection')
      for (const listener of runners) process.on('unhandledRejection', listener)
    }
  })

  describe('a call Discord refuses', () => {
    const refusal = (code: number) => expect.objectContaining({ code })

    it('keeps a reply refused with 10062 in calls, with its error, and counts nothing as sent', async () => {
      const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName: 'ping' })
      interaction.reply.mockRejectedValueOnce(createDiscordError(10062))

      await expect(respond(interaction).send('Pong!')).rejects.toMatchObject({ code: 10062 })

      expect(getResponse(interaction)).toEqual({
        state: 'unanswered',
        sent: false,
        calls: [{ method: 'reply', payload: { content: 'Pong!', flags: 0 }, error: refusal(10062) }],
      })
    })

    it('counts an update refused with 50027 as not sent', async () => {
      const interaction = createMockInteraction(ButtonInteraction, { customId: 'refresh' })
      interaction.update.mockRejectedValueOnce(createDiscordError(50027))

      await expect(respond(interaction).send('Refreshed.')).rejects.toMatchObject({ code: 50027 })

      expect(getResponse(interaction)).toMatchObject({ sent: false, calls: [{ method: 'update', error: refusal(50027) }] })
    })

    it('marks only the refused call: a deferral that went through stays, and an edit refused after it sends nothing', async () => {
      const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName: 'report' })
      await respond(interaction).acknowledge()
      interaction.editReply.mockRejectedValueOnce(createDiscordError(50001))

      await expect(respond(interaction).send('Done.')).rejects.toMatchObject({ code: 50001 })

      const { state, sent, calls } = getResponse(interaction)
      expect({ state, sent }).toEqual({ state: 'deferred', sent: false })
      expect(calls.map(call => [call.method, 'error' in call])).toEqual([
        ['deferReply', false],
        ['editReply', true],
      ])
    })

    it('keeps what was sent before a refused follow-up', async () => {
      const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName: 'report' })
      await respond(interaction).send('Started.')
      interaction.followUp.mockRejectedValueOnce(createDiscordError(10015))

      await expect(respond(interaction).followUp('Finished.')).rejects.toMatchObject({ code: 10015 })

      expect(getResponse(interaction)).toMatchObject({ state: 'replied', sent: true })
      expect(getResponse(interaction).calls.map(call => [call.method, 'error' in call])).toEqual([
        ['reply', false],
        ['followUp', true],
      ])
    })

    it('counts an expired edit sent through the channel, with the refused editReply before it', async () => {
      const message = createMockMessage()
      const interaction = createMockInteraction(ButtonInteraction, { customId: 'refresh', message })
      Object.assign(interaction, { createdTimestamp: Date.now() - 16 * 60 * 1000, context: InteractionContextType.Guild })
      await respond(interaction).acknowledge()
      interaction.editReply.mockRejectedValueOnce(createDiscordError(50027))

      await respond(interaction).send('Late.')

      expect(getResponse(interaction)).toMatchObject({ state: 'replied', sent: true })
      expect(getResponse(interaction).calls.map(call => [call.method, 'error' in call])).toEqual([
        ['deferUpdate', false],
        ['editReply', true],
        ['message.edit', false],
      ])
    })

    it('records a refused cleanup that respond() swallows: the deferral a denied call leaves is not deleted', async () => {
      const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName: 'report' })
      await respond(interaction).acknowledge()
      interaction.deleteReply.mockRejectedValueOnce(createDiscordError(10008))

      await expect(responseOf(interaction).abandon()).resolves.toBeUndefined()

      expect(getResponse(interaction).calls).toEqual([
        { method: 'deferReply', payload: { flags: 0 } },
        { method: 'deleteReply', payload: undefined, error: refusal(10008) },
      ])
    })

    it.each([
      ['deferReply', () => createMockInteraction(ChatInputCommandInteraction), (i: any) => respond(i).acknowledge()],
      ['deferUpdate', () => createMockInteraction(ButtonInteraction), (i: any) => respond(i).acknowledge()],
      ['reply', () => createMockInteraction(ChatInputCommandInteraction), (i: any) => respond(i).send('x')],
      ['update', () => createMockInteraction(ButtonInteraction), (i: any) => respond(i).send('x')],
      ['editReply', () => createMockInteraction(ChatInputCommandInteraction), async (i: any) => {
        await respond(i).send('x')
        return respond(i).edit('y')
      }],
      ['followUp', () => createMockInteraction(ChatInputCommandInteraction), async (i: any) => {
        await respond(i).send('x')
        return respond(i).followUp('y')
      }],
      ['deleteReply', () => createMockInteraction(ChatInputCommandInteraction), async (i: any) => {
        await respond(i).send('x')
        return respond(i).delete()
      }],
      ['showModal', () => createMockInteraction(ButtonInteraction), (i: any) => respond(i).modal(
        new ModalBuilder().setCustomId('form').setTitle('Form').addLabelComponents(
          new LabelBuilder().setLabel('Body').setTextInputComponent(new TextInputBuilder().setCustomId('body').setStyle(TextInputStyle.Short)),
        ),
      )],
    ] as const)('marks a refused %s with its error', async (method, create, run) => {
      const interaction = create() as any
      interaction[method].mockRejectedValueOnce(createDiscordError(50001))

      await expect(run(interaction)).rejects.toMatchObject({ code: 50001 })

      const call = getResponse(interaction).calls.at(-1)!
      expect(call).toMatchObject({ method, error: refusal(50001) })
      expect(getResponse(interaction).calls.slice(0, -1).some(earlier => 'error' in earlier)).toBe(false)
    })
  })

  it('reports an autocomplete, which has no reply, as unanswered', () => {
    expect(getResponse(createMockInteraction(AutocompleteInteraction))).toEqual({ state: 'unanswered', sent: false, calls: [] })
  })
})

describe('createDiscordError', () => {
  it('builds the error discord.js throws, with the code, and a message naming it by default', () => {
    const error = createDiscordError(50027)

    expect(error.code).toBe(50027)
    expect(error.message).toContain('50027')
    expect(createDiscordError(10062, 'Unknown interaction').message).toBe('Unknown interaction')
  })
})
