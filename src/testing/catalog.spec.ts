import { createTranslator, defineCatalog, Translator } from '@src/common/index.js'
import { Controller, MeoCord, Service } from '@src/decorator/index.js'
import { expectCompleteCatalog, MeoCordTestingModule } from '@src/testing/index.js'

const enUS = defineCatalog({
  ban: { description: 'Ban a member', done: 'Banned {user}.' },
  warnings: { one: '{count} warning', other: '{count} warnings' },
})

describe('expectCompleteCatalog', () => {
  it('passes when every locale translates every message in every form its language needs', () => {
    const t = createTranslator({
      default: 'en-US',
      locales: {
        'en-US': enUS,
        id: { ban: { description: 'Blokir anggota', done: '{user} diblokir.' }, warnings: { other: '{count} peringatan' } },
      },
    })

    expect(() => expectCompleteCatalog(t)).not.toThrow()
  })

  it('names each missing message, stray message and missing plural form, by locale', () => {
    const t = createTranslator({
      default: 'en-US',
      locales: {
        'en-US': enUS,
        ru: { ban: { description: 'Забанить' }, warnings: { one: '{count} предупреждение', other: '{count} предупреждения' } },
        // A catalog loaded from JSON is checked only at runtime, so it can carry a key the default lacks.
        ja: { ...{ ban: { description: 'BAN', done: '{user}をBAN', reason: '理由' } }, warnings: { other: '{count}件' } } as never,
      },
    })

    expect(() => expectCompleteCatalog(t)).toThrow(
      'The catalogs are incomplete:\n' +
        '  ru: missing ban.done; warnings lacks few, many\n' +
        '  ja: ban.reason is not in the default catalog',
    )
  })

  it("leaves MeoCord's own texts to their English fallback, reporting only a key MeoCord lacks", () => {
    const id = { ...{ ban: { description: 'Blokir anggota', done: '{user} diblokir.' }, warnings: { other: '{count} peringatan' } } }
    const t = createTranslator({
      default: 'en-US',
      locales: {
        'en-US': { ...enUS, meocord: { usage: { heading: 'How to use: {usage}' } } },
        id: { ...id, meocord: { usage: { missing: '{param} belum diisi' } } },
        // A catalog loaded from JSON is checked only at runtime, so it can misspell one of MeoCord's keys.
        ja: { ...id, meocord: { usage: { headng: '使い方: {usage}' } } } as never,
      },
    })

    expect(() => expectCompleteCatalog(t)).toThrow('The catalogs are incomplete:\n  ja: meocord.usage.headng is not one of MeoCord\'s texts')
  })

  it("requires every locale that is not English to translate each of MeoCord's own texts, with meocord: true", () => {
    const meocord = { usage: { heading: 'Cara pakai: {usage}' } }
    const t = createTranslator({
      default: 'en-US',
      locales: { 'en-US': enUS, 'en-GB': {}, id: { ban: { description: 'Blokir', done: '{user} diblokir.' }, warnings: { other: '{count}' }, meocord } },
    })

    expect(() => expectCompleteCatalog(t)).toThrow('  en-GB: missing ban.description; missing ban.done; missing warnings')
    const report = (() => {
      try {
        expectCompleteCatalog(t, { meocord: true })
      } catch (error) {
        return (error as Error).message
      }
    })()!
    const id = report.split('\n').find(line => line.startsWith('  id: '))!
    expect(id).toContain('missing meocord.usage.headingMany; missing meocord.usage.missing')
    expect(id).not.toContain('missing meocord.usage.heading;')
    expect(report).not.toMatch(/en-GB: .*meocord/)
  })

  it('refuses a translator it cannot read', () => {
    expect(() => expectCompleteCatalog({} as Translator)).toThrow('takes a translator made by createTranslator')
  })
})

describe('the translator in a testing module', () => {
  const t = createTranslator({ default: 'en-US', locales: { 'en-US': { ping: 'Pong!' } } })

  @Service()
  class PingService {
    constructor(readonly translator: Translator) {}
  }

  @Controller()
  class PingController {
    constructor(readonly ping: PingService) {}
  }

  @MeoCord({ controllers: [PingController], clientOptions: { intents: [] }, i18n: t })
  class App {}

  it("is the app's i18n translator", () => {
    const module = MeoCordTestingModule.create({ app: App, controllers: [PingController] }).compile()

    expect(module.get(PingService).translator).toBe(t)
  })

  it('can be provided directly', () => {
    const module = MeoCordTestingModule.create({ controllers: [PingController], providers: [{ provide: Translator, useValue: t }] }).compile()

    expect(module.get(PingService).translator).toBe(t)
  })

  it('is refused, with what to pass, when nothing provides it', () => {
    expect(() => MeoCordTestingModule.create({ controllers: [PingController] }).compile()).toThrow(
      'PingService injects Translator, but @MeoCord has no i18n',
    )
  })
})
