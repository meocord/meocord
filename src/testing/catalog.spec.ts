import { createTranslator, defineCatalog, Translator } from '@src/common/index.js'
import { Controller, MeoCord, Service } from '@src/decorator/index.js'
import { expectCompleteCatalog, MeoCordTestingModule } from '@src/testing/index.js'
import { PLACEHOLDER_CASES } from '@src/common/placeholder-cases.js'
import { placeholderNames } from '@src/common/translator.js'

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

  it("names a {param} a translation uses that the default message doesn't take, from the strings themselves", () => {
    // Read from JSON, the strings are `string` to the type checker, so only this test sees their params
    const id = { ban: { description: 'Blokir {anggota}', done: 'Diblokir {usr} dan {x}.' }, warnings: { other: '{jumlah} peringatan' } }
    const t = createTranslator({ default: 'en-US', locales: { 'en-US': enUS, id: id as never } })

    expect(() => expectCompleteCatalog(t)).toThrow(
      'The catalogs are incomplete:\n' +
        '  id: ban.description takes no {anggota}; the default is "Ban a member"; ' +
        'ban.done takes no {usr}; the default is "Banned {user}."; ' +
        'ban.done takes no {x}; the default is "Banned {user}."; ' +
        'warnings takes no {jumlah}; the default is "{count} warnings"',
    )
  })

  it("takes a translation that leaves a param out, or leaves {count} out of a plural's form", () => {
    const id = { ban: { description: 'Blokir anggota', done: 'Diblokir.' }, warnings: { one: 'Satu', other: 'Peringatan: {count}' } }
    const t = createTranslator({ default: 'en-US', locales: { 'en-US': enUS, id: id as never } })

    expect(() => expectCompleteCatalog(t)).not.toThrow()
  })

  it("names a {param} a translation of MeoCord's own texts uses that MeoCord's English doesn't take", () => {
    const id = { ...{ ban: { description: 'Blokir anggota', done: '{user} diblokir.' }, warnings: { other: '{count} peringatan' } } }
    const t = createTranslator({
      default: 'en-US',
      locales: { 'en-US': enUS, id: { ...id, meocord: { usage: { heading: 'Cara pakai: {command}' } } } as never },
    })

    expect(() => expectCompleteCatalog(t)).toThrow(
      '  id: meocord.usage.heading takes no {command}: MeoCord\'s English is "Usage: {usage}"',
    )
  })

  it.each(PLACEHOLDER_CASES)('reads the params of $text as translating and the compiler do', ({ text, params }) => {
    expect(placeholderNames(text)).toEqual(params)
    // A translation that keeps the text's braces takes the same params, so nothing is reported
    const t = createTranslator({ default: 'en-US', locales: { 'en-US': { m: text } as never, id: { m: `${text} ~` } as never } })
    expect(() => expectCompleteCatalog(t)).not.toThrow()
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

  it('is refused, naming the class, when nothing provides it', () => {
    expect(() => MeoCordTestingModule.create({ controllers: [PingController] }).compile()).toThrow(
      'PingService: it injects Translator, but @MeoCord has no i18n',
    )
  })
})
