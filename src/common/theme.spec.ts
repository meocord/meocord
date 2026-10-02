import { vi } from 'vitest'
import { ButtonInteraction, resolveColor } from 'discord.js'
import { Logger, respond, Theme, useTheme } from '@src/common/index.js'
import { resetThemeStatics } from '@src/common/theme.js'
import { DEFAULT_THEME } from '@src/core/theme-defaults.js'
import { Command, Controller, Defer, MeoCord, UseTheme } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { createMockInteraction, createMockMessage, getResponse, MeoCordTestingModule } from '@src/testing/index.js'

const read: unknown[] = []

@Controller()
@UseTheme({ colors: { primary: '#000001', danger: '#000002' } })
class Scoped {
  @Command('scoped', CommandType.BUTTON)
  scoped() {
    read.push(Theme.primaryColor, Theme.errorColor)
  }
}

@Controller()
class Answering {
  @Command('crash', CommandType.BUTTON)
  crash() {
    throw new Error('crash')
  }

  @Command('slow', CommandType.BUTTON)
  @Defer()
  async slow(interaction: ButtonInteraction) {
    await respond(interaction).send({ embeds: [{ description: 'done' }] })
  }
}

@Controller()
class Plain {
  @Command('plain', CommandType.BUTTON)
  plain() {
    read.push(Theme.primaryColor, Theme.successColor)
  }
}

const press = (customId: string) => createMockInteraction(ButtonInteraction, { customId })
const warnings = () => vi.mocked(Logger.prototype.warn).mock.calls.map(([line]) => String(line))

beforeEach(() => {
  read.length = 0
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
})
afterEach(() => {
  resetThemeStatics()
  vi.restoreAllMocks()
})

describe('Theme, deprecated', () => {
  it("reads MeoCord's default roles outside a call, errorColor as danger", () => {
    const { colors } = DEFAULT_THEME
    expect([Theme.primaryColor, Theme.successColor, Theme.infoColor, Theme.errorColor, Theme.warningColor]).toEqual([
      colors.primary,
      colors.success,
      colors.info,
      colors.danger,
      colors.warning,
    ])
  })

  it('reads the theme of the call it is read in, @UseTheme included', async () => {
    await MeoCordTestingModule.create({ controllers: [Scoped] }).compile().invoke(Scoped, 'scoped', press('scoped'))

    expect(read).toEqual(['#000001', '#000002'])
  })

  it('sets a role beneath every theme an app sets: read back where nothing overrides it', async () => {
    Theme.primaryColor = '#123456'
    Theme.successColor = '#654321'
    @MeoCord({ controllers: [Plain], clientOptions: { intents: [] }, theme: { colors: { success: '#00FF00' } } })
    class App {}

    await MeoCordTestingModule.create({ app: App, controllers: [Plain] }).compile().invoke(Plain, 'plain', press('plain'))

    expect([Theme.primaryColor, useTheme().colors.primary]).toEqual(['#123456', '#123456'])
    // In the app's call: primary from the assignment, success from the app's theme over it
    expect(read).toEqual(['#123456', '#00FF00'])
  })

  it('recolours what respond() sends when assigned after the app has answered', async () => {
    @MeoCord({ controllers: [Answering], clientOptions: { intents: [] }, theme: { colors: { info: '#00FF00' } } })
    class App {}
    const module = MeoCordTestingModule.create({ app: App, controllers: [Answering] }).compile()
    // A call first: the app's theme is built lazily, so without it the assignment would never have to rebuild it
    await module.dispatch(press('crash')).catch(() => undefined)
    Theme.primaryColor = '#0A0B0C'
    Theme.errorColor = '#0D0E0F'
    const crashed = press('crash')
    const deferred = createMockInteraction(ButtonInteraction, {
      customId: 'slow',
      message: createMockMessage({ embeds: [{ description: 'card' }], components: [] }),
    })

    await module.dispatch(crashed).catch(() => undefined)
    await module.dispatch(deferred)

    const colours = (interaction: ButtonInteraction) =>
      getResponse(interaction).calls.map(call => [call.method, (call.payload as { embeds?: { color?: number }[] } | undefined)?.embeds?.at(-1)?.color])
    expect(colours(crashed)).toEqual([['reply', resolveColor('#0D0E0F')]])
    // The loading view Defer puts under the card, then the answer
    expect(colours(deferred)).toEqual([
      ['deferUpdate', undefined],
      ['editReply', resolveColor('#0A0B0C')],
      ['editReply', resolveColor('#0A0B0C')],
    ])
  })

  it('warns once for each property set and each property read, naming what replaces it', () => {
    Theme.primaryColor = '#111111'
    Theme.primaryColor = '#222222'
    Theme.errorColor = '#333333'
    void [Theme.primaryColor, Theme.primaryColor, Theme.successColor]

    expect(warnings()).toEqual([
      'Assigning Theme.primaryColor is deprecated and will be removed in the next major version (5.0). Use colors.primary in @MeoCord({ theme }) instead.',
      'Assigning Theme.errorColor is deprecated and will be removed in the next major version (5.0). Use colors.danger in @MeoCord({ theme }) instead.',
      'Theme.primaryColor is deprecated and will be removed in the next major version (5.0). Use useTheme().colors.primary instead.',
      'Theme.successColor is deprecated and will be removed in the next major version (5.0). Use useTheme().colors.success instead.',
    ])
  })

  it('never throws on an assignment: a colour that is not one is reported and left unset', () => {
    expect(() => {
      Theme.warningColor = '#GGG' as never
    }).not.toThrow()

    expect(Theme.warningColor).toBe(DEFAULT_THEME.colors.warning)
    expect(warnings()).toContainEqual(expect.stringMatching(/Theme\.warningColor.*#GGG/))
  })
})
