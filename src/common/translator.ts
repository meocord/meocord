import { type Guild, type Interaction, Locale } from 'discord.js'
import { type MeoCordMessages } from '@src/interface/index.js'
import { refuse } from '@src/util/refusal.util.js'
import { Logger } from '@src/common/logger.js'

/**
 * The plural categories `Intl.PluralRules` selects between.
 *
 * @group Types
 */
export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other'

/**
 * A message with a form per plural category, chosen by the `count` param through `Intl.PluralRules`.
 *
 * `other` is required, since every language has it, and `{count}` interpolates like any param.
 *
 * @remarks
 * An object with an `other` form whose keys are all plural category names is always read as a plural, never as a group
 * of messages named `one`, `other` and so on.
 *
 * @group Types
 */
export type PluralMessage = { readonly other: string } & Readonly<Partial<Record<Exclude<PluralCategory, 'other'>, string>>>

/**
 * A message catalog: messages, plurals, and nested groups of them, keyed by name.
 *
 * @group Types
 */
export interface CatalogShape {
  readonly [key: string]: string | PluralMessage | CatalogShape
}

type IsPlural<T> = T extends object
  ? [Exclude<keyof T, PluralCategory>] extends [never]
    ? T extends PluralMessage
      ? true
      : false
    : false
  : false

/**
 * Every message key of a catalog: the dotted path to each message or plural.
 *
 * @group Types
 */
export type MessageKey<C> = {
  [K in keyof C & string]: C[K] extends string
    ? K
    : IsPlural<C[K]> extends true
      ? K
      : `${K}.${MessageKey<C[K]>}`
}[keyof C & string]

/**
 * The keys whose message is a single string rather than plural forms, with or without `{params}`.
 *
 * @group Types
 * @see {@link LocalizationKey}
 */
export type StringMessageKey<C> = {
  [K in keyof C & string]: C[K] extends string ? K : IsPlural<C[K]> extends true ? never : `${K}.${StringMessageKey<C[K]>}`
}[keyof C & string]

/**
 * The keys {@link Translator.localizations} takes: a single string with no `{params}`, since Discord shows a command's
 * name or description as written, with no plural forms.
 *
 * @group Types
 */
export type LocalizationKey<C> = {
  [K in StringMessageKey<C>]: [Placeholders<MessageAt<C, K>>] extends [never] ? K : never
}[StringMessageKey<C>]

/** The message at a key. */
export type MessageAt<C, K extends string> = K extends `${infer Head}.${infer Rest}`
  ? Head extends keyof C
    ? MessageAt<C[Head], Rest>
    : never
  : K extends keyof C
    ? C[K]
    : never

/** Each character of a string, as a union; tail-recursive, so a long string stays within the compiler's depth. */
type Chars<S extends string, Found = never> = S extends `${infer First}${infer Rest}` ? Chars<Rest, Found | First> : Found

/** A character `\w` matches without the `u` flag: ASCII letters, digits and `_`. */
type WordChar = Chars<'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_'>

/**
 * Whether a string is one or more word characters. It reads 16 at a time, so a name up to 16,000 characters long stays
 * within the compiler's 1,000 steps of tail recursion.
 */
type IsWord<S extends string> =
  S extends `${infer A}${infer B}${infer C}${infer D}${infer E}${infer F}${infer G}${infer H}${infer I}${infer J}${infer K}${infer L}${infer M}${infer N}${infer O}${infer P}${infer Rest}`
    ? [A | B | C | D | E | F | G | H | I | J | K | L | M | N | O | P] extends [WordChar]
      ? Rest extends ''
        ? true
        : IsWord<Rest>
      : false
    : S extends `${WordChar}${infer Rest}`
      ? Rest extends ''
        ? true
        : IsWord<Rest>
      : false

/**
 * The `{param}` names of a message, read from the left as translating reads them: `{{` is a brace written as text, and
 * `{` then word characters then `}` is a param. Where the braces hold anything else, reading resumes after the `{`.
 * A `}}` never holds a param's `}`, so it changes no name. Each `{` is one step of tail recursion, with the names found
 * so far in `Found`, so a message may hold about 1,000 of them.
 */
export type Placeholders<S, Found = never> = S extends `${string}{${infer After}`
  ? After extends `{${infer Rest}`
    ? Placeholders<Rest, Found>
    : Placeholders<[ParamAt<After>] extends [never] ? After : After extends `${string}}${infer Rest}` ? Rest : After, Found | ParamAt<After>>
  : Found

/** The param a `{` opens, from the text after it: the name when word characters close there. */
type ParamAt<After extends string> = After extends `${infer Name}}${string}` ? (IsWord<Name> extends true ? Name : never) : never

/**
 * The params a catalog message takes: one per `{name}` placeholder, whose name is ASCII letters, digits or `_`, and
 * `count` for a plural message.
 *
 * Other text in braces, such as `{ and }`, is the message's own, and `{{` and `}}` are one brace each, so `{{id}}`
 * shows `{id}` and takes no param. A translator's `t(key, params)` is checked against it, so a placeholder left out or
 * misspelt fails to compile. Use it to type params you build before translating.
 *
 * @group Types
 * @see {@link createTranslator}
 */
export type MessageParams<M> = M extends string
  ? Record<Placeholders<M>, string | number>
  : IsPlural<M> extends true
    ? { count: number } & Record<Exclude<Placeholders<M[keyof M & PluralCategory]>, 'count'>, string | number>
    : never

type ParamsArgs<M> = [keyof MessageParams<M>] extends [never] ? [params?: Record<string, never>] : [params: MessageParams<M>]

/**
 * Translates a key into one locale's message.
 *
 * The key and its params are type-checked against the default catalog.
 *
 * @group Types
 */
export type Translate<C> = <K extends MessageKey<C>>(key: K, ...params: ParamsArgs<MessageAt<C, K>>) => string

/**
 * What a locale other than the default provides: any part of the default catalog, in its own wording.
 *
 * Its messages may use only the `{params}` the default's take: `createTranslator` checks that for a catalog that keeps
 * its text, and `expectCompleteCatalog` for any.
 *
 * A message it leaves out falls back to a related locale, then to the default.
 *
 * @group Types
 */
export type LocaleCatalog<C> = {
  readonly [K in keyof C]?: C[K] extends string ? string : IsPlural<C[K]> extends true ? PluralMessage : LocaleCatalog<C[K]>
}

/**
 * What is wrong with a catalog's `meocord` group, one message per mistake: a key MeoCord has no text for, a group where
 * MeoCord has a text or a text where it has a group, or a `{param}` MeoCord's English text lacks, shown beside that
 * English.
 */
type MeoCordIssues<T, M, Path extends string = 'meocord.'> = {
  [K in keyof T & string]: K extends keyof M
    ? M[K] extends string
      ? T[K] extends string
        ? `${Path}${K} takes no {${Exclude<Placeholders<T[K]>, Placeholders<M[K]>> & string}}: MeoCord's English is "${M[K]}"`
        : `${Path}${K} is a text, not a group`
      : T[K] extends string
        ? `${Path}${K} is a group, not a text`
        : MeoCordIssues<T[K], M[K], `${Path}${K}.`>
    : `${Path}${K} is not one of MeoCord's texts`
}[keyof T & string]

/** The issues of a catalog's `meocord` group, each a message naming the text and what is wrong. */
export type CatalogIssues<C> = C extends { readonly meocord: infer G } ? MeoCordIssues<G, MeoCordMessages> : never

/** Refuses a catalog with a mistake, naming each one, where a mismatched text would otherwise read as `never`. */
type MeoCordReport<Issues> = [Issues] extends [never] ? unknown : Readonly<Record<Issues & string, never>>

/** The params a default message takes: its placeholders, and `count` for a plural. */
type DefaultParams<M> = M extends string ? Placeholders<M> : IsPlural<M> extends true ? Placeholders<M[keyof M & PluralCategory]> | 'count' : never

/** The placeholders a locale's message uses, in every form of a plural. */
type UsedParams<T> = T extends string ? Placeholders<T> : T extends object ? Placeholders<T[keyof T & PluralCategory]> : never

/** A default message as an error shows it: the text, or a plural's `other` form. */
type ShownText<M> = M extends string ? M : M extends { readonly other: infer Other extends string } ? Other : ''

/** One issue per `{param}` a locale's message uses that the default's doesn't take. */
type ParamIssue<T, M, Where extends string> = [Exclude<UsedParams<T>, DefaultParams<M>>] extends [never]
  ? never
  : `${Where} takes no {${Exclude<UsedParams<T>, DefaultParams<M>> & string}}; the default is "${ShownText<M>}"`

/**
 * What is wrong with a locale's params, one message per `{param}` its message uses that the default's doesn't take.
 * A message typed `string`, as a plain or JSON catalog's is, can't be read, so only `expectCompleteCatalog` checks it.
 */
export type LocaleIssues<T, C, L extends string, Path extends string = ''> = {
  [K in keyof T & string]: K extends 'meocord'
    ? never
    : K extends keyof C
      ? C[K] extends string
        ? string extends T[K]
          ? never
          : ParamIssue<T[K], C[K], `${L}: ${Path}${K}`>
        : IsPlural<C[K]> extends true
          ? string extends T[K][keyof T[K] & PluralCategory]
            ? never
            : ParamIssue<T[K], C[K], `${L}: ${Path}${K}`>
          : LocaleIssues<T[K], C[K], L, `${Path}${K}.`>
      : never
}[keyof T & string]

/** A locale's catalog with nothing the default lacks: each key is `never` where the default has none. */
type WithinDefault<T, C> = {
  readonly [K in keyof T]: K extends 'meocord'
    ? unknown
    : K extends keyof C
    ? C[K] extends string
      ? string
      : IsPlural<C[K]> extends true
        ? PluralMessage
        : WithinDefault<T[K], C[K]>
    : never
}

/** Refuses a `locales` key that is not a Discord locale, such as a bare `en`. */
type DiscordLocaleKeys<L> = { readonly [K in keyof L]: K extends `${Locale}` ? unknown : never }

type WidenedLeaves<C> = {
  [K in keyof C]: C[K] extends string ? (string extends C[K] ? true : never) : C[K] extends object ? WidenedLeaves<C[K]> : never
}[keyof C]

/** Refuses a default catalog whose messages lost their literal types, since its params would go unchecked. */
type LiteralCatalog<C> = [WidenedLeaves<C>] extends [never]
  ? unknown
  : { 'The default catalog has lost its message types: wrap the catalog in defineCatalog(...) or add `as const`': never }

/**
 * What {@link defineCatalog} takes: a catalog, checked as it is written.
 *
 * Its `meocord` group, the texts MeoCord writes itself, holds only those texts, each a text where MeoCord's is one and a
 * group where MeoCord's is one, with no `{param}` MeoCord's English text lacks. A mistake shows as an error naming the
 * text, beside MeoCord's English. The rest of the catalog is the application's own, checked against it by
 * {@link createTranslator}.
 *
 * @typeParam T - The catalog.
 *
 * @group Types
 */
export type CatalogDefinition<T> = T & MeoCordReport<CatalogIssues<T>>

/**
 * Declares a message catalog, keeping each message's text as its type so the params it takes can be checked.
 *
 * A default catalog declared apart from `createTranslator` needs it, or `as const`. Other locales compile without it,
 * but only one that keeps its text has its `{params}` checked when the code compiles.
 *
 * @param catalog - Messages, plurals and nested groups of them.
 * @returns The catalog, unchanged.
 *
 * @example
 * ```ts
 * // src/locales/en-US.ts
 * export default defineCatalog({
 *   ban: { description: 'Ban a member', done: 'Banned {user}.' },
 *   warnings: { one: '{count} warning', other: '{count} warnings' },
 * })
 * ```
 *
 * @group Utilities
 * @category Localisation
 */
export function defineCatalog<const T extends CatalogShape>(catalog: CatalogDefinition<T>): T {
  return catalog
}

/**
 * What {@link createTranslator} takes: the default locale, and a catalog per locale.
 *
 * It is checked as it is written. Every key of `locales` is a locale Discord sends, every catalog holds only messages the
 * default one has, using no `{param}` the default's lacks, and the default catalog keeps its messages' text, so their
 * params are read from it. Each catalog's `meocord` group is checked as {@link CatalogDefinition} checks it. A mistake shows as an
 * error naming the locale or the message.
 *
 * @typeParam Locales - The catalogs, by locale.
 * @typeParam Default - The locale whose catalog is the reference and the last fallback.
 *
 * @group Types
 */
export type TranslatorOptions<
  Locales extends Readonly<Record<string, CatalogShape>>,
  Default extends keyof Locales & `${Locale}`,
> = {
  /** The locale whose catalog is the reference and the last fallback. */
  default: Default
  /** A catalog per discord.js `Locale`, including the default's. */
  locales: Locales &
    DiscordLocaleKeys<Locales> & { readonly [L in Exclude<keyof Locales, Default>]: WithinDefault<Locales[L], Locales[Default]> }
} & LiteralCatalog<Locales[Default]> &
  MeoCordReport<{ [L in keyof Locales]: CatalogIssues<Locales[L]> }[keyof Locales]> &
  MeoCordReport<{ [L in Exclude<keyof Locales, Default>]: LocaleIssues<Locales[L], Locales[Default], L & string> }[Exclude<keyof Locales, Default>]>

/**
 * Translates messages from one catalog per locale, typed by the default one.
 *
 * Make one with `createTranslator` at module scope, so command builders can use it, and pass it to `@MeoCord({ i18n
 * })` to inject it as `Translator` too.
 *
 * @remarks
 * A locale is resolved to the catalog that serves it: the exact locale, then another of the same language (`es-419` to
 * `es-ES`, `en-GB` to `en-US`), then the default. A message missing from that catalog is looked up the same way.
 * A key with no message in any catalog, such as one naming a group, is returned as it is; in development, a warning
 * names it once.
 *
 * @typeParam C - The default catalog. Every locale's keys are checked against it, and so are the `{params}` of
 *   each message whose text the compiler can read; see {@link createTranslator}.
 *
 * @example
 * ```ts
 * const enUS = defineCatalog({ ban: { done: 'Banned {user}.' } })
 *
 * @Service()
 * export class BanService {
 *   constructor(private readonly t: Translator<typeof enUS>) {}
 *
 *   done(interaction: ChatInputCommandInteraction, user: User): string {
 *     return this.t.for(interaction)('ban.done', { user: user.toString() })
 *   }
 * }
 * ```
 *
 * @group Utilities
 * @category Localisation
 */
export abstract class Translator<C = CatalogShape> {
  /** The locale whose catalog is the default. */
  abstract readonly defaultLocale: Locale

  /** Every locale with a catalog, the default first. */
  abstract readonly locales: readonly Locale[]

  /**
   * Translates into the default locale, as a command builder's name or description needs.
   *
   * @param key - A message key of the default catalog.
   * @param params - The message's params, when it takes any.
   * @returns The message in the default locale.
   */
  abstract default<K extends MessageKey<C>>(key: K, ...params: ParamsArgs<MessageAt<C, K>>): string

  /**
   * A message in every locale other than the default whose own catalog has it, for a builder's
   * `setNameLocalizations` or `setDescriptionLocalizations`. Locales without it are left out, so
   * Discord falls back to the default name for them, and so are an empty translation and a translation
   * with a `{param}`, which `expectCompleteCatalog` reports.
   *
   * Discord shows en-US users the en-GB value, en-GB users the en-US one, and es-419 users the es-ES one,
   * when their own locale has none. So when the default is en-US, en-GB or es-419 and its partner is in
   * the result, the default's own message is added under the default's key, and its users keep the default
   * wording.
   *
   * @param key - A plain message key without `{params}`: Discord shows a name or description as written, and has no
   *   plural forms for it.
   * @returns The message keyed by locale.
   * @throws When the default catalog's message takes params, as one from a JSON file can.
   */
  abstract localizations(key: LocalizationKey<C>): Partial<Record<Locale, string>>

  /**
   * Translates for the user of an interaction, in the language their Discord client uses.
   *
   * @param interaction - The interaction being answered.
   * @param options - `public: true` uses the server's language instead, for a reply everyone there
   *   sees; outside a server, the user's.
   * @returns A function that translates a message key.
   */
  abstract for(interaction: Interaction, options?: { public?: boolean }): Translate<C>

  /**
   * Translates for a server, in its preferred language: for events and messages, which have no
   * user locale.
   *
   * @param guild - The server to translate for.
   * @returns A function that translates a message key.
   */
  abstract forGuild(guild: Guild): Translate<C>

  /**
   * Translates into a given locale.
   *
   * @param locale - A discord.js `Locale`; one without a catalog falls back as a user's would.
   * @returns A function that translates a message key.
   */
  abstract locale(locale: Locale | `${Locale}`): Translate<C>
}

/**
 * Where a translator made by `createTranslator` keeps its catalogs, for MeoCord's texts, `@MeoCord` and
 * `expectCompleteCatalog`.
 */
export const CATALOGS = Symbol('catalogs')

/** How MeoCord's own texts read a translator made by `createTranslator`: the catalogs that serve a locale, in order. */
export const LOCALE_CHAIN = Symbol('localeChain')

/** A message a translator serves, and the locale whose catalog has it. */
export interface FoundMessage {
  message: string | PluralMessage
  locale: Locale
}

/** For a class that injects `Translator` in an app that configured none. */
export function missingTranslatorError(cls: { name: string }): Error {
  return new Error(
    `${cls.name}: it injects Translator, but @MeoCord has no i18n. Pass @MeoCord({ i18n: t }), where t comes from createTranslator.`,
  )
}

const DISCORD_LOCALES: ReadonlySet<string> = new Set(Object.values(Locale))

export const languageOf = (locale: string): string => locale.split('-')[0]

/** A message by its dotted key, or undefined when the catalog lacks it or the key names a group. */
export function lookup(catalog: CatalogShape | undefined, key: string): string | PluralMessage | undefined {
  let current: unknown = catalog
  for (const part of key.split('.')) {
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[part]
  }
  if (typeof current === 'string') return current
  if (typeof current === 'object' && current !== null && typeof (current as PluralMessage).other === 'string') {
    return current as PluralMessage
  }
  return undefined
}

const plurals = new Map<string, Intl.PluralRules>()

/** The form of a found message to use: a plain message itself, or a plural's form for `count` in its locale's rules. */
export function pluralForm({ message, locale }: FoundMessage, count: unknown): string {
  if (typeof message === 'string') return message
  let rules = plurals.get(locale)
  if (!rules) plurals.set(locale, (rules = new Intl.PluralRules(locale)))
  return message[rules.select(Number(count)) as PluralCategory] ?? message.other
}

/** A brace written as text, `{{` or `}}`, or a `{param}` of word characters: the reading `Placeholders` follows. */
const PLACEHOLDER = /\{\{|}}|\{(\w+)}/g

/** The `{param}` names of a message, in order, as translating fills them. */
export function placeholderNames(message: string): string[] {
  return [...message.matchAll(PLACEHOLDER)].flatMap(([, name]) => (name === undefined ? [] : [name]))
}

/** A message with each `{param}` replaced by what `fill` gives for its name, and each `{{` or `}}` as one brace. */
export function fillPlaceholders(message: string, fill: (name: string, placeholder: string) => string): string {
  return message.replace(PLACEHOLDER, (whole, name: string | undefined) => (name === undefined ? whole[0] : fill(name, whole)))
}

function interpolate(message: string, params: Record<string, unknown>): string {
  return fillPlaceholders(message, (name, whole) => (Object.hasOwn(params, name) ? String(params[name]) : whole))
}

/** Whether a dotted key leads to an object in a catalog: a group of messages, which has no text of its own. */
function isGroup(catalog: CatalogShape | undefined, key: string): boolean {
  let current: unknown = catalog
  for (const part of key.split('.')) {
    if (typeof current !== 'object' || current === null || !Object.hasOwn(current, part)) return false
    current = (current as Record<string, unknown>)[part]
  }
  return typeof current === 'object' && current !== null
}

/** The locale Discord shows a locale's users when that locale has no localization of its own, by its locale fallbacks. */
const FALLBACK_PARTNERS: Partial<Record<Locale, Locale>> = {
  [Locale.EnglishUS]: Locale.EnglishGB,
  [Locale.EnglishGB]: Locale.EnglishUS,
  [Locale.SpanishLATAM]: Locale.SpanishES,
}

class CatalogTranslator<C extends CatalogShape> extends Translator<C> {
  readonly locales: readonly Locale[]
  private readonly logger = new Logger('Translator')
  private readonly warned = new Set<string>()

  constructor(
    readonly defaultLocale: Locale,
    private readonly catalogs: Partial<Record<Locale, CatalogShape>>,
  ) {
    super()
    Object.defineProperty(this, CATALOGS, { value: catalogs })
    this.locales = [defaultLocale, ...(Object.keys(catalogs) as Locale[]).filter(locale => locale !== defaultLocale)]
  }

  /** The catalogs that serve a locale, most specific first, ending with the default. */
  [LOCALE_CHAIN](requested: string | undefined): Locale[] {
    const chain: Locale[] = []
    const add = (locale: Locale) => {
      if (!chain.includes(locale)) chain.push(locale)
    }

    if (requested && this.catalogs[requested as Locale]) add(requested as Locale)
    if (requested) {
      const language = languageOf(requested)
      // Then the other catalogs of the requested language, the default first, as en-GB reads en-US
      for (const locale of this.locales) if (languageOf(locale) === language) add(locale)
    }
    add(this.defaultLocale)
    return chain
  }

  private translate(requested: string | undefined, key: string, params: Record<string, unknown> = {}): string {
    for (const locale of this[LOCALE_CHAIN](requested)) {
      const message = lookup(this.catalogs[locale], key)
      if (message === undefined) continue
      // An empty translation, as tools export an untranslated string, counts as missing: Discord refuses an empty reply
      const text = pluralForm({ message, locale }, params.count)
      if (text !== '') return interpolate(text, params)
    }
    this.warnUnknown(key)
    return key
  }

  /** Warns once per key, in development, that a key with no message is shown in its place. */
  private warnUnknown(key: string): void {
    if (process.env.NODE_ENV !== 'development' || this.warned.has(key)) return
    this.warned.add(key)
    this.logger.warn(
      isGroup(this.catalogs[this.defaultLocale], key)
        ? `"${key}" names a group of messages, not one, so the key is shown in its place.`
        : `No catalog has a message with the key "${key}", so the key is shown in its place.`,
    )
  }

  private translateTo(locale: string | undefined): Translate<C> {
    return ((key: string, params?: Record<string, unknown>) => this.translate(locale, key, params)) as Translate<C>
  }

  default<K extends MessageKey<C>>(key: K, ...params: ParamsArgs<MessageAt<C, K>>): string {
    return this.translate(this.defaultLocale, key, params[0] as Record<string, unknown> | undefined)
  }

  localizations(key: LocalizationKey<C>): Partial<Record<Locale, string>> {
    const original = lookup(this.catalogs[this.defaultLocale], key)
    if (original === undefined) this.warnUnknown(key)
    const params = typeof original === 'string' ? placeholderNames(original) : []
    if (params.length > 0) {
      const taken = [...new Set(params)].map(name => `{${name}}`).join(', ')
      throw refuse(
        new Error(`localizations("${key}"): the message takes ${taken}, and a name or description is shown as written. Use a message without params.`),
      )
    }

    const localized: Partial<Record<Locale, string>> = {}
    for (const locale of this.locales) {
      if (locale === this.defaultLocale) continue
      const message = lookup(this.catalogs[locale], key)
      // A translation with a {param} is left out, as Discord would show it as written, and so is an empty one
      if (typeof message === 'string' && message !== '' && placeholderNames(message).length === 0) {
        localized[locale] = fillPlaceholders(message, (_name, whole) => whole)
      }
    }
    // Discord gives a locale it falls back from its partner's value, so the default keeps its own wording beside one
    const partner = FALLBACK_PARTNERS[this.defaultLocale]
    if (partner && localized[partner] !== undefined && typeof original === 'string' && original !== '') {
      localized[this.defaultLocale] = fillPlaceholders(original, (_name, whole) => whole)
    }
    return localized
  }

  for(interaction: Interaction, options: { public?: boolean } = {}): Translate<C> {
    return this.translateTo(options.public ? (interaction.guildLocale ?? interaction.locale) : interaction.locale)
  }

  forGuild(guild: Guild): Translate<C> {
    return this.translateTo(guild.preferredLocale)
  }

  locale(locale: Locale | `${Locale}`): Translate<C> {
    return this.translateTo(locale)
  }
}

/**
 * Creates the application's translator from one catalog per locale.
 *
 * Create it at module scope: command builders are built when the controllers using them are decorated, before any
 * container exists, and use it for names and descriptions. Pass the same instance to `@MeoCord({ i18n })` to inject it
 * as `Translator`.
 *
 * Each locale is checked against the default catalog when the code compiles: every key must be one the default has,
 * and a message may use only the `{params}` the default's message takes, and `{count}` in a plural's forms, in any
 * order, all or some. The error names each mistake, such as:
 *
 * ```text
 * id: ban.done takes no {usr}; the default is "Banned {user}."
 * ```
 *
 * @remarks
 * The compiler reads a message's params only from its text, which a catalog made with `defineCatalog`, written with
 * `as const` or written inline keeps. A catalog from a plain variable or a JSON file types each message as `string`, so
 * its params are checked by `expectCompleteCatalog` from `meocord/testing` instead, when a test runs.
 *
 * A brace a message shows as text is written twice: `'Buttons use ticket/{{id}}'` shows `ticket/{id}` and takes no
 * param.
 *
 * @param options - The default locale and a catalog per locale.
 * @param options.default - The locale whose catalog is the reference and the last fallback.
 * @param options.locales - A catalog per discord.js `Locale`, including the default's.
 * @returns The translator, typed by the default catalog.
 * @throws When the default locale has no catalog, or a key is not a Discord locale.
 *
 * @example
 * ```ts
 * const enUS = defineCatalog({ ban: { description: 'Ban a member', done: 'Banned {user}.' } })
 * const id = { ban: { description: 'Blokir anggota', done: '{user} diblokir.' } }
 * export const t = createTranslator({ default: 'en-US', locales: { 'en-US': enUS, id } })
 *
 * new SlashCommandBuilder()
 *   .setName('ban')
 *   .setDescription(t.default('ban.description'))
 *   .setDescriptionLocalizations(t.localizations('ban.description'))
 *
 * @Command('ban', CommandType.SLASH)
 * async ban(interaction: ChatInputCommandInteraction) {
 *   await respond(interaction).send(t.for(interaction)('ban.done', { user: interaction.user.toString() }))
 * }
 * ```
 *
 * @group Utilities
 * @category Localisation
 */
export function createTranslator<
  const Locales extends Readonly<Record<string, CatalogShape>>,
  const Default extends keyof Locales & `${Locale}`,
>(options: TranslatorOptions<Locales, Default>): Translator<Locales[Default]> {
  const { default: defaultLocale, locales } = options
  for (const locale of Object.keys(locales)) {
    if (!DISCORD_LOCALES.has(locale)) {
      throw refuse(new Error(`"${locale}" is not a Discord locale. Use discord.js Locale values, such as en-US or es-ES.`))
    }
  }
  if (!locales[defaultLocale]) throw refuse(new Error(`The default locale "${defaultLocale}" has no catalog in locales.`))

  // Typed by the default catalog; at runtime every catalog is read the same way.
  return new CatalogTranslator(defaultLocale as Locale, locales as Partial<Record<Locale, CatalogShape>>) as unknown as Translator<
    Locales[Default]
  >
}
