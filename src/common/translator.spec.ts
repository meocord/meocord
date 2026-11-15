import { vi } from 'vitest'
import { ChatInputCommandInteraction, type Guild, Locale } from 'discord.js'
import { createTranslator, defineCatalog, Logger } from '@src/common/index.js'
import { missingTranslatorError } from '@src/common/translator.js'
import { createMockInteraction } from '@src/testing/index.js'

const enUS = defineCatalog({
  ban: { description: 'Ban a member', done: 'Banned {user}.' },
  warnings: { one: '{count} warning', other: '{count} warnings' },
  apples: { zero: 'no apples', one: 'one apple', other: '{count} apples' },
  ping: 'Pong!',
})

const t = createTranslator({
  default: 'en-US',
  locales: {
    'en-US': enUS,
    'en-GB': { ping: 'Pong, old chap!' },
    'es-ES': { ban: { description: 'Banear a un miembro', done: 'Baneado {user}.' }, ping: '¡Pong!' },
    id: { ban: { done: '{user} diblokir.' }, warnings: { other: '{count} peringatan' } },
    ja: { ban: { description: 'メンバーをBANする' } },
    ru: { warnings: { one: '{count} предупреждение', few: '{count} предупреждения', many: '{count} предупреждений', other: '{count} предупреждения' } },
  },
})

const interaction = (locale: string, guildLocale: string | null = null) =>
  createMockInteraction(ChatInputCommandInteraction, { locale: locale as Locale, guildLocale: guildLocale as Locale })

describe('createTranslator', () => {
  it('translates into the default locale, with its params', () => {
    expect(t.default('ban.done', { user: 'Ada' })).toBe('Banned Ada.')
    expect(t.default('ping')).toBe('Pong!')
  })

  it('lists the default first among its locales', () => {
    expect(t.defaultLocale).toBe(Locale.EnglishUS)
    expect(t.locales[0]).toBe(Locale.EnglishUS)
    expect(t.locales).toHaveLength(6)
  })

  it('refuses a locale Discord does not have, and a default without a catalog', () => {
    expect(() => createTranslator({ default: 'en-US', locales: { 'en-US': enUS, en: {} } as never })).toThrow(
      '"en" is not a Discord locale',
    )
    expect(() => createTranslator({ default: 'ja', locales: { 'en-US': enUS } } as never)).toThrow(
      'The default locale "ja" has no catalog',
    )
  })
})

describe('resolving a locale', () => {
  it("uses the user's locale", () => {
    expect(t.for(interaction('es-ES'))('ban.done', { user: 'Ada' })).toBe('Baneado Ada.')
  })

  it('falls back to another locale of the same language before the default', () => {
    expect(t.for(interaction('es-419'))('ping')).toBe('¡Pong!')
  })

  // en-GB has its own catalog, but lacks this message: the en-US default is its language's fallback.
  it('falls back message by message', () => {
    expect(t.for(interaction('en-GB'))('ping')).toBe('Pong, old chap!')
    expect(t.for(interaction('en-GB'))('ban.done', { user: 'Ada' })).toBe('Banned Ada.')
    expect(t.for(interaction('ja'))('ban.done', { user: 'Ada' })).toBe('Banned Ada.')
  })

  it('uses the default for a language without a catalog', () => {
    expect(t.for(interaction('fr'))('ping')).toBe('Pong!')
  })

  it("uses the server's locale for a public reply, and the user's outside a server", () => {
    expect(t.for(interaction('ja', 'es-ES'), { public: true })('ping')).toBe('¡Pong!')
    expect(t.for(interaction('es-ES', null), { public: true })('ping')).toBe('¡Pong!')
  })

  it("uses a server's preferred locale, for events and messages", () => {
    expect(t.forGuild({ preferredLocale: 'es-ES' } as Guild)('ping')).toBe('¡Pong!')
  })

  it('translates into a locale it is given', () => {
    expect(t.locale('id')('ban.done', { user: 'Ada' })).toBe('Ada diblokir.')
  })
})

describe('plurals', () => {
  it('picks the form Intl.PluralRules selects for the count', () => {
    expect(t.default('warnings', { count: 1 })).toBe('1 warning')
    expect(t.default('warnings', { count: 5 })).toBe('5 warnings')
  })

  it("uses each language's own categories", () => {
    const ru = t.locale('ru')
    expect(ru('warnings', { count: 1 })).toBe('1 предупреждение')
    expect(ru('warnings', { count: 3 })).toBe('3 предупреждения')
    expect(ru('warnings', { count: 5 })).toBe('5 предупреждений')
  })

  // Indonesian's rules select only `other`, and English's select `other` for 0, so a `zero` form is not read
  it('uses the form the locale’s rules select', () => {
    expect(t.locale('id')('warnings', { count: 1 })).toBe('1 peringatan')
    expect(t.default('apples', { count: 0 })).toBe('0 apples')
  })

  it('falls back to `other` for a category the message lacks', () => {
    const items = createTranslator({
      default: 'en-US',
      locales: {
        'en-US': { items: { one: '{count} item', other: '{count} items' } },
        ru: { items: { one: '{count} предмет', other: '{count} предметов' } },
      },
    })

    // Russian's rules select `few` for 3, which this message has no form for
    expect(items.locale('ru')('items', { count: 3 })).toBe('3 предметов')
  })

  it('falls back to the default for a translation whose plural lacks `other`', () => {
    const items = createTranslator({
      default: 'en-US',
      locales: { 'en-US': { items: { one: '{count} item', other: '{count} items' } }, ru: { items: { one: '{count} предмет', few: '{count} предмета' } } },
    } as never) as unknown as { locale: (locale: string) => (key: string, params: object) => string }

    expect(items.locale('ru')('items', { count: 3 })).toBe('3 items')
  })

  // As a catalog loaded from JSON may: the default language has one form, and the translation's needs several
  it('reads a translation that gives a plural where the default has a plain message as that plural', () => {
    const items = createTranslator({
      default: 'en-US',
      locales: {
        'en-US': { items: '{count} items' },
        pl: { items: { one: '{count} rzecz', few: '{count} rzeczy', many: '{count} rzeczy', other: '{count} rzeczy' } },
      },
    } as never) as unknown as { locale: (locale: string) => (key: string, params: object) => string }
    const pl = items.locale('pl')

    expect([pl('items', { count: 1 }), pl('items', { count: 2 }), pl('items', { count: 5 })]).toEqual(['1 rzecz', '2 rzeczy', '5 rzeczy'])
  })
})

describe('interpolation', () => {
  it('leaves a placeholder with no param in place', () => {
    expect(t.default('ban.done', {} as never)).toBe('Banned {user}.')
  })

  it("leaves a placeholder named like an object's built-in members in place when no param has that name", () => {
    const own = createTranslator({ default: 'en-US', locales: { 'en-US': { note: 'Built by {constructor}; see {toString}.' } } })

    expect(own.default('note', {} as never)).toBe('Built by {constructor}; see {toString}.')
  })

  it('returns the key for a message no catalog has, rather than throwing', () => {
    expect((t.default as (key: string) => string)('ban.missing')).toBe('ban.missing')
  })
})

describe('braces written as text', () => {
  const braces = createTranslator({
    default: 'en-US',
    locales: {
      'en-US': defineCatalog({ route: 'Buttons use ticket/{{id}} as their customId', wrapped: '{{{user}}} wraps {{ and }}' }),
      id: { route: 'Tombol memakai ticket/{{id}}' },
    },
  })

  it('reads {{ and }} as one brace each, so {{word}} shows {word} and takes no param', () => {
    expect(braces.default('route')).toBe('Buttons use ticket/{id} as their customId')
    expect(braces.default('wrapped', { user: 'Ada' })).toBe('{Ada} wraps { and }')
    expect(braces.locale('id')('route')).toBe('Tombol memakai ticket/{id}')
  })

  it('gives each brace once in the localizations', () => {
    expect(braces.localizations('route')).toEqual({ id: 'Tombol memakai ticket/{id}' })
  })
})

describe('localizations', () => {
  it("lists only the other locales whose catalog has the message", () => {
    expect(t.localizations('ban.description')).toEqual({ 'es-ES': 'Banear a un miembro', ja: 'メンバーをBANする' })
  })

  // A catalog from a JSON file, whose messages the compiler types as string
  const loose = createTranslator({
    default: 'en-US',
    locales: {
      'en-US': { ban: { description: 'Ban a member', done: 'Banned {user}.' } },
      id: { ban: { description: 'Blokir {usr}', done: '{user} diblokir.' } },
      ja: { ban: { description: 'メンバーをBANする' } },
    } as never,
  }) as unknown as { localizations: (key: string) => unknown }

  it('refuses a key whose message takes params without them, which Discord would show as written', () => {
    expect(() => loose.localizations('ban.done')).toThrow(
      'localizations("ban.done"): the message takes {user}, and a name or description is shown as written. Give a value for each, as in localizations("ban.done", { user }), or use a message without params.',
    )
  })

  it('leaves out a translation with a {param}, as expectCompleteCatalog reports it', () => {
    expect(loose.localizations('ban.description')).toEqual({ ja: 'メンバーをBANする' })
  })

  // Discord shows en-US users the en-GB value, and es-419 users the es-ES one, when their own locale has none
  it.each([
    ['en-US', 'en-GB', 'Pick a color', 'Pick a colour'],
    ['en-GB', 'en-US', 'Pick a colour', 'Pick a color'],
    ['es-419', 'es-ES', 'Elige un color', 'Escoge un color'],
  ] as const)('keeps a %s default’s own wording beside its %s partner', (locale, partner, wording, partnerWording) => {
    const paint = createTranslator({ default: locale, locales: { [locale]: { d: wording }, [partner]: { d: partnerWording }, ja: { d: '色' } } } as never)

    expect(paint.localizations('d' as never)).toEqual({ [locale]: wording, [partner]: partnerWording, ja: '色' })
  })

  it('leaves out an empty translation, so Discord shows the default there', () => {
    const empty = createTranslator({ default: 'en-US', locales: { 'en-US': { d: 'Ban a member' }, 'en-GB': { d: '' }, id: { d: '' }, ja: { d: 'BAN' } } })

    expect(empty.localizations('d')).toEqual({ ja: 'BAN' })
  })
})

describe('localizations with params', () => {
  const lookups = createTranslator({
    default: 'en-US',
    locales: {
      'en-US': defineCatalog({ lookup: { user: 'Show {mode} for a linked user' }, modes: { chaos: 'Chaos mode' } }),
      'en-GB': { lookup: { user: 'Show {mode} for a linked member' } },
      ja: { lookup: { user: '連携済みユーザーの{mode}を表示' }, modes: { chaos: '混沌モード' } },
      id: { lookup: { user: '' } },
      'es-ES': { modes: { chaos: 'Modo caos' } },
    },
  })
  const chaos = (locale: Locale) => lookups.locale(locale)('modes.chaos')

  it('fills the params into each translation, calling a function once for each locale whose message uses it', () => {
    const mode = vi.fn(chaos)

    expect(lookups.localizations('lookup.user', { mode })).toEqual({
      'en-US': 'Show Chaos mode for a linked user',
      'en-GB': 'Show Chaos mode for a linked member',
      ja: '連携済みユーザーの混沌モードを表示',
    })
    expect(mode.mock.calls.map(([locale]) => locale).sort()).toEqual(['en-GB', 'en-US', 'ja'])
    expect(lookups.localizations('lookup.user', { mode: 7 })).toEqual({
      'en-US': 'Show 7 for a linked user',
      'en-GB': 'Show 7 for a linked member',
      ja: '連携済みユーザーの7を表示',
    })
  })

  it('uses a value as written, static or from a function, a `{param}` in it included', () => {
    const mode = (locale: Locale) => (locale === Locale.Japanese ? '{n}' : '{n} modes')

    expect(lookups.localizations('lookup.user', { mode })).toEqual({
      'en-US': 'Show {n} modes for a linked user',
      'en-GB': 'Show {n} modes for a linked member',
      ja: '連携済みユーザーの{n}を表示',
    })
    expect(lookups.localizations('lookup.user', { mode: '{n}' })).toEqual({
      'en-US': 'Show {n} for a linked user',
      'en-GB': 'Show {n} for a linked member',
      ja: '連携済みユーザーの{n}を表示',
    })
  })

  it('keeps every locale for a value from a message that writes a brace as text', () => {
    const routes = createTranslator({
      default: 'en-US',
      locales: {
        'en-US': defineCatalog({ d: 'Open {what}', route: 'ticket/{{id}}' }),
        'en-GB': { d: 'Open up {what}' },
        ja: { d: '{what}を開く', route: 'チケット/{{id}}' },
      },
    })

    expect(routes.localizations('d', { what: locale => routes.locale(locale)('route') })).toEqual({
      'en-US': 'Open ticket/{id}',
      'en-GB': 'Open up ticket/{id}',
      ja: 'チケット/{id}を開く',
    })
  })

  it('adds the default only beside its partner, and calls no function for it otherwise', () => {
    const plain = createTranslator({ default: 'en-US', locales: { 'en-US': defineCatalog({ d: 'Ban {who}' }), ja: { d: '{who}をBAN（{who}）' } } })
    const who = vi.fn((locale: Locale) => (locale === Locale.Japanese ? 'メンバー' : 'a member'))

    expect(plain.localizations('d', { who })).toEqual({ ja: 'メンバーをBAN（メンバー）' })
    expect(who.mock.calls).toEqual([[Locale.Japanese]])
  })

  // Discord shows en-US users the en-GB value, and es-419 users the es-ES one, when their own locale has none
  it.each([
    ['en-US', 'en-GB', 'Pick a {tone} color', 'Pick a {tone} colour'],
    ['en-GB', 'en-US', 'Pick a {tone} colour', 'Pick a {tone} color'],
    ['es-419', 'es-ES', 'Elige un color {tone}', 'Escoge un color {tone}'],
  ] as const)('keeps a %s default’s own wording, filled, beside its %s partner', (locale, partner, wording, partnerWording) => {
    const paint = createTranslator({ default: locale, locales: { [locale]: { d: wording }, [partner]: { d: partnerWording }, ja: { d: '{tone}色' } } } as never)
    const tone = vi.fn((target: Locale) => (target === Locale.Japanese ? '暗い' : 'dark'))

    expect(paint.localizations('d' as never, { tone } as never)).toEqual({
      [locale]: wording.replace('{tone}', 'dark'),
      [partner]: partnerWording.replace('{tone}', 'dark'),
      ja: '暗い色',
    })
    expect(tone).toHaveBeenCalledTimes(3)
  })

  it('leaves out an empty translation and a locale without the message, and keeps braces written as text', () => {
    const tickets = createTranslator({
      default: 'en-US',
      locales: { 'en-US': defineCatalog({ d: 'Open {kind} ticket/{{id}}' }), 'en-GB': { d: '' }, ja: { d: '{kind}チケット/{{id}}を開く' }, id: {} },
    })

    expect(tickets.localizations('d', { kind: 'bug' })).toEqual({ ja: 'bugチケット/{id}を開く' })
    // Filled with nothing, a translation is as empty as an untranslated one
    const bare = createTranslator({ default: 'en-US', locales: { 'en-US': defineCatalog({ d: '{kind}' }), ja: { d: '{kind}' }, id: { d: '{kind}' } } })
    expect(bare.localizations('d', { kind: locale => (locale === Locale.Japanese ? '' : 'bug') })).toEqual({ id: 'bug' })
  })

  it("leaves out a translation from a JSON catalog that uses a param it wasn't given", () => {
    const loose = createTranslator({
      default: 'en-US',
      locales: { 'en-US': { d: 'Ban {who}' }, id: { d: 'Blokir {siapa}' }, ja: { d: '{who}をBAN' } } as never,
    }) as unknown as { localizations: (key: string, params?: Record<string, unknown>) => unknown }

    expect(loose.localizations('d', { who: 'Ada' })).toEqual({ ja: 'AdaをBAN' })
  })

  it('calls a function for a locale it then leaves out, and leaves out a translation whose own param is given no value', () => {
    const loose = createTranslator({
      default: 'en-US',
      locales: { 'en-US': { d: 'Ban {who}' }, fr: { d: 'Bannir {who} {extra}' }, ja: { d: '{who}をBAN' } } as never,
    }) as unknown as { localizations: (key: string, params?: Record<string, unknown>) => unknown }
    const who = vi.fn((locale: Locale) => (locale === Locale.Japanese ? 'エイダ' : 'Ada'))

    expect(loose.localizations('d', { who, extra: undefined })).toEqual({ ja: 'エイダをBAN' })
    expect(who.mock.calls.map(([locale]) => locale).sort()).toEqual(['fr', 'ja'])
  })

  it.each([
    ['no params', {}, '{mode}'],
    ['a param given undefined', { mode: undefined }, '{mode}'],
  ] as const)('refuses %s for a param the default message takes', (_, params, missing) => {
    expect(() => lookups.localizations('lookup.user', params as never)).toThrow(
      `localizations("lookup.user", params): the message takes {mode}, and params give no value for ${missing}. A name or description is shown as written, so give a value for each.`,
    )
  })

  it('refuses a param named as a key every object inherits, and fills it given as its own', () => {
    const inherited = createTranslator({
      default: 'en-US',
      locales: { 'en-US': defineCatalog({ d: 'Show {constructor} by {toString}' }), ja: { d: '{toString}の{constructor}' } },
    })

    expect(() => inherited.localizations('d', {} as never)).toThrow('params give no value for {constructor}, {toString}.')
    expect(inherited.localizations('d', { constructor: 'roles', toString: 'name' })).toEqual({ ja: 'nameのroles' })
  })

  it('names each param left out, of a typed catalog and of a JSON one', () => {
    const typed = createTranslator({ default: 'en-US', locales: { 'en-US': defineCatalog({ d: 'Ban {user} for {days} days, {user}' }) } })
    expect(() => typed.localizations('d', { user: 'Ada' } as never)).toThrow('the message takes {user}, {days}, and params give no value for {days}.')
    const loose = createTranslator({ default: 'en-US', locales: { 'en-US': { d: '{a} {b} {c}' }, ja: { d: '{a}' } } as never }) as unknown as {
      localizations: (key: string, params?: Record<string, unknown>) => unknown
    }
    expect(() => loose.localizations('d', { b: 1 })).toThrow('the message takes {a}, {b}, {c}, and params give no value for {a}, {c}.')
  })
})

describe('an empty translation', () => {
  const empty = createTranslator({
    default: 'en-US',
    locales: { 'en-US': { d: 'Ban a member', blank: '' }, 'en-GB': { d: '' }, id: { d: '' } },
  })

  it('reads as missing, so a related locale or the default answers', () => {
    expect([empty.locale('en-GB')('d'), empty.locale('id')('d')]).toEqual(['Ban a member', 'Ban a member'])
  })

  it('in the default catalog shows the key, as a missing one does', () => {
    expect(empty.locale('id')('blank')).toBe('blank')
  })
})

describe('a plural with a form that is no text', () => {
  it('reads as missing, so the next catalog answers', () => {
    const t = createTranslator({
      default: 'en-US',
      locales: { 'en-US': { items: { one: '{count} item', other: '{count} items' } }, id: { items: { one: { deep: 'x' }, other: '{count} barang' } } as never },
    })
    expect([t.locale('id')('items', { count: 1 }), t.locale('id')('items', { count: 2 })]).toEqual(['1 item', '2 items'])
  })
})

describe('a key with no message, in development', () => {
  let warned: string[]
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'development')
    warned = []
    vi.spyOn(Logger.prototype, 'warn').mockImplementation((...args: unknown[]) => void warned.push(args.join(' ')))
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  const fresh = () =>
    createTranslator({ default: 'en-US', locales: { 'en-US': { menu: { title: 'Menu' }, hi: 'Hi' } } as never }) as unknown as {
      default: (key: string) => string
      locale: (locale: string) => (key: string) => string
      localizations: (key: string) => unknown
    }

  it('warns once per key that the key is shown, naming a group as one', () => {
    const own = fresh()

    expect(own.default('nope')).toBe('nope')
    expect(own.locale('id')('nope')).toBe('nope')
    expect(own.default('menu')).toBe('menu')
    expect(own.localizations('menu.missing')).toEqual({})
    expect(own.default('hi')).toBe('Hi')

    expect(warned).toEqual([
      'No catalog has a message with the key "nope", so the key is shown in its place.',
      '"menu" names a group of messages, not one, so the key is shown in its place.',
      'No catalog has a message with the key "menu.missing", so the key is shown in its place.',
    ])
  })

  it('warns for each translator of its own', () => {
    fresh().default('nope')
    fresh().default('nope')

    expect(warned).toHaveLength(2)
  })

  it('stays quiet outside development', () => {
    vi.stubEnv('NODE_ENV', 'production')
    fresh().default('nope')

    expect(warned).toEqual([])
  })

  // A plural is an object whose every key is a plural category, as the types and expectCompleteCatalog read one
  it('reads a group with an `other` key, or with plural categories beside other keys, as a group', () => {
    const own = createTranslator({
      default: 'en-US',
      locales: {
        'en-US': { reasons: { spam: 'Spam', other: 'Other' }, mixed: { one: 'one {count}', other: '{count}', note: 'A note' } },
        id: { reasons: { spam: 'Spam', other: 'Lainnya' } },
      },
    } as never) as unknown as {
      default: (key: string, params?: object) => string
      localizations: (key: string) => unknown
    }

    expect([own.default('reasons'), own.default('reasons', { count: 2 }), own.default('mixed', { count: 1 })]).toEqual(['reasons', 'reasons', 'mixed'])
    expect(own.localizations('reasons')).toEqual({})
    expect([own.default('reasons.other'), own.default('mixed.note'), own.localizations('reasons.other')]).toEqual(['Other', 'A note', { id: 'Lainnya' }])
    expect(warned).toEqual([
      '"reasons" names a group of messages, not one, so the key is shown in its place.',
      '"mixed" names a group of messages, not one, so the key is shown in its place.',
    ])
  })

  it("reads a translation by the default catalog's shapes, so one that keeps only a group's `other` is a group", () => {
    const own = createTranslator({
      default: 'en-US',
      locales: {
        'en-US': { grp: { other: 'Other', label: 'Label' } },
        ru: { grp: { other: 'Другое' }, extra: { other: 'Ещё' } },
      },
    } as never) as unknown as { locale: (locale: string) => (key: string) => string }
    const ru = own.locale('ru')

    // A key the default lacks is read by its own shape: `extra` is a plural
    expect([ru('grp'), ru('grp.other'), ru('grp.label'), ru('extra')]).toEqual(['grp', 'Другое', 'Label', 'Ещё'])
    expect(warned).toEqual(['"grp" names a group of messages, not one, so the key is shown in its place.'])
  })
})

describe('a key with a dot in it', () => {
  afterEach(() => vi.restoreAllMocks())

  it('is warned about once, by locale and key, as no lookup can reach it', () => {
    const warned: string[] = []
    vi.spyOn(Logger.prototype, 'warn').mockImplementation((...args: unknown[]) => void warned.push(args.join(' ')))
    const dotted = createTranslator({
      default: 'en-US',
      locales: { 'en-US': { 'ban.done': 'Banned.', ban: { 'kick.done': 'Kicked.' } }, id: { 'ban.done': 'Diblokir.' } } as never,
    }) as unknown as { default: (key: string) => string }

    expect(warned).toEqual([
      'The en-US catalog\'s key "ban.done" has a ".", which a lookup reads as a path, so its message is never found. Nest it as a group instead.',
      'The en-US catalog\'s key "kick.done" in ban has a ".", which a lookup reads as a path, so its message is never found. Nest it as a group instead.',
      'The id catalog\'s key "ban.done" has a ".", which a lookup reads as a path, so its message is never found. Nest it as a group instead.',
    ])
    expect(dotted.default('ban.done')).toBe('ban.done')
  })
})

describe('at the edges', () => {
  it("returns the key for one that names an object's built-in members", () => {
    const t = createTranslator({ default: 'en-US', locales: { 'en-US': { greeting: 'Hello' } } })
    const translate = t.locale('en-US') as unknown as (key: string) => string

    for (const key of ['constructor', 'constructor.name', '__proto__', '__proto__.toString', 'toString', 'greeting.length']) {
      expect(translate(key)).toBe(key)
    }
  })

  it('uses the default locale for an interaction without a locale, and a server without a preferred one', () => {
    const t = createTranslator({ default: 'en-US', locales: { 'en-US': { hi: 'Hello' }, id: { hi: 'Halo' } } })

    expect(t.for({ locale: undefined } as never)('hi')).toBe('Hello')
    expect(t.for({ locale: undefined, guildLocale: null } as never, { public: true })('hi')).toBe('Hello')
    expect(t.forGuild({ preferredLocale: undefined } as never)('hi')).toBe('Hello')
  })

  it("reads a plural's count as `other` when it is not a number", () => {
    const t = createTranslator({
      default: 'en-US',
      locales: { 'en-US': { items: { one: '{count} item', other: '{count} items' } } },
    })
    const translate = t.locale('en-US') as unknown as (key: string, params: Record<string, unknown>) => string

    expect(translate('items', { count: 'many' })).toBe('many items')
  })
})

describe('lookups, and what never resolves', () => {
  const t = createTranslator({
    default: 'en-US',
    locales: {
      'en-US': { menu: { title: 'Menu', empty: null }, items: { one: '{count} item', other: '{count} items' }, hi: 'Hi' },
      'en-GB': { hi: 'Hello there' },
      id: { hi: 'Halo', items: { other: '{count} barang' } },
    } as never,
  })
  const translate = t.locale('en-US') as unknown as (key: string) => string

  it('returns the key for a group of messages, and for a path through an empty entry', () => {
    expect(translate('menu')).toBe('menu')
    expect(translate('menu.empty.more')).toBe('menu.empty.more')
  })

  it('lists only plain messages among the localizations, never a plural', () => {
    expect(t.localizations('items' as never)).toEqual({})
    expect(t.localizations('hi' as never)).toEqual({ 'en-US': 'Hi', 'en-GB': 'Hello there', id: 'Halo' })
  })
})

describe('missingTranslatorError', () => {
  it('names the class and says what to pass', () => {
    expect(missingTranslatorError({ name: 'BanService' }).message).toBe(
      'BanService: it injects Translator, but @MeoCord has no i18n. Pass @MeoCord({ i18n: t }), where t comes from createTranslator.',
    )
  })
})

