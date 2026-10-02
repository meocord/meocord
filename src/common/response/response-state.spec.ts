import {
  ActionRowBuilder,
  type APIEmbed,
  ButtonBuilder,
  ButtonStyle,
  ApplicationIntegrationType,
  ButtonInteraction,
  ChatInputCommandInteraction,
  ComponentType,
  InteractionContextType,
  type Message,
  MessageFlags,
  MessageFlagsBitField,
  ModalBuilder,
  ModalSubmitInteraction,
  resolveColor,
  StringSelectMenuInteraction,
} from 'discord.js'
import { vi } from 'vitest'
import { Logger } from '@src/common/logger.js'
import { Theme } from '@src/common/theme.js'
import { DEFAULT_THEME } from '@src/core/theme-defaults.js'
import { GuardDeniedError } from '@src/common/errors.js'
import { LOCK_MEMORY_MS, lockedMessageCount, respond, responseOf } from '@src/common/response/response-state.js'
import { RENDERED_CONTAINER_ID, setPresenter } from '@src/common/response/presenter.js'
import { UnroutedExecutionContext } from '@src/common/execution-context.js'
import { createDiscordError, createMockInteraction, createMockMessage, getResponse } from '@src/testing/index.js'

const { Ephemeral, SuppressEmbeds, SuppressNotifications, IsComponentsV2 } = MessageFlags

interface Payload { flags?: number; embeds?: APIEmbed[]; components?: { type: number; id?: number }[]; content?: string }

function sent(method: { mock: { calls: unknown[][] } }, call = 0): Payload {
  return method.mock.calls[call][0] as Payload
}

function messageWith(options: { flags?: number; embeds?: APIEmbed[]; components?: unknown[] } = {}): Message {
  const message = createMockMessage()
  Object.assign(message, {
    flags: new MessageFlagsBitField(options.flags ?? 0),
    embeds: (options.embeds ?? []).map(embed => ({ toJSON: () => embed })),
    components: (options.components ?? []).map(component => ({ toJSON: () => component })),
  })
  return message as unknown as Message
}

const command = () => createMockInteraction(ChatInputCommandInteraction)
const button = (message = messageWith()) => createMockInteraction(ButtonInteraction, { customId: 'refresh', message })

describe('respond()', () => {
  it('returns one state per interaction', () => {
    const interaction = command()
    expect(respond(interaction)).toBe(respond(interaction))
  })

  it('refuses an autocomplete interaction, which answers with respond([])', () => {
    const autocomplete = { isRepliable: () => false } as never
    expect(() => respond(autocomplete)).toThrow('autocomplete answers with respond([])')
  })

  describe('send()', () => {
    it('replies to an unanswered command, then edits on a second send', async () => {
      const interaction = command()

      await respond(interaction).send('first')
      await respond(interaction).send('second')

      expect(sent(interaction.reply)).toMatchObject({ content: 'first', withResponse: true })
      expect(sent(interaction.editReply)).toMatchObject({ content: 'second' })
      expect(respond(interaction).state).toBe('replied')
    })

    it("updates an unanswered component's message instead of replying", async () => {
      const interaction = button()

      await respond(interaction).send({ content: 'updated' })

      expect(sent(interaction.update)).toMatchObject({ content: 'updated' })
      expect(interaction.reply).not.toHaveBeenCalled()
    })

    it('edits once the interaction is deferred', async () => {
      const interaction = command()
      await respond(interaction).acknowledge()

      await respond(interaction).send('done')

      expect(sent(interaction.editReply)).toMatchObject({ content: 'done' })
    })

    it('picks up answers made directly with discord.js', async () => {
      const interaction = command()
      await interaction.reply('raw reply')

      await respond(interaction).send('through respond')

      expect(interaction.reply).toHaveBeenCalledTimes(1)
      expect(sent(interaction.editReply)).toMatchObject({ content: 'through respond' })
    })
  })

  describe('flags', () => {
    it('keeps one call’s flags out of the next call', async () => {
      const interaction = command()

      await respond(interaction).send({ content: 'private', flags: Ephemeral | SuppressNotifications })
      await respond(interaction).followUp({ content: 'public' })

      expect(sent(interaction.reply).flags).toBe(Ephemeral | SuppressNotifications)
      expect(sent(interaction.followUp).flags).toBe(0)
    })

    it('defers a reply with Ephemeral only', async () => {
      const interaction = command()

      await respond(interaction).acknowledge({ ephemeral: true })

      expect(sent(interaction.deferReply).flags).toBe(Ephemeral)
    })

    it('drops flags an edit cannot take, with a development warning', async () => {
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
      const interaction = command()
      await respond(interaction).acknowledge()

      await respond(interaction).send({ content: 'x', flags: Ephemeral | SuppressEmbeds })

      expect(sent(interaction.editReply).flags).toBe(SuppressEmbeds)
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Ephemeral'))
      warn.mockRestore()
    })

    // A flags value on an edit sets every flag Discord lets an edit change, SuppressEmbeds among them
    it("keeps a message's suppressed embeds suppressed through the lock, the restore and an edit", async () => {
      const interaction = button(messageWith({ flags: SuppressEmbeds, components: [{ type: ComponentType.ActionRow, components: [{ type: ComponentType.Button, style: 1, custom_id: 'refresh', label: 'Refresh' }] }] }))
      vi.mocked(interaction.fetchReply).mockRejectedValue(new Error('not readable'))
      // Discord returns the edited message with the flags it kept
      vi.mocked(interaction.editReply).mockResolvedValue(messageWith({ flags: SuppressEmbeds }))

      await respond(interaction).lock()
      await responseOf(interaction).release()
      await respond(interaction).edit('done')

      const edits = vi.mocked(interaction.editReply).mock.calls.map(([payload]) => Number((payload as Payload).flags ?? 0))
      expect(edits).toHaveLength(3)
      for (const flags of edits) expect(flags & SuppressEmbeds).toBe(SuppressEmbeds)
    })

    it('keeps IsComponentsV2 on edits of a Components V2 message, dropping content and embeds', async () => {
      const interaction = button(messageWith({ flags: IsComponentsV2 }))
      await respond(interaction).acknowledge()

      await respond(interaction).send({ content: 'ignored', embeds: [{ description: 'ignored' }], components: [] })

      const payload = sent(interaction.editReply)
      expect(payload.flags).toBe(IsComponentsV2)
      expect(payload).not.toHaveProperty('content')
      expect(payload).not.toHaveProperty('embeds')
    })
  })

  // discord.js's deprecated reply option; respond() reads it as the Ephemeral flag before deciding anything
  describe('the deprecated ephemeral option', () => {
    it('keeps a private follow-up on a public deferral private: delete, then follow up, never an edit', async () => {
      const interaction = command()
      await respond(interaction).acknowledge()
      const steps: string[] = []
      interaction.deleteReply.mockImplementation(async () => void steps.push('delete'))
      interaction.followUp.mockImplementation(async () => {
        steps.push('followUp')
        return createMockMessage() as never
      })

      await respond(interaction).followUp({ content: 'secret', ephemeral: true })

      expect(steps).toEqual(['delete', 'followUp'])
      expect(interaction.editReply).not.toHaveBeenCalled()
      expect(sent(interaction.followUp)).toEqual({ content: 'secret', flags: Ephemeral })
    })

    it('makes a first reply private, as its records and the mock show', async () => {
      const interaction = command()

      await respond(interaction).send({ content: 'private', ephemeral: true })

      expect(sent(interaction.reply)).toMatchObject({ content: 'private', flags: Ephemeral })
      expect(sent(interaction.reply)).not.toHaveProperty('ephemeral')
      expect(getResponse(interaction).calls[0].payload).toMatchObject({ flags: Ephemeral })
      expect(interaction.ephemeral).toBe(true)
    })

    it('makes a follow-up after a reply private', async () => {
      const interaction = command()
      await respond(interaction).send('public')

      await respond(interaction).followUp({ content: 'private', ephemeral: true })

      expect(sent(interaction.followUp)).toEqual({ content: 'private', flags: Ephemeral })
    })

    it('leaves out of an update and an edit what they cannot change', async () => {
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
      const clicked = button()
      const deferred = command()
      await respond(deferred).acknowledge()

      await respond(clicked).send({ content: 'updated', ephemeral: true })
      await respond(deferred).send({ content: 'edited', ephemeral: true })

      for (const payload of [sent(clicked.update), sent(deferred.editReply)]) {
        expect(payload).not.toHaveProperty('ephemeral')
        expect(Number(payload.flags ?? 0) & Ephemeral).toBe(0)
      }
      warn.mockRestore()
    })

    it('drops ephemeral: false without making anything private', async () => {
      const interaction = command()

      await respond(interaction).send({ content: 'public', ephemeral: false })

      expect(sent(interaction.reply)).toEqual({ content: 'public', flags: 0, withResponse: true })
    })
  })

  describe('followUp()', () => {
    it('is the first reply before any answer', async () => {
      const interaction = button()

      await respond(interaction).followUp({ content: 'hi', flags: Ephemeral })

      expect(sent(interaction.reply).flags).toBe(Ephemeral)
      expect(interaction.update).not.toHaveBeenCalled()
    })

    // Discord would make the follow-up the deferred reply, shown to everyone, ignoring its flags
    it('keeps a private follow-up private on a public deferred reply: delete, then follow up', async () => {
      const interaction = command()
      await respond(interaction).acknowledge()
      const steps: string[] = []
      interaction.deleteReply.mockImplementation(async () => void steps.push('delete'))
      interaction.followUp.mockImplementation(async () => {
        steps.push('followUp')
        return createMockMessage() as never
      })

      await respond(interaction).followUp({ content: 'secret', flags: Ephemeral })

      expect(steps).toEqual(['delete', 'followUp'])
      expect(sent(interaction.followUp)).toMatchObject({ content: 'secret', flags: Ephemeral })
      expect(interaction.editReply).not.toHaveBeenCalled()
    })

    it('sends a follow-up as the edit of a deferred reply that is private, or when it asks for no privacy', async () => {
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
      const secret = command()
      await respond(secret).acknowledge({ ephemeral: true })
      const plain = command()
      await respond(plain).acknowledge()

      await respond(secret).followUp({ content: 'secret', flags: Ephemeral })
      await respond(plain).followUp({ content: 'hello' })

      expect(sent(secret.editReply)).toMatchObject({ content: 'secret' })
      expect(sent(plain.editReply)).toMatchObject({ content: 'hello' })
      expect(secret.deleteReply).not.toHaveBeenCalled()
      expect(plain.followUp).not.toHaveBeenCalled()
      expect(warn).not.toHaveBeenCalled()
      warn.mockRestore()
    })

    it('follows up after a deferred component update, keeping Ephemeral', async () => {
      const interaction = button()
      await respond(interaction).acknowledge()

      await respond(interaction).followUp({ content: 'private note', flags: Ephemeral })

      expect(sent(interaction.followUp)).toMatchObject({ content: 'private note', flags: Ephemeral })
    })
  })

  describe('acknowledge()', () => {
    it('defers a component invisibly, with an update', async () => {
      const interaction = button()

      await respond(interaction).acknowledge()

      expect(interaction.deferUpdate).toHaveBeenCalledTimes(1)
      expect(interaction.deferReply).not.toHaveBeenCalled()
    })

    it('treats a modal submitted from a message as a component', async () => {
      const interaction = createMockInteraction(ModalSubmitInteraction, { message: messageWith() })

      await respond(interaction).acknowledge()

      expect(interaction.deferUpdate).toHaveBeenCalledTimes(1)
    })

    it('shares one acknowledgement between concurrent calls', async () => {
      const interaction = command()

      await Promise.all([respond(interaction).acknowledge(), respond(interaction).acknowledge()])

      expect(interaction.deferReply).toHaveBeenCalledTimes(1)
    })

    it('treats 40060 as acknowledged elsewhere', async () => {
      const interaction = command()
      interaction.deferReply.mockRejectedValueOnce(createDiscordError(40060))

      await respond(interaction).acknowledge()

      expect(respond(interaction).state).toBe('replied')
    })
  })

  describe('modal()', () => {
    const modal = new ModalBuilder().setCustomId('m').setTitle('Title')

    it('shows a modal while unanswered', async () => {
      const interaction = command()

      await respond(interaction).modal(modal)

      expect(interaction.showModal).toHaveBeenCalledWith(modal)
    })

    it('refuses an interaction that cannot show a modal, such as a modal submission', async () => {
      const interaction = createMockInteraction(ModalSubmitInteraction, { customId: 'form' })
      Reflect.deleteProperty(interaction, 'showModal')

      await expect(respond(interaction).modal(new ModalBuilder().setCustomId('x').setTitle('X'))).rejects.toThrow('cannot show a modal')
    })

    it('throws a clear error once acknowledged, rather than failing at Discord', async () => {
      const interaction = command()
      await respond(interaction).acknowledge()

      await expect(respond(interaction).modal(modal)).rejects.toThrow('A modal must be the first response')
    })
  })

  describe('delete()', () => {
    it('refuses before any answer', async () => {
      await expect(respond(command()).delete()).rejects.toThrow('There is no answer to delete')
    })

    it('deletes the reply', async () => {
      const interaction = command()
      await respond(interaction).send('bye')

      await respond(interaction).delete()

      expect(interaction.deleteReply).toHaveBeenCalledTimes(1)
    })
  })

  describe('attachments', () => {
    const cdn = 'https://cdn.discordapp.com/attachments/1/2/card.png?ex=1'

    it('points a Discord CDN image at attachment:// when the edited message keeps the file', async () => {
      const interaction = command()
      await respond(interaction).acknowledge()

      await respond(interaction).edit({
        embeds: [{ image: { url: cdn }, thumbnail: { url: 'https://example.com/a.png' } }],
        files: [{ attachment: Buffer.from(''), name: 'card.png' }],
      })

      const [embed] = sent(interaction.editReply).embeds ?? []
      expect(embed.image?.url).toBe('attachment://card.png')
      expect(embed.thumbnail?.url).toBe('https://example.com/a.png')
    })

    it('leaves a CDN image alone when the file is not kept', async () => {
      const interaction = command()
      await respond(interaction).acknowledge()

      await respond(interaction).edit({ embeds: [{ image: { url: cdn } }] })

      expect(sent(interaction.editReply).embeds?.[0].image?.url).toBe(cdn)
    })

    it('rewrites Components V2 media the message keeps', async () => {
      const message = messageWith({ flags: IsComponentsV2 })
      Object.assign(message, { attachments: new Map([['1', { name: 'card.png' }]]) })
      const interaction = button(message)
      await respond(interaction).acknowledge()

      await respond(interaction).edit({
        components: [{ type: ComponentType.MediaGallery, items: [{ media: { url: cdn } }] }] as never,
      })

      const [gallery] = sent(interaction.editReply).components as unknown as { items: { media: { url: string } }[] }[]
      expect(gallery.items[0].media.url).toBe('attachment://card.png')
    })
  })

  describe('install contexts', () => {
    const pastTokenLifetime = Date.now() - 16 * 60 * 1000

    it('edits through the channel only once the token has expired, where the bot is present', async () => {
      const message = messageWith()
      const interaction = button(message)
      Object.assign(interaction, { createdTimestamp: pastTokenLifetime, context: InteractionContextType.Guild })
      await respond(interaction).acknowledge()
      interaction.editReply.mockRejectedValueOnce(createDiscordError(50027))

      await respond(interaction).send('late')

      expect(message.edit).toHaveBeenCalledWith(expect.objectContaining({ content: 'late' }))
    })

    // The token's age is read on the host's clock, which may run behind Discord's
    it('takes a token error as expiry from 14 minutes, allowing for a clock running late', async () => {
      const message = messageWith()
      const interaction = button(message)
      Object.assign(interaction, { createdTimestamp: Date.now() - 14.5 * 60 * 1000, context: InteractionContextType.Guild })
      await respond(interaction).acknowledge()
      interaction.editReply.mockRejectedValueOnce(createDiscordError(10015))

      await respond(interaction).send('late')

      expect(message.edit).toHaveBeenCalledWith(expect.objectContaining({ content: 'late' }))
    })

    it('never uses the channel in a server without the bot', async () => {
      const message = messageWith()
      const interaction = createMockInteraction(ButtonInteraction, {
        message,
        context: InteractionContextType.Guild,
        authorizingIntegrationOwners: { [ApplicationIntegrationType.UserInstall]: 'user' },
      })
      Object.assign(interaction, { createdTimestamp: pastTokenLifetime })
      await respond(interaction).acknowledge()
      interaction.editReply.mockRejectedValueOnce(createDiscordError(50027))

      await expect(respond(interaction).send('late')).rejects.toThrow('50027')
      expect(message.edit).not.toHaveBeenCalled()
    })

    it('rethrows a token error while the token is still valid', async () => {
      const message = messageWith()
      const interaction = button(message)
      await respond(interaction).acknowledge()
      interaction.editReply.mockRejectedValueOnce(createDiscordError(50027))

      await expect(respond(interaction).send('early')).rejects.toThrow()
      expect(message.edit).not.toHaveBeenCalled()
    })
  })

  describe('error()', () => {
    // A plain Error is a fault in the bot, so the default presenter gives it the danger colour
    const describedAs = (payload: Payload) => {
      const [embed] = payload.embeds ?? []
      expect(embed.color).toBe(resolveColor(DEFAULT_THEME.colors.danger))
      return embed.description
    }

    it('replies privately to an unanswered interaction', async () => {
      const interaction = command()

      await respond(interaction).error(new Error('x'))

      expect(describedAs(sent(interaction.reply))).toBe('An error occurred while executing the command.')
      expect(sent(interaction.reply).flags).toBe(Ephemeral)
    })

    it("edits a command's deferred reply into the error", async () => {
      const interaction = command()
      await respond(interaction).acknowledge()

      await respond(interaction).error(new Error('x'), { message: 'Profile not found.' })

      expect(describedAs(sent(interaction.editReply))).toBe('Profile not found.')
      expect(interaction.followUp).not.toHaveBeenCalled()
    })

    it("keeps a private error off a public deferred reply: delete, then follow up", async () => {
      const interaction = command()
      await respond(interaction).acknowledge()
      const steps: string[] = []
      interaction.deleteReply.mockImplementation(async () => void steps.push('delete'))
      interaction.followUp.mockImplementation(async () => {
        steps.push('followUp')
        return createMockMessage() as never
      })

      await respond(interaction).error(new GuardDeniedError('Owners only.'), { message: 'Owners only.', visibility: 'private' })

      expect(steps).toEqual(['delete', 'followUp'])
      expect(sent(interaction.followUp).flags).toBe(Ephemeral)
      expect(interaction.editReply).not.toHaveBeenCalled()
    })

    it('adds the error to a private component message, keeping its components and embeds', async () => {
      const row = { type: ComponentType.ActionRow, components: [] }
      const interaction = button(messageWith({ flags: Ephemeral, embeds: [{ description: 'card' }], components: [row] }))
      await respond(interaction).acknowledge()

      await respond(interaction).error(new Error('x'))

      const payload = sent(interaction.editReply)
      expect(payload.components).toEqual([row])
      expect(payload.embeds?.map(embed => embed.description)).toEqual(['card', 'An error occurred while executing the command.'])
      expect(interaction.followUp).not.toHaveBeenCalled()
    })

    // Discord refuses an eleventh embed, which would leave the card locked and the error unseen
    it('restores a full private card and follows up privately, where the error would not fit', async () => {
      const embeds = Array.from({ length: 10 }, (_, index) => ({ description: `page ${index}` }))
      const row = { type: ComponentType.ActionRow, components: [{ type: ComponentType.Button, style: 1, custom_id: 'refresh', label: 'Refresh' }] }
      const interaction = button(messageWith({ flags: Ephemeral, embeds, components: [row] }))
      vi.mocked(interaction.fetchReply).mockRejectedValue(new Error('not readable'))
      await respond(interaction).lock()

      await respond(interaction).error(new Error('x'))

      const edits = vi.mocked(interaction.editReply).mock.calls.map(([payload]) => payload as Payload)
      for (const edit of edits) expect(edit.embeds?.length ?? 0).toBeLessThanOrEqual(10)
      expect(edits.at(-1)).toMatchObject({ components: [row], embeds })
      expect(sent(interaction.followUp).flags).toBe(Ephemeral)
    })

    it('follows up privately on a public component, never editing the clicked message', async () => {
      const interaction = button()
      await respond(interaction).acknowledge()

      await respond(interaction).error(new Error('x'))

      expect(interaction.editReply).not.toHaveBeenCalled()
      expect(sent(interaction.followUp).flags).toBe(Ephemeral)
    })

    it('answers a Components V2 message with a container carrying MeoCord’s id', async () => {
      const interaction = createMockInteraction(StringSelectMenuInteraction, { message: messageWith({ flags: IsComponentsV2 }) })
      await respond(interaction).acknowledge()

      await respond(interaction).error(new Error('x'))

      const payload = sent(interaction.followUp)
      expect(payload.flags).toBe(Ephemeral | IsComponentsV2)
      expect(payload.components?.[0]).toMatchObject({ type: ComponentType.Container, id: RENDERED_CONTAINER_ID })
      expect(payload).not.toHaveProperty('embeds')
    })

    it('follows up once after 40060, and never throws', async () => {
      const interaction = command()
      interaction.reply.mockRejectedValueOnce(createDiscordError(40060))
      interaction.followUp.mockRejectedValueOnce(createDiscordError(10062))

      await expect(respond(interaction).error(new Error('x'))).resolves.toBeUndefined()
      expect(getResponse(interaction).calls.map(call => call.method)).toEqual(['reply', 'followUp'])
    })

    it('never throws when the presenter itself fails', async () => {
      const interaction = command()
      setPresenter(interaction.client, {
        loading: () => ({ text: 'x' }),
        error: () => {
          throw new Error('presenter broke')
        },
      })

      const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)

      await expect(respond(interaction).error(new Error('x'))).resolves.toBeUndefined()
      expect(logged).toHaveBeenCalledWith(expect.stringContaining('Could not write the error answer for'), expect.objectContaining({ message: 'presenter broke' }))
      logged.mockRestore()
    })

    // An interaction past Discord's three seconds refuses the acknowledgement; that is no fault of the presenter
    it('logs a refused acknowledgement before a drawn error view as the send it is, not as the presenter failing', async () => {
      const interaction = command()
      interaction.deferReply.mockRejectedValueOnce(createDiscordError(10062))
      setPresenter(interaction.client, { loading: () => ({ text: 'x' }), error: async () => ({ text: 'Drawn.' }) })
      const debug = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined)
      const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)

      await respond(interaction).error(new Error('x'))

      expect(debug).toHaveBeenCalledOnce()
      expect(debug).toHaveBeenCalledWith(expect.stringContaining('Could not acknowledge the interaction privately'))
      expect(logged).not.toHaveBeenCalledWith(expect.stringContaining('Could not write the error answer for'), expect.anything())
      // Discord no longer knows the interaction, so no answer is tried that could only fail the same way
      expect(getResponse(interaction).calls.map(call => call.method)).toEqual(['deferReply'])
      debug.mockRestore()
      logged.mockRestore()
    })

    it('reports a drawing that rejects while a refused acknowledgement is awaited, and leaves no rejection unhandled', async () => {
      const interaction = command()
      const acknowledgement = Promise.withResolvers<never>()
      interaction.deferReply.mockReturnValueOnce(acknowledgement.promise)
      const drawing = Promise.withResolvers<never>()
      setPresenter(interaction.client, { loading: () => ({ text: 'x' }), error: () => drawing.promise })
      const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
      const debug = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined)
      const unhandled = vi.fn()
      process.on('unhandledRejection', unhandled)

      const answered = respond(interaction).error(new Error('x'))
      drawing.reject(new Error('drawing broke'))
      await new Promise(resolve => setTimeout(resolve, 0))
      acknowledgement.reject(createDiscordError(10062))
      await answered
      await new Promise(resolve => setTimeout(resolve, 0))
      process.off('unhandledRejection', unhandled)

      expect(unhandled).not.toHaveBeenCalled()
      expect(logged).toHaveBeenCalledWith(expect.stringContaining('Could not write the error answer for'), expect.objectContaining({ message: 'drawing broke' }))
      debug.mockRestore()
      logged.mockRestore()
    })

    it("styles the error with the client's presenter", async () => {
      const interaction = command()
      const error = new Error('x')
      const presenter = {
        loading: () => ({ text: 'loading' }),
        error: vi.fn(() => ({ text: 'Branded.', color: Theme.warningColor })),
      }
      setPresenter(interaction.client, presenter)

      await respond(interaction).error(error, { message: 'Words.' })

      expect(presenter.error).toHaveBeenCalledWith(
        expect.objectContaining({ interaction, mode: 'embed', theme: DEFAULT_THEME }),
        { message: 'Words.', error, tone: 'danger' },
      )
      expect(sent(interaction.reply).embeds?.[0]).toMatchObject({ description: 'Branded.', color: resolveColor(Theme.warningColor) })
    })
  })

  it('is reachable from the ExecutionContext of an interaction, and absent for a message', () => {
    const interaction = command()

    expect(new UnroutedExecutionContext([interaction]).response).toBe(respond(interaction))
    expect(new UnroutedExecutionContext([createMockMessage()]).response).toBeUndefined()
  })

  it('reports what it did through getResponse()', async () => {
    const interaction = button()
    await respond(interaction).acknowledge()
    await respond(interaction).send('done')

    expect(getResponse(interaction)).toMatchObject({ state: 'replied', sent: true })
    expect(getResponse(interaction).calls.map(call => call.method)).toEqual(['deferUpdate', 'editReply'])
    expect(getResponse(command())).toEqual({ state: 'unanswered', sent: false, calls: [] })
  })
})

describe('respond(), call by call', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  const row = (...ids: string[]) => ({
    type: ComponentType.ActionRow,
    components: ids.map(id => ({ type: ComponentType.Button, style: 1, custom_id: id, label: id })),
  })

  describe('reading answers made around it', () => {
    it('reports a raw reply in its state, before any call of its own', async () => {
      const interaction = command()
      await interaction.reply('raw')

      expect(respond(interaction).state).toBe('replied')
    })

    it('deletes, follows up and refuses a modal after a raw acknowledgement it did not make', async () => {
      const deleted = command()
      await deleted.deferReply()
      await respond(deleted).delete()
      expect(deleted.deleteReply).toHaveBeenCalled()

      const followed = command()
      await followed.deferReply()
      await respond(followed).followUp('done')
      expect(sent(followed.editReply)).toMatchObject({ content: 'done' })

      const modal = button()
      await modal.deferUpdate()
      await expect(respond(modal).modal(new ModalBuilder().setCustomId('m').setTitle('M'))).rejects.toThrow(
        'A modal must be the first response',
      )
    })

    it('refuses a modal while its own acknowledgement is still in flight', async () => {
      const interaction = button()
      let finish!: () => void
      interaction.deferUpdate.mockImplementation(() => new Promise<never>(resolve => (finish = resolve as () => void)))
      const acknowledging = respond(interaction).acknowledge()

      await expect(respond(interaction).modal(new ModalBuilder().setCustomId('m').setTitle('M'))).rejects.toThrow(
        'A modal must be the first response',
      )
      finish()
      await acknowledging
    })
  })

  describe('acknowledge()', () => {
    it('returns a promise once the interaction is answered', async () => {
      const interaction = command()
      await respond(interaction).send('done')

      await expect(respond(interaction).acknowledge()).resolves.toBeUndefined()
    })

    it('passes on a rejection that carries no code, as it came', async () => {
      const nulled = command()
      nulled.deferReply.mockRejectedValueOnce(null)
      const empty = command()
      empty.deferReply.mockRejectedValueOnce(undefined)

      await expect(respond(nulled).acknowledge()).rejects.toBeNull()
      await expect(respond(empty).acknowledge()).rejects.toBeUndefined()
    })
  })

  describe('what send() returns and records', () => {
    it("returns the message Discord answers a reply and an update with, and records each call's payload", async () => {
      const reply = createMockMessage()
      const commandCall = command()
      commandCall.reply.mockResolvedValue({ resource: { message: reply } } as never)
      const update = createMockMessage()
      const buttonCall = button()
      buttonCall.update.mockResolvedValue({ resource: { message: update } } as never)

      expect(await respond(commandCall).send('hi')).toBe(reply)
      expect(await respond(buttonCall).send('updated')).toBe(update)
      expect(getResponse(commandCall).calls).toEqual([{ method: 'reply', payload: { content: 'hi', flags: 0 } }])
      expect(getResponse(buttonCall).calls).toEqual([{ method: 'update', payload: { content: 'updated', flags: 0 } }])
    })

    it('records the delete and the private follow-up that keep a follow-up off a public deferral', async () => {
      const interaction = command()
      await respond(interaction).acknowledge()

      await respond(interaction).followUp({ content: 'secret', flags: Ephemeral })
      // The deferral is gone: another follow-up is a message of its own, not an edit of it
      await respond(interaction).followUp('another')

      expect(getResponse(interaction).calls.map(call => call.method)).toEqual(['deferReply', 'deleteReply', 'followUp', 'followUp'])
    })

    it('records a delete', async () => {
      const interaction = command()
      await respond(interaction).send('x')

      await respond(interaction).delete()

      expect(getResponse(interaction).calls.at(-1)).toEqual({ method: 'deleteReply', payload: undefined })
    })
  })

  describe('flags on edits', () => {
    it('sets no SuppressEmbeds on an edit of a message that does not have it', async () => {
      const interaction = button(messageWith())
      await respond(interaction).acknowledge()

      await respond(interaction).edit('plain')

      expect(sent(interaction.editReply).flags).toBe(0)
    })

    it('keeps a message Components V2 once an edit made it so', async () => {
      const interaction = command()
      await respond(interaction).acknowledge()

      await respond(interaction).edit({ components: [], flags: IsComponentsV2 })
      await respond(interaction).edit('text is dropped now')

      expect(sent(interaction.editReply, 1)).toEqual({ flags: IsComponentsV2 })
    })

    it('names the flags it drops in development, and says nothing in production', async () => {
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
      const interaction = command()
      await respond(interaction).acknowledge()

      await respond(interaction).edit({ content: 'x', flags: SuppressNotifications } as never)
      expect(warn).toHaveBeenCalledWith('Dropped flags SuppressNotifications, which a edit cannot take.')

      warn.mockClear()
      vi.stubEnv('NODE_ENV', 'production')
      await respond(interaction).edit({ content: 'y', flags: SuppressNotifications } as never)
      expect(warn).not.toHaveBeenCalled()
    })
  })

  describe('the token', () => {
    const inGuild = (age: number) => {
      const message = messageWith()
      const interaction = button(message)
      Object.assign(interaction, { createdTimestamp: Date.now() - age, context: InteractionContextType.Guild })
      return { interaction, message }
    }

    it('rethrows a token error a second after the interaction was created', async () => {
      const { interaction, message } = inGuild(1000)
      await respond(interaction).acknowledge()
      interaction.editReply.mockRejectedValueOnce(createDiscordError(50027))

      await expect(respond(interaction).send('early')).rejects.toThrow('50027')
      expect(message.edit).not.toHaveBeenCalled()
    })

    it('takes a token error as expiry from exactly 14 minutes, and records the channel edit', async () => {
      vi.useFakeTimers({ now: Date.now(), toFake: ['Date'] })
      const { interaction, message } = inGuild(14 * 60 * 1000)
      await respond(interaction).acknowledge()
      interaction.editReply.mockRejectedValueOnce(createDiscordError(10015))

      await respond(interaction).send('late')

      expect(message.edit).toHaveBeenCalled()
      expect(getResponse(interaction).calls.map(call => call.method)).toEqual(['deferUpdate', 'editReply', 'message.edit'])
    })
  })

  describe('lock()', () => {
    it('keeps the snapshot as original', async () => {
      const interaction = button(messageWith({ embeds: [{ description: 'card' }], components: [row('refresh')] }))

      await respond(interaction).lock()

      expect(respond(interaction).original).toEqual({ components: [row('refresh')], embeds: [{ description: 'card' }] })
    })

    it('locks a message a raw deferred update acknowledged, since the message is still unanswered', async () => {
      const interaction = button(messageWith({ components: [row('refresh')] }))
      await interaction.deferUpdate()

      await respond(interaction).lock()

      expect(interaction.editReply).toHaveBeenCalled()
    })

    it('locks nothing on a message a raw update already answered', async () => {
      const interaction = button(messageWith({ components: [row('refresh')] }))
      await interaction.update({ content: 'raw' })

      await respond(interaction).lock()

      expect(interaction.editReply).not.toHaveBeenCalled()
      expect(respond(interaction).original).toBeUndefined()
    })

    // 40060 from our own acknowledgement means another process acknowledged it: the message is still ours to lock
    it('still locks after its own acknowledgement found the interaction acknowledged elsewhere', async () => {
      const interaction = button(messageWith({ components: [row('refresh')] }))
      interaction.deferUpdate.mockRejectedValueOnce(createDiscordError(40060))
      interaction.editReply.mockResolvedValue(createMockMessage() as never)

      await respond(interaction).lock()

      expect(interaction.editReply).toHaveBeenCalled()
    })

    it('adds the loading container to a Components V2 card only while it fits in 40 components', async () => {
      // A container with one text display: two components
      const texts = (count: number) => Array.from({ length: count }, () => ({ type: ComponentType.TextDisplay, content: 't' }))
      const fits = button(messageWith({ flags: IsComponentsV2, components: texts(38) }))
      const full = button(messageWith({ flags: IsComponentsV2, components: texts(39) }))

      await respond(fits).lock()
      await respond(full).lock()

      expect(sent(fits.editReply).components).toHaveLength(39)
      expect(sent(full.editReply).components).toHaveLength(39)
    })

    it('writes back the embeds without the loading view when send() leaves embeds out', async () => {
      const interaction = button(messageWith({ embeds: [{ description: 'card' }], components: [row('refresh')] }))
      await respond(interaction).lock()

      await respond(interaction).send({ content: 'done' })

      expect(sent(interaction.editReply, 1)).toMatchObject({ content: 'done', embeds: [{ description: 'card' }], components: [row('refresh')] })
    })
  })

  describe('error()', () => {
    const texts = (count: number) => Array.from({ length: count }, () => ({ type: ComponentType.TextDisplay, content: 't' }))

    it('adds the error to a private card at the limit, 10 embeds or 40 components, and not past it', async () => {
      const nine = button(messageWith({ flags: Ephemeral, embeds: Array.from({ length: 9 }, () => ({ description: 'p' })) }))
      const v2Fits = button(messageWith({ flags: Ephemeral | IsComponentsV2, components: texts(38) }))
      const v2Full = button(messageWith({ flags: Ephemeral | IsComponentsV2, components: texts(39) }))
      for (const interaction of [nine, v2Fits, v2Full]) await respond(interaction).acknowledge()

      for (const interaction of [nine, v2Fits, v2Full]) await respond(interaction).error(new Error('x'))

      expect(sent(nine.editReply).embeds).toHaveLength(10)
      expect(sent(v2Fits.editReply).components?.at(-1)).toMatchObject({ type: ComponentType.Container, id: RENDERED_CONTAINER_ID })
      expect(v2Full.editReply).not.toHaveBeenCalledWith(expect.objectContaining({ components: expect.arrayContaining([expect.objectContaining({ id: RENDERED_CONTAINER_ID })]) }))
      expect(sent(v2Full.followUp).flags).toBe(Ephemeral | IsComponentsV2)
    })

    it("tells the presenter a Components V2 message's mode", async () => {
      const modes: string[] = []
      const interaction = button(messageWith({ flags: IsComponentsV2 }))
      setPresenter(interaction.client, {
        loading: () => ({ text: 'x' }),
        error: context => {
          modes.push(context.mode)
          return { text: 'x' }
        },
      })
      await respond(interaction).acknowledge()

      await respond(interaction).error(new Error('x'))

      expect(modes).toEqual(['v2'])
    })

    // Already private, so one message: no delete and resend
    it('edits a private deferral into a private error', async () => {
      const interaction = command()
      await respond(interaction).acknowledge({ ephemeral: true })

      await respond(interaction).error(new Error('x'), { visibility: 'private' })

      expect(getResponse(interaction).calls.map(call => call.method)).toEqual(['deferReply', 'editReply'])
      expect(interaction.deleteReply).not.toHaveBeenCalled()
      expect(interaction.followUp).not.toHaveBeenCalled()
    })

    it('never deletes a reply the handler already sent, even for a private error', async () => {
      const interaction = command()
      await respond(interaction).send('public answer')

      await respond(interaction).error(new Error('x'), { visibility: 'private' })

      expect(interaction.deleteReply).not.toHaveBeenCalled()
      expect(sent(interaction.followUp).flags).toBe(Ephemeral)
    })
  })
})

describe("respond() under @Defer's timer and locks", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  const row = (...ids: string[]) => ({
    type: ComponentType.ActionRow,
    components: ids.map(id => ({ type: ComponentType.Button, style: 1, custom_id: id, label: id })),
  })
  const pending = () => new Promise<never>(() => {})

  describe('the timer', () => {
    it('acknowledges nothing while an update, a reply or a modal of its own is in flight', async () => {
      vi.useFakeTimers()
      const updating = button()
      updating.update.mockImplementation(pending)
      const replying = command()
      replying.reply.mockImplementation(pending)
      const opening = button()
      opening.showModal.mockImplementation(pending)
      for (const interaction of [updating, replying, opening]) responseOf(interaction).scheduleAcknowledge(1000)

      void respond(updating).send('x')
      void respond(replying).send('x')
      void respond(opening).modal(new ModalBuilder().setCustomId('m').setTitle('M'))
      await vi.advanceTimersByTimeAsync(1000)

      expect(updating.deferUpdate).not.toHaveBeenCalled()
      expect(replying.deferReply).not.toHaveBeenCalled()
      expect(opening.deferUpdate).not.toHaveBeenCalled()
    })

    it('applies a lock asked for before it fired, with the controls asked for', async () => {
      vi.useFakeTimers()
      const interaction = button(messageWith({ components: [row('refresh', 'other')] }))
      Object.assign(interaction, { customId: 'refresh' })
      interaction.editReply.mockResolvedValue(createMockMessage() as never)
      responseOf(interaction).scheduleAcknowledge(1000)

      await respond(interaction).lock({ disable: 'clicked' })
      expect(interaction.editReply).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1000)

      const buttons = (sent(interaction.editReply).components?.[0] as unknown as { components: { disabled?: boolean }[] }).components
      expect(buttons.map(node => node.disabled)).toEqual([true, undefined])
    })

    it('warns in development when a raw discord.js call answered first, and never otherwise', async () => {
      vi.useFakeTimers()
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
      const raw = command()
      const through = command()
      for (const interaction of [raw, through]) responseOf(interaction).scheduleAcknowledge(1000)

      await raw.reply('raw')
      await respond(through).send('through respond')
      await vi.advanceTimersByTimeAsync(1000)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn).toHaveBeenCalledWith(
        'An interaction under @Defer was answered with a raw discord.js call; answer through respond(interaction) so its state stays in step.',
      )

      warn.mockClear()
      vi.stubEnv('NODE_ENV', 'production')
      const quiet = command()
      responseOf(quiet).scheduleAcknowledge(1000)
      await quiet.reply('raw')
      await vi.advanceTimersByTimeAsync(1000)
      expect(warn).not.toHaveBeenCalled()
    })
  })

  describe('release() and abandon()', () => {
    it("never acknowledges a command whose handler returned before the timer: Discord's own failure says more", async () => {
      vi.useFakeTimers()
      const interaction = command()
      responseOf(interaction).scheduleAcknowledge(1000)

      await responseOf(interaction).release()
      await vi.advanceTimersByTimeAsync(1000)

      expect(interaction.deferReply).not.toHaveBeenCalled()
    })

    it("defers a command denied before the timer privately, so nobody sees it before it is deleted", async () => {
      vi.useFakeTimers()
      const interaction = command()
      responseOf(interaction).scheduleAcknowledge(1000)

      await responseOf(interaction).abandon()

      expect(sent(interaction.deferReply).flags).toBe(Ephemeral)
      expect(interaction.deleteReply).toHaveBeenCalled()
    })

    it('warns on release about a raw answer only, never about one made through it or no answer', async () => {
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
      const raw = command()
      await raw.reply('raw')
      const through = command()
      await respond(through).send('answered')
      const none = command()

      for (const interaction of [raw, through, none]) await responseOf(interaction).release()

      expect(warn).toHaveBeenCalledTimes(1)
    })

    it("never deletes a component's message a raw acknowledgement deferred", async () => {
      const interaction = button()
      await interaction.deferUpdate()

      await responseOf(interaction).abandon()

      expect(interaction.deleteReply).not.toHaveBeenCalled()
    })

    it("never deletes a component's message: its acknowledgement left nothing to undo", async () => {
      const interaction = button()
      await respond(interaction).acknowledge()

      await responseOf(interaction).abandon()

      expect(interaction.deleteReply).not.toHaveBeenCalled()
    })
  })

  describe('a message two calls hold', () => {
    function shared(components: unknown[]) {
      let current = components
      const read = () => Object.assign(messageWith({ components: current }), { id: `shared-${Math.random()}` })
      const message = read()
      const clickOn = (customId: string) => {
        const interaction = createMockInteraction(ButtonInteraction, { customId, message })
        interaction.editReply.mockImplementation(async payload => {
          current = ((payload as Payload).components ?? current) as unknown[]
          return Object.assign(messageWith({ components: current }), { id: message.id }) as never
        })
        interaction.fetchReply.mockImplementation(async () => Object.assign(messageWith({ components: current }), { id: message.id }) as never)
        return interaction
      }
      return { clickOn, current: () => current as { components: { custom_id: string; disabled?: boolean; label?: string }[] }[] }
    }

    it("keeps the other call's control disabled in an answer, and its new components once that call settles", async () => {
      const message = shared([row('a', 'b')])
      const first = message.clickOn('a')
      const second = message.clickOn('b')
      await respond(first).acknowledge()
      await respond(second).acknowledge()
      await respond(first).lock({ disable: 'clicked' })
      await respond(second).lock({ disable: 'clicked' })

      await respond(first).send({ components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('a').setLabel('A done').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('b').setLabel('b').setStyle(ButtonStyle.Primary),
      )] })
      expect(message.current()[0].components.map(({ label, disabled }) => [label, disabled])).toEqual([['A done', undefined], ['b', true]])

      await responseOf(second).release()
      expect(message.current()[0].components.map(({ label, disabled }) => [label, disabled])).toEqual([['A done', undefined], ['b', undefined]])
    })
  })

  it("settles the other call onto the embeds an answer sent", async () => {
    const message = Object.assign(messageWith({ embeds: [{ description: 'card' }], components: [row('a', 'b')] }), { id: 'embeds-shared' })
    const first = createMockInteraction(ButtonInteraction, { customId: 'a', message })
    const second = createMockInteraction(ButtonInteraction, { customId: 'b', message })
    for (const interaction of [first, second]) {
      interaction.editReply.mockResolvedValue(createMockMessage() as never)
      interaction.fetchReply.mockRejectedValue(new Error('not readable'))
      await respond(interaction).acknowledge()
      await respond(interaction).lock({ disable: 'clicked' })
    }

    await respond(first).send({ embeds: [{ description: 'A result' }] })
    await responseOf(second).release()

    // The answer as sent, the theme's primary colour filled in
    expect(sent(second.editReply, 1).embeds).toEqual([{ description: 'A result', color: resolveColor(DEFAULT_THEME.colors.primary) }])
  })

  describe('the lock registry', () => {
    it('forgets a message at once when something else changed it', async () => {
      const interaction = button(Object.assign(messageWith({ components: [row('refresh')] }), { id: 'changed-outside' }))
      await respond(interaction).lock()
      const held = lockedMessageCount()
      // Edited after the lock, as Discord stamps an edit something else makes
      interaction.fetchReply.mockResolvedValue(Object.assign(messageWith({ components: [row('someone-else')] }), { editedTimestamp: Date.now() + 60_000 }) as never)

      await responseOf(interaction).release()

      expect(lockedMessageCount()).toBe(held - 1)
    })

    it('forgets a private card answered with the error added, once the memory window passes', async () => {
      vi.useFakeTimers()
      const interaction = button(Object.assign(messageWith({ flags: Ephemeral, components: [row('refresh')] }), { id: 'private-card' }))
      interaction.editReply.mockResolvedValue(createMockMessage() as never)
      await respond(interaction).lock()
      const held = lockedMessageCount()

      await respond(interaction).error(new Error('x'))
      await vi.advanceTimersByTimeAsync(LOCK_MEMORY_MS)

      expect(lockedMessageCount()).toBe(held - 1)
    })
  })
})

describe('respond() when Discord refuses what @Defer does on its own', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  const row = { type: ComponentType.ActionRow, components: [{ type: ComponentType.Button, style: 1, custom_id: 'refresh', label: 'r' }] }

  it('logs a failed acknowledgement when the timer fires, without an unhandled rejection', async () => {
    vi.useFakeTimers()
    const debug = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined)
    const interaction = button()
    interaction.deferUpdate.mockRejectedValueOnce(createDiscordError(10062))
    responseOf(interaction).scheduleAcknowledge(1000)

    await vi.advanceTimersByTimeAsync(1000)

    expect(debug).toHaveBeenCalledWith(expect.stringMatching(/^Could not acknowledge in time: DiscordAPIError.*10062/))
  })

  it("logs a failed acknowledgement when the call ends before the timer, and never throws", async () => {
    vi.useFakeTimers()
    const debug = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined)
    const interaction = button()
    interaction.deferUpdate.mockRejectedValueOnce(createDiscordError(10062))
    responseOf(interaction).scheduleAcknowledge(1000)

    await expect(responseOf(interaction).release()).resolves.toBeUndefined()

    expect(debug).toHaveBeenCalledWith(expect.stringMatching(/^Could not acknowledge: DiscordAPIError.*10062/))
    expect(respond(interaction).state).toBe('unanswered')
  })

  it('logs a restore Discord refuses, and never throws', async () => {
    const debug = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined)
    const interaction = button(messageWith({ components: [row] }))
    interaction.fetchReply.mockRejectedValue(new Error('not readable'))
    await respond(interaction).lock()
    interaction.editReply.mockRejectedValueOnce(createDiscordError(10008))

    await expect(responseOf(interaction).release()).resolves.toBeUndefined()

    expect(debug).toHaveBeenCalledWith(expect.stringMatching(/^Could not restore the message: DiscordAPIError.*10008/))
  })

  it("logs a deferred reply Discord will not delete after a silent denial, and never throws", async () => {
    const debug = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined)
    const interaction = command()
    await respond(interaction).acknowledge()
    interaction.deleteReply.mockRejectedValueOnce(createDiscordError(10008))

    await expect(responseOf(interaction).abandon()).resolves.toBeUndefined()

    expect(debug).toHaveBeenCalledWith(expect.stringMatching(/^Could not delete the deferred reply: DiscordAPIError.*10008/))
  })
})

describe('respond(), the last details', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('names every flag it drops, separated', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const interaction = command()
    await respond(interaction).acknowledge()

    await respond(interaction).edit({ content: 'x', flags: SuppressNotifications | Ephemeral } as never)

    expect(warn).toHaveBeenCalledWith('Dropped flags Ephemeral, SuppressNotifications, which a edit cannot take.')
  })

  it('sends exactly the flags a payload sets, even on a message with suppressed embeds', async () => {
    const interaction = button(messageWith({ flags: SuppressEmbeds }))
    await respond(interaction).acknowledge()

    await respond(interaction).edit({ content: 'x', flags: [] })

    expect(sent(interaction.editReply).flags).toBe(0)
  })

  it("acknowledges nothing when the timer fires while error()'s own reply is in flight", async () => {
    vi.useFakeTimers()
    const interaction = command()
    interaction.reply.mockImplementation(() => new Promise<never>(() => {}))
    responseOf(interaction).scheduleAcknowledge(1000)

    void respond(interaction).error(new Error('x'))
    await vi.advanceTimersByTimeAsync(1000)

    expect(interaction.deferReply).not.toHaveBeenCalled()
  })

  it('keeps the flags an update asks for, and a Components V2 update in later edits', async () => {
    const suppressed = button()
    await respond(suppressed).send({ content: 'x', flags: SuppressEmbeds })
    const v2 = button()
    await respond(v2).send({ components: [], flags: IsComponentsV2 })
    await respond(v2).edit('text is dropped')

    expect(sent(suppressed.update).flags).toBe(SuppressEmbeds)
    expect(sent(v2.editReply)).toEqual({ flags: IsComponentsV2 })
  })

  // Discord gives every component an id, so what it returns differs from what was sent
  it('restores a locked message Discord returned with component ids', async () => {
    const row = { type: ComponentType.ActionRow, components: [{ type: ComponentType.Button, style: 1, custom_id: 'refresh', label: 'r' }] }
    const interaction = button(messageWith({ components: [row] }))
    let current: unknown[] = []
    interaction.editReply.mockImplementation(async payload => {
      const withIds = ((payload as Payload).components ?? []).map((component, index) => ({ ...component, id: index + 1 }))
      current = withIds
      return messageWith({ components: withIds }) as never
    })
    interaction.fetchReply.mockImplementation(async () => messageWith({ components: current }) as never)
    await respond(interaction).lock()

    await responseOf(interaction).release()

    expect(interaction.editReply).toHaveBeenCalledTimes(2)
  })

  it('logs, and never throws, when its follow-up after a 40060 fails too', async () => {
    const debug = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined)
    const interaction = command()
    interaction.reply.mockRejectedValueOnce(createDiscordError(40060))
    interaction.followUp.mockRejectedValueOnce(createDiscordError(10015))

    await expect(respond(interaction).error(new Error('x'))).resolves.toBeUndefined()

    expect(debug).toHaveBeenCalledWith(expect.stringMatching(/^Could not deliver the error reply: DiscordAPIError.*10015/))
  })

  it('answers an unanswered component on a private message with a private reply, never an edit', async () => {
    const interaction = button(messageWith({ flags: Ephemeral, embeds: [{ description: 'card' }] }))

    await respond(interaction).error(new Error('x'))

    expect(sent(interaction.reply).flags).toBe(Ephemeral)
    expect(interaction.editReply).not.toHaveBeenCalled()
  })
})

describe('respond(), answers asked for together', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const modal = new ModalBuilder().setCustomId('m').setTitle('M')

  it('makes answers asked for at once in order, each from where the last left the interaction', async () => {
    const sends = command()
    const mixed = command()
    const fallback = command()

    await Promise.all([respond(sends).send('first'), respond(sends).send('second')])
    await Promise.all([respond(mixed).send('answer'), respond(mixed).followUp('more')])
    void respond(fallback).send('answer')
    await responseOf(fallback).presentAnswer(new Error('x'))

    expect(getResponse(sends).calls.map(call => call.method)).toEqual(['reply', 'editReply'])
    expect(sent(sends.editReply)).toMatchObject({ content: 'second' })
    expect(getResponse(mixed).calls.map(call => call.method)).toEqual(['reply', 'followUp'])
    expect(getResponse(fallback).calls.map(call => call.method)).toEqual(['reply', 'followUp'])
  })

  it('replies after an acknowledgement Discord failed, rather than throwing its error again', async () => {
    const interaction = command()
    interaction.deferReply.mockRejectedValueOnce(new Error('ECONNRESET'))
    await expect(respond(interaction).acknowledge()).rejects.toThrow('ECONNRESET')

    await respond(interaction).send('answer')

    expect(sent(interaction.reply)).toMatchObject({ content: 'answer' })
    expect(respond(interaction).state).toBe('replied')
  })

  it('acknowledges again after an acknowledgement that failed before reaching Discord', async () => {
    const interaction = command()
    const state = respond(interaction)
    // Thrown as the acknowledgement picks its Discord call, before any of it is awaited
    interaction.isCommand.mockImplementationOnce(() => {
      throw new Error('picked nothing')
    })
    await expect(state.acknowledge()).rejects.toThrow('picked nothing')

    await state.acknowledge()

    expect(interaction.deferReply).toHaveBeenCalledTimes(1)
    expect(state.state).toBe('deferred')
  })

  // discord.js refuses an edit or a follow-up while it holds the interaction unanswered, as it does after a 40060
  it('takes a reply or an update refused with 40060 as answered elsewhere, so the next send edits', async () => {
    const replied = command()
    replied.reply.mockRejectedValueOnce(createDiscordError(40060))
    const updated = button()
    updated.update.mockRejectedValueOnce(createDiscordError(40060))

    for (const interaction of [replied, updated]) {
      await expect(respond(interaction).send('first')).rejects.toMatchObject({ code: 40060 })
      expect(respond(interaction).state).toBe('replied')
      await respond(interaction).send('second')
    }

    expect(sent(replied.editReply)).toMatchObject({ content: 'second' })
    expect(sent(updated.editReply)).toMatchObject({ content: 'second' })
  })

  it('takes a modal refused with 40060 as answered elsewhere too, so the next send edits rather than failing the same way', async () => {
    const interaction = command()
    interaction.showModal.mockRejectedValueOnce(createDiscordError(40060))

    await expect(respond(interaction).modal(modal)).rejects.toMatchObject({ code: 40060 })
    expect(respond(interaction).state).toBe('replied')
    await respond(interaction).send('answer')

    expect(getResponse(interaction).calls.map(call => call.method)).toEqual(['showModal', 'editReply'])
  })

  it('reaches Discord with the follow-up and the edit it makes after a 40060, which discord.js did not see', async () => {
    const erred = command()
    erred.reply.mockRejectedValueOnce(createDiscordError(40060))
    const acknowledged = command()
    acknowledged.deferReply.mockRejectedValueOnce(createDiscordError(40060))

    await respond(erred).error(new Error('x'))
    await respond(acknowledged).acknowledge()
    await respond(acknowledged).send('answer')

    expect(getResponse(erred).calls.filter(call => 'error' in call).map(call => call.method)).toEqual(['reply'])
    expect(getResponse(acknowledged).calls.filter(call => 'error' in call).map(call => call.method)).toEqual(['deferReply'])
    expect(sent(acknowledged.editReply)).toMatchObject({ content: 'answer' })
  })

  it("refuses to send, edit or delete after a modal, which has no message, and points at the modal's submit", async () => {
    const interaction = command()
    await respond(interaction).modal(modal)

    await expect(respond(interaction).send('x')).rejects.toThrow("answer the modal's submit instead")
    await expect(respond(interaction).edit('x')).rejects.toThrow("answer the modal's submit instead")
    await expect(respond(interaction).delete()).rejects.toThrow("answer the modal's submit instead")

    expect(getResponse(interaction).calls.map(call => call.method)).toEqual(['showModal'])
  })

  it('answers an error after a modal with a private follow-up, never an edit of the clicked message', async () => {
    const interaction = button(messageWith({ flags: Ephemeral, embeds: [{ description: 'card' }] }))
    await respond(interaction).modal(modal)

    await respond(interaction).error(new Error('x'))

    expect(getResponse(interaction).calls.map(call => call.method)).toEqual(['showModal', 'followUp'])
    expect(sent(interaction.followUp).flags).toBe(Ephemeral)
  })
})
