import { ButtonInteraction, ChatInputCommandInteraction, ContainerBuilder, EmbedBuilder, MessageFlags, TextDisplayBuilder } from 'discord.js'
import { vi } from 'vitest'
import { Logger } from '@src/common/logger.js'
import { UserError } from '@src/common/errors.js'
import { forgetDeprecationWarnings } from '@src/common/deprecation.js'
import { respond } from '@src/common/response/response-state.js'
import { setPresenter } from '@src/common/response/presenter.js'
import { type PresentedError, type ResponseContext } from '@src/interface/index.js'
import { createMockInteraction, createMockMessage, getResponse } from '@src/testing/index.js'
import { forgetStrictMocks } from '@src/testing/strict-mocks.js'

const { Ephemeral, IsComponentsV2 } = MessageFlags

interface Payload {
  flags?: number
  content?: string
  embeds?: unknown[]
  components?: unknown[]
  message?: string
}

let warned: string[]
beforeEach(() => {
  forgetStrictMocks()
  forgetDeprecationWarnings()
  warned = []
  vi.spyOn(Logger.prototype, 'warn').mockImplementation((text: unknown) => void warned.push(String(text)))
})
afterEach(() => vi.restoreAllMocks())

/** The payloads an interaction's answers sent with `method`, as plain JSON. */
const calls = (interaction: object, method: string): Payload[] =>
  getResponse(interaction as never)
    .calls.filter(call => call.method === method)
    .map(call => JSON.parse(JSON.stringify(call.payload ?? {})) as Payload)
const text = (content: string) => new TextDisplayBuilder().setContent(content)
const embed = (description: string) => new EmbedBuilder().setDescription(description)
const command = () => createMockInteraction(ChatInputCommandInteraction, { commandName: 'ping' })
const button = (message = createMockMessage()) => createMockInteraction(ButtonInteraction, { customId: 'open', message })

describe("the format of the app's own answer", () => {
  it("edits the app's own Components V2 reply as V2, reading it back once", async () => {
    const interaction = command()
    await interaction.reply({ components: [text('Working')], flags: IsComponentsV2 })

    await respond(interaction).send({ components: [text('Done')] })
    await respond(interaction).send({ components: [text('Done again')] })

    expect(calls(interaction, 'editReply').map(edit => edit.flags)).toEqual([IsComponentsV2, IsComponentsV2])
    expect(interaction.fetchReply).toHaveBeenCalledTimes(1)
  })

  it("reads the app's own embed reply back once, and edits it as an embed", async () => {
    const interaction = command()
    await interaction.reply({ embeds: [embed('Working')] })

    await respond(interaction).send({ embeds: [embed('Done')] })
    await respond(interaction).send({ embeds: [embed('Done again')] })

    expect(calls(interaction, 'editReply').map(edit => [edit.flags, edit.embeds?.length])).toEqual([
      [0, 1],
      [0, 1],
    ])
    expect(interaction.fetchReply).toHaveBeenCalledTimes(1)
  })

  it("reads nothing back after the app's own deferReply(), however many answers fill it", async () => {
    const interaction = command()
    await interaction.deferReply()

    await respond(interaction).send('Done')
    await respond(interaction).send('Done again')

    expect(calls(interaction, 'editReply')).toHaveLength(2)
    expect(interaction.fetchReply).not.toHaveBeenCalled()
  })

  it("reads nothing back after a component's own update(), whose message's format is known", async () => {
    const interaction = button(createMockMessage({ embeds: [{ description: 'Card' }] }))
    await interaction.update({ embeds: [embed('Updated')] })

    await respond(interaction).send({ embeds: [embed('Again')] })

    expect(calls(interaction, 'editReply').at(-1)?.flags).toBe(0)
    expect(interaction.fetchReply).not.toHaveBeenCalled()
  })

  it('edits a Components V2 follow-up that replaced a public deferral as V2, by its id', async () => {
    const interaction = command()
    await respond(interaction).acknowledge()
    await respond(interaction).followUp({ components: [text('Working')], flags: Ephemeral | IsComponentsV2 })

    await respond(interaction).send({ components: [text('Done')] })

    const [replaced] = calls(interaction, 'followUp')
    const edit = calls(interaction, 'editReply').at(-1)!
    expect([replaced.flags, edit.flags, typeof edit.message]).toEqual([Ephemeral | IsComponentsV2, IsComponentsV2, 'string'])
  })

  it("edits an embed follow-up that became the answer after delete() as an embed, whatever the component's message was", async () => {
    const interaction = button(createMockMessage({ flags: IsComponentsV2, components: [text('Panel').toJSON()] }))
    await respond(interaction).acknowledge()
    await respond(interaction).delete()
    await respond(interaction).followUp({ embeds: [embed('Working')] })

    await respond(interaction).send({ embeds: [embed('Done')] })

    const edit = calls(interaction, 'editReply').at(-1)!
    expect([edit.flags, edit.embeds?.length]).toEqual([0, 1])
  })

  it('keeps a follow-up that became the answer Components V2 once an edit makes it so', async () => {
    const interaction = command()
    await respond(interaction).acknowledge()
    await respond(interaction).followUp({ embeds: [embed('Working')], flags: Ephemeral })

    await respond(interaction).send({ components: [text('Done')], flags: IsComponentsV2 })
    await respond(interaction).send({ components: [text('Done again')] })

    expect(calls(interaction, 'editReply').map(edit => edit.flags)).toEqual([IsComponentsV2, IsComponentsV2])
  })
})

describe("the answer's format, apart from the component message's", () => {
  const onV2 = () => createMockMessage({ flags: IsComponentsV2, components: [new ContainerBuilder().addTextDisplayComponents(text('Panel')).toJSON()] })
  const followUpV2 = (interaction: object) => ((calls(interaction, 'followUp').at(-1)?.flags ?? 0) & IsComponentsV2) !== 0

  it("edits the app's own embed reply to a button on a Components V2 message as an embed", async () => {
    const interaction = button(onV2())
    await interaction.reply({ embeds: [embed('Opened')] })

    await respond(interaction).send({ content: 'Updated', embeds: [embed('Now open')] })

    const edit = calls(interaction, 'editReply').at(-1)!
    expect([edit.flags, edit.content, edit.embeds?.length]).toEqual([0, 'Updated', 1])
  })

  it("edits the app's own deferReply() to a button on a Components V2 message as the answer it is sent", async () => {
    const interaction = button(onV2())
    await interaction.deferReply()

    await respond(interaction).send({ embeds: [embed('Done')] })

    const edit = calls(interaction, 'editReply').at(-1)!
    expect([edit.flags, edit.embeds?.length]).toEqual([0, 1])
    expect(interaction.fetchReply).not.toHaveBeenCalled()
  })

  it("still follows up an error to a button on a Components V2 message as V2 after the app's own reply", async () => {
    const interaction = button(onV2())
    await interaction.reply({ embeds: [embed('Opened')] })

    await respond(interaction).error(new UserError('Not yours.'))

    expect(followUpV2(interaction)).toBe(true)
  })

  it("tells the presenter that error follow-up's form, the component message's, once the reply was edited", async () => {
    const interaction = button(onV2())
    const modes: ResponseContext['mode'][] = []
    setPresenter(interaction.client, {
      loading: () => ({ text: 'Working' }),
      error: (context: ResponseContext, { message }: PresentedError) => (modes.push(context.mode), { text: message }),
    })
    await interaction.reply({ embeds: [embed('Opened')] })
    await respond(interaction).send({ embeds: [embed('Opened again')] })

    await respond(interaction).error(new UserError('Not yours.'))

    expect([modes, followUpV2(interaction)]).toEqual([['v2'], true])
  })

  it("follows up an error after MeoCord's own embed reply to a button on a Components V2 message as an embed", async () => {
    const interaction = button(onV2())
    await respond(interaction).followUp({ embeds: [embed('Opened')] })

    await respond(interaction).error(new UserError('Not yours.'))

    expect([calls(interaction, 'reply').length, followUpV2(interaction)]).toEqual([1, false])
  })
})
