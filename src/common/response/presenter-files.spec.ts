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
import { LOADING_DRAW_TIMEOUT_MS } from '@src/core/theme-resolvers.js'
import { createDiscordError, createMockInteraction, createMockMessage, createMockUser, MeoCordTestingModule } from '@src/testing/index.js'

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

describe('a send Discord refuses as too large', () => {
  // A path or a stream has no size to check before sending, and a limit can be lower than the interaction says
  const TOO_LARGE = 40005

  it("answers a command with the view again, without its files", async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const interaction = command(presenting(() => [card()]))
    interaction.reply.mockRejectedValueOnce(createDiscordError(TOO_LARGE))

    await respond(interaction).error(new Error('x'), { message: 'Broken.' })

    const [first, again] = [sent(interaction.reply, 0), sent(interaction.reply, 1)]
    expect(names(first)).toEqual(['card.png'])
    expect(names(again)).toEqual([])
    expect(again.embeds?.[0]).toMatchObject({ description: 'Broken.' })
    expect(again.embeds?.[0]).not.toHaveProperty('image')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('too large'))
  })

  it('locks a message with the loading view again, without its files', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const interaction = button(presenting(() => [card()]))
    interaction.editReply.mockRejectedValueOnce(createDiscordError(TOO_LARGE))

    await respond(interaction).lock()

    expect(names(sent(interaction.editReply, 0))).toEqual(['card.png'])
    expect(names(sent(interaction.editReply, 1))).toEqual([])
  })

  it("answers a message command with the drawn view again, without its files", async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const module = MeoCordTestingModule.create({ app: DiceApp, controllers: [DiceController] }).compile()
    const message = createMockMessage({ content: '!refuse' })
    message.reply.mockRejectedValueOnce(createDiscordError(TOO_LARGE))

    await module.dispatch(message)

    const [first, again] = [message.reply.mock.calls[0]?.[0] as Payload, message.reply.mock.calls[1]?.[0] as Payload]
    expect(names(first)).toEqual(['card.png'])
    expect(names(again)).toEqual([])
    expect(again.embeds?.[0]).toMatchObject({ description: '⚠️ Not today.' })
    expect(again.embeds?.[0]).not.toHaveProperty('image')
  })
})

describe('a presenter without messageError', () => {
  // A cooldown notice prints its end as <t:…:R>, so both runs read one clock that does not move between them
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

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

describe('a messageError that fails', () => {
  @Service()
  class ThrowingPresenter implements ResponsePresenter {
    loading() {
      return { text: 'Drawing…' }
    }

    error(_context: unknown, { message }: PresentedError) {
      return { text: message }
    }

    messageError(): ResponseView {
      throw new Error('canvas broke')
    }
  }

  @Service()
  class RejectingPresenter extends ThrowingPresenter {
    override messageError(): ResponseView {
      return Promise.reject(new Error('canvas broke')) as never
    }
  }

  @MeoCord({ controllers: [DiceController], presenter: ThrowingPresenter, messages: MESSAGES, clientOptions: { intents: [] } })
  class ThrowingApp {}

  @MeoCord({ controllers: [DiceController], presenter: RejectingPresenter, messages: MESSAGES, clientOptions: { intents: [] } })
  class RejectingApp {}

  /** The reply to a usage error and the direct message of a failing command, under an app. */
  async function answers(App: new () => unknown) {
    const module = MeoCordTestingModule.create({ app: App, controllers: [DiceController] }).compile()
    const usage = createMockMessage({ content: '!roll many' })
    const broken = createMockMessage({ content: '!broken' })
    await module.dispatch(usage).catch(() => undefined)
    await module.dispatch(broken).catch(() => undefined)
    return JSON.parse(JSON.stringify([usage.reply.mock.calls, broken.author.send.mock.calls]).replace(/<#\d+>/g, '<#channel>'))
  }

  it.each([
    ['throws', ThrowingApp],
    ['rejects', RejectingApp],
  ])("answers in MeoCord's plain text when it %s, and reports the failure as the call's fault", async (_how, App) => {
    const errors = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)

    const answered = await answers(App)

    expect(answered).toEqual(await answers(PlainApp))
    expect(answered.flat(2).length).toBe(2)
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('Could not write the usage reply'), expect.objectContaining({ message: 'canvas broke' }))
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('Could not write the direct message'), expect.objectContaining({ message: 'canvas broke' }))
  })

  // A bot's own tests catch a broken messageError, as they do a broken error()
  it('rejects the dispatch with the failure, once the plain text is sent', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    const module = MeoCordTestingModule.create({ app: ThrowingApp, controllers: [DiceController] }).compile()
    const message = createMockMessage({ content: '!roll many' })

    await expect(module.dispatch(message)).rejects.toThrow('canvas broke')
    expect(message.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Usage: !roll <sides>') }))
  })
})

describe('a messageError view MeoCord cannot render', () => {
  let drawn: ResponseView = { text: '' }

  @Service()
  class UnrenderablePresenter implements ResponsePresenter {
    loading() {
      return { text: 'Drawing…' }
    }

    error(_context: unknown, { message }: PresentedError) {
      return { text: message }
    }

    messageError(): ResponseView {
      return drawn
    }
  }

  const plainMessages = { prefix: '!', dmOnError: true }

  @MeoCord({ controllers: [DiceController], presenter: UnrenderablePresenter, messages: plainMessages, clientOptions: { intents: [] } })
  class UnrenderableApp {}

  @MeoCord({ controllers: [DiceController], messages: plainMessages, clientOptions: { intents: [] } })
  class PlainTextApp {}

  /** What a message gets back under an app. */
  async function replyTo(App: new () => unknown, content: string) {
    const module = MeoCordTestingModule.create({ app: App, controllers: [DiceController] }).compile()
    const message = createMockMessage({ content })
    await module.dispatch(message).catch(() => undefined)
    return [message.reply.mock.calls, message.author.send.mock.calls]
  }

  it.each([
    // One for each call site that reports the failure: the usage reply, and a UserError's reply
    ['a colour that is no colour', { text: 'hi', color: 'notacolor' }, '!roll many'],
    ['an empty text, which an embed cannot hold', { text: '' }, '!refuse'],
  ])("answers in MeoCord's plain text for %s, and reports the failure", async (_case, view, content) => {
    const errors = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    drawn = view as ResponseView

    const answered = await replyTo(UnrenderableApp, content)

    expect(answered).toEqual(await replyTo(PlainTextApp, content))
    expect(answered.flat(2).length).toBe(1)
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('Could not write the'), expect.anything())
  })
})

describe("an interaction presenter's view that fails", () => {
  const failing = (fail: () => ResponseView | Promise<ResponseView>) => ({ loading: fail, error: fail }) as ResponsePresenter

  it.each([
    ['throws', () => {
      throw new Error('canvas broke')
    }],
    // A view MeoCord cannot render, which the render check before sending catches, as it would an empty text
    ['returns a colour that is no colour', () => ({ text: 'hi', color: 'notacolor' }) as unknown as ResponseView],
  ])("answers an error with MeoCord's own view when it %s, and reports the fault", async (_case, fail) => {
    const errors = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    const interaction = command(failing(fail))

    await respond(interaction).error(new Error('x'), { message: 'Broken.' })

    expect(sent(interaction.reply).embeds?.[0]).toMatchObject({ title: 'Oops!', description: 'Broken.' })
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('Could not write the error answer'), expect.anything())
  })

  it.each([
    ['throws', () => {
      throw new Error('canvas broke')
    }],
    ['rejects', () => Promise.reject(new Error('canvas broke'))],
    ['returns a colour that is no colour', () => ({ text: 'hi', color: 'notacolor' }) as unknown as ResponseView],
  ])("locks with MeoCord's own loading view when the presenter's %s, warning with its name", async (_case, fail) => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const interaction = button(failing(fail))

    await respond(interaction).lock()

    expect(interaction.deferUpdate).toHaveBeenCalled()
    expect(sent(interaction.editReply).embeds?.at(-1)).toMatchObject({ description: expect.stringContaining('Working on it…') })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('loading'), expect.anything())
  })
})

// A loading view that never comes would hold the lock, and the handler after it, forever
describe('a loading view the presenter is slow to draw', () => {
  afterEach(() => vi.useRealTimers())

  function drawing() {
    const pending = Promise.withResolvers<ResponseView>()
    return { pending, presenter: { loading: () => pending.promise, error: () => ({ text: 'x' }) } as ResponsePresenter }
  }

  it('is shown when it comes within the deadline, and leaves no timer behind', async () => {
    vi.useFakeTimers()
    const { pending, presenter } = drawing()
    const interaction = button(presenter)

    const locked = respond(interaction).lock()
    await vi.advanceTimersByTimeAsync(LOADING_DRAW_TIMEOUT_MS - 1)
    pending.resolve({ text: 'Brewing…' })
    await locked

    expect(sent(interaction.editReply).embeds?.at(-1)).toMatchObject({ description: 'Brewing…' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it("shows MeoCord's own after the deadline, warns once, and never puts the late view over it", async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const { pending, presenter } = drawing()
    const interaction = button(presenter)

    const locked = respond(interaction).lock()
    await vi.advanceTimersByTimeAsync(LOADING_DRAW_TIMEOUT_MS)
    await locked
    pending.resolve({ text: 'Brewing…' })
    await vi.advanceTimersByTimeAsync(LOADING_DRAW_TIMEOUT_MS)

    expect(interaction.editReply).toHaveBeenCalledTimes(1)
    expect(sent(interaction.editReply).embeds?.at(-1)).toMatchObject({ description: expect.stringContaining('Working on it…') })
    expect(warn).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`The presenter's loading view did not come within ${LOADING_DRAW_TIMEOUT_MS} ms`))
  })

  it('leaves no rejection unhandled when a drawing that missed the deadline fails later', async () => {
    vi.useFakeTimers()
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const { pending, presenter } = drawing()
    const interaction = button(presenter)
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)

    const locked = respond(interaction).lock()
    await vi.advanceTimersByTimeAsync(LOADING_DRAW_TIMEOUT_MS)
    await locked
    pending.reject(new Error('canvas broke late'))
    vi.useRealTimers()
    await new Promise(resolve => setTimeout(resolve, 0))
    process.off('unhandledRejection', unhandled)

    expect(unhandled).not.toHaveBeenCalled()
  })
})
