import { describe, expectTypeOf, it } from 'vitest'
import { type ChatInputCommandInteraction, Locale, type Message } from 'discord.js'
import { createTranslator, defineCatalog, translateError, type Translator } from '@src/common/index.js'

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
    // @ts-expect-error `headng` is not one of MeoCord's texts
    defineCatalog({ meocord: { usage: { headng: 'Usage: {usage}' } } })
    // @ts-expect-error `headng` is not one of MeoCord's texts
    createTranslator({ default: 'en-US', locales: { 'en-US': enUS, id: { meocord: { usage: { headng: 'Cara pakai: {usage}' } } } } })
  })

  it('rejects a {param} the English text lacks, and takes one that leaves a param out', () => {
    // @ts-expect-error `{command}` is not a param of meocord.usage.heading
    defineCatalog({ meocord: { usage: { heading: 'Usage: {command}' } } })
    // @ts-expect-error `{name}` is not a param of meocord.usage.missing
    createTranslator({ default: 'en-US', locales: { 'en-US': enUS, id: { meocord: { usage: { missing: '{name} belum diisi' } } } } })
    createTranslator({ default: 'en-US', locales: { 'en-US': enUS, id: { meocord: { usage: { notValid: '"{word}" tidak sah' } } } } })
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
