import 'reflect-metadata'
import { ButtonInteraction, ChatInputCommandInteraction, MessageFlags, ModalBuilder, ModalSubmitInteraction } from 'discord.js'
import { vi } from 'vitest'
import { Logger } from '@src/common/logger.js'
import { forgetDeprecationWarnings } from '@src/common/deprecation.js'
import { respond } from '@src/common/response/response-state.js'
import { createMockInteraction } from '@src/testing/mock-interaction.js'
import { forgetStrictMocks, useStrictMocks } from '@src/testing/strict-mocks.js'
import { UNDEFINED_ANSWER_WARNING } from '@src/testing/mock-interaction.js'

let warned: string[]
beforeEach(() => {
  forgetStrictMocks()
  forgetDeprecationWarnings()
  warned = []
  // The warning that an answer resolves to undefined has its own spec, mock-interaction-response.spec
  vi.spyOn(Logger.prototype, 'warn').mockImplementation((text: unknown) => void (String(text) === UNDEFINED_ANSWER_WARNING || warned.push(String(text))))
})
afterEach(() => vi.restoreAllMocks())
afterAll(() => forgetStrictMocks())

const slash = () => createMockInteraction(ChatInputCommandInteraction, { commandName: 'ping' })
const click = () => createMockInteraction(ButtonInteraction, { customId: 'go' })

describe("a mock interaction's ephemeral, under useStrictMocks()", () => {
  beforeEach(() => useStrictMocks())

  it('is null until a reply or deferral decides it, as discord.js has it', () => {
    const interactions = [slash(), click(), createMockInteraction(ModalSubmitInteraction, { customId: 'form' })]

    expect(interactions.map(interaction => interaction.ephemeral)).toEqual([null, null, null])
    expect(warned).toEqual([])
  })

  it('is what reply() and deferReply() send, and stays null through update() and deferUpdate()', async () => {
    const [shown, hidden, deferred] = [slash(), slash(), slash()]
    await shown.reply('hi')
    await hidden.reply({ content: 'hi', flags: MessageFlags.Ephemeral })
    await deferred.deferReply({ flags: MessageFlags.Ephemeral })
    const [updated, deferredUpdate] = [click(), click()]
    await updated.update({ content: 'u' })
    await deferredUpdate.deferUpdate()

    expect([shown, hidden, deferred, updated, deferredUpdate].map(interaction => interaction.ephemeral)).toEqual([false, true, true, null, null])
  })
})

it('stays undecided after a reply a test rejects, which changes nothing, in both modes', async () => {
  const defaultMode = slash()
  defaultMode.reply.mockRejectedValueOnce(new Error('refused'))
  await expect(defaultMode.reply({ content: 'hi', flags: MessageFlags.Ephemeral })).rejects.toThrow('refused')
  expect(defaultMode.ephemeral).toBe(false)
  expect(warned).toEqual([expect.stringMatching(/^ChatInputCommandInteraction\.ephemeral reads a placeholder/)])

  forgetStrictMocks()
  useStrictMocks()
  const strict = slash()
  strict.reply.mockRejectedValueOnce(new Error('refused'))
  await expect(strict.reply({ content: 'hi', flags: MessageFlags.Ephemeral })).rejects.toThrow('refused')
  expect(strict.ephemeral).toBeNull()
})

describe("a mock interaction's ephemeral, in default mode", () => {
  it('reads false before a reply or deferral, and warns once that strict mocks read null', () => {
    const [first, second] = [slash(), click()]

    expect([first.ephemeral, first.ephemeral, second.ephemeral]).toEqual([false, false, false])
    expect(warned).toEqual([
      expect.stringMatching(/^ChatInputCommandInteraction\.ephemeral reads a placeholder.*5\.0.*null.*useStrictMocks\(\)/s),
      expect.stringMatching(/^ButtonInteraction\.ephemeral reads a placeholder/),
    ])
  })

  it('reads what a reply or deferral decided without a warning, as a value the test sets', async () => {
    const [replied, deferred, set] = [slash(), slash(), slash()]
    await replied.reply('hi')
    await deferred.deferReply({ flags: MessageFlags.Ephemeral })
    set.ephemeral = true

    expect([replied.ephemeral, deferred.ephemeral, set.ephemeral]).toEqual([false, true, true])
    expect(warned).toEqual([])
  })

  it("says nothing for MeoCord's reads once a test answers the interaction itself", async () => {
    const answered = slash()
    answered.replied = true
    await respond(answered).delete()
    expect(warned).toEqual([])
  })

  // As discord.js has it, and as MeoCord's lock reads it to tell an update from a reply
  it('reads null after update() and deferUpdate(), without a warning, and keeps a value the test set', async () => {
    const [updated, deferredUpdate, set] = [click(), click(), click()]
    await updated.update({ content: 'u' })
    await deferredUpdate.deferUpdate()
    set.ephemeral = true
    await set.deferUpdate()

    expect([updated.ephemeral, deferredUpdate.ephemeral, set.ephemeral]).toEqual([null, null, true])
    expect(warned).toEqual([])
  })

  it('reads null, quietly, once a test marks the interaction deferred itself, and false once it marks it replied', () => {
    const [deferred, replied, both] = [click(), slash(), click()]
    deferred.deferred = true
    replied.replied = true
    both.deferred = true
    both.replied = true

    expect([deferred.ephemeral, replied.ephemeral, both.ephemeral]).toEqual([null, false, false])
    expect(warned).toEqual([])
  })

  it('reads false with the warning after showModal(), which decides nothing', async () => {
    const shown = click()
    await shown.showModal(new ModalBuilder().setCustomId('form').setTitle('Form'))

    expect(shown.ephemeral).toBe(false)
    expect(warned).toEqual([expect.stringMatching(/^ButtonInteraction\.ephemeral reads a placeholder/)])
  })

  it('reads false with the warning after a deferUpdate() a test rejects, which changes nothing', async () => {
    const refused = click()
    refused.deferUpdate.mockRejectedValueOnce(new Error('refused'))
    await expect(refused.deferUpdate()).rejects.toThrow('refused')

    expect(refused.ephemeral).toBe(false)
    expect(warned).toEqual([expect.stringMatching(/^ButtonInteraction\.ephemeral reads a placeholder/)])
  })

  it("says nothing for MeoCord's own reads while it answers", async () => {
    const deferred = slash()
    await deferred.deferReply({ flags: MessageFlags.Ephemeral })
    await respond(deferred).followUp({ content: 'done', flags: MessageFlags.Ephemeral })
    const replied = slash()
    await respond(replied).send('hi')
    await respond(replied).delete()

    expect(warned).toEqual([])
  })
})
