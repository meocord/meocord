import {
  ButtonInteraction,
  ChatInputCommandInteraction,
  ComponentType,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuInteraction,
  TextDisplayBuilder,
} from 'discord.js'
import { vi } from 'vitest'
import { Logger } from '@src/common/logger.js'
import { UserError } from '@src/common/errors.js'
import { forgetDeprecationWarnings } from '@src/common/deprecation.js'
import { respond } from '@src/common/response/response-state.js'
import { RENDERED_CONTAINER_ID, setPresenter, setViewMode, viewModeFor } from '@src/common/response/presenter.js'
import { type PresentedError, type ResponseContext, type ResponsePresenter, type ResponseView } from '@src/interface/index.js'
import { createDiscordError, createMockInteraction, createMockMessage, getResponse } from '@src/testing/index.js'
import { forgetStrictMocks, useStrictMocks } from '@src/testing/strict-mocks.js'

const { Ephemeral, IsComponentsV2 } = MessageFlags

interface Payload {
  flags?: number
  content?: string
  embeds?: unknown[]
  components?: { type: number; id?: number; components?: { type: number; content?: string }[] }[]
  message?: string
}

let warned: string[]
beforeEach(() => {
  forgetStrictMocks()
  forgetDeprecationWarnings()
  useStrictMocks()
  warned = []
  vi.spyOn(Logger.prototype, 'warn').mockImplementation((text: unknown) => void warned.push(String(text)))
})
afterEach(() => vi.restoreAllMocks())
afterAll(() => forgetStrictMocks())

/** The payloads an interaction's answers sent, by method, as plain JSON. */
const calls = (interaction: object, method?: string): Payload[] =>
  getResponse(interaction as never)
    .calls.filter(call => method === undefined || call.method === method)
    .map(call => JSON.parse(JSON.stringify(call.payload ?? {})) as Payload)
const last = (interaction: object, method: string): Payload => calls(interaction, method).at(-1)!

const isContainer = (payload: Payload) =>
  payload.components?.[0]?.type === ComponentType.Container && payload.components[0].id === RENDERED_CONTAINER_ID && !('embeds' in payload)
const isEmbed = (payload: Payload) => (payload.embeds?.length ?? 0) > 0 && ((payload.flags ?? 0) & IsComponentsV2) === 0

/** A mock interaction on a client whose app answers with `mode`. */
function command(mode: 'embed' | 'v2' = 'v2') {
  const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName: 'ping' })
  setViewMode(interaction.client, mode)
  return interaction
}
function button(message = createMockMessage(), mode: 'embed' | 'v2' = 'v2') {
  const interaction = createMockInteraction(ButtonInteraction, { customId: 'refresh', message })
  setViewMode(interaction.client, mode)
  return interaction
}

/** A presenter that records the form each view is drawn for. */
function recordingPresenter(client: object, text = (message: string) => message): ResponseContext['mode'][] {
  const modes: ResponseContext['mode'][] = []
  const presenter: ResponsePresenter = {
    loading: () => ({ text: 'Working' }),
    error: (context: ResponseContext, { message }: PresentedError): ResponseView => {
      modes.push(context.mode)
      return { title: 'Oops', text: text(message) }
    },
  }
  setPresenter(client, presenter)
  return modes
}

describe("viewMode's registration", () => {
  it("is 'embed' for a client nothing set, and follows what is set", () => {
    const client = {}
    expect(viewModeFor(client)).toBe('embed')
    setViewMode(client, 'v2')
    expect(viewModeFor(client)).toBe('v2')
    setViewMode(client, 'embed')
    expect(viewModeFor(client)).toBe('embed')
  })
})

describe("viewMode: 'v2' for the messages MeoCord starts", () => {
  it('replies to an unanswered command with a private container, and tells the presenter', async () => {
    const interaction = command()
    const modes = recordingPresenter(interaction.client)

    await respond(interaction).error(new UserError('Not yours.'))

    const reply = last(interaction, 'reply')
    expect(isContainer(reply)).toBe(true)
    expect(reply.flags).toBe(Ephemeral | IsComponentsV2)
    expect(modes).toEqual(['v2'])
  })

  it("answers with MeoCord's own view when the presenter's text is too long for a container", async () => {
    const interaction = command()
    recordingPresenter(interaction.client, () => 'y'.repeat(4050))
    const failed = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)

    await respond(interaction).error(new UserError('Not yours.'))

    const reply = last(interaction, 'reply')
    expect(isContainer(reply)).toBe(true)
    expect(reply.components![0].components![0].content).not.toContain('yyyy')
    expect(failed).toHaveBeenCalledTimes(1)
  })

  it("replies with an embed, as before, under 'embed'", async () => {
    const interaction = command('embed')

    await respond(interaction).error(new UserError('Not yours.'))

    const reply = last(interaction, 'reply')
    expect(isEmbed(reply)).toBe(true)
    expect(reply.flags).toBe(Ephemeral)
  })

  it('follows up an answered command with a container', async () => {
    const interaction = command()
    await respond(interaction).send('first')

    await respond(interaction).error(new Error('down'))

    expect(isContainer(last(interaction, 'followUp'))).toBe(true)
    expect(last(interaction, 'followUp').flags).toBe(Ephemeral | IsComponentsV2)
  })

  it('follows up with a container when Discord refuses the reply as answered elsewhere (40060)', async () => {
    const interaction = command()
    interaction.reply.mockRejectedValueOnce(createDiscordError(40060))

    await respond(interaction).error(new Error('down'))

    expect(isContainer(last(interaction, 'followUp'))).toBe(true)
  })

  it("edits MeoCord's own deferral nothing was sent into into a container", async () => {
    const interaction = command()
    await respond(interaction).acknowledge()

    await respond(interaction).error(new Error('down'))

    const edit = last(interaction, 'editReply')
    expect(isContainer(edit)).toBe(true)
    expect(edit.flags).toBe(IsComponentsV2)
  })

  it("edits the app's own deferReply() nothing was sent into into a container", async () => {
    const interaction = command()
    await interaction.deferReply()

    await respond(interaction).error(new Error('down'))

    expect(isContainer(last(interaction, 'editReply'))).toBe(true)
  })

  it('edits the private deferral made for a slow presenter into a container', async () => {
    const interaction = command()
    setPresenter(interaction.client, { loading: () => ({ text: 'Working' }), error: async (_, { message }) => ({ text: message }) })

    await respond(interaction).error(new UserError('Not yours.'))

    expect(calls(interaction).map(call => call.flags)).toEqual([Ephemeral, IsComponentsV2])
    expect(isContainer(last(interaction, 'editReply'))).toBe(true)
  })

  it('replaces a public deferral with a private container, and edits it as V2 later', async () => {
    const interaction = command()
    await respond(interaction).acknowledge()
    await respond(interaction).error(new UserError('Not yours.'))
    const followUp = last(interaction, 'followUp')

    await respond(interaction).send({ embeds: [new EmbedBuilder().setDescription('card')], components: [new TextDisplayBuilder().setContent('card')] })

    expect(isContainer(followUp)).toBe(true)
    expect(getResponse(interaction).calls.map(call => call.method)).toEqual(['deferReply', 'deleteReply', 'followUp', 'editReply'])
    const edit = last(interaction, 'editReply')
    expect([edit.flags, 'embeds' in edit, typeof edit.message]).toEqual([IsComponentsV2, false, 'string'])
  })

  it('follows up a refused select-menu pick with a container, after the empty update that puts it back', async () => {
    const interaction = createMockInteraction(StringSelectMenuInteraction, { customId: 'pick', values: ['a'], message: createMockMessage() })
    setViewMode(interaction.client, 'v2')

    await respond(interaction).error(new UserError('Not that one.'))

    expect(calls(interaction, 'update')).toEqual([{}])
    expect(isContainer(last(interaction, 'followUp'))).toBe(true)
  })
})

describe("viewMode: 'v2' and the messages that already exist", () => {
  it("adds an error to a private embed message as an embed, the message's own form", async () => {
    const interaction = button(createMockMessage({ flags: Ephemeral, embeds: [{ description: 'card' }] }))
    const modes = recordingPresenter(interaction.client)
    await respond(interaction).acknowledge()

    await respond(interaction).error(new Error('down'))

    const edit = last(interaction, 'editReply')
    expect([edit.embeds?.length, (edit.flags ?? 0) & IsComponentsV2]).toEqual([2, 0])
    expect(modes).toEqual(['embed'])
  })

  it('draws the error again for a container when it does not fit the embed message, fitting its text to 4000', async () => {
    const full = Array.from({ length: 10 }, () => ({ description: 'card' }))
    const interaction = button(createMockMessage({ flags: Ephemeral, embeds: full }))
    const modes = recordingPresenter(interaction.client)
    await respond(interaction).acknowledge()

    await respond(interaction).error(new Error('down'), { message: 'x'.repeat(5000) })

    const followUp = last(interaction, 'followUp')
    expect(isContainer(followUp)).toBe(true)
    expect(modes).toEqual(['embed', 'v2'])
    const shown = followUp.components![0].components![0].content!
    expect(shown.length).toBeLessThanOrEqual(4000)
  })

  it("keeps a lock's loading view on an embed message an embed", async () => {
    const interaction = button(createMockMessage({ embeds: [{ description: 'card' }] }))

    await respond(interaction).lock()

    const edit = last(interaction, 'editReply')
    expect([edit.embeds?.length, (edit.flags ?? 0) & IsComponentsV2]).toEqual([2, 0])
  })

  it('follows up after the restore of an embed message with a container, restoring the message as an embed', async () => {
    const interaction = button(createMockMessage({ embeds: [{ description: 'card' }] }))
    await respond(interaction).lock()

    await respond(interaction).error(new Error('down'))

    const restore = last(interaction, 'editReply')
    expect([restore.embeds?.length, (restore.flags ?? 0) & IsComponentsV2]).toEqual([1, 0])
    expect(isContainer(last(interaction, 'followUp'))).toBe(true)
  })
})

describe('every answer records its format', () => {
  it("edits the app's own Components V2 reply as V2, reading it back once", async () => {
    const interaction = command('embed')
    await interaction.reply({ components: [new TextDisplayBuilder().setContent('hi')], flags: IsComponentsV2 })

    await respond(interaction).send({ embeds: [new EmbedBuilder().setDescription('card')] })
    await respond(interaction).send({ components: [new TextDisplayBuilder().setContent('again')] })

    expect(calls(interaction, 'editReply').map(edit => [edit.flags, 'embeds' in edit])).toEqual([
      [IsComponentsV2, false],
      [IsComponentsV2, false],
    ])
    expect(interaction.fetchReply).toHaveBeenCalledTimes(1)
  })

  it("reads the app's own embed reply back once, and edits it as an embed", async () => {
    const interaction = command('embed')
    await interaction.reply({ embeds: [new EmbedBuilder().setDescription('card')] })

    await respond(interaction).send({ embeds: [new EmbedBuilder().setDescription('again')] })
    await respond(interaction).send({ embeds: [new EmbedBuilder().setDescription('once more')] })

    expect(calls(interaction, 'editReply').map(edit => [edit.flags, edit.embeds?.length])).toEqual([
      [0, 1],
      [0, 1],
    ])
    expect(interaction.fetchReply).toHaveBeenCalledTimes(1)
  })

  it("reads nothing back after the app's own deferReply(), which is never V2", async () => {
    const interaction = command('embed')
    await interaction.deferReply()

    await respond(interaction).send('done')

    expect(interaction.fetchReply).not.toHaveBeenCalled()
  })
})

describe('content and embeds dropped from a Components V2 answer', () => {
  it('warns, naming the call, with or without viewMode', async () => {
    const interaction = button(createMockMessage({ flags: IsComponentsV2 }), 'embed')
    await respond(interaction).acknowledge()

    await respond(interaction).send({ content: 'hi', embeds: [{ description: 'card' }], components: [] })

    expect(warned).toEqual([expect.stringMatching(/^Dropped the content and embeds of an answer to customId "refresh": it goes to a Components V2 message/)])
  })

  it("drops the content of the app's own Components V2 follow-up, with a warning", async () => {
    const interaction = command('embed')
    await respond(interaction).send('first')

    await respond(interaction).followUp({ content: 'hi', components: [new TextDisplayBuilder().setContent('hi')], flags: IsComponentsV2 })

    expect('content' in last(interaction, 'followUp')).toBe(false)
    expect(warned).toEqual([expect.stringMatching(/^Dropped the content of an answer to/)])
  })

  it('warns of nothing for empty content and embeds', async () => {
    const interaction = button(createMockMessage({ flags: IsComponentsV2 }), 'embed')
    await respond(interaction).acknowledge()

    await respond(interaction).send({ content: '', embeds: [], components: [] })

    expect(warned).toEqual([])
  })
})
