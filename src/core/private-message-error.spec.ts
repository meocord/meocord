import {
  ButtonInteraction,
  ComponentType,
  MessageFlags,
  MessageFlagsBitField,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from 'discord.js'
import { Logger, respond, UserError } from '@src/common/index.js'
import { setPresenter } from '@src/common/response/presenter.js'
import { Command, Controller, Defer } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { type ResponsePresenter } from '@src/interface/index.js'
import { createDiscordError, createMockInteraction, createMockMessage, getResponse, MeoCordTestingModule } from '@src/testing/index.js'

// An error is added to a private message only while that message is the answer MeoCord made; an edit of any other
// answer would replace it

@Controller()
class Private {
  @Command('card', CommandType.BUTTON)
  card() {
    throw new UserError('Refused.')
  }

  @Command('pick', CommandType.SELECT_MENU)
  pick() {
    throw new UserError('Refused.')
  }

  @Command('note', CommandType.MODAL_SUBMIT)
  note() {
    throw new UserError('Refused.')
  }

  @Command('deferred', CommandType.BUTTON)
  @Defer({ mode: 'eager', disable: 'none' })
  deferred() {
    throw new UserError('Refused.')
  }

  @Command('sends', CommandType.BUTTON)
  async sends(interaction: ButtonInteraction) {
    await respond(interaction).send('Done.')
  }

  @Command('sends-then-fails', CommandType.BUTTON)
  async sendsThenFails(interaction: ButtonInteraction) {
    await respond(interaction).send('Done.')
    throw new UserError('Refused.')
  }

  @Command('notes', CommandType.BUTTON)
  async notes(interaction: ButtonInteraction) {
    await respond(interaction).followUp({ content: 'Noted.', flags: MessageFlags.Ephemeral })
    throw new UserError('Refused.')
  }

  @Command('resends', CommandType.BUTTON)
  async resends(interaction: ButtonInteraction) {
    await respond(interaction).send('First.')
    await respond(interaction).delete()
    await respond(interaction).send('Second.')
    throw new UserError('Refused.')
  }

  @Command('raw-reply', CommandType.BUTTON)
  async rawReply(interaction: ButtonInteraction) {
    await interaction.reply({ content: 'Raw.' })
    throw new UserError('Refused.')
  }

  @Command('raw-update', CommandType.BUTTON)
  async rawUpdate(interaction: ButtonInteraction) {
    await interaction.update({ content: 'Raw.' })
    throw new UserError('Refused.')
  }

  @Command('raw-defer', CommandType.BUTTON)
  async rawDefer(interaction: ButtonInteraction) {
    await interaction.deferUpdate()
    throw new UserError('Refused.')
  }

  @Command('raw-deferred-pick', CommandType.SELECT_MENU)
  async rawDeferredPick(interaction: StringSelectMenuInteraction) {
    await interaction.deferReply()
    throw new UserError('Refused.')
  }
}

type Kind = typeof ButtonInteraction | typeof StringSelectMenuInteraction | typeof ModalSubmitInteraction

/** An interaction on a message carrying a button, private unless `ephemeral` is false. */
function on(kind: Kind, customId: string, { ephemeral = true } = {}) {
  const message = createMockMessage()
  const row = { type: ComponentType.ActionRow, components: [{ type: ComponentType.Button, custom_id: 'open', label: 'Open', style: 1 }] }
  Object.assign(message, { flags: new MessageFlagsBitField(ephemeral ? MessageFlags.Ephemeral : 0), components: [{ toJSON: () => row }], embeds: [] })
  const values = kind === StringSelectMenuInteraction ? { values: ['a'] } : {}
  return createMockInteraction(kind as typeof ButtonInteraction, { customId, message, ...values } as never)
}

/** Each Discord call: its method, `({})` for one that sets no field, private ones marked, refused ones with their code. */
function calls(interaction: object): string[] {
  return getResponse(interaction as never).calls.map(({ method, payload, error }) => {
    const empty = typeof payload === 'object' && payload !== null && Object.keys(payload).length === 0
    const flags = Number((payload as { flags?: unknown } | undefined)?.flags ?? 0)
    const code = (error as { code?: unknown } | undefined)?.code
    return `${method}${empty ? '({})' : ''}${flags & MessageFlags.Ephemeral ? ' private' : ''}${code === undefined ? '' : ` !${String(code)}`}`
  })
}

const drawsLater = (interaction: { client: object }) =>
  setPresenter(interaction.client as never, { error: async (_context, { message }) => ({ text: message }) } as ResponsePresenter)

describe('an error on a private message', () => {
  beforeEach(() => {
    for (const level of ['debug', 'warn', 'error'] as const) vi.spyOn(Logger.prototype, level).mockImplementation(() => undefined)
  })
  afterEach(() => vi.restoreAllMocks())
  const module = MeoCordTestingModule.create({ controllers: [Private] }).compile()

  it.each([
    ['a button', ButtonInteraction, 'card', ['deferReply private !40060', 'followUp private']],
    ['a pick', StringSelectMenuInteraction, 'pick', ['update({}) !40060', 'followUp private']],
    ['a modal submitted from it', ModalSubmitInteraction, 'note', ['deferReply private !40060', 'followUp private']],
  ] as const)(
    'follows up on %s whose acknowledgement Discord says something else made, before an asynchronous view is drawn',
    async (_name, kind, customId, expected) => {
      const interaction = on(kind, customId)
      drawsLater(interaction)
      for (const method of ['deferReply', 'update'] as const) interaction[method].mockRejectedValueOnce(createDiscordError(40060))

      await module.dispatch(interaction)

      expect(calls(interaction)).toEqual(expected)
      expect(interaction.replied).toBe(true)
    },
  )

  it('only follows up when the asynchronous view fails too, as for the failure reported after it', async () => {
    const interaction = on(ButtonInteraction, 'card')
    setPresenter(interaction.client, {
      error: async () => {
        throw new Error('presenter broke')
      },
    } as unknown as ResponsePresenter)
    interaction.deferReply.mockRejectedValueOnce(createDiscordError(40060))

    await module.dispatch(interaction).catch(() => undefined)

    expect(calls(interaction)).toEqual(['deferReply private !40060', 'followUp private', 'followUp private'])
  })

  it.each([
    ['drawn at once', false],
    ['drawn asynchronously', true],
  ])('follows up a failure after a send Discord says something else answered, its view %s', async (_name, later) => {
    const interaction = on(ButtonInteraction, 'sends')
    if (later) drawsLater(interaction)
    interaction.update.mockRejectedValueOnce(createDiscordError(40060))

    await module.dispatch(interaction).catch(() => undefined)

    expect(calls(interaction)).toEqual(['update !40060', 'followUp private'])
  })

  it('follows up a failure after a deferral Discord says something else answered', async () => {
    const interaction = on(ButtonInteraction, 'deferred')
    interaction.deferUpdate.mockRejectedValueOnce(createDiscordError(40060))

    await module.dispatch(interaction)

    expect(calls(interaction)).toEqual(['deferUpdate !40060', 'followUp private'])
  })

  it("keeps a handler's own reply, made with discord.js, and follows the error up", async () => {
    const interaction = on(ButtonInteraction, 'raw-reply')

    await module.dispatch(interaction)

    expect(calls(interaction)).toEqual(['reply', 'followUp private'])
    expect(interaction.editReply).not.toHaveBeenCalled()
  })

  it("keeps a handler's own private follow-up, sent as the first answer, and follows the error up", async () => {
    const interaction = on(ButtonInteraction, 'notes')

    await module.dispatch(interaction)

    expect(calls(interaction)).toEqual(['reply private', 'followUp private'])
    expect(interaction.editReply).not.toHaveBeenCalled()
  })

  it('keeps the message sent after delete(), which became the answer, and follows the error up', async () => {
    const interaction = on(ButtonInteraction, 'resends')

    await module.dispatch(interaction)

    expect(calls(interaction)).toEqual(['update', 'deleteReply', 'followUp private', 'followUp private'])
    expect(interaction.editReply).not.toHaveBeenCalled()
  })

  // Which of these answers discord.js made is not known, so the error is never added to the message after one
  it.each([
    ['interaction.update()', 'raw-update', 'update'],
    ['interaction.deferUpdate()', 'raw-defer', 'deferUpdate'],
  ])("follows the error up after a handler's own %s", async (_name, customId, method) => {
    const interaction = on(ButtonInteraction, customId)

    await module.dispatch(interaction)

    expect(calls(interaction)).toEqual([method, 'followUp private'])
  })

  it("leaves a handler's own deferred reply to a pick alone, on a public message too", async () => {
    for (const ephemeral of [true, false]) {
      const interaction = on(StringSelectMenuInteraction, 'raw-deferred-pick', { ephemeral })

      await module.dispatch(interaction)

      expect(calls(interaction)).toEqual(['deferReply', 'followUp private'])
    }
  })

  it("adds the error to the private message after a handler's own send through respond(i)", async () => {
    const interaction = on(ButtonInteraction, 'sends-then-fails')

    await module.dispatch(interaction)

    expect(calls(interaction)).toEqual(['update', 'editReply'])
    expect(JSON.stringify(getResponse(interaction).calls[1].payload)).toContain('Refused.')
  })

  it('adds a failing presenter\'s report to the private message a pick was put back on', async () => {
    const interaction = on(StringSelectMenuInteraction, 'pick')
    setPresenter(interaction.client, {
      error: () => {
        throw new Error('presenter broke')
      },
    } as unknown as ResponsePresenter)

    await module.dispatch(interaction).catch(() => undefined)

    expect(calls(interaction)).toEqual(['update({})', 'followUp private', 'editReply'])
    expect(JSON.stringify(getResponse(interaction).calls[2].payload)).toContain('An error occurred')
  })

  it('answers nothing after Discord says something else answered a component no route takes', async () => {
    const interaction = on(ButtonInteraction, 'nothing/here')
    drawsLater(interaction)
    interaction.deferReply.mockRejectedValueOnce(createDiscordError(40060))

    await module.dispatch(interaction)

    expect(calls(interaction)).toEqual(['deferReply private !40060'])
  })
})
