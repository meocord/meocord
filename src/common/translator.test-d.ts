import { describe, expectTypeOf, it } from 'vitest'
import { type ChatInputCommandInteraction, Locale, type Message } from 'discord.js'
import { createTranslator, defineCatalog, translateError, type Translator } from '@src/common/index.js'
import { type CatalogIssues, type LocaleIssues, type Placeholders } from '@src/common/translator.js'
import { PLACEHOLDER_CASES } from '@src/common/placeholder-cases.js'

const enUS = defineCatalog({
  ban: { description: 'Ban a member', done: 'Banned {user} for {days} days.' },
  warnings: { one: '{count} warning for {user}', other: '{count} warnings for {user}' },
  ping: 'Pong!',
})

const t = createTranslator({ default: 'en-US', locales: { 'en-US': enUS, id: { ban: { done: 'Melarang {user}.' } } } })
declare const interaction: ChatInputCommandInteraction

describe('keys', () => {
  it("takes every message of the default catalog, by its dotted path", () => {
    expectTypeOf(t.default('ping')).toEqualTypeOf<string>()
    expectTypeOf(t.default('ban.description')).toEqualTypeOf<string>()
    t.for(interaction)('warnings', { count: 2, user: 'Ada' })
  })

  it('rejects a key the default catalog lacks, and a group of messages', () => {
    // @ts-expect-error not a key
    t.default('ban.reason')
    // @ts-expect-error a group, not a message
    t.default('ban')
  })
})

describe('params', () => {
  it('requires each {name} in the message', () => {
    t.default('ban.done', { user: 'Ada', days: 3 })
    // @ts-expect-error the message takes params
    t.default('ban.done')
    // @ts-expect-error `days` is missing
    t.default('ban.done', { user: 'Ada' })
    // @ts-expect-error `usr` is not a param
    t.default('ban.done', { usr: 'Ada', days: 3 })
  })

  it('takes none for a message without placeholders', () => {
    t.default('ping')
    // @ts-expect-error the message takes no params
    t.default('ping', { user: 'Ada' })
  })

  it('requires a numeric count, and the variants’ params, for a plural', () => {
    t.default('warnings', { count: 1, user: 'Ada' })
    // @ts-expect-error count is required
    t.default('warnings', { user: 'Ada' })
    // @ts-expect-error count is a number
    t.default('warnings', { count: '1', user: 'Ada' })
    // @ts-expect-error user is required by the variants
    t.default('warnings', { count: 1 })
  })
})

describe('localizations', () => {
  it('takes plain messages only, and returns one per locale', () => {
    expectTypeOf(t.localizations('ban.description')).toEqualTypeOf<Partial<Record<Locale, string>>>()
    // @ts-expect-error names and descriptions have no plural forms
    t.localizations('warnings')
  })
})

describe('locales', () => {
  it('lets other locales leave messages out, with any wording', () => {
    createTranslator({ default: 'en-US', locales: { 'en-US': enUS, ja: { ping: 'ポン！' }, 'es-ES': {} } })
  })

  it('rejects a message the default catalog does not have', () => {
    // @ts-expect-error `extra` is not in the default catalog
    createTranslator({ default: 'en-US', locales: { 'en-US': enUS, ja: { extra: 'x' } } })
  })

  it('rejects a locale Discord does not have, and a default without a catalog', () => {
    // @ts-expect-error bare `en` is not a Discord locale
    createTranslator({ default: 'en-US', locales: { 'en-US': enUS, en: {} } })
    // @ts-expect-error the default must have a catalog
    createTranslator({ default: 'ja', locales: { 'en-US': enUS } })
  })

  it('translates into an explicit locale', () => {
    t.locale(Locale.Japanese)('ping')
    t.locale('es-419')('ping')
  })
})

describe('placeholders', () => {
  type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
  // Each case whose params the compiler reads otherwise than the table says, by its text
  type Mismatched<Case = (typeof PLACEHOLDER_CASES)[number]> = Case extends { text: infer Text; params: readonly (infer Param)[] }
    ? Same<Placeholders<Text>, Param> extends true
      ? never
      : Text
    : never

  it('reads a {param} as translating does: word characters between braces, and nothing else', () => {
    expectTypeOf<Mismatched>().toEqualTypeOf<never>()
  })

  it("takes no params for a message whose braces hold no param", () => {
    const braces = createTranslator({ default: 'en-US', locales: { 'en-US': defineCatalog({ wrap: 'Wrap text in { and }.' }) } })
    braces.default('wrap')
    createTranslator({ default: 'en-US', locales: { 'en-US': defineCatalog({ wrap: 'Wrap text in { and }.' }), id: { wrap: 'Bungkus dengan { dan }.' } } })
  })

  // '{p0} {p1} … ' up to N params, their names, and a name of 4,096 characters
  type Numbered<N extends number, I extends unknown[] = [], Text extends string = ''> = I['length'] extends N
    ? Text
    : Numbered<N, [...I, unknown], `${Text}{p${I['length']}} `>
  type Names<N extends number, I extends unknown[] = [], Found = never> = I['length'] extends N
    ? Found
    : Names<N, [...I, unknown], Found | `p${I['length']}`>
  type Twice<S extends string> = `${S}${S}`
  type LongName = Twice<Twice<Twice<Twice<Twice<Twice<Twice<Twice<Twice<Twice<Twice<Twice<'a'>>>>>>>>>>>>

  it('reads a message with many params, and a long name, and t() takes all of them', () => {
    expectTypeOf<Same<Placeholders<Numbered<49>>, Names<49>>>().toEqualTypeOf<true>()
    expectTypeOf<Same<Placeholders<Numbered<300>>, Names<300>>>().toEqualTypeOf<true>()
    expectTypeOf<Placeholders<`Banned {${LongName}}.`>>().toEqualTypeOf<LongName>()
    expectTypeOf<Placeholders<`{${LongName}ñ} {user}`>>().toEqualTypeOf<'user'>()

    const many = { forty: '' as Numbered<49>, hundreds: '' as Numbered<300>, long: '' as `Banned {${LongName}}.` }
    const t = createTranslator({ default: 'en-US', locales: { 'en-US': many, id: many } })
    t.default('forty', {} as Record<Names<49>, string>)
    t.default('hundreds', {} as Record<Names<300>, string>)
    t.default('long', {} as Record<LongName, string>)
    // @ts-expect-error the last param is missing
    t.default('hundreds', {} as Record<Exclude<Names<300>, 'p299'>, string>)
  })
})

describe("other locales' params", () => {
  it("takes any of the default message's params, in any order, and {count} in a plural's forms", () => {
    createTranslator({
      default: 'en-US',
      locales: {
        'en-US': enUS,
        id: defineCatalog({
          ban: { description: 'Blokir anggota', done: '{days} hari untuk {user}.' },
          warnings: { one: 'Satu peringatan', other: '{count} peringatan untuk {user}' },
        }),
        // A param left out, and a plural form without {count}
        ja: { ban: { done: '{user}をBAN' }, warnings: { other: '警告' } },
      },
    })
  })

  it("rejects a {param} the default message doesn't take", () => {
    // @ts-expect-error Property '"id: ban.done takes no {usr}; the default is "Banned {user} for {days} days.""' is missing
    createTranslator({ default: 'en-US', locales: { 'en-US': enUS, id: { ban: { done: 'Melarang {usr}.' } } } })
    // @ts-expect-error a plural's param translated: {jumlah} is not the default's
    createTranslator({ default: 'en-US', locales: { 'en-US': enUS, id: { warnings: { other: '{jumlah} peringatan' } } } })
    // @ts-expect-error a {param} in a message whose default takes none
    createTranslator({ default: 'en-US', locales: { 'en-US': enUS, id: { ping: 'Pong {user}!' } } })
    // @ts-expect-error checked in a catalog made with defineCatalog too
    createTranslator({ default: 'en-US', locales: { 'en-US': enUS, id: defineCatalog({ ban: { done: 'Melarang {usr}.' } }) } })
  })

  it('names the locale, the message, the param and the default in the error', () => {
    expectTypeOf<LocaleIssues<{ ban: { done: 'Melarang {usr}.' } }, typeof enUS, 'id'>>().toEqualTypeOf<
      `id: ban.done takes no {usr}; the default is "Banned {user} for {days} days."`
    >()
    expectTypeOf<LocaleIssues<{ warnings: { one: '{n} x'; other: '{jumlah} y' } }, typeof enUS, 'id'>>().toEqualTypeOf<
      | `id: warnings takes no {n}; the default is "{count} warnings for {user}"`
      | `id: warnings takes no {jumlah}; the default is "{count} warnings for {user}"`
    >()
    expectTypeOf<LocaleIssues<{ ping: 'Pong {x}!' }, typeof enUS, 'ja'>>().toEqualTypeOf<`ja: ping takes no {x}; the default is "Pong!"`>()
    expectTypeOf<LocaleIssues<{ ban: { done: '{user} {days}' }; ping: 'Pong' }, typeof enUS, 'id'>>().toEqualTypeOf<never>()
  })

  it('leaves a message typed `string`, as a plain or JSON catalog has, to expectCompleteCatalog', () => {
    const id: { ban: { done: string } } = { ban: { done: 'Melarang {usr}.' } }
    createTranslator({ default: 'en-US', locales: { 'en-US': enUS, id } })
  })
})

describe('literal catalogs', () => {
  it('asks for defineCatalog or `as const` when the default catalog has lost its message types', () => {
    const widened: { greet: string } = { greet: 'Hi {name}' }
    // @ts-expect-error wrap the catalog in defineCatalog(...) or add `as const`
    createTranslator({ default: 'en-US', locales: { 'en-US': widened } })
  })

  it('keeps them for an `as const` catalog, and an inline one', () => {
    const asConst = { greet: 'Hi {name}' } as const
    createTranslator({ default: 'en-US', locales: { 'en-US': asConst } }).default('greet', { name: 'Ada' })
    // @ts-expect-error name is required
    createTranslator({ default: 'en-US', locales: { 'en-US': { greet: 'Hi {name}' } } }).default('greet')
  })
})

describe('Translator', () => {
  it('is what createTranslator returns, typed by the default catalog', () => {
    expectTypeOf(t).toEqualTypeOf<Translator<typeof enUS>>()
  })
})

describe("MeoCord's own texts", () => {
  it('lets any locale translate any of them, all or part', () => {
    createTranslator({
      default: 'en-US',
      locales: {
        'en-US': defineCatalog({ ...enUS, meocord: { usage: { heading: 'How to use: {usage}' } } }),
        id: { ping: 'Pong!', meocord: { usage: { missing: '{param} belum diisi' }, types: { int: 'bilangan bulat' } } },
        ja: { meocord: { fallback: { notFound: 'コマンドが見つかりません' } } },
      },
    })
  })

  it('rejects a key MeoCord lacks, in the default catalog and in another locale', () => {
    // @ts-expect-error Property '"meocord.usage.headng is not one of MeoCord's texts"' is missing
    defineCatalog({ meocord: { usage: { headng: 'Usage: {usage}' } } })
    // @ts-expect-error the same, named for the locale's group
    createTranslator({ default: 'en-US', locales: { 'en-US': enUS, id: { meocord: { usage: { headng: 'Cara pakai: {usage}' } } } } })
  })

  it('rejects a {param} the English text lacks, and takes one that leaves a param out', () => {
    // @ts-expect-error Property '"meocord.usage.heading takes no {command}: MeoCord's English is "Usage: {usage}""' is missing
    defineCatalog({ meocord: { usage: { heading: 'Usage: {command}' } } })
    // @ts-expect-error the same, for meocord.usage.missing in the id locale
    createTranslator({ default: 'en-US', locales: { 'en-US': enUS, id: { meocord: { usage: { missing: '{name} belum diisi' } } } } })
    createTranslator({ default: 'en-US', locales: { 'en-US': enUS, id: { meocord: { usage: { notValid: '"{word}" tidak sah' } } } } })
  })

  it('names the text, what is wrong, and the English with the params it takes, in the error', () => {
    type Issues<T> = CatalogIssues<{ meocord: T }>
    expectTypeOf<Issues<{ usage: { heading: 'Usage: {command}' } }>>().toEqualTypeOf<`meocord.usage.heading takes no {command}: MeoCord's English is "Usage: {usage}"`>()
    expectTypeOf<Issues<{ usage: { notValid: '{label} {wrd} {kind}' } }>>().toEqualTypeOf<
      | `meocord.usage.notValid takes no {wrd}: MeoCord's English is "{label}: "{word}" is not a valid {type}"`
      | `meocord.usage.notValid takes no {kind}: MeoCord's English is "{label}: "{word}" is not a valid {type}"`
    >()
    expectTypeOf<Issues<{ usage: { headng: 'x' }; helpp: { list: 'y' } }>>().toEqualTypeOf<
      `meocord.usage.headng is not one of MeoCord's texts` | `meocord.helpp is not one of MeoCord's texts`
    >()
    expectTypeOf<Issues<{ usage: { heading: 'Cara pakai: {usage}' }; types: { int: string } }>>().toEqualTypeOf<never>()
  })

  it('gives the translator their keys when the default catalog has them', () => {
    const own = createTranslator({ default: 'en-US', locales: { 'en-US': defineCatalog({ meocord: { presenter: { loading: 'Hang on…' } } }) } })
    expectTypeOf(own.default('meocord.presenter.loading')).toEqualTypeOf<string>()
  })
})

describe('translateError', () => {
  it('takes an interaction, a message or a locale', () => {
    const error = new Error('boom')
    expectTypeOf(translateError(error, t, interaction)).toEqualTypeOf<string>()
    translateError(error, t, {} as Message)
    translateError(error, t, 'id')
    translateError(error, t, Locale.Japanese)
    // @ts-expect-error bare `en` is not a Discord locale
    translateError(error, t, 'en')
  })
})
