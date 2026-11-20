import {
  ButtonInteraction,
  ChannelSelectMenuInteraction,
  ComponentType,
  MentionableSelectMenuInteraction,
  MessageFlags,
  MessageFlagsBitField,
  RoleSelectMenuInteraction,
  StringSelectMenuInteraction,
  UserSelectMenuInteraction,
} from 'discord.js'
import { type ExecutionContext, GuardDeniedError, Logger, OwnerGuard, respond, UserError } from '@src/common/index.js'
import { setPresenter } from '@src/common/response/presenter.js'
import { Catch, Command, Controller, Cooldown, Defer, UseFilter, UseGuard } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { type ExceptionFilter, type ResponsePresenter } from '@src/interface/index.js'
import { createDiscordError, createMockInteraction, createMockMessage, createMockUser, getResponse, MeoCordTestingModule } from '@src/testing/index.js'

// Discord user ids, as the customId and the guard compare them
const owner = '200000000000000001'
const stranger = '200000000000000002'

/** Answers a refusal itself, through the response layer, as an app's filter does. */
@Catch(GuardDeniedError)
class AnswersDenial implements ExceptionFilter<GuardDeniedError> {
  async catch(error: GuardDeniedError, context: ExecutionContext) {
    await respond(context.getInteraction()!).error(error)
  }
}

@Controller()
class Menus {
  @Command('pick/{ownerId:snowflake}', CommandType.SELECT_MENU)
  @UseGuard(OwnerGuard)
  async pick(interaction: StringSelectMenuInteraction) {
    await respond(interaction).send('Picked.')
  }

  @Command('eager/{ownerId:snowflake}', CommandType.SELECT_MENU)
  @Defer({ mode: 'eager' })
  @UseGuard(OwnerGuard)
  async eager(interaction: StringSelectMenuInteraction) {
    await respond(interaction).send('Picked.')
  }

  @Command('auto/{ownerId:snowflake}', CommandType.SELECT_MENU)
  @Defer()
  @UseGuard(OwnerGuard)
  async auto(interaction: StringSelectMenuInteraction) {
    await respond(interaction).send('Picked.')
  }

  @Command('locked', CommandType.SELECT_MENU)
  @Defer({ mode: 'eager', disable: 'clicked' })
  locked() {
    throw new UserError('Not now.')
  }

  @Command('slow', CommandType.SELECT_MENU)
  @Cooldown({ seconds: 60 })
  async slow(interaction: StringSelectMenuInteraction) {
    await respond(interaction).send('Slow.')
  }

  @Command('boom', CommandType.SELECT_MENU)
  boom() {
    throw new Error('boom')
  }

  @Command('answered', CommandType.SELECT_MENU)
  async answered(interaction: StringSelectMenuInteraction) {
    await respond(interaction).send('Done.')
    throw new UserError('Then refused.')
  }

  @Command('filtered/{ownerId:snowflake}', CommandType.SELECT_MENU)
  @UseGuard(OwnerGuard)
  @UseFilter(AnswersDenial)
  async filtered(interaction: StringSelectMenuInteraction) {
    await respond(interaction).send('Picked.')
  }

  @Command('members/{ownerId:snowflake}', CommandType.USER_SELECT_MENU)
  @UseGuard(OwnerGuard)
  async members(interaction: UserSelectMenuInteraction) {
    await respond(interaction).send('Picked.')
  }

  @Command('roles/{ownerId:snowflake}', CommandType.ROLE_SELECT_MENU)
  @UseGuard(OwnerGuard)
  async roles(interaction: RoleSelectMenuInteraction) {
    await respond(interaction).send('Picked.')
  }

  @Command('targets/{ownerId:snowflake}', CommandType.MENTIONABLE_SELECT_MENU)
  @UseGuard(OwnerGuard)
  async targets(interaction: MentionableSelectMenuInteraction) {
    await respond(interaction).send('Picked.')
  }

  @Command('channels/{ownerId:snowflake}', CommandType.CHANNEL_SELECT_MENU)
  @UseGuard(OwnerGuard)
  async channels(interaction: ChannelSelectMenuInteraction) {
    await respond(interaction).send('Picked.')
  }

  @Command('card/{ownerId:snowflake}', CommandType.BUTTON)
  @UseGuard(OwnerGuard)
  async card(interaction: ButtonInteraction) {
    await respond(interaction).send('Picked.')
  }
}

type Picked =
  | typeof StringSelectMenuInteraction
  | typeof UserSelectMenuInteraction
  | typeof RoleSelectMenuInteraction
  | typeof MentionableSelectMenuInteraction
  | typeof ChannelSelectMenuInteraction
  | typeof ButtonInteraction

/** A pick by `userId` in the menu `customId` names, on a message that carries that menu, private when `ephemeral`. */
function pickBy(userId: string, customId: string, { kind = StringSelectMenuInteraction as Picked, ephemeral = false } = {}) {
  const user = createMockUser()
  user.id = userId
  const message = createMockMessage()
  const row = { type: ComponentType.ActionRow, components: [{ type: ComponentType.StringSelect, custom_id: customId, options: [{ label: 'a', value: 'a' }] }] }
  Object.assign(message, { flags: new MessageFlagsBitField(ephemeral ? MessageFlags.Ephemeral : 0), components: [{ toJSON: () => row }], embeds: [] })
  return createMockInteraction(kind as typeof StringSelectMenuInteraction, { customId, user, message, values: ['a'] } as never)
}

/** Each Discord call the interaction got: its method, `({})` for one that sets no field, private ones marked. */
function calls(interaction: object): string[] {
  return getResponse(interaction as never).calls.map(({ method, payload }) => {
    const empty = typeof payload === 'object' && payload !== null && Object.keys(payload).length === 0
    const flags = Number((payload as { flags?: unknown } | undefined)?.flags ?? 0)
    return `${method}${empty ? '({})' : ''}${flags & MessageFlags.Ephemeral ? ' private' : ''}`
  })
}

describe('a select-menu pick MeoCord answers with an error', () => {
  beforeEach(() => {
    for (const level of ['debug', 'warn', 'error'] as const) vi.spyOn(Logger.prototype, level).mockImplementation(() => undefined)
  })
  afterEach(() => vi.restoreAllMocks())
  const module = MeoCordTestingModule.create({ controllers: [Menus] }).compile()

  it("updates the message for the owner's pick, as the handler answers it", async () => {
    const interaction = pickBy(owner, `pick/${owner}`)

    await module.dispatch(interaction)

    expect(calls(interaction)).toEqual(['update'])
  })

  // Discord puts the menu back in the picker's client only on a response that updates the message
  it.each([
    ['refused by a guard', stranger, `pick/${owner}`, false],
    ['refused by a guard, on a private message', stranger, `pick/${owner}`, true],
    ['that no route takes', owner, 'nothing/here', false],
  ])('puts the menu back with an update that sets no field, then answers privately, for a pick %s', async (_name, userId, customId, ephemeral) => {
    const interaction = pickBy(userId, customId, { ephemeral })

    await module.dispatch(interaction)

    expect(calls(interaction)).toEqual(['update({})', 'followUp private'])
  })

  it('puts the menu back for a pick a cooldown refuses', async () => {
    await module.dispatch(pickBy(owner, 'slow'))
    const again = pickBy(owner, 'slow')

    await module.dispatch(again)

    expect(calls(again)).toEqual(['update({})', 'followUp private'])
    expect(JSON.stringify(getResponse(again).calls[1].payload)).toContain('Slow down')
  })

  it('puts the menu back for a pick whose handler throws', async () => {
    const interaction = pickBy(owner, 'boom')

    await expect(module.dispatch(interaction)).rejects.toThrow('boom')

    expect(calls(interaction)).toEqual(['update({})', 'followUp private'])
  })

  it.each([
    ['a user', UserSelectMenuInteraction, 'members'],
    ['a role', RoleSelectMenuInteraction, 'roles'],
    ['a mentionable', MentionableSelectMenuInteraction, 'targets'],
    ['a channel', ChannelSelectMenuInteraction, 'channels'],
  ] as const)('puts %s select menu back as a string one', async (_name, kind, route) => {
    const interaction = pickBy(stranger, `${route}/${owner}`, { kind })

    await module.dispatch(interaction)

    expect(calls(interaction)).toEqual(['update({})', 'followUp private'])
  })

  it.each([
    ["@Defer({ mode: 'eager' })", 'eager'],
    ['@Defer()', 'auto'],
  ])('puts a pick %s deferred back with an edit that sets no field, then answers privately', async (_name, route) => {
    const interaction = pickBy(stranger, `${route}/${owner}`)

    await module.dispatch(interaction)

    expect(calls(interaction)).toEqual(['deferUpdate', 'editReply({})', 'followUp private'])
  })

  it('adds the error to a private message a deferred pick is on, which puts the menu back by itself', async () => {
    const interaction = pickBy(stranger, `eager/${owner}`, { ephemeral: true })

    await module.dispatch(interaction)

    expect(calls(interaction)).toEqual(['deferUpdate', 'editReply'])
    expect(JSON.stringify(getResponse(interaction).calls[1].payload)).toContain('Only the user who opened this can use it.')
  })

  it('sends no empty edit after a restore, which redrew the message already', async () => {
    const interaction = pickBy(owner, 'locked')

    await module.dispatch(interaction)

    expect(calls(interaction)).toEqual(['deferUpdate', 'editReply', 'editReply', 'followUp private'])
  })

  it('keeps the answer a handler gave a pick, following it up privately', async () => {
    const interaction = pickBy(owner, 'answered')

    await module.dispatch(interaction)

    expect(calls(interaction)).toEqual(['update', 'followUp private'])
  })

  it("puts the menu back when a filter answers the refusal through respond(i).error()", async () => {
    const interaction = pickBy(stranger, `filtered/${owner}`)

    await module.dispatch(interaction)

    expect(calls(interaction)).toEqual(['update({})', 'followUp private'])
  })

  // A view drawn asynchronously is waited for after the acknowledgement, so the menu is put back first
  it.each([
    ['a pick, putting the menu back', StringSelectMenuInteraction, 'pick', ['update({})', 'followUp private']],
    ['a button, with a private deferral', ButtonInteraction, 'card', ['deferReply private', 'editReply']],
  ] as const)('acknowledges %s, before a presenter drawing the error asynchronously has drawn it', async (_name, kind, route, expected) => {
    const interaction = pickBy(stranger, `${route}/${owner}`, { kind })
    setPresenter(interaction.client, { error: async (_context, { message }) => ({ text: message }) } as ResponsePresenter)

    await module.dispatch(interaction)

    expect(calls(interaction)).toEqual(expected)
  })

  it('follows up on a private message a pick was put back on, before an asynchronous view is drawn', async () => {
    const interaction = pickBy(stranger, `pick/${owner}`, { ephemeral: true })
    setPresenter(interaction.client, { error: async (_context, { message }) => ({ text: message }) } as ResponsePresenter)

    await module.dispatch(interaction)

    expect(calls(interaction)).toEqual(['update({})', 'followUp private'])
  })

  it('puts the menu back on the next answer when Discord refuses the first, before an asynchronous view is drawn', async () => {
    const debug = vi.spyOn(Logger.prototype, 'debug')
    const interaction = pickBy(stranger, `pick/${owner}`)
    setPresenter(interaction.client, { error: async (_context, { message }) => ({ text: message }) } as ResponsePresenter)
    interaction.update.mockRejectedValueOnce(createDiscordError(50013))

    await module.dispatch(interaction)

    expect(calls(interaction)).toEqual(['update({})', 'update({})', 'followUp private'])
    expect(debug).toHaveBeenCalledWith(expect.stringMatching(/^Could not put the menu back: DiscordAPIError.*50013/))
  })

  it('follows up once when Discord says something else answered a pick first, before an asynchronous view is drawn', async () => {
    const logged = [vi.spyOn(Logger.prototype, 'debug'), vi.spyOn(Logger.prototype, 'error')]
    const interaction = pickBy(stranger, `pick/${owner}`)
    setPresenter(interaction.client, { error: async (_context, { message }) => ({ text: message }) } as ResponsePresenter)
    interaction.update.mockRejectedValueOnce(createDiscordError(40060))

    await module.dispatch(interaction)

    expect(calls(interaction)).toEqual(['update({})', 'followUp private'])
    expect(interaction.replied).toBe(true)
    // An answer made elsewhere is no failed send
    expect(logged.flatMap(spy => spy.mock.calls.map(String))).not.toContainEqual(expect.stringContaining('put the menu back'))
  })

  // The answer made elsewhere is the interaction's own response, so the error never edits it
  it.each([
    ['public', false],
    ['private', true],
  ])('follows up once when Discord says something else answered a pick on a %s message first', async (_name, ephemeral) => {
    const interaction = pickBy(stranger, `pick/${owner}`, { ephemeral })
    interaction.update.mockRejectedValueOnce(createDiscordError(40060))

    await module.dispatch(interaction)

    expect(calls(interaction)).toEqual(['update({})', 'followUp private'])
    // Recorded on the interaction too, as discord.js needs it to send the follow-up
    expect(interaction.replied).toBe(true)
  })

  it('still answers privately when Discord refuses the edit that puts a deferred menu back', async () => {
    const debug = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined)
    const interaction = pickBy(stranger, `eager/${owner}`)
    interaction.editReply.mockRejectedValueOnce(createDiscordError(50001))

    await module.dispatch(interaction)

    expect(calls(interaction)).toEqual(['deferUpdate', 'editReply({})', 'followUp private'])
    expect(debug).toHaveBeenCalledWith(expect.stringMatching(/^Could not put the menu back: DiscordAPIError.*50001/))
  })

  it('answers a button it refuses privately, which leaves nothing to put back', async () => {
    const interaction = pickBy(stranger, `card/${owner}`, { kind: ButtonInteraction })

    await module.dispatch(interaction)

    expect(calls(interaction)).toEqual(['reply private'])
  })
})
