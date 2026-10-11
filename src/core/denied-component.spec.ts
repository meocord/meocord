import {
  ButtonInteraction,
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from 'discord.js'
import { vi } from 'vitest'
import { Logger } from '@src/common/logger.js'
import { Command, Controller, Defer, Guard, Observer, UseGuard } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { type DispatchObserver, type DispatchResult, type GuardInterface } from '@src/interface/index.js'
import {
  createChatInputOptions,
  createDiscordError,
  createMockInteraction,
  createMockMessage,
  getResponse,
  MeoCordTestingModule,
} from '@src/testing/index.js'

// A guard's false stops a call silently: a component is acknowledged invisibly, so Discord shows no failure.

const calls = (interaction: object) => getResponse(interaction as never).calls.map(call => call.method)

let answerFirst: ((interaction: ButtonInteraction) => Promise<unknown>) | undefined

@Guard()
class Deny implements GuardInterface {
  async canActivate(interaction: ButtonInteraction) {
    await answerFirst?.(interaction)
    return false
  }
}

const settled: DispatchResult[] = []

@Observer()
class Outcomes implements DispatchObserver {
  onSettled(_context: unknown, result: DispatchResult) {
    settled.push(result)
  }
}

@Controller()
class Cards {
  @Command('card/{id}', CommandType.BUTTON)
  @UseGuard(Deny)
  card() {}

  @Command('slow/{id}', CommandType.BUTTON)
  @UseGuard(Deny)
  @Defer()
  slow() {}

  @Command('pick', CommandType.SELECT_MENU)
  @UseGuard(Deny)
  pick() {}

  @Command('note', CommandType.MODAL_SUBMIT)
  @UseGuard(Deny)
  note() {}

  @Command('ping', CommandType.SLASH)
  @UseGuard(Deny)
  ping() {}
}

const module = () => MeoCordTestingModule.create({ controllers: [Cards], observers: [Outcomes] }).compile()

beforeEach(() => {
  answerFirst = undefined
  settled.length = 0
})

describe('a call a guard denies by returning false', () => {
  it.each([
    ['a button', () => createMockInteraction(ButtonInteraction, { customId: 'card/1' })],
    ['a select menu', () => createMockInteraction(StringSelectMenuInteraction, { customId: 'pick' })],
    ['a modal submitted from a message', () => createMockInteraction(ModalSubmitInteraction, { customId: 'note', message: createMockMessage() as never })],
  ])('is acknowledged invisibly on %s without @Defer', async (_label, make) => {
    const interaction = make()

    await module().dispatch(interaction)

    expect(calls(interaction)).toEqual(['deferUpdate'])
    expect(settled.map(({ outcome }) => outcome)).toEqual(['denied'])
  })

  it('is acknowledged once on a button with @Defer, as before', async () => {
    const interaction = createMockInteraction(ButtonInteraction, { customId: 'slow/1' })

    await module().dispatch(interaction)

    expect(calls(interaction)).toEqual(['deferUpdate'])
  })

  it.each([
    ['a command', () => Object.assign(createMockInteraction(ChatInputCommandInteraction, { commandName: 'ping' }), { options: createChatInputOptions({}) })],
    ['a modal opened by a command', () => createMockInteraction(ModalSubmitInteraction, { customId: 'note' })],
  ])('is left unanswered on %s, whose only acknowledgement is a reply of its own', async (_label, make) => {
    const interaction = make()

    await module().dispatch(interaction)

    expect(calls(interaction)).toEqual([])
  })

  it('adds nothing to a click the guard answered itself', async () => {
    answerFirst = click => click.reply({ content: 'Not yours', ephemeral: true } as never)
    const interaction = createMockInteraction(ButtonInteraction, { customId: 'card/1' })

    await module().dispatch(interaction)

    expect(calls(interaction)).toEqual(['reply'])
  })

  it('takes a click something else acknowledged first as answered, without an error', async () => {
    const interaction = createMockInteraction(ButtonInteraction, { customId: 'card/1' })
    // As when a collector answered the click first: Discord refuses the second acknowledgement
    vi.mocked(interaction.deferUpdate).mockRejectedValueOnce(createDiscordError(40060, 'Interaction has already been acknowledged.'))

    const debug = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => {})

    await module().dispatch(interaction)

    expect(debug.mock.calls.map(([line]) => String(line)).filter(line => line.startsWith('Could not acknowledge'))).toEqual([])
    expect(settled.map(({ outcome }) => outcome)).toEqual(['denied'])
    debug.mockRestore()
  })
})
