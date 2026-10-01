import {
  AttachmentBuilder,
  type APIEmbed,
  ButtonInteraction,
  ChatInputCommandInteraction,
  Collection,
  ComponentType,
  type Message,
  MessageFlags,
  MessageFlagsBitField,
} from 'discord.js'
import { vi } from 'vitest'
import { Logger } from '@src/common/logger.js'
import { respond, responseOf } from '@src/common/response/response-state.js'
import { setPresenter } from '@src/common/response/presenter.js'
import { type MessageResponseContext, type PresentedError, type ResponsePresenter, type ResponseView } from '@src/interface/index.js'
import { Controller, Cooldown, MeoCord, MessageHandler, Service } from '@src/decorator/index.js'
import { UserError } from '@src/common/errors.js'
import { createMockInteraction, createMockMessage, createMockUser, MeoCordTestingModule } from '@src/testing/index.js'

const { Ephemeral, IsComponentsV2 } = MessageFlags

interface Payload {
  flags?: number
  embeds?: APIEmbed[]
  components?: { type: number; components?: { type: number; items?: unknown[]; file?: unknown }[] }[]
  files?: { name?: string | null }[]
  attachments?: { id?: string; name?: string | null }[]
}

const sent = (method: { mock: { calls: unknown[][] } }, call = 0) => method.mock.calls[call][0] as Payload
const names = (payload: Payload) => (payload.files ?? []).map(file => file.name)
const card = () => new AttachmentBuilder(Buffer.from('png'), { name: 'card.png' })

function messageWith(options: { flags?: number; embeds?: APIEmbed[]; attachments?: { id: string; name: string }[] } = {}): Message {
  const message = createMockMessage()
  Object.assign(message, {
    flags: new MessageFlagsBitField(options.flags ?? 0),
    embeds: (options.embeds ?? []).map(embed => ({ toJSON: () => embed })),
    components: [],
    attachments: new Collection((options.attachments ?? []).map(attachment => [attachment.id, attachment])),
  })
  return message as unknown as Message
}

/** A presenter whose views carry `files`, drawn at once or, when `drawn`, after a turn of the event loop. */
function presenting(files: () => ResponseView['files'], { drawn = false, components }: { drawn?: boolean; components?: ResponseView['components'] } = {}) {
  const view = (text: string): ResponseView => ({ text, files: files(), components })
  const later = <T>(value: T) => new Promise<T>(resolve => setTimeout(() => resolve(value), 5))
  return {
    loading: () => (drawn ? later(view('Drawing…')) : view('Drawing…')),
    error: (_context, { message }) => (drawn ? later(view(message)) : view(message)),
  } as ResponsePresenter
}

function command(presenter: ResponsePresenter) {
  const interaction = createMockInteraction(ChatInputCommandInteraction)
  setPresenter(interaction.client, presenter)
  return interaction
}

function button(presenter: ResponsePresenter, message = messageWith()) {
  const interaction = createMockInteraction(ButtonInteraction, { customId: 'refresh', message })
  setPresenter(interaction.client, presenter)
  return interaction
}

afterEach(() => vi.restoreAllMocks())

describe("a presenter's files", () => {
  it('are sent with an error, and the first image is the embed image', async () => {
    const interaction = command(presenting(() => [card(), { name: 'log.txt', data: Buffer.from('trace') }]))

    await respond(interaction).error(new Error('x'), { message: 'Broken.' })

    const payload = sent(interaction.reply)
    expect(names(payload)).toEqual(['card.png', 'log.txt'])
    expect(payload.embeds?.[0]).toMatchObject({ description: 'Broken.', image: { url: 'attachment://card.png' } })
  })

  it('are shown in a Components V2 container: images in a gallery, other files as files, after the text', async () => {
    const interaction = button(
      presenting(() => [card(), { name: 'log.txt', data: Buffer.from('trace') }]),
      messageWith({ flags: IsComponentsV2 }),
    )
    await respond(interaction).acknowledge()

    await respond(interaction).error(new Error('x'), { message: 'Broken.' })

    const payload = sent(interaction.followUp)
    expect(names(payload)).toEqual(['card.png', 'log.txt'])
    expect(payload.components?.[0]?.components?.map(component => component.type)).toEqual([
      ComponentType.TextDisplay,
      ComponentType.MediaGallery,
      ComponentType.File,
    ])
    expect(payload.components?.[0]?.components?.[1]?.items).toEqual([{ media: { url: 'attachment://card.png' } }])
    expect(payload.components?.[0]?.components?.[2]?.file).toEqual({ url: 'attachment://log.txt' })
  })

  it("are not shown twice when the view's own components show them", async () => {
    const gallery = { type: ComponentType.MediaGallery as const, items: [{ media: { url: 'attachment://card.png' } }] }
    const interaction = button(presenting(() => [card()], { components: [gallery] }), messageWith({ flags: IsComponentsV2 }))
    await respond(interaction).acknowledge()

    await respond(interaction).error(new Error('x'), { message: 'Broken.' })

    expect(sent(interaction.followUp).components?.[0]?.components?.map(component => component.type)).toEqual([
      ComponentType.TextDisplay,
      ComponentType.MediaGallery,
    ])
  })

  it("join a private card's own attachments when the error is added to it, which the edit keeps", async () => {
    const message = messageWith({ flags: Ephemeral, embeds: [{ description: 'p' }], attachments: [{ id: '1', name: 'chart.png' }] })
    const interaction = button(presenting(() => [card()]), message)
    await respond(interaction).acknowledge()

    await respond(interaction).error(new Error('x'), { message: 'Broken.' })

    const payload = sent(interaction.editReply)
    expect(names(payload)).toEqual(['card.png'])
    expect(payload.attachments).toEqual([expect.objectContaining({ id: '1' })])
  })

  it('leave a locked message when the loading view goes, keeping only its own attachments', async () => {
    const message = messageWith({ attachments: [{ id: '1', name: 'chart.png' }] })
    const interaction = button(presenting(() => [card()]), message)

    await respond(interaction).lock()
    await responseOf(interaction).release()

    const [loading, restored] = [sent(interaction.editReply, 0), sent(interaction.editReply, 1)]
    expect(names(loading)).toEqual(['card.png'])
    expect(loading.attachments).toEqual([expect.objectContaining({ id: '1' })])
    expect(names(restored)).toEqual([])
    expect(restored.attachments).toEqual([expect.objectContaining({ id: '1' })])
  })
})

describe('a presenter that draws its view asynchronously', () => {
  it('has a command acknowledged before the drawn error, which then edits the reply', async () => {
    const interaction = command(presenting(() => [card()], { drawn: true }))

    await respond(interaction).error(new Error('x'), { message: 'Broken.' })

    expect(interaction.reply).not.toHaveBeenCalled()
    expect(sent(interaction.deferReply).flags).toBe(Ephemeral)
    expect(names(sent(interaction.editReply))).toEqual(['card.png'])
  })

  it('draws the loading view after the lock acknowledges the click', async () => {
    const interaction = button(presenting(() => [card()], { drawn: true }))

    await respond(interaction).lock()

    expect(interaction.deferUpdate).toHaveBeenCalled()
    expect(names(sent(interaction.editReply))).toEqual(['card.png'])
  })
})

describe("Discord's attachment limits", () => {
  it('send a view with more than 10 files without them, and warn', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const interaction = command(presenting(() => Array.from({ length: 11 }, (_, i) => ({ name: `${i}.png`, data: Buffer.from('p') }))))

    await respond(interaction).error(new Error('x'), { message: 'Broken.' })

    const payload = sent(interaction.reply)
    expect(names(payload)).toEqual([])
    expect(payload.embeds?.[0]).toMatchObject({ description: 'Broken.' })
    expect(payload.embeds?.[0]).not.toHaveProperty('image')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('10 files'))
  })

  it("send a view with a file over the interaction's size limit without its files, and warn", async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const interaction = command(presenting(() => [{ name: 'big.png', data: Buffer.alloc(11) }]))
    Object.assign(interaction, { attachmentSizeLimit: 10 })

    await respond(interaction).error(new Error('x'), { message: 'Broken.' })

    expect(names(sent(interaction.reply))).toEqual([])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('big.png'))
  })
})

const contexts: MessageResponseContext[] = []

@Service()
class DrawingPresenter implements ResponsePresenter {
  loading() {
    return { text: 'Drawing…' }
  }

  error(_context: unknown, { message }: PresentedError) {
    return { text: message }
  }

  async messageError(context: MessageResponseContext, { message }: PresentedError) {
    contexts.push(context)
    await new Promise(resolve => setTimeout(resolve, 5))
    return { text: message, files: [card()] }
  }
}

/** A presenter for interactions alone, whose views carry files: without messageError, message replies stay text. */
@Service()
class InteractionPresenter implements ResponsePresenter {
  loading() {
    return { text: 'Drawing…', files: [card()] }
  }

  error(_context: unknown, { message }: PresentedError) {
    return { text: message, files: [card()] }
  }
}

@Controller()
class DiceController {
  @MessageHandler('roll {sides:int}')
  roll(_message: Message, _params: { sides: number }) {
    return undefined
  }

  @MessageHandler('broken')
  broken() {
    throw new Error('boom')
  }

  @MessageHandler('refuse')
  refuse() {
    throw new UserError('Not today.')
  }

  @MessageHandler('daily')
  @Cooldown({ seconds: 60 })
  daily() {
    return undefined
  }
}

const MESSAGES = { prefix: '!', dmOnError: true, dmOnCooldown: true, replyEmoji: true }

@MeoCord({ controllers: [DiceController], presenter: DrawingPresenter, messages: MESSAGES, clientOptions: { intents: [] } })
class DiceApp {}

@MeoCord({ controllers: [DiceController], presenter: InteractionPresenter, messages: MESSAGES, clientOptions: { intents: [] } })
class InteractionPresenterApp {}

@MeoCord({ controllers: [DiceController], messages: MESSAGES, clientOptions: { intents: [] } })
class PlainApp {}

describe("a message command's errors, in the presenter's messageError view", () => {
  const module = MeoCordTestingModule.create({ app: DiceApp, controllers: [DiceController] }).compile()
  beforeEach(() => (contexts.length = 0))

  it('answer a usage error with the drawn view, telling the presenter the message', async () => {
    const message = createMockMessage({ content: '!roll many' })

    await module.dispatch(message)

    const payload = message.reply.mock.calls[0]?.[0] as Payload & { allowedMentions?: unknown }
    // replyEmoji gives the view the theme's warning emoji, which this presenter's view leaves out
    expect(payload.embeds?.[0]).toMatchObject({ description: expect.stringMatching(/^⚠️ .*is not a valid whole number/s), image: { url: 'attachment://card.png' } })
    expect(names(payload)).toEqual(['card.png'])
    expect(payload.allowedMentions).toEqual({ repliedUser: false, parse: [] })
    expect(contexts[0]).toMatchObject({ message, mode: 'embed', locale: 'en-US' })
  })

  it("answer a UserError with the drawn view", async () => {
    const message = createMockMessage({ content: '!refuse' })

    await module.dispatch(message)

    const payload = message.reply.mock.calls[0]?.[0] as Payload
    expect(payload.embeds?.[0]).toMatchObject({ description: '⚠️ Not today.' })
    expect(names(payload)).toEqual(['card.png'])
  })

  it("send dmOnError's direct message in the drawn view", async () => {
    const message = createMockMessage({ content: '!broken' })

    await module.dispatch(message).catch(() => undefined)

    const payload = message.author.send.mock.calls[0]?.[0] as Payload & { allowedMentions?: unknown }
    expect(payload.embeds?.[0]?.description).toContain('!broken')
    expect(names(payload)).toEqual(['card.png'])
    expect(payload.allowedMentions).toEqual({ parse: [] })
  })

  it("send dmOnCooldown's direct message in the drawn view", async () => {
    const author = createMockUser()
    await module.dispatch(createMockMessage({ content: '!daily', author }))
    const again = createMockMessage({ content: '!daily', author })

    await module.dispatch(again).catch(() => undefined)

    const payload = again.author.send.mock.calls[0]?.[0] as Payload
    expect(payload.embeds?.[0]?.description).toContain('!daily')
    expect(names(payload)).toEqual(['card.png'])
  })
})

describe('a presenter without messageError', () => {
  /** What the bot sends for each message, the replies and direct messages, under an app. */
  async function answers(App: new () => unknown) {
    const module = MeoCordTestingModule.create({ app: App, controllers: [DiceController] }).compile()
    const author = createMockUser()
    const sent: unknown[] = []
    for (const content of ['!roll many', '!refuse', '!broken', '!daily', '!daily']) {
      const message = createMockMessage({ content, author })
      await module.dispatch(message).catch(() => undefined)
      sent.push(message.reply.mock.calls, message.author.send.mock.calls)
    }
    // Each mock message has a channel of its own, which the direct messages name
    return JSON.parse(JSON.stringify(sent).replace(/<#\d+>/g, '<#channel>'))
  }

  it("leaves a message command's replies and direct messages exactly as they are without a presenter", async () => {
    const plain = await answers(PlainApp)

    expect(await answers(InteractionPresenterApp)).toEqual(plain)
    expect(plain.flat(2).length).toBeGreaterThan(0)
  })
})
