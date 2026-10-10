import { type Locale } from 'discord.js'
import {
  type CatalogShape,
  CATALOGS,
  fillPlaceholders,
  type FoundMessage,
  languageOf,
  LOCALE_CHAIN,
  lookup,
  pluralForm,
  type Translator,
} from '@src/common/translator.js'
import { MEOCORD_MESSAGES } from '@src/common/meocord-messages.js'
import { type MessageUsageIssue } from '@src/common/errors.js'
import { shared } from '@src/util/shared-state.util.js'

/** A value one of MeoCord's texts reads: a word or number, a list joined in the text's language, or another text. */
export type TextParam = string | number | TextList | MeoCordText

/**
 * Words to join as a list. A `unit` list is joined with `joiner`, a comma unless given, in every language; an `or` list
 * in an app's catalog reads in its locale's words, and in MeoCord's English with `joiner`.
 */
export interface TextList {
  readonly list: readonly string[]
  readonly style: 'or' | 'unit'
  readonly joiner?: string
}

/** One of MeoCord's texts, by its key under `meocord.` or an app's own, and what it is told if nothing has the key. */
export interface MeoCordText {
  readonly key: string
  readonly params?: Readonly<Record<string, TextParam>>
  readonly fallback?: string
}

/** Where a text is read: a user's locale, a server's, or `undefined` for the translator's default. */
export type TextLocale = string | undefined

/** A translator that serves messages by locale, as `createTranslator` makes. */
interface Catalogs {
  [CATALOGS]: Partial<Record<string, CatalogShape>>
  [LOCALE_CHAIN](requested: string | undefined): Locale[]
}

const hasCatalogs = (translator: Translator<any> | undefined): translator is Translator<any> & Catalogs =>
  translator !== undefined && CATALOGS in translator && LOCALE_CHAIN in translator

const ENGLISH = 'en-US' as Locale

/**
 * The message a text is in for `locale`, and whether it is the app's: the app's catalogs down the locale's chain, with
 * MeoCord's English as the English catalog. An English request reads it after the app's English catalogs and before a
 * default in another language; any other request reads it last.
 */
function findText(translator: Translator<any> | undefined, locale: TextLocale, key: string): (FoundMessage & { own: boolean }) | undefined {
  const english = () => {
    const message = lookup(MEOCORD_MESSAGES, key)
    return message === undefined ? undefined : { message, locale: ENGLISH, own: false }
  }
  if (!hasCatalogs(translator)) return english()
  const englishFirst = locale !== undefined && languageOf(locale) === 'en' && languageOf(translator.defaultLocale) !== 'en'
  for (const served of translator[LOCALE_CHAIN](locale)) {
    const beforeDefault = englishFirst && served === translator.defaultLocale ? english() : undefined
    if (beforeDefault) return beforeDefault
    const message = lookup(translator[CATALOGS][served], key)
    if (message !== undefined) return { message, locale: served, own: true }
  }
  return english()
}

const lists = new Map<string, Intl.ListFormat>()

/** An `or` list in a locale's words, such as "a, b, or c" in en-US. */
function orListIn(locale: string, items: readonly string[]): string {
  let format = lists.get(locale)
  if (!format) lists.set(locale, (format = new Intl.ListFormat(locale, { type: 'disjunction' })))
  return format.format(items)
}

/**
 * A text in `locale`, as {@link findText} finds it. An `or` list in an app's catalog reads in the words of the locale
 * that has it; any other list is joined with its `joiner`, a comma unless given, as Intl's `unit` lists join with
 * nothing in zh-CN and with a space in ja.
 */
export function renderText(translator: Translator<any> | undefined, locale: TextLocale, text: MeoCordText): string {
  const found = findText(translator, locale, text.key)
  if (!found) return text.fallback ?? text.key
  const params = text.params ?? {}
  return fillPlaceholders(pluralForm(found, params.count), (name, whole) => {
    if (!Object.hasOwn(params, name)) return whole
    const value = params[name]
    if (typeof value !== 'object') return String(value)
    if ('list' in value) return found.own && value.style === 'or' ? orListIn(found.locale, value.list) : value.list.join(value.joiner ?? ', ')
    return renderText(translator, locale, value)
  })
}

/** Renders texts in one locale through one translator: a word or number as it is, a text in the locale's words. */
export function textRenderer(translator: Translator<any> | undefined, locale: TextLocale): (text: TextParam) => string {
  return text => (typeof text !== 'object' ? String(text) : 'list' in text ? text.list.join(text.joiner ?? ', ') : renderText(translator, locale, text))
}

// Shared by both builds of this version, so either answers in the app's language
const translators = shared('clientTranslators', () => new WeakMap<object, Translator<any>>())

/** Records the translator of the app a client's interactions and messages come to. */
export function registerClientTranslator(client: object, translator: Translator<any> | undefined): void {
  if (translator) translators.set(client, translator)
  else translators.delete(client)
}

/** The translator of the app a client belongs to, if it has one. */
export function translatorOfClient(client: object | null | undefined): Translator<any> | undefined {
  return client ? translators.get(client) : undefined
}

/** What an interaction is answered in: its user's locale, as MeoCord answers the user who made the call. */
export const interactionLocale = (interaction: { locale?: string }): TextLocale => interaction.locale as TextLocale

/** What a reply to a message is in: its server's preferred locale, which the channel reads, or the default in a DM. */
export const messageLocale = (message: { guild?: { preferredLocale?: string } | null }): TextLocale =>
  message.guild?.preferredLocale as TextLocale

/** A text for an interaction, in its user's language through its app's translator. */
export function textFor(interaction: { client?: object; locale?: string }, text: MeoCordText): string {
  return renderText(translatorOfClient(interaction.client), interactionLocale(interaction), text)
}

const issueTexts = new WeakMap<MessageUsageIssue, MeoCordText>()

/** An issue of a usage error, whose message is the text in English, keeping the text to translate it later. */
export function usageIssue(text: MeoCordText, param?: string): MessageUsageIssue {
  const issue: MessageUsageIssue = { ...(param !== undefined && { param }), message: renderText(undefined, undefined, text) }
  issueTexts.set(issue, text)
  return issue
}

/** The text an issue MeoCord made carries; an issue an app made has none. */
export const textOfIssue = (issue: MessageUsageIssue): MeoCordText | undefined => issueTexts.get(issue)
