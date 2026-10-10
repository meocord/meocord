import { type APIEmbed, ButtonInteraction, ChatInputCommandInteraction, Collection, type Message, MessageFlags, MessageFlagsBitField } from 'discord.js'
import { vi } from 'vitest'
import { UserError } from '@src/common/errors.js'
import { Logger } from '@src/common/logger.js'
import { setPresenter } from '@src/common/response/presenter.js'
import { respond } from '@src/common/response/response-state.js'
import { Command, Controller, MeoCord, MessageHandler } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { type PresentedError, type ResponsePresenter } from '@src/interface/index.js'
import { createMockInteraction, createMockMessage, MeoCordTestingModule } from '@src/testing/index.js'

const GENERIC = 'An error occurred while executing the command.'

interface Payload {
  content?: string
  embeds?: APIEmbed[]
  components?: { components?: { content?: string; components?: { content?: string }[] }[] }[]
}

const sent = (method: { mock: { calls: unknown[][] } }) => method.mock.calls[0][0] as Payload
const description = (payload: Payload) => payload.embeds?.[0]?.description ?? ''
/** The text of the Text Display a Components V2 answer carries. */
const display = (payload: Payload) => payload.components?.at(-1)?.components?.[0]?.content ?? ''
const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

/** A presenter that passes the message through as its text, recording the message it was given. */
function passingThrough(view: { title?: string; emoji?: string } = {}) {
  const given: PresentedError[] = []
  const presenter: ResponsePresenter = {
    loading: () => ({ text: 'Working' }),
    error: (_context, presented) => (given.push(presented), { ...view, text: presented.message }),
    messageError: (_context, presented) => (given.push(presented), { ...view, text: presented.message }),
  }
  // As @MeoCord({ presenter }) takes it: a class
  class Presenter {
    loading = presenter.loading
    error = presenter.error
    messageError = presenter.messageError
  }
  return { presenter, given, Presenter }
}

function command(presenter?: ResponsePresenter) {
  const interaction = createMockInteraction(ChatInputCommandInteraction)
  if (presenter) setPresenter(interaction.client, presenter)
  return interaction
}

/** A button on a Components V2 message, whose answers are Components V2 too. */
function v2Button(presenter: ResponsePresenter) {
  const message = createMockMessage()
  Object.assign(message, { flags: new MessageFlagsBitField(MessageFlags.IsComponentsV2), embeds: [], components: [], attachments: new Collection() })
  const interaction = createMockInteraction(ButtonInteraction, { customId: 'refresh', message: message as unknown as Message })
  setPresenter(interaction.client, presenter)
  return interaction
}

beforeEach(() => vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {}))
afterEach(() => vi.restoreAllMocks())

describe("a user's outcome too long or empty for Discord", () => {
  it('answers a message over 4096 characters cut to fit, in its own colour and privately', async () => {
    const interaction = command()
    const message = 'x'.repeat(4097)

    await respond(interaction).error(new UserError(message))

    const payload = sent(interaction.reply)
    expect(description(payload)).toHaveLength(4096)
    expect(description(payload)).toBe(`${'x'.repeat(4095)}…`)
    expect(payload.embeds?.[0]?.color).toBe(11568128)
    expect(Number(MessageFlagsBitField.resolve((payload as { flags?: number }).flags ?? 0)) & MessageFlags.Ephemeral).toBeTruthy()
  })

  it('cuts on a code point, never splitting a surrogate pair', async () => {
    const interaction = command()

    await respond(interaction).error(new UserError('😀'.repeat(2049)))

    const text = description(sent(interaction.reply))
    expect(text.length).toBeLessThanOrEqual(4096)
    expect(text.endsWith('…')).toBe(true)
    expect(loneSurrogate.test(text)).toBe(false)
  })

  it('answers a UserError with no message in its own colour, with the generic text', async () => {
    const interaction = command()

    await respond(interaction).error(new UserError(''))

    const payload = sent(interaction.reply)
    expect(description(payload)).toBe(GENERIC)
    expect(payload.embeds?.[0]?.color).toBe(11568128)
  })

  it("gives an app's presenter the message fitted to an embed, so passing it through renders", async () => {
    const { presenter, given } = passingThrough({ emoji: '⚠️' })
    const interaction = command(presenter)

    await respond(interaction).error(new UserError('y'.repeat(5000)))

    expect(given.map(({ message }) => message.length)).toEqual([4096])
    expect(description(sent(interaction.reply)).length).toBeLessThanOrEqual(4096)
    expect(description(sent(interaction.reply)).startsWith('⚠️ y')).toBe(true)
  })

  it("gives an app's presenter an empty message as the generic text", async () => {
    const { presenter, given } = passingThrough()
    const interaction = command(presenter)

    await respond(interaction).error(new UserError(''))

    expect(given.map(({ message }) => message)).toEqual([GENERIC])
  })

  it('fits a Components V2 answer, title line included, within a Text Display', async () => {
    const { presenter, given } = passingThrough({ title: 'Not allowed' })
    const interaction = v2Button(presenter)

    await respond(interaction).error(new UserError('z'.repeat(5000)))

    expect(given.map(({ message }) => message.length)).toEqual([4000])
    const text = display(sent(interaction.reply))
    expect(text.length).toBeLessThanOrEqual(4000)
    expect(text.startsWith('### Not allowed\nz')).toBe(true)
  })

  it('is answered through dispatch, which resolves, rather than failing as a bot fault', async () => {
    @Controller()
    class Shop {
      @Command('buy', CommandType.SLASH)
      buy() {
        throw new UserError('w'.repeat(4097))
      }
    }
    const module = MeoCordTestingModule.create({ controllers: [Shop] }).compile()
    const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName: 'buy' })

    await expect(module.dispatch(interaction)).resolves.toMatchObject({ ran: true })
    expect(description(sent(interaction.reply))).toHaveLength(4096)
  })
})

describe("a message command's reply too long or empty for Discord", () => {
  @Controller()
  class Commands {
    @MessageHandler('long')
    long() {
      throw new UserError('v'.repeat(2121))
    }

    @MessageHandler('longer')
    longer() {
      throw new UserError('u'.repeat(5000))
    }

    @MessageHandler('empty')
    empty() {
      throw new UserError('')
    }
  }

  async function replyTo(content: string, presenter?: new () => ResponsePresenter, replyEmoji = false) {
    @MeoCord({ controllers: [Commands], messages: { prefix: '!', replyEmoji }, ...(presenter && { presenter }), clientOptions: { intents: [] } })
    class App {}
    const module = MeoCordTestingModule.fromApp(App).compile()
    const message = createMockMessage({ content })
    Object.assign(message.author, { bot: false })
    await module.dispatch(message)
    return sent(message.reply)
  }

  it('cuts a plain-text reply to 2000 characters, the warning emoji included', async () => {
    expect((await replyTo('!long')).content).toBe(`${'v'.repeat(1999)}…`)

    const withEmoji = (await replyTo('!long', undefined, true)).content ?? ''
    expect(withEmoji).toHaveLength(2000)
    expect(withEmoji.endsWith('v…')).toBe(true)
  })

  it('replies to an empty message with the generic text', async () => {
    expect((await replyTo('!empty')).content).toBe(GENERIC)
  })

  it("gives an app's messageError the message fitted to an embed", async () => {
    const { Presenter, given } = passingThrough()

    const payload = await replyTo('!longer', Presenter)

    expect(given.map(({ message }) => message.length)).toEqual([4096])
    expect(description(payload)).toHaveLength(4096)
  })
})
