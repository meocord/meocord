import 'reflect-metadata'
import { ButtonInteraction, ComponentType, MessageFlags, MessageFlagsBitField } from 'discord.js'
import { vi } from 'vitest'
import { Logger } from '@src/common/logger.js'
import { respond } from '@src/common/response/response-state.js'
import { createMockInteraction, createMockMessage } from '@src/testing/mock-interaction.js'
import { forgetStrictMocks, useStrictMocks } from '@src/testing/strict-mocks.js'

// A lock holds the message a component is on only while that message is the original response: after the app's own
// deferUpdate() it is, and after its own deferReply() the deferred reply is, which the lock would replace

const row = { type: ComponentType.ActionRow, components: [{ type: ComponentType.Button, custom_id: 'go', label: 'Go', style: 1 }] }

/** A click on a message with one "Go" button. */
function click() {
  const message = createMockMessage()
  Object.assign(message, { flags: new MessageFlagsBitField(0), components: [{ toJSON: () => row }], embeds: [] })
  return createMockInteraction(ButtonInteraction, { customId: 'go', message } as never)
}

/** What each editReply carried: the loading view's disabled controls, the message's controls, or neither. */
const edits = (interaction: ButtonInteraction) =>
  vi.mocked(interaction.editReply).mock.calls.map(([payload]) => {
    const text = JSON.stringify(payload)
    return text.includes('"disabled":true') ? 'locked' : text.includes('"custom_id":"go"') ? 'controls' : 'answer only'
  })

describe.each([
  ['default mode', false],
  ['strict mode', true],
])("lock() after the app's own first answer, in %s", (_mode, strict) => {
  let warned: string[]
  beforeEach(() => {
    forgetStrictMocks()
    if (strict) useStrictMocks()
    warned = []
    vi.spyOn(Logger.prototype, 'warn').mockImplementation((text: unknown) => void warned.push(String(text)))
  })
  afterEach(() => vi.restoreAllMocks())
  afterAll(() => forgetStrictMocks())

  it('locks the message after deferUpdate(), which leaves it the original response, and puts it back', async () => {
    const interaction = click()
    await interaction.deferUpdate()

    await respond(interaction).lock()
    await respond(interaction).send({ content: 'Done' })

    expect(edits(interaction)).toEqual(['locked', 'controls'])
    expect(interaction.ephemeral).toBeNull()
    expect(warned.filter(text => text.includes('ephemeral'))).toEqual([])
  })

  it('locks the message after its own deferUpdate() whatever ephemeral the test gave the interaction', async () => {
    const interaction = click()
    interaction.ephemeral = false

    await respond(interaction).lock()
    await respond(interaction).send({ content: 'Done' })

    expect(edits(interaction)).toEqual(['locked', 'controls'])
  })

  // A test that marks the interaction deferred itself says no more than discord.js's flag, which a deferred update sets
  it('locks the message after the test marked the interaction deferred itself, and puts it back', async () => {
    const interaction = click()
    interaction.deferred = true

    await respond(interaction).lock()
    await respond(interaction).send({ content: 'Done' })

    expect(edits(interaction)).toEqual(['locked', 'controls'])
  })

  it('locks nothing after the test marked the interaction replied itself, and send() edits the reply', async () => {
    const interaction = click()
    interaction.replied = true

    await respond(interaction).lock()
    await respond(interaction).send({ content: 'Done' })

    expect(edits(interaction)).toEqual(['answer only'])
  })

  it.each([
    ['a deferred reply', {}],
    ['a private deferred reply', { flags: MessageFlags.Ephemeral }],
  ] as const)('locks nothing after deferReply() made %s, and send() edits it with its own answer only', async (_name, options) => {
    const interaction = click()
    await interaction.deferReply(options)

    await respond(interaction).lock()
    await respond(interaction).send({ content: 'Done' })

    expect(edits(interaction)).toEqual(['answer only'])
    expect(vi.mocked(interaction.editReply).mock.calls[0][0]).toMatchObject({ content: 'Done' })
    expect(respond(interaction).original).toBeUndefined()
  })
})
