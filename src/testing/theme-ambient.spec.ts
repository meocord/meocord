import { ButtonInteraction } from 'discord.js'
import { Command, Controller, MeoCord } from '@src/decorator/index.js'
import { useTheme } from '@src/common/index.js'
import { CommandType } from '@src/enum/index.js'
import { type OnReady, type OnShutdown } from '@src/interface/index.js'
import { DEFAULT_THEME } from '@src/core/theme-defaults.js'
import { createMockInteraction, MeoCordTestingModule } from '@src/testing/index.js'

const seen: unknown[] = []
const primary = () => useTheme().colors.primary

@Controller()
class Shop implements OnReady {
  onReady() {
    seen.push(['ready', primary()])
  }

  @Command('buy', CommandType.BUTTON)
  buy() {
    seen.push(['buy', primary()])
  }
}

@MeoCord({ controllers: [Shop], clientOptions: { intents: [] }, theme: { colors: { primary: '#0000A1' } } })
class First {}

@MeoCord({ controllers: [Shop], clientOptions: { intents: [] }, theme: { colors: { primary: '#0000A2' } } })
class Second {}

const compile = (app: new () => unknown) => MeoCordTestingModule.create({ app, controllers: [Shop] }).compile()

beforeEach(() => {
  seen.length = 0
})

// A file of its own: which app's theme is read outside calls is one value for the whole process
describe('the theme read outside calls, in a testing module', () => {
  it('is the app\'s once the module is ready, as for a bot online, until close()', async () => {
    const module = compile(First)
    await module.init()
    const initialised = primary()

    await module.init({ ready: true })
    const ready = primary()
    await module.close()

    expect([initialised, ready, primary()]).toEqual([DEFAULT_THEME.colors.primary, '#0000A1', DEFAULT_THEME.colors.primary])
    // onReady runs as the bot's does, reading the app's theme outside any call
    expect(seen).toEqual([['ready', '#0000A1']])
  })

  it('stays with the first module ready; a second keeps its theme to its calls, and its close() leaves the first\'s', async () => {
    const first = await compile(First).init({ ready: true })
    const second = await compile(Second).init({ ready: true })

    await second.invoke(Shop, 'buy', createMockInteraction(ButtonInteraction, { customId: 'buy' }))
    const whileBoth = primary()
    await second.close()
    const afterSecond = primary()
    await first.close()

    expect(seen).toEqual([
      ['ready', '#0000A1'],
      // The second's onReady ran outside any call, where the first's theme is read
      ['ready', '#0000A1'],
      ['buy', '#0000A2'],
    ])
    expect([whileBoth, afterSecond, primary()]).toEqual(['#0000A1', '#0000A1', DEFAULT_THEME.colors.primary])
  })

  // Given up after the hooks, so onShutdown reads the app's theme as onReady did
  it("is still the app's while its onShutdown hooks run", async () => {
    @Controller()
    class Closer implements OnShutdown {
      onShutdown() {
        seen.push(['shutdown', primary()])
      }
    }
    @MeoCord({ controllers: [Closer], clientOptions: { intents: [] }, theme: { colors: { primary: '#0000A3' } } })
    class Third {}
    const module = await MeoCordTestingModule.create({ app: Third, controllers: [Closer] }).compile().init({ ready: true })

    await module.close()

    expect(seen).toEqual([['shutdown', '#0000A3']])
    expect(primary()).toBe(DEFAULT_THEME.colors.primary)
  })

  it('goes back to the defaults when the first closes, not to a second module that is still ready', async () => {
    const first = await compile(First).init({ ready: true })
    const second = await compile(Second).init({ ready: true })

    await first.close()
    const afterFirst = primary()
    await second.invoke(Shop, 'buy', createMockInteraction(ButtonInteraction, { customId: 'buy' }))
    await second.close()

    expect(afterFirst).toBe(DEFAULT_THEME.colors.primary)
    expect(seen.at(-1)).toEqual(['buy', '#0000A2'])
  })
})
