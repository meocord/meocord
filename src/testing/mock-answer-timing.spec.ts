import 'reflect-metadata'
import { AutocompleteInteraction, ButtonInteraction, ChatInputCommandInteraction, DiscordjsErrorCodes, MessageFlags } from 'discord.js'
import { vi } from 'vitest'
import { Logger } from '@src/common/logger.js'
import { forgetDeprecationWarnings } from '@src/common/deprecation.js'
import { Command, Controller, Guard, UseGuard } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { type GuardInterface } from '@src/interface/index.js'
import { createMockInteraction, getResponse, MeoCordTestingModule } from '@src/testing/index.js'
import { forgetStrictMocks, useStrictMocks } from './strict-mocks.js'

let warned: string[]
beforeEach(() => {
  forgetStrictMocks()
  forgetDeprecationWarnings()
  warned = []
  vi.spyOn(Logger.prototype, 'warn').mockImplementation((text: unknown) => void warned.push(String(text)))
})
afterEach(() => vi.restoreAllMocks())
afterAll(() => forgetStrictMocks())

const slash = () => createMockInteraction(ChatInputCommandInteraction, { commandName: 'ping' })
const click = () => createMockInteraction(ButtonInteraction, { customId: 'go' })
const autocomplete = () => createMockInteraction(AutocompleteInteraction, { commandName: 'pick' })
const outcome = (answer: Promise<unknown>) => answer.then(() => 'ok', (error: { code?: unknown; status?: unknown }) => error.code ?? error.status)

describe('when a mock interaction is answered, under useStrictMocks()', () => {
  beforeEach(() => useStrictMocks())

  it('sets each first answer\'s flag once its promise resolves, as discord.js does after the request', async () => {
    const [deferring, replying, updating, deferringUpdate, modal] = [slash(), slash(), click(), click(), slash()]
    const answers = [
      deferring.deferReply(),
      replying.reply('hi'),
      updating.update({ content: 'u' }),
      deferringUpdate.deferUpdate(),
      modal.showModal({ customId: 'm', title: 'M', components: [] } as never),
    ]
    const flags = () => [deferring.deferred, replying.replied, updating.replied, deferringUpdate.deferred, modal.replied]

    expect(flags()).toEqual([false, false, false, false, false])
    await Promise.all(answers)
    expect(flags()).toEqual([true, true, true, true, true])
  })

  it('refuses an edit, follow-up or delete made before the first answer resolves, with InteractionNotReplied', async () => {
    const results = await Promise.all(
      (['editReply', 'followUp', 'deleteReply'] as const).map(method => {
        const interaction = slash()
        const deferring = interaction.deferReply()
        const result = outcome((interaction[method] as (options?: unknown) => Promise<unknown>)(method === 'deleteReply' ? undefined : 'done'))
        return deferring.then(() => result)
      }),
    )

    expect(results).toEqual([DiscordjsErrorCodes.InteractionNotReplied, DiscordjsErrorCodes.InteractionNotReplied, DiscordjsErrorCodes.InteractionNotReplied])
  })

  it("sends a second answer made while the first is in flight, which Discord refuses with 40060 once the first lands", async () => {
    const interaction = slash()
    const [a, b] = [outcome(interaction.reply('a')), outcome(interaction.reply('b'))]

    expect([await a, await b]).toEqual(['ok', 40060])
    expect(getResponse(interaction).calls.map(call => [call.method, 'error' in call])).toEqual([
      ['reply', false],
      ['reply', true],
    ])
    expect(interaction.replied).toBe(true)
  })

  it('takes the second answer when the test made the first reject, as a bot would', async () => {
    const interaction = slash()
    interaction.reply.mockRejectedValueOnce(new Error('network'))
    const [a, b] = [outcome(interaction.reply('a')), outcome(interaction.reply('b'))]

    expect([await a, await b]).toEqual([undefined, 'ok'])
    expect(interaction.replied).toBe(true)
  })

  it("decides ephemeral with the flag, once the answer resolves", async () => {
    const interaction = slash()
    const deferring = interaction.deferReply({ flags: MessageFlags.Ephemeral })
    const before = interaction.ephemeral
    await deferring

    expect([before, interaction.ephemeral]).toEqual([null, true])
  })

  it("sets an autocomplete's responded once respond() resolves, and refuses a second sent in flight with 40060", async () => {
    const interaction = autocomplete()
    const [a, b] = [outcome(interaction.respond([])), outcome(interaction.respond([]))]
    const right = interaction.responded

    expect([right, await a, await b, interaction.responded]).toEqual([false, 'ok', 40060, true])
  })

  // A mock answer resolves on the next microtask, so only overlaps within one synchronous run are caught: a guard's
  // un-awaited reply has landed by the time MeoCord answers the denial, where on a bot the request is still in flight
  it("lands a guard's un-awaited reply before MeoCord answers the denial, so an overlap across an await isn't caught", async () => {
    @Guard()
    class Refuse implements GuardInterface {
      canActivate(interaction: ChatInputCommandInteraction) {
        void interaction.reply('no')
        return false
      }
    }
    @Controller()
    class Ping {
      @Command('ping', CommandType.SLASH)
      @UseGuard(Refuse)
      ping() {}
    }
    const module = MeoCordTestingModule.create({ controllers: [Ping] }).compile()
    const interaction = slash()

    await module.dispatch(interaction)

    expect(getResponse(interaction).calls.map(call => [call.method, 'error' in call])).toEqual([['reply', false]])
    expect(warned).toEqual([])
  })
})

describe('when a mock interaction is answered, in default mode', () => {
  it('sets the flag at the call, and warns once where a bot would refuse an edit before the answer resolves', async () => {
    const interaction = slash()
    const deferring = interaction.deferReply()
    const deferred = interaction.deferred
    await interaction.editReply('done')
    await interaction.followUp('more')
    await deferring

    expect(deferred).toBe(true)
    expect(warned).toEqual([
      expect.stringMatching(/^deferReply\(\) had not resolved when editReply\(\) was called; on a bot this throws InteractionNotReplied\. Await deferReply\(\) first/),
    ])
  })

  it('refuses a second answer in flight with InteractionAlreadyReplied, and warns that a bot gets 40060', async () => {
    const interaction = slash()
    const [a, b] = [outcome(interaction.reply('a')), outcome(interaction.reply('b'))]

    expect([await a, await b]).toEqual(['ok', DiscordjsErrorCodes.InteractionAlreadyReplied])
    expect(warned).toEqual([expect.stringMatching(/^reply\(\) was called while reply\(\) had not resolved; on a bot.*40060/s)])
  })

  it('warns once for a second respond() in flight', async () => {
    const interaction = autocomplete()
    const [a, b] = [outcome(interaction.respond([])), outcome(interaction.respond([]))]

    expect([interaction.responded, await a, await b]).toEqual([true, 'ok', DiscordjsErrorCodes.InteractionAlreadyReplied])
    expect(warned).toEqual([expect.stringMatching(/^respond\(\) was called while respond\(\) had not resolved; on a bot.*40060/s)])
  })
})

describe.each([
  ['default', () => {}],
  ['strict', () => useStrictMocks()],
])('an answer that fails after another answer, in %s mode', (_mode, setUp) => {
  beforeEach(() => setUp())

  it('leaves the other answer in place, undoing only a change nothing has followed', async () => {
    const interaction = slash()
    interaction.reply.mockRejectedValueOnce(new Error('network'))
    const [a, b] = [outcome(interaction.reply('a')), outcome(interaction.reply('b'))]
    await Promise.all([a, b])

    expect([interaction.replied, (await interaction.fetchReply()).content]).toEqual([true, 'b'])
  })

  it('keeps a later edit when an earlier one fails after it', async () => {
    const interaction = slash()
    await interaction.deferReply()
    interaction.editReply.mockRejectedValueOnce(new Error('network'))
    await Promise.all([outcome(interaction.editReply('a')), outcome(interaction.editReply('b'))])

    expect((await interaction.fetchReply()).content).toBe('b')
  })

  it('leaves the interaction unanswered when both answers fail, in either order', async () => {
    for (const order of [[0, 1], [1, 0]]) {
      const interaction = slash()
      const failures = order.map(() => Promise.withResolvers<never>())
      interaction.reply.mockImplementationOnce(() => failures[0].promise).mockImplementationOnce(() => failures[1].promise)
      const answers = [outcome(interaction.reply('a')), outcome(interaction.reply('b'))]
      for (const index of order) failures[index].reject(new Error('network'))
      await Promise.all(answers)

      expect(interaction.replied).toBe(false)
    }
  })
})

describe.each([
  ['default', () => {}],
  ['strict', () => useStrictMocks()],
])('an awaited answer, in %s mode', (_mode, setUp) => {
  beforeEach(() => setUp())

  it('is followed by an edit as before, with no warning, and reading a flag never warns', async () => {
    const interaction = slash()
    void interaction.deferred
    await interaction.deferReply()
    const edited = await interaction.editReply('done')

    expect([interaction.deferred, edited.content]).toEqual([true, 'done'])
    expect(warned).toEqual([])
  })
})
