import { vi } from 'vitest'
import { ButtonInteraction, resolveColor } from 'discord.js'
import { Command, Controller, MessageHandler, MeoCord, Service, UseTheme } from '@src/decorator/index.js'
import { respond, ThemeCache, useTheme } from '@src/common/index.js'
import { CommandType } from '@src/enum/index.js'
import { type ThemeOverride, type ThemeResolvers } from '@src/interface/index.js'
import { DEFAULT_THEME } from '@src/core/theme-defaults.js'
import { setLegacyThemeLayer } from '@src/core/theme-scope.js'
import { createMockInteraction, createMockMessage, createMockTheme, MeoCordTestingModule, withTheme } from '@src/testing/index.js'

const GUILD = '100000000000000001'
const seen: unknown[] = []
const primary = () => useTheme().colors.primary

/** A button pressed in `GUILD`. */
function press(customId: string) {
  const interaction = createMockInteraction(ButtonInteraction, { customId })
  Object.assign(interaction, { guildId: GUILD })
  return interaction
}

@Controller()
class Shop {
  @Command('buy', CommandType.BUTTON)
  buy() {
    seen.push([primary(), useTheme().colors.info])
  }
}

@Controller()
@UseTheme({ colors: { info: '#0000C1' } })
class Themed {
  @Command('themed', CommandType.BUTTON)
  themed() {
    seen.push([primary(), useTheme().colors.info])
  }
}

@MeoCord({
  controllers: [Shop, Themed],
  clientOptions: { intents: [] },
  theme: { colors: { primary: '#0000A1', info: '#0000A2' } },
  themeFor: { guild: () => ({ colors: { primary: '#0000A3' } }) },
})
class App {}

beforeEach(() => {
  seen.length = 0
})
afterEach(() => {
  setLegacyThemeLayer(undefined)
})

describe('overrideTheme', () => {
  it('changes part of the app\'s theme for this module only, keeping the rest', async () => {
    const overridden = MeoCordTestingModule.create({ app: App, controllers: [Shop] }).overrideThemeFor(undefined).overrideTheme({ colors: { primary: '#0000B1' } }).compile()
    const plain = MeoCordTestingModule.create({ app: App, controllers: [Shop] }).overrideThemeFor(undefined).compile()

    await overridden.invoke(Shop, 'buy', press('buy'))
    await plain.invoke(Shop, 'buy', press('buy'))

    // Merged over the app's theme: its info stays
    expect(seen).toEqual([
      ['#0000B1', '#0000A2'],
      ['#0000A1', '#0000A2'],
    ])
  })

  it('keeps the app\'s themeFor over it', async () => {
    await MeoCordTestingModule.create({ app: App, controllers: [Shop] }).overrideTheme({ colors: { info: '#0000B4' } }).compile().invoke(Shop, 'buy', press('buy'))

    expect(seen).toEqual([['#0000A3', '#0000B4']])
  })

  it('gives a module without an app a theme, beneath each @UseTheme', async () => {
    const module = MeoCordTestingModule.create({ controllers: [Shop, Themed] }).overrideTheme({ colors: { primary: '#0000B2' } }).compile()

    await module.invoke(Shop, 'buy', press('buy'))
    await module.dispatch(press('themed'))

    expect(seen).toEqual([
      ['#0000B2', DEFAULT_THEME.colors.info],
      ['#0000B2', '#0000C1'],
    ])
  })

  it('checks the theme where it is given, and keeps a copy', async () => {
    expect(() => MeoCordTestingModule.create({ controllers: [Shop] }).overrideTheme({ colors: { primary: '#GGG' } })).toThrow(
      /^overrideTheme: the theme has 1 problem:\n {2}theme\.colors\.primary: '#GGG' is not a colour/,
    )

    const theme: ThemeOverride = { colors: { primary: '#0000B3' } }
    const builder = MeoCordTestingModule.create({ controllers: [Shop] }).overrideTheme(theme)
    theme.colors!.primary = '#GGG'
    await builder.compile().invoke(Shop, 'buy', press('buy'))

    expect(seen).toEqual([['#0000B3', DEFAULT_THEME.colors.info]])
    expect(Object.isFrozen(theme.colors)).toBe(false)
  })
})

describe('overrideThemeFor', () => {
  it('replaces the app\'s resolvers, through invoke and dispatch', async () => {
    const guild = vi.fn<NonNullable<ThemeResolvers['guild']>>(() => ({ colors: { primary: '#0000D1' } }))
    const module = MeoCordTestingModule.create({ app: App, controllers: [Shop] }).overrideThemeFor({ guild }).compile()

    await module.invoke(Shop, 'buy', press('buy'))
    await module.dispatch(press('buy'))

    expect(seen).toEqual([
      ['#0000D1', '#0000A2'],
      ['#0000D1', '#0000A2'],
    ])
    // Cached per module, as in the bot: one lookup for the server
    expect(guild).toHaveBeenCalledTimes(1)
    expect(guild).toHaveBeenCalledWith({ guild: { id: GUILD } })
  })

  it('removes them with undefined, and adds them to a module without an app', async () => {
    const removed = MeoCordTestingModule.create({ app: App, controllers: [Shop] }).overrideThemeFor(undefined).compile()
    const added = MeoCordTestingModule.create({ controllers: [Shop] })
      .overrideThemeFor({ guild: async () => ({ colors: { primary: '#0000D2' } }) })
      .compile()

    await removed.invoke(Shop, 'buy', press('buy'))
    await added.invoke(Shop, 'buy', press('buy'))

    expect(seen).toEqual([
      ['#0000A1', '#0000A2'],
      ['#0000D2', DEFAULT_THEME.colors.info],
    ])
  })

  it('refuses resolvers the runtime cannot call', () => {
    const builder = MeoCordTestingModule.create({ controllers: [Shop] })
    expect(() => builder.overrideThemeFor({ server: () => undefined } as never)).toThrow("overrideThemeFor has no resolver 'server': give guild or user.")
    expect(() => builder.overrideThemeFor({ guild: '#0000D3' } as never)).toThrow('overrideThemeFor: guild must be a function returning part of a theme.')
    expect(() => builder.overrideThemeFor(null as never)).toThrow(
      'overrideThemeFor takes { guild?, user? }, each a function returning part of a theme, a class implementing ThemeResolver, or undefined for none.',
    )
  })
})

describe('module.themeCache', () => {
  it('is the ThemeCache the module\'s classes inject, and clears the module\'s results', async () => {
    @Service()
    class Settings {
      constructor(readonly themes: ThemeCache) {}
    }
    Reflect.defineMetadata('design:paramtypes', [ThemeCache], Settings)
    const guild = vi.fn((): ThemeOverride => ({ colors: { primary: '#0000E1' } }))
    const module = MeoCordTestingModule.create({ controllers: [Shop], providers: [{ provide: Settings, useClass: Settings }] })
      .overrideThemeFor({ guild })
      .compile()
    const other = MeoCordTestingModule.create({ controllers: [Shop] }).overrideThemeFor({ guild }).compile()

    expect(module.themeCache).toBeInstanceOf(ThemeCache)
    expect(module.get(Settings).themes).toBe(module.themeCache)
    expect(other.themeCache).not.toBe(module.themeCache)

    await module.invoke(Shop, 'buy', press('buy'))
    await module.invoke(Shop, 'buy', press('buy'))
    module.themeCache.invalidateGuild(GUILD)
    await module.invoke(Shop, 'buy', press('buy'))

    expect(guild).toHaveBeenCalledTimes(2)
  })
})

describe('createMockTheme', () => {
  it('is the defaults, whole and frozen, with the overrides merged', () => {
    const theme = createMockTheme({ colors: { danger: '#0000F1' }, emojis: { loading: '⌛' } })

    expect(theme).toEqual({
      colors: { ...DEFAULT_THEME.colors, danger: '#0000F1' },
      emojis: { ...DEFAULT_THEME.emojis, loading: '⌛' },
      buttons: DEFAULT_THEME.buttons,
    })
    expect([Object.isFrozen(theme), Object.isFrozen(theme.colors), Object.isFrozen(theme.emojis), Object.isFrozen(theme.buttons)]).toEqual([true, true, true, true])
  })

  it('is the theme a module with no theme reads, the legacy layer included', async () => {
    expect(createMockTheme()).toEqual(DEFAULT_THEME)
    setLegacyThemeLayer({ colors: { primary: '#0000F2' } })
    await MeoCordTestingModule.create({ controllers: [Shop] }).compile().invoke(Shop, 'buy', press('buy'))

    expect(createMockTheme().colors.primary).toBe('#0000F2')
    expect(seen).toEqual([['#0000F2', DEFAULT_THEME.colors.info]])
  })

  it('checks the overrides and never freezes them', () => {
    expect(() => createMockTheme({ buttons: { danger: 5 as never } })).toThrow(/^createMockTheme: the theme has 1 problem:\n {2}theme\.buttons\.danger: 5/)

    const overrides: ThemeOverride = { colors: { primary: '#0000F3' } }
    createMockTheme(overrides)
    expect(Object.isFrozen(overrides.colors)).toBe(false)
  })
})

describe('withTheme', () => {
  @Service()
  class Formatter {
    async line(text: string) {
      await Promise.resolve()
      return `${useTheme().emojis.success} ${text} ${primary()}`
    }
  }

  it('runs a service called outside any call in the theme it is given, and returns what it returns', async () => {
    const theme = createMockTheme({ emojis: { success: '🎉' }, colors: { primary: '#0000F4' } })
    let inside: unknown

    const line = await withTheme(theme, () => {
      inside = useTheme()
      return new Formatter().line('Saved')
    })

    expect(line).toBe('🎉 Saved #0000F4')
    // A theme createMockTheme made is used as it is
    expect(inside).toBe(theme)
    expect(primary()).toBe(DEFAULT_THEME.colors.primary)
  })

  it('takes part of a theme, as createMockTheme does', () => {
    expect(withTheme({ colors: { primary: '#0000F5' } }, () => [primary(), useTheme().colors.info, Object.isFrozen(useTheme())])).toEqual([
      '#0000F5',
      DEFAULT_THEME.colors.info,
      true,
    ])
  })

  it('checks a theme it is given', () => {
    expect(() => withTheme({ colors: { primary: '#GGG' } }, () => undefined)).toThrow(/^withTheme: the theme has 1 problem:\n {2}theme\.colors\.primary/)
  })
})

describe('respond() outside a call, as in a collector\'s callback', () => {
  // What a handler leaves to run after its call, as collector.on('collect', ...) does
  let collect: ((click: ButtonInteraction) => Promise<unknown>) | undefined

  @Controller()
  class Collecting {
    @Command('collect', CommandType.BUTTON)
    collect() {
      collect = click => respond(click).send({ embeds: [{ description: 'collected' }] })
    }

    @MessageHandler('collect')
    collectFromMessage() {
      collect = click => respond(click).send({ embeds: [{ description: 'collected' }] })
    }
  }

  @MeoCord({
    controllers: [Collecting],
    clientOptions: { intents: [] },
    theme: { colors: { primary: '#0000A4' } },
    themeFor: { guild: () => ({ colors: { primary: '#0000A5' } }) },
  })
  class CollectingApp {}

  /** A click the collector receives later, from the client the call came to. */
  async function clickAfter(client: unknown, guildId?: string) {
    const click = createMockInteraction(ButtonInteraction, { customId: 'picked', client: client as never })
    Object.assign(click, { guildId: guildId ?? null })
    await collect!(click)
    return ((click.update.mock.calls[0]?.[0])).embeds[0].color
  }

  beforeEach(() => {
    collect = undefined
  })

  it('takes the module\'s theme, with the server\'s over it, after dispatch and invoke', async () => {
    const module = MeoCordTestingModule.create({ app: CollectingApp, controllers: [Collecting] }).compile()

    const dispatched = press('collect')
    await module.dispatch(dispatched)
    const afterDispatch = await clickAfter(dispatched.client, GUILD)

    const invoked = createMockInteraction(ButtonInteraction, { customId: 'collect' })
    await module.invoke(Collecting, 'collect', invoked)
    const afterInvoke = await clickAfter(invoked.client)

    expect([afterDispatch, afterInvoke]).toEqual([resolveColor('#0000A5'), resolveColor('#0000A4')])
  })

  it('takes it after a message the module dispatched, whose client a collector on its reply shares', async () => {
    const module = MeoCordTestingModule.create({ app: CollectingApp, controllers: [Collecting] }).compile()
    const message = createMockMessage({ content: 'collect' })

    await module.dispatch(message)

    expect(await clickAfter(message.client)).toBe(resolveColor('#0000A4'))
  })
})
