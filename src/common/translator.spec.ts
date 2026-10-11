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

  it('refuses a key whose message takes params, which Discord would show as written', () => {
    expect(() => loose.localizations('ban.done')).toThrow(
      'localizations("ban.done"): the message takes {user}, and a name or description is shown as written. Use a message without params.',
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

