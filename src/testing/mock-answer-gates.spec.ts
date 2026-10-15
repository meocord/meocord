import 'reflect-metadata'
import {
  AutocompleteInteraction,
  ButtonInteraction,
  ChatInputCommandInteraction,
  DiscordjsErrorCodes,
  type ModalMessageModalSubmitInteraction,
  ModalSubmitInteraction,
} from 'discord.js'
import { vi } from 'vitest'
import { Logger } from '@src/common/logger.js'
import { forgetDeprecationWarnings } from '@src/common/deprecation.js'
import { Autocomplete, Command, Controller } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { createMockInteraction, createMockMessage, getResponse, MeoCordTestingModule } from '@src/testing/index.js'
import { forgetStrictMocks, useStrictMocks } from '@src/testing/strict-mocks.js'

let warned: string[]
beforeEach(() => {
  forgetStrictMocks()
  forgetDeprecationWarnings()
  warned = []
  vi.spyOn(Logger.prototype, 'warn').mockImplementation((text: unknown) => void warned.push(String(text)))
})
afterEach(() => vi.restoreAllMocks())
afterAll(() => forgetStrictMocks())

const autocomplete = () => createMockInteraction(AutocompleteInteraction, { commandName: 'search' })
const slash = () => createMockInteraction(ChatInputCommandInteraction, { commandName: 'play' })
const click = () => createMockInteraction(ButtonInteraction, { customId: 'buy' })
const outcome = (answer: Promise<unknown>) => answer.then(() => 'ok', (error: { code?: unknown }) => error.code ?? error)

const MODES = [
  ['in default mode', () => undefined],
  ['under useStrictMocks()', () => useStrictMocks()],
] as const

const CHOICES = [{ name: 'a', value: 'a' }]
const W_UNCOUNTED = /^launchActivity\(\) here leaves the interaction unanswered, and getResponse\(\) doesn't report it; under useStrictMocks\(\)/
const W_AFTER = /^launchActivity\(\) here runs though the interaction was answered; under useStrictMocks\(\)/
const W_SET_RESPOND = /^respond\(\) here runs a behaviour a test set and leaves responded as it was; under useStrictMocks\(\)/
const methods = (interaction: Parameters<typeof getResponse>[0]) => getResponse(interaction).calls.map(call => call.method + ('error' in call ? '!' : ''))
const report = (interaction: Parameters<typeof getResponse>[0]) => {
  const { state, sent } = getResponse(interaction)
  return { state, sent, calls: methods(interaction) }
}

@Controller()
class Answers {
  @Command('activity', CommandType.SLASH)
  async activity(interaction: ChatInputCommandInteraction) {
    await interaction.launchActivity()
    throw new Error('boom')
  }

  @Command('premium', CommandType.SLASH)
  async premium(interaction: ChatInputCommandInteraction) {
    await interaction.sendPremiumRequired()
  }

  @Autocomplete('search')
  async search(interaction: AutocompleteInteraction) {
    await interaction.respond(CHOICES)
    throw new Error('after responding')
  }

  @Autocomplete('find')
  async find(interaction: AutocompleteInteraction) {
    await interaction.respond(CHOICES)
  }
}
const compile = () => MeoCordTestingModule.create({ controllers: [Answers] }).compile()
const command = (commandName: string) => createMockInteraction(ChatInputCommandInteraction, { commandName })
const lookup = (commandName: string) => createMockInteraction(AutocompleteInteraction, { commandName })

// Each case runs in both modes: default mode keeps what it read before, with a warning at the call, and strict mocks
// answer as discord.js does
describe('launchActivity() and sendPremiumRequired() on a mock interaction', () => {
  it.each([
    ['in default mode', () => undefined, { state: 'unanswered', sent: false, calls: [] }, false, [W_UNCOUNTED]],
    ['under useStrictMocks()', () => useStrictMocks(), { state: 'replied', sent: false, calls: ['launchActivity'] }, true, []],
  ] as const)('count as the first answer under strict mocks only, %s', async (_, mode, reported, replied, warnings) => {
    mode()
    const interaction = slash()
    await interaction.launchActivity()

    expect([report(interaction), interaction.replied]).toEqual([reported, replied])
    expect(warned).toEqual(warnings.map(text => expect.stringMatching(text)))
  })

  it.each([
    ['in default mode', () => undefined, ['ok', ['reply']], ['ok', ['reply']], [W_UNCOUNTED, W_AFTER]],
    [
      'under useStrictMocks()',
      () => useStrictMocks(),
      [DiscordjsErrorCodes.InteractionAlreadyReplied, ['launchActivity', 'reply!']],
      [DiscordjsErrorCodes.InteractionAlreadyReplied, ['reply', 'launchActivity!']],
      [],
    ],
  ] as const)('leave a reply() before or after them as before, refused under strict mocks, %s', async (_, mode, after, before, warnings) => {
    mode()
    const launched = slash()
    await launched.launchActivity()
    const replied = slash()
    await replied.reply('hi')

    expect([await outcome(launched.reply('hi')), methods(launched)]).toEqual(after)
    expect([await outcome(replied.launchActivity()), methods(replied)]).toEqual(before)
    expect(warned).toEqual(warnings.map(text => expect.stringMatching(text)))
  })

  it.each([
    ['in default mode', () => undefined, ['followUp']],
    ['under useStrictMocks()', () => useStrictMocks(), ['sendPremiumRequired', 'followUp']],
  ] as const)('take a follow-up after them, as discord.js does, %s', async (_, mode, calls) => {
    mode()
    const interaction = slash()
    await interaction.sendPremiumRequired()

    expect(await outcome(interaction.followUp('x'))).toBe('ok')
    expect([methods(interaction), interaction.replied]).toEqual([calls, true])
  })

  it.each([
    ['in default mode', () => undefined, DiscordjsErrorCodes.InteractionNotReplied],
    ['under useStrictMocks()', () => useStrictMocks(), 10008],
  ] as const)('leave an edit after them refused, as before in default mode, %s', async (_, mode, refusal) => {
    mode()
    const interaction = slash()
    await interaction.launchActivity()

    expect(await outcome(interaction.editReply('x'))).toBe(refusal)
  })

  it.each([
    ['in default mode', () => undefined, ['ok', ['update']]],
    ['under useStrictMocks()', () => useStrictMocks(), [DiscordjsErrorCodes.InteractionAlreadyReplied, ['launchActivity', 'update!']]],
  ] as const)("leave a component's update() after them as before, refused under strict mocks, %s", async (_, mode, result) => {
    mode()
    const interaction = click()
    await interaction.launchActivity()

    expect([await outcome(interaction.update({ content: 'x' })), methods(interaction)]).toEqual(result)
  })

  it.each([
    ['in default mode', () => undefined, ['reply'], { state: 'unanswered', sent: false, calls: [] }],
    ['under useStrictMocks()', () => useStrictMocks(), ['launchActivity', 'followUp'], { state: 'replied', sent: false, calls: ['sendPremiumRequired'] }],
  ] as const)('answer a dispatched call as the mode reads them, %s', async (_, mode, failed, premium) => {
    mode()
    const module = compile()
    const activity = command('activity')
    const upgrade = command('premium')

    await expect(module.dispatch(activity)).rejects.toThrow('boom')
    await module.dispatch(upgrade)

    expect(methods(activity)).toEqual(failed)
    expect(report(upgrade)).toEqual(premium)
  })
})

describe("a mock autocomplete's respond()", () => {
  it.each([
    ['in default mode', () => undefined, { state: 'unanswered', sent: false, calls: [] }],
    ['under useStrictMocks()', () => useStrictMocks(), { state: 'replied', sent: false, calls: ['respond'] }],
  ] as const)('is reported by getResponse() under strict mocks only, %s', async (_, mode, reported) => {
    mode()
    const interaction = autocomplete()
    await interaction.respond([])

    expect([report(interaction), interaction.responded]).toEqual([reported, true])
  })

  it.each([
    ['in default mode', () => undefined, ['ok', 'ok'], false, [W_SET_RESPOND]],
    ['under useStrictMocks()', () => useStrictMocks(), ['ok', DiscordjsErrorCodes.InteractionAlreadyReplied], true, []],
  ] as const)('given a behaviour by a test, marks responded and refuses a second under strict mocks only, %s', async (_, mode, outcomes, responded, warnings) => {
    mode()
    const interaction = autocomplete()
    interaction.respond.mockResolvedValue(undefined)

    expect([await outcome(interaction.respond([])), await outcome(interaction.respond([]))]).toEqual(outcomes)
    expect(interaction.responded).toBe(responded)
    expect(warned).toEqual(warnings.map(text => expect.stringMatching(text)))
  })

  it.each([
    ['in default mode', () => undefined, false, [[CHOICES], [[]]]],
    ['under useStrictMocks()', () => useStrictMocks(), true, [[CHOICES]]],
  ] as const)('given a behaviour by a test, through dispatch, %s', async (_, mode, responded, calls) => {
    mode()
    const module = compile()
    const found = lookup('find')
    found.respond.mockResolvedValue(undefined)
    const failing = lookup('search')
    failing.respond.mockResolvedValue(undefined)

    await module.dispatch(found)
    await expect(module.dispatch(failing)).rejects.toThrow('after responding')

    expect([found.respond.mock.calls.length, found.responded]).toEqual([1, responded])
    expect(failing.respond.mock.calls).toEqual(calls)
  })

  it.each(MODES)('leaves the autocomplete unanswered when a respond() a test set rejects, %s', async (_, mode) => {
    mode()
    const interaction = autocomplete()
    interaction.respond.mockRejectedValueOnce(new Error('gone'))
    await interaction.respond(CHOICES).catch(() => undefined)

    expect(interaction.responded).toBe(false)
    await expect(interaction.respond(CHOICES)).resolves.toBeUndefined()
  })
})

describe('update() on a mock modal', () => {
  const fromCommand = () => createMockInteraction(ModalSubmitInteraction, { customId: 'report' })
  const fromButton = () => createMockInteraction(ModalSubmitInteraction, { customId: 'report', message: createMockMessage({ content: 'Report' }) })
  // discord.js types update() only on a modal from a message, which a test can't narrow a mock to
  const update = (interaction: ModalSubmitInteraction) => (interaction as ModalMessageModalSubmitInteraction).update('Thanks')
  const UPDATE_NEEDS_MESSAGE = 'update() needs the message a component opened this modal from, and this modal came from a command.'

  it('is refused under useStrictMocks() when the modal came from a command, leaving it unanswered', async () => {
    useStrictMocks()
    const interaction = fromCommand()

    await expect(update(interaction)).rejects.toThrow(UPDATE_NEEDS_MESSAGE)
    expect(interaction.replied).toBe(false)
    expect(await outcome(interaction.reply('Thanks'))).toBe('ok')
  })

  it('runs in default mode when the modal came from a command, with a warning', async () => {
    const interaction = fromCommand()

    await expect(update(interaction)).resolves.toBeUndefined()
    expect(warned).toEqual([expect.stringContaining(`${UPDATE_NEEDS_MESSAGE} Use reply() or deferReply() instead. The mock runs it`)])
  })

  it.each(MODES)('updates the message a button opened the modal from, %s', async (_, mode) => {
    mode()
    const interaction = fromButton()
    await update(interaction)

    expect((await interaction.fetchReply()).content).toBe('Thanks')
    expect(warned).toEqual([])
  })
})
