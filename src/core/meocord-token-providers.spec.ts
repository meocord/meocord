import { vi } from 'vitest'

const { warned } = vi.hoisted(() => ({ warned: [] as string[] }))

vi.mock('@src/common/index.js', async importOriginal => ({
  ...(await importOriginal<object>()),
  Logger: class {
    log = vi.fn()
    debug = vi.fn()
    info = vi.fn()
    verbose = vi.fn()
    error = vi.fn()
    warn = (...args: unknown[]) => warned.push(args.map(String).join(' '))
  },
}))
vi.mock('@src/util/meocord-config-loader.util.js', () => ({ loadMeoCordConfig: () => ({ discordToken: 'token' }) }))
vi.mock('@src/util/platform.util.js', () => ({ assertBuiltForThisPlatform: () => {} }))

import { Controller, MeoCord } from '@src/decorator/index.js'
import { MeoCordFactory } from '@src/core/meocord-factory.js'
import { ExecutionContext } from '@src/common/execution-context.js'
import { createTranslator, Translator } from '@src/common/translator.js'
import { ThemeCache } from '@src/core/theme-resolvers.js'
import { forgetDeprecationWarnings } from '@src/common/deprecation.js'

@Controller()
class Ping {}

describe("a provider for a token MeoCord binds itself", () => {
  beforeEach(() => {
    warned.length = 0
    forgetDeprecationWarnings()
  })

  it.each([
    ['ThemeCache', ThemeCache],
    ['ExecutionContext', ExecutionContext],
  ] as const)('warns for %s, naming it, that the next major version refuses it, and still creates the app', (name, token) => {
    @MeoCord({ controllers: [Ping], providers: [{ provide: token, useValue: {} }], clientOptions: { intents: [] } })
    class App {}

    expect(() => MeoCordFactory.create(App)).not.toThrow()
    expect(warned).toEqual([
      `App: @MeoCord({ providers }) provides ${name}, which MeoCord binds itself; the next major version (5.0) refuses it. Remove the provider.`,
    ])
  })

  // It supplies the translator when the app sets no i18n, which is supported
  it('says nothing for a Translator provider without i18n', () => {
    @MeoCord({
      controllers: [Ping],
      providers: [{ provide: Translator, useValue: createTranslator({ default: 'en-US', locales: { 'en-US': {} } }) }],
      clientOptions: { intents: [] },
    })
    class App {}

    MeoCordFactory.create(App)
    expect(warned).toEqual([])
  })
})
