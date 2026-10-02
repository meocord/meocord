import { vi } from 'vitest'
import { AsyncLocalStorage } from 'node:async_hooks'
import { EventEmitter } from 'node:events'
import { ButtonInteraction, Client } from 'discord.js'
import {
  Catch,
  Command,
  Controller,
  Guard,
  Interceptor,
  MeoCord,
  Service,
  UseGuard,
  UseInterceptor,
  UseTheme,
} from '@src/decorator/index.js'
import { bindTheme, type ExecutionContext, useTheme } from '@src/common/index.js'
import { CommandType } from '@src/enum/index.js'
import { type CallHandler, type ExceptionFilter, type InterceptorInterface } from '@src/interface/index.js'
import { MeoCordFactory } from '@src/core/meocord-factory.js'
import { DEFAULT_THEME } from '@src/core/theme-defaults.js'
import { setLegacyThemeLayer } from '@src/core/theme-scope.js'
import { createMockInteraction, MeoCordTestingModule } from '@src/testing/index.js'

vi.mock('@src/util/meocord-config-loader.util.js', () => ({ loadMeoCordConfig: () => ({ discordToken: 'token' }) }))
vi.mock('@src/util/platform.util.js', () => ({ assertBuiltForThisPlatform: () => {} }))

const seen: unknown[] = []
const primary = () => useTheme().colors.primary
const press = (customId: string) => createMockInteraction(ButtonInteraction, { customId })
const pause = (ms = 5) => new Promise(resolve => setTimeout(resolve, ms))

beforeEach(() => {
  seen.length = 0
})
afterEach(() => {
  vi.restoreAllMocks()
  setLegacyThemeLayer(undefined)
})

describe('useTheme with no app', () => {
  it('reads MeoCord\'s defaults outside any call, and never throws', () => {
    expect(useTheme()).toBe(DEFAULT_THEME)
  })
})

describe('the layers a handler\'s theme is built from', () => {
  @Controller()
  @UseTheme({ colors: { primary: '#000001', success: '#000011' } })
  class BaseShop {
    @Command('base/inherited', CommandType.BUTTON)
    @UseTheme({ emojis: { loading: '🛒' } })
    inherited() {
      seen.push([primary(), useTheme().colors.success, useTheme().emojis.loading])
    }
  }

  @Controller()
  @UseTheme({ colors: { primary: '#000002' } })
  class Shop extends BaseShop {
    @Command('shop/own', CommandType.BUTTON)
    @UseTheme({ colors: { primary: '#000003' } })
    own() {
      seen.push([primary(), useTheme().colors.success, useTheme().colors.danger])
    }

    @Command('shop/plain', CommandType.BUTTON)
    plain() {
      seen.push([primary(), useTheme().colors.success])
    }
  }

  @Controller({ inheritStages: false })
  @UseTheme({ colors: { primary: '#000004' } })
  class Sealed extends BaseShop {
    @Command('sealed/own', CommandType.BUTTON)
    own() {
      seen.push([primary(), useTheme().colors.success, useTheme().colors.info])
    }
  }

  @MeoCord({ controllers: [Shop], clientOptions: { intents: [] }, theme: { colors: { info: '#0000AA', success: '#0000BB' } } })
  class App {}

  // Shop and Sealed both inherit base/inherited, so the bot would take only one of them
  const compile = (controller: typeof Shop | typeof Sealed) => MeoCordTestingModule.create({ app: App, controllers: [controller] }).compile()

  it('merges the app\'s theme, then each class from the base down, then the method, over the defaults', async () => {
    const module = compile(Shop)

    await module.invoke(Shop, 'own', press('shop/own'))
    await module.invoke(Shop, 'plain', press('shop/plain'))
    await module.invoke(Shop, 'inherited', press('base/inherited'))

    expect(seen).toEqual([
      ['#000003', '#000011', DEFAULT_THEME.colors.danger],
      ['#000002', '#000011'],
      // An inherited handler keeps its own method's layer, under the class it is dispatched on
      ['#000002', '#000011', '🛒'],
    ])
  })

  it('stops at a class with inheritStages: false, as guards do, and keeps the app\'s theme beneath it', async () => {
    await compile(Sealed).invoke(Sealed, 'own', press('sealed/own'))

    expect(seen).toEqual([['#000004', '#0000BB', '#0000AA']])
  })

  it('gives context.getTheme() the call\'s theme, and freezes it', async () => {
    @Interceptor()
    class ReadsTheme implements InterceptorInterface {
      intercept(context: ExecutionContext, next: CallHandler) {
        seen.push(context.getTheme().colors.primary)
        const theme = context.getTheme() as { colors: Record<string, unknown> }
        expect(() => {
          theme.colors.primary = '#FFFFFF'
        }).toThrow(TypeError)
        return next.handle()
      }
    }

    @Controller()
    @UseTheme({ colors: { primary: '#000005' } })
    class Read {
      @Command('read', CommandType.BUTTON)
      @UseInterceptor(ReadsTheme)
      read() {}
    }

    await MeoCordTestingModule.create({ controllers: [Read] }).compile().invoke(Read, 'read', press('read'))

    expect(seen).toEqual(['#000005'])
  })

  it('freezes only the plain objects and arrays of a theme, leaving what else an app keeps in it as it is', async () => {
    class Palette {
      series = ['#000001']
    }
    const charts = { palette: new Palette(), lookup: new Map([['a', 1]]), plain: { axis: '#000002', steps: [1, 2] } }

    @Controller()
    class Chart {
      @Command('chart', CommandType.BUTTON)
      chart() {
        const { charts: read } = useTheme() as unknown as { charts: typeof charts }
        seen.push({
          palette: Object.isFrozen(read.palette),
          series: Object.isFrozen(read.palette.series),
          lookup: Object.isFrozen(read.lookup),
          plain: Object.isFrozen(read.plain),
          steps: Object.isFrozen(read.plain.steps),
        })
      }
    }
    @MeoCord({ controllers: [Chart], clientOptions: { intents: [] }, theme: { charts } as never })
    class App {}

    await MeoCordTestingModule.create({ app: App, controllers: [Chart] }).compile().invoke(Chart, 'chart', press('chart'))

    expect(seen).toEqual([{ palette: false, series: false, lookup: false, plain: true, steps: true }])
  })

  it('keeps a __proto__ key from JSON as a key when a layer merges it', async () => {
    @Controller()
    @UseTheme(JSON.parse('{"charts":{"__proto__":{"injected":"yes"}}}'))
    class Chart {
      @Command('proto', CommandType.BUTTON)
      proto() {
        const { charts } = useTheme() as unknown as { charts: Record<string, unknown> }
        seen.push([Object.keys(charts).sort(), (charts as { injected?: string }).injected, Object.getPrototypeOf(charts) === Object.prototype])
      }
    }
    @MeoCord({ controllers: [Chart], clientOptions: { intents: [] }, theme: { charts: { axis: '#000001' } } as never })
    class App {}

    await MeoCordTestingModule.create({ app: App, controllers: [Chart] }).compile().invoke(Chart, 'proto', press('proto'))

    expect(seen).toEqual([[['__proto__', 'axis'], undefined, true]])
  })

  it('never freezes the object an app gives @UseTheme', () => {
    const brand = { colors: { primary: '#000006' } } as const

    @Controller()
    @UseTheme(brand)
    class Branded {}

    expect(Object.isFrozen(brand)).toBe(false)
    expect(Object.isFrozen(brand.colors)).toBe(false)
    expect(Branded).toBeDefined()
  })
})

describe('what a call\'s theme reaches', () => {
  @Service()
  class Formatter {
    colour() {
      return primary()
    }
  }

  @Guard()
  class Allow {
    canActivate() {
      seen.push(['guard', primary()])
      return true
    }
  }

  @Controller()
  @UseTheme({ colors: { primary: '#0000C1' } })
  class Other {
    @Command('other', CommandType.BUTTON)
    @UseGuard(Allow)
    @UseTheme({ colors: { primary: '#0000C2' } })
    async other(_interaction: ButtonInteraction) {
      seen.push(['other', primary()])
    }
  }

  @Controller()
  @UseTheme({ colors: { primary: '#0000D1' } })
  class Main {
    constructor(
      private readonly formatter: Formatter,
      private readonly otherController: Other,
    ) {}

    @Command('main', CommandType.BUTTON)
    async main(interaction: ButtonInteraction) {
      seen.push(['service', this.formatter.colour()])
      // Called directly, another controller's handler keeps the caller's theme: the theme is the call's
      await this.otherController.other(interaction)
      setTimeout(() => seen.push(['timer', primary()]), 5)
      seen.push(['after await', primary()])
    }
  }
  Reflect.defineMetadata('design:paramtypes', [Formatter, Other], Main)

  it('reaches services, a directly called handler, and work that outlives the call', async () => {
    const module = MeoCordTestingModule.create({ controllers: [Main, Other], providers: [{ provide: Formatter, useClass: Formatter }] }).compile()

    await module.invoke(Main, 'main', press('main'))
    seen.push(['outside', primary()])
    await pause(15)

    expect(seen).toEqual([
      ['service', '#0000D1'],
      ['guard', '#0000D1'],
      ['other', '#0000D1'],
      ['after await', '#0000D1'],
      ['outside', DEFAULT_THEME.colors.primary],
      ['timer', '#0000D1'],
    ])
  })

  it('gives each overlapping call its own theme, and a nested dispatch its own, restoring the outer one', async () => {
    const module = MeoCordTestingModule.create({ controllers: [Main, Other], providers: [{ provide: Formatter, useClass: Formatter }] }).compile()

    @Controller()
    @UseTheme({ colors: { primary: '#0000E1' } })
    class Outer {
      @Command('outer', CommandType.BUTTON)
      async outer() {
        seen.push(['outer before', primary()])
        await module.invoke(Other, 'other', press('other'))
        seen.push(['outer after', primary()])
      }
    }
    const outerModule = MeoCordTestingModule.create({ controllers: [Outer] }).compile()

    await Promise.all([outerModule.invoke(Outer, 'outer', press('outer')), module.invoke(Main, 'main', press('main'))])
    await pause(15)

    const outer = (seen as unknown[][]).filter(([what]) => String(what).startsWith('outer'))
    expect(outer).toEqual([
      ['outer before', '#0000E1'],
      ['outer after', '#0000E1'],
    ])
    // The nested dispatch ran in Other's own theme; Main's direct call to it, alongside, in Main's
    expect(seen).toContainEqual(['other', '#0000C2'])
    expect(seen).toContainEqual(['other', '#0000D1'])
  })
})

describe('a listener the handler registers', () => {
  it('runs in the emitter\'s context, and in the handler\'s theme once bound with bindTheme', async () => {
    const emitter = new EventEmitter()

    @Controller()
    @UseTheme({ colors: { primary: '#0C0B0A' } })
    class Collecting {
      @Command('collect', CommandType.BUTTON)
      collect() {
        emitter.on('tick', () => seen.push(['unbound', primary()]))
        emitter.on('tick', bindTheme(function (this: EventEmitter, value: number) {
          seen.push(['bound', primary(), value, this === emitter])
        }))
      }
    }

    await MeoCordTestingModule.create({ controllers: [Collecting] }).compile().invoke(Collecting, 'collect', press('collect'))
    emitter.emit('tick', 7)

    expect(seen).toEqual([
      ['unbound', DEFAULT_THEME.colors.primary],
      ['bound', '#0C0B0A', 7, true],
    ])
  })
})

describe('apps in one process', () => {
  @Controller()
  class Plain {
    @Command('plain', CommandType.BUTTON)
    plain() {
      seen.push(primary())
    }
  }

  it('keeps each testing module\'s app theme to its own calls', async () => {
    @MeoCord({ controllers: [Plain], clientOptions: { intents: [] }, theme: { colors: { primary: '#0000F1' } } })
    class First {}
    @MeoCord({ controllers: [Plain], clientOptions: { intents: [] }, theme: { colors: { primary: '#0000F2' } } })
    class Second {}
    const first = MeoCordTestingModule.create({ app: First, controllers: [Plain] }).compile()
    const second = MeoCordTestingModule.create({ app: Second, controllers: [Plain] }).compile()

    await Promise.all([first.invoke(Plain, 'plain', press('plain')), second.invoke(Plain, 'plain', press('plain'))])

    expect(seen.sort()).toEqual(['#0000F1', '#0000F2'])
    expect(primary()).toBe(DEFAULT_THEME.colors.primary)
  })

  it('enters no scope for an app with no @UseTheme and no theme of its own', async () => {
    const run = vi.spyOn(AsyncLocalStorage.prototype, 'run')

    await MeoCordTestingModule.create({ controllers: [Plain] }).compile().invoke(Plain, 'plain', press('plain'))

    expect(seen).toEqual([DEFAULT_THEME.colors.primary])
    expect(run).not.toHaveBeenCalled()
  })

  it('enters no scope for an app theme that sets nothing', async () => {
    const run = vi.spyOn(AsyncLocalStorage.prototype, 'run')
    for (const theme of [{}, { colors: {} }, { colors: { primary: undefined } }]) {
      @MeoCord({ controllers: [Plain], clientOptions: { intents: [] }, theme })
      class Empty {}
      await MeoCordTestingModule.create({ app: Empty, controllers: [Plain] }).compile().invoke(Plain, 'plain', press('plain'))
    }

    expect(run).not.toHaveBeenCalled()
    expect(seen).toEqual([DEFAULT_THEME.colors.primary, DEFAULT_THEME.colors.primary, DEFAULT_THEME.colors.primary])
  })

  it('reads the started bot\'s app theme outside any call, and enters no scope for it', async () => {
    const clients: Client[] = []
    vi.spyOn(Client.prototype, 'login').mockImplementation(function (this: Client) {
      clients.push(this)
      return Promise.resolve('token')
    })
    @MeoCord({ controllers: [Plain], clientOptions: { intents: [] }, theme: { colors: { primary: '#0000F3' } } })
    class Bot {}
    await MeoCordFactory.create(Bot).start()
    const run = vi.spyOn(AsyncLocalStorage.prototype, 'run')

    await Promise.all(clients[0].rawListeners('interactionCreate').map(listener => (listener as (i: unknown) => unknown)(press('plain'))))

    expect(seen).toEqual(['#0000F3'])
    expect(primary()).toBe('#0000F3')
    expect(run).not.toHaveBeenCalled()
  })
})

describe('an error no route takes', () => {
  it('reaches the global filters in the app\'s theme', async () => {
    @Catch()
    class Record implements ExceptionFilter {
      catch() {
        seen.push(primary())
      }
    }

    @Controller()
    @UseTheme({ colors: { primary: '#0000A2' } })
    class Some {
      @Command('some', CommandType.BUTTON)
      some() {}
    }

    @MeoCord({ controllers: [Some], filters: [Record], clientOptions: { intents: [] }, theme: { colors: { primary: '#0000A1' } } })
    class App {}

    await MeoCordTestingModule.create({ app: App, controllers: [Some] }).compile().dispatch(press('nowhere'))

    expect(seen).toEqual(['#0000A1'])
  })
})

describe('a theme that is not valid', () => {
  it('stops @MeoCord where the app is declared, naming the app and the token', () => {
    expect(() => {
      @MeoCord({ controllers: [], clientOptions: { intents: [] }, theme: { colors: { primary: '#GGGGGG' } } })
      class Broken {}
      return Broken
    }).toThrow(/Broken: @MeoCord\(\{ theme \}\): the theme has 1 problem:\n {2}theme\.colors\.primary/)
  })

  it('stops @UseTheme where it applies, naming the class and the method', () => {
    expect(() => {
      @Controller()
      class Broken {
        @Command('x', CommandType.BUTTON)
        @UseTheme({ emojis: { loading: 'not an emoji' } })
        x() {}
      }
      return Broken
    }).toThrow(/Broken\.x: @UseTheme: the theme has 1 problem:\n {2}theme\.emojis\.loading/)
  })

  it('keeps the theme @MeoCord checked, whatever happens to the object afterwards', async () => {
    const theme: { colors: { primary: `#${string}` } } = { colors: { primary: '#0E0E0E' } }
    @Controller()
    class Plain {
      @Command('plain', CommandType.BUTTON)
      plain() {
        seen.push(primary())
      }
    }
    @MeoCord({ controllers: [Plain], clientOptions: { intents: [] }, theme })
    class App {}
    theme.colors.primary = '#GGG'

    await MeoCordTestingModule.create({ app: App, controllers: [Plain] }).compile().invoke(Plain, 'plain', press('plain'))

    expect(seen).toEqual(['#0E0E0E'])
  })

  it('refuses a second @UseTheme on one class', () => {
    expect(() => {
      @Controller()
      @UseTheme({ colors: { primary: '#000001' } })
      @UseTheme({ colors: { info: '#000002' } })
      class Twice {}
      return Twice
    }).toThrow('Twice: @UseTheme: there is one already')
  })
})

describe('the layer the deprecated Theme statics write', () => {
  it('goes beneath the app\'s theme, and a running app sees it at once', async () => {
    @Controller()
    class Plain {
      @Command('plain', CommandType.BUTTON)
      plain() {
        seen.push([primary(), useTheme().colors.info])
      }
    }
    @MeoCord({ controllers: [Plain], clientOptions: { intents: [] }, theme: { colors: { info: '#0000B1' } } })
    class App {}
    const module = MeoCordTestingModule.create({ app: App, controllers: [Plain] }).compile()

    await module.invoke(Plain, 'plain', press('plain'))
    setLegacyThemeLayer({ colors: { primary: '#0000B2', info: '#0000B3' } })
    await module.invoke(Plain, 'plain', press('plain'))

    expect(seen).toEqual([
      [DEFAULT_THEME.colors.primary, '#0000B1'],
      ['#0000B2', '#0000B1'],
    ])
  })
})
