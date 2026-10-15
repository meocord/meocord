import 'reflect-metadata'
import { ButtonInteraction, ChatInputCommandInteraction, type Interaction } from 'discord.js'
import { vi } from 'vitest'
import { Logger } from '@src/common/logger.js'
import { forgetDeprecationWarnings } from '@src/common/deprecation.js'
import { createTranslator, defineCatalog, respond, UserError } from '@src/common/index.js'
import { translatorOfClient } from '@src/common/meocord-text.js'
import { Command, Controller, MeoCord, On } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { type PresentedError, type ResponsePresenter } from '@src/interface/index.js'
import { forgetStrictMocks, useStrictMocks } from '@src/testing/strict-mocks.js'
import { createMockClient, createMockInteraction, getResponse, MeoCordTestingModule } from '@src/testing/index.js'

let warned: string[]
beforeEach(() => {
  forgetStrictMocks()
  forgetDeprecationWarnings()
  warned = []
  vi.spyOn(Logger.prototype, 'warn').mockImplementation((text: unknown) => void warned.push(String(text)))
})
afterEach(() => vi.restoreAllMocks())
afterAll(() => forgetStrictMocks())

class AppPresenter implements ResponsePresenter {
  loading() {
    return { text: 'Working' }
  }
  error(_context: unknown, { message }: PresentedError) {
    return { text: `APP: ${message}` }
  }
}

@Controller()
class Shop {
  @Command('buy', CommandType.SLASH)
  buy() {
    throw new UserError('nope')
  }

  @On('interactionCreate')
  async expire(interaction: Interaction) {
    if (interaction.isButton()) await respond(interaction).error(new UserError('expired'))
  }
}

const t = createTranslator({ default: 'en-US', locales: { 'en-US': defineCatalog({ shop: { closed: 'Closed.' } }) } })

@MeoCord({ controllers: [Shop], presenter: AppPresenter, clientOptions: { intents: [] }, i18n: t })
class App {}

/** Whether the interaction was answered with the app's presenter. */
const byApp = (interaction: Interaction) => JSON.stringify(getResponse(interaction).calls).includes('APP: ')

const LEAKED = /^A module without a presenter here answers with the presenter another module set on the same client; under useStrictMocks\(\)/

describe('two modules dispatching on one client', () => {
  it.each([
    ['in default mode, the app first', () => undefined, true, [true, true], [LEAKED]],
    ['in default mode, the app last', () => undefined, false, [false, true], []],
    ['under useStrictMocks(), the app first', () => useStrictMocks(), true, [true, false], []],
    ['under useStrictMocks(), the app last', () => useStrictMocks(), false, [false, true], []],
  ] as const)('answer as the mode has it: %s', async (_, mode, appFirst, answers, warnings) => {
    mode()
    const client = createMockClient()
    const withApp = MeoCordTestingModule.create({ app: App, controllers: [Shop] }).compile()
    const plain = MeoCordTestingModule.create({ controllers: [Shop] }).compile()
    const answered: boolean[] = []

    for (const module of appFirst ? [withApp, plain] : [plain, withApp]) {
      const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName: 'buy', client })
      await module.dispatch(interaction)
      answered.push(byApp(interaction))
    }

    // Default mode keeps the presenter another module set, with a warning; strict mocks answer with each module's own
    expect(answered).toEqual(answers)
    expect(warned).toEqual(warnings.map(text => expect.stringMatching(text)))
  })
})

const EMIT_LEAVES = /^emit\(\) here leaves the client's presenter, theme and translator as they were.*5\.0.*useStrictMocks\(\)/s

describe('an event emitted to a module', () => {
  it("is answered with the app's presenter and translator under useStrictMocks(), as on the bot", async () => {
    useStrictMocks()
    const button = createMockInteraction(ButtonInteraction, { customId: 'old/1' })

    await MeoCordTestingModule.fromApp(App).compile().emit('interactionCreate', button)

    expect(byApp(button)).toBe(true)
    expect(translatorOfClient(button.client)).toBe(t)
    expect(warned).toEqual([])
  })

  it('leaves the client as it was in default mode, with a warning once', async () => {
    const button = createMockInteraction(ButtonInteraction, { customId: 'old/1' })
    const module = MeoCordTestingModule.fromApp(App).compile()

    await module.emit('interactionCreate', button)
    await module.emit('interactionCreate', createMockInteraction(ButtonInteraction, { customId: 'old/2' }))

    expect([byApp(button), translatorOfClient(button.client)]).toEqual([false, undefined])
    expect(warned).toEqual([expect.stringMatching(EMIT_LEAVES)])
  })

  it('warns in default mode for a module with a theme alone, which strict mocks set on the client too', async () => {
    const module = MeoCordTestingModule.create({ controllers: [Shop] }).overrideTheme({ colors: { primary: '#BB0000' } }).compile()

    await module.emit('interactionCreate', createMockInteraction(ButtonInteraction, { customId: 'old/1' }))

    expect(warned).toEqual([expect.stringMatching(EMIT_LEAVES)])
  })

  @MeoCord({ controllers: [Shop], clientOptions: { intents: [] } })
  class PlainApp {}

  it.each([
    ['made with create()', () => MeoCordTestingModule.create({ controllers: [Shop] }).compile()],
    ['made from an app', () => MeoCordTestingModule.fromApp(PlainApp).compile()],
  ] as const)('warns of nothing in default mode for a module with no presenter, theme or translator of its own, %s', async (_, compile) => {
    await compile().emit('interactionCreate', createMockInteraction(ButtonInteraction, { customId: 'old/1' }))

    expect(warned).toEqual([])
  })
})
