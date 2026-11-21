import { ButtonInteraction, ComponentType, MessageFlags, MessageFlagsBitField } from 'discord.js'
import { Logger, UserError } from '@src/common/index.js'
import { Command, Controller, Defer } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { createDiscordError, createMockInteraction, createMockMessage, getResponse, MeoCordTestingModule } from '@src/testing/index.js'

// Discord refusing @Defer's acknowledgement with 40060 means something else answered first, maybe with a reply, which
// is then the original response: no lock is drawn, since the lock and its restore would replace that reply

const SLOW_HANDLER_MS = 2_500

@Controller()
class Cards {
  @Command('locked', CommandType.BUTTON)
  @Defer({ mode: 'eager' })
  locked() {
    throw new UserError('Refused.')
  }

  @Command('unlocked', CommandType.BUTTON)
  @Defer({ mode: 'eager', disable: 'none' })
  unlocked() {
    throw new UserError('Refused.')
  }

  @Command('works', CommandType.BUTTON)
  @Defer({ mode: 'eager' })
  works() {}

  @Command('slow', CommandType.BUTTON)
  @Defer({ mode: 'auto' })
  async slow() {
    await new Promise(resolve => setTimeout(resolve, SLOW_HANDLER_MS))
  }
}

/** A click on a message with one "Go" button, private unless `ephemeral` is false. */
function click(customId: string, { ephemeral = true } = {}) {
  const message = createMockMessage()
  const row = { type: ComponentType.ActionRow, components: [{ type: ComponentType.Button, custom_id: 'go', label: 'Go', style: 1 }] }
  Object.assign(message, { flags: new MessageFlagsBitField(ephemeral ? MessageFlags.Ephemeral : 0), components: [{ toJSON: () => row }], embeds: [] })
  return createMockInteraction(ButtonInteraction, { customId, message } as never)
}

/** Each Discord call: its method, then what its payload shows, then the code it was refused with. */
function calls(interaction: object): string[] {
  return getResponse(interaction as never).calls.map(({ method, payload, error }) => {
    const text = JSON.stringify(payload ?? null)
    const shown = [
      text.includes('Refused.') && 'error',
      text.includes('"disabled":true') ? 'locked' : text.includes('"custom_id":"go"') && 'controls',
      Number((payload as { flags?: unknown } | undefined)?.flags ?? 0) & MessageFlags.Ephemeral && 'private',
    ].filter(Boolean)
    const code = (error as { code?: unknown } | undefined)?.code
    return [method, shown.length ? `(${shown.join(' ')})` : '', code === undefined ? '' : ` !${String(code)}`].join('')
  })
}

describe('@Defer after Discord says something else acknowledged the click', () => {
  beforeEach(() => {
    for (const level of ['debug', 'warn', 'error'] as const) vi.spyOn(Logger.prototype, level).mockImplementation(() => undefined)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })
  const module = MeoCordTestingModule.create({ controllers: [Cards] }).compile()

  it.each([
    ['a failing handler on a private message', 'locked', true, ['deferUpdate !40060', 'followUp(error private)']],
    ['a failing handler on a public message', 'locked', false, ['deferUpdate !40060', 'followUp(error private)']],
    ["a failing handler with disable: 'none'", 'unlocked', true, ['deferUpdate !40060', 'followUp(error private)']],
    ['a handler that returns', 'works', true, ['deferUpdate !40060']],
  ] as const)("draws no lock under 'eager' for %s, so nothing edits the other answer", async (_name, customId, ephemeral, expected) => {
    const interaction = click(customId, { ephemeral })
    interaction.deferUpdate.mockRejectedValueOnce(createDiscordError(40060))

    await module.dispatch(interaction)

    expect(calls(interaction)).toEqual(expected)
  })

  it("draws no lock under 'auto' when its timer's acknowledgement is refused", async () => {
    vi.useFakeTimers()
    const interaction = click('slow')
    interaction.deferUpdate.mockRejectedValueOnce(createDiscordError(40060))

    const handled = module.dispatch(interaction)
    await vi.advanceTimersByTimeAsync(SLOW_HANDLER_MS)
    await handled

    expect(calls(interaction)).toEqual(['deferUpdate !40060'])
  })

  it.each([
    ['a failing handler on a private message', 'locked', true, ['deferUpdate', 'editReply(locked)', 'editReply(error controls)']],
    ['a failing handler on a public message', 'locked', false, ['deferUpdate', 'editReply(locked)', 'editReply(controls)', 'followUp(error private)']],
    ['a handler that returns', 'works', true, ['deferUpdate', 'editReply(locked)', 'editReply(controls)']],
  ] as const)("locks and restores under 'eager' as before for %s when its acknowledgement goes through", async (_name, customId, ephemeral, expected) => {
    const interaction = click(customId, { ephemeral })

    await module.dispatch(interaction)

    expect(calls(interaction)).toEqual(expected)
  })
})
