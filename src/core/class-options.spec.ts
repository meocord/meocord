import 'reflect-metadata'
import { vi } from 'vitest'
import { type ButtonInteraction } from 'discord.js'
import { Translator } from '@src/common/translator.js'
import { MeoCordFactory } from '@src/core/meocord-factory.js'
import { Command, Controller, MeoCord, Observer } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { MeoCordTestingModule, reportAllStartupErrors } from '@src/testing/index.js'
import { forgetDeclaredErrors, startupErrorsOf } from '@src/util/refusal.util.js'

vi.mock('@src/util/meocord-config-loader.util.js', () => ({ loadMeoCordConfig: () => ({ discordToken: 'token' }) }))
vi.mock('@src/util/platform.util.js', () => ({ assertBuiltForThisPlatform: () => {} }))

// Every option that takes a class refuses anything else by name, where the app is declared or as it is created.

@Controller()
class Tools {
  @Command('tool', CommandType.BUTTON)
  async tool(_interaction: ButtonInteraction) {}
}

/** What `run` throws, which fails the test when it throws nothing. */
function thrownBy(run: () => unknown): Error {
  try {
    run()
  } catch (error) {
    return error as Error
  }
  throw new Error('nothing was thrown')
}

const declare = (options: object) => () => MeoCord({ controllers: [Tools], clientOptions: { intents: [] }, ...options } as never)(class App {})

const arrow = () => ({})
const method = { make() {} }.make

describe('@MeoCord given what is no class for an option that takes one', () => {
  it.each([
    ['presenter', { loading() {}, error() {} }, 'takes a class implementing ResponsePresenter, not an object'],
    ['presenter', arrow, 'takes a class implementing ResponsePresenter, not a function'],
    ['presenter', method, 'takes a class implementing ResponsePresenter, not a function'],
    ['cooldownStore', { take() {} }, 'takes a class implementing CooldownStore, not an object'],
    ['cooldownStore', arrow, 'takes a class implementing CooldownStore, not a function'],
  ])('refuses a %s of %o, naming it', (option, value, reason) => {
    expect(declare({ [option]: value })).toThrow(new TypeError(`App: @MeoCord({ ${option} }) ${reason}.`))
  })

  it.each([
    [{ y: 2 }, 'an object'],
    [arrow, 'a function'],
    ['Tools', '"Tools"'],
    [Symbol('Tools'), 'a symbol'],
  ])('refuses a controller of %o', (value, named) => {
    expect(declare({ controllers: [Tools, value] })).toThrow(`App: @MeoCord({ controllers }) takes classes, not ${named}.`)
  })

  it.each([
    [{ x: 1 }, 'an object'],
    [arrow, 'a function'],
    [42, 'a number'],
  ])('refuses a service of %o', (value, named) => {
    expect(declare({ services: [value] })).toThrow(`App: @MeoCord({ services }) takes classes, or tokens that providers provide, not ${named}.`)
  })

  it('refuses an observer that is an arrow function, naming it as a function', () => {
    expect(declare({ observers: [arrow] })).toThrow('App: @MeoCord({ observers }) takes classes decorated with @Observer(), not a function.')
  })
})

describe("with startupErrors: 'all'", () => {
  afterEach(() => forgetDeclaredErrors())

  it('the refused option is what create() and fromApp() report', () => {
    reportAllStartupErrors()
    @MeoCord({ controllers: [Tools], presenter: {} as never, clientOptions: { intents: [] } })
    class App {}
    const refused = 'App: @MeoCord({ presenter }) takes a class implementing ResponsePresenter, not an object.'

    expect(() => MeoCordFactory.create(App)).toThrow(refused)
    expect(() => MeoCordTestingModule.fromApp(App)).toThrow(refused)
  })
})

describe('a service listed by a token', () => {
  const TOKEN = Symbol('Settings')

  it('is refused as the app is created or compiled when nothing provides it', () => {
    @MeoCord({ controllers: [Tools], services: [TOKEN, 'Clock'], clientOptions: { intents: [] } })
    class App {}

    const fromCreate = thrownBy(() => MeoCordFactory.create(App))
    const fromCompile = thrownBy(() => MeoCordTestingModule.fromApp(App).compile())

    expect(startupErrorsOf(fromCreate).map(error => error.message)).toEqual([
      'App: @MeoCord({ services }) lists Symbol(Settings), which nothing provides: add a provider for it to @MeoCord({ providers }).',
      "App: @MeoCord({ services }) lists 'Clock', which nothing provides: add a provider for it to @MeoCord({ providers }).",
    ])
    expect(fromCompile.message).toBe(
      "App: @MeoCord({ services }) lists Symbol(Settings), which nothing provides: add a provider for it to @MeoCord({ providers }) or the testing module's providers.",
    )
  })

  it("starts when the app's providers provide it, or compiles when the test's do", () => {
    @MeoCord({ controllers: [Tools], services: [TOKEN], providers: [{ provide: TOKEN, useValue: { prefix: '!' } }], clientOptions: { intents: [] } })
    class Provided {}
    @MeoCord({ controllers: [Tools], services: [TOKEN], clientOptions: { intents: [] } })
    class ProvidedByTheTest {}

    expect(() => MeoCordFactory.create(Provided)).not.toThrow()
    expect(MeoCordTestingModule.fromApp(Provided).compile().get(TOKEN)).toEqual({ prefix: '!' })
    expect(MeoCordTestingModule.fromApp(ProvidedByTheTest, { providers: [{ provide: TOKEN, useValue: 1 }] }).compile().get(TOKEN)).toBe(1)
  })
})

describe("a testing module's own lists", () => {
  @Observer()
  class Watch {
    onSettled() {}
  }
  it('refuses a controller or an observer that is no class, reporting both', () => {
    const error = thrownBy(() => MeoCordTestingModule.create({ controllers: [Tools, { y: 2 } as never], observers: [Watch, arrow as never] }).compile())

    expect(startupErrorsOf(error).map(each => each.message)).toEqual([
      "the testing module's controllers takes classes, not an object.",
      "the testing module's observers takes classes decorated with @Observer(), not a function.",
    ])
  })

  it('leaves a refused controller out of the checks of the rest, which still report what they find', () => {
    class Greeter {
      constructor(readonly translator: unknown) {}
    }
    // Recorded first, as TypeScript emits it beside the class decorator, which reads it
    Reflect.defineMetadata('design:paramtypes', [Translator], Greeter)
    Controller()(Greeter)

    const error = thrownBy(() => MeoCordTestingModule.create({ controllers: [Tools, arrow as never, Greeter] }).compile())

    expect(startupErrorsOf(error).map(each => each.message)).toEqual([
      "the testing module's controllers takes classes, not a function.",
      'Greeter: it injects Translator, but @MeoCord has no i18n. Pass @MeoCord({ i18n: t }), where t comes from createTranslator.',
    ])
  })

  it('still compiles with classes', () => {
    expect(() => MeoCordTestingModule.create({ controllers: [Tools], observers: [Watch] }).compile()).not.toThrow()
  })
})
