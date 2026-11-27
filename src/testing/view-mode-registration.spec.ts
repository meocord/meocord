import 'reflect-metadata'
import { ChatInputCommandInteraction, type Interaction, MessageFlags } from 'discord.js'
import { vi } from 'vitest'
import { Logger } from '@src/common/logger.js'
import { UserError } from '@src/common/errors.js'
import { respond } from '@src/common/response/response-state.js'
import { viewModeFor } from '@src/common/response/presenter.js'
import { Command, Controller, MeoCord, On } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { createMockInteraction, getResponse, MeoCordTestingModule, type TestingModule } from '@src/testing/index.js'
import { forgetStrictMocks, useStrictMocks } from '@src/testing/strict-mocks.js'

const { Ephemeral, IsComponentsV2 } = MessageFlags

beforeEach(() => {
  forgetStrictMocks()
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
})
afterEach(() => vi.restoreAllMocks())
afterAll(() => forgetStrictMocks())

@Controller()
class Refusals {
  @Command('ping', CommandType.SLASH)
  async ping(interaction: ChatInputCommandInteraction) {
    await respond(interaction).error(new UserError('Not yours.'))
  }

  @On('interactionCreate')
  async heard(interaction: Interaction) {
    await respond(interaction).error(new UserError('Not yours.'))
  }
}

// On MeoCord's default presenter, which binds no presenter of the app's
@MeoCord({ controllers: [Refusals], viewMode: 'v2', clientOptions: { intents: [] } })
class V2App {}

@MeoCord({ controllers: [Refusals], clientOptions: { intents: [] } })
class EmbedApp {}

const replyFlags = (interaction: object) => {
  const reply = getResponse(interaction as never).calls.find(call => call.method === 'reply')
  return (reply?.payload as { flags?: number } | undefined)?.flags
}
const slash = () => createMockInteraction(ChatInputCommandInteraction, { commandName: 'ping' })

describe.each([
  ['default mode', () => undefined],
  ['strict mocks', () => useStrictMocks()],
])("a testing module's viewMode, in %s", (_, mode) => {
  beforeEach(() => mode())

  it.each([
    ['invoke', (module: TestingModule, interaction: ChatInputCommandInteraction) => module.invoke(Refusals, 'ping', interaction)],
    ['dispatch', (module: TestingModule, interaction: ChatInputCommandInteraction) => module.dispatch(interaction)],
    ['emit', (module: TestingModule, interaction: ChatInputCommandInteraction) => module.emit('interactionCreate', interaction)],
  ] as const)('answers %s with the Components V2 views the bot sends', async (__, run) => {
    const module = await MeoCordTestingModule.fromApp(V2App).compile().init()
    const interaction = slash()

    await run(module, interaction)

    expect(replyFlags(interaction)).toBe(Ephemeral | IsComponentsV2)
    await module.close()
  })

  it("puts a module's own viewMode on a client another module answered with 'v2'", async () => {
    const v2 = await MeoCordTestingModule.fromApp(V2App).compile().init()
    const embed = await MeoCordTestingModule.fromApp(EmbedApp).compile().init()
    const first = slash()
    const second = createMockInteraction(ChatInputCommandInteraction, { commandName: 'ping', client: first.client })

    await v2.dispatch(first)
    await embed.dispatch(second)

    expect([replyFlags(first), replyFlags(second), viewModeFor(first.client)]).toEqual([Ephemeral | IsComponentsV2, Ephemeral, 'embed'])
    await Promise.all([v2.close(), embed.close()])
  })
})

describe('@MeoCord({ viewMode })', () => {
  it.each(['card', 'V2', true])('refuses %o where the app is declared', viewMode => {
    const declare = () => {
      @MeoCord({ controllers: [], clientOptions: { intents: [] }, viewMode: viewMode as never })
      class App {}
      return App
    }

    expect(declare).toThrow(`App: @MeoCord({ viewMode }) must be 'embed' or 'v2' (got ${JSON.stringify(viewMode)}).`)
  })
})
