import 'reflect-metadata'
import { ButtonInteraction, ChatInputCommandInteraction, MessageFlags, ModalSubmitInteraction } from 'discord.js'
import { vi } from 'vitest'
import { Logger } from '@src/common/logger.js'
import { forgetDeprecationWarnings } from '@src/common/deprecation.js'
import { respond } from '@src/common/response/response-state.js'
import { createMockInteraction } from './mock-interaction.js'
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
