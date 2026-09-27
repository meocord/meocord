import { type Locale } from 'discord.js'
import { CATALOGS, FIND_MESSAGE, type FoundMessage, lookup, pluralForm, type Translator } from '@src/common/translator.js'
import { MEOCORD_MESSAGES } from '@src/common/meocord-messages.js'
import { type MessageUsageIssue } from '@src/common/errors.js'

/** A value one of MeoCord's texts reads: a word or number, a list joined in the text's language, or another text. */
export type TextParam = string | number | TextList | MeoCordText

/** Words to join as a list: in an app's catalog, in its locale's words; in MeoCord's English, with `joiner`, a comma by default. */
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
interface Finder { [FIND_MESSAGE](requested: string | undefined, key: string): FoundMessage | undefined }

const canFind = (translator: Translator<any> | undefined): translator is Translator<any> & Finder =>
  translator !== undefined && CATALOGS in translator && FIND_MESSAGE in translator

const lists = new Map<string, Intl.ListFormat>()

/** A list in a locale's words: "a, b or c", or, for a unit, "a, b, c". */
function listIn(locale: string, style: 'or' | 'unit', items: readonly string[]): string {
  let format = lists.get(`${locale} ${style}`)
  if (!format) lists.set(`${locale} ${style}`, (format = new Intl.ListFormat(locale, { type: style === 'or' ? 'disjunction' : 'unit' })))
  return format.format(items)
}

/**
 * A text in `locale`: the app's catalogs down the locale's chain, then MeoCord's English. A list in MeoCord's
 * English is joined with commas, as it reads; in an app's catalog, in the words of the locale that has it.
 */
export function renderText(translator: Translator<any> | undefined, locale: TextLocale, text: MeoCordText): string {
  const own = canFind(translator) ? translator[FIND_MESSAGE](locale, text.key) : undefined
  const english = own ? undefined : lookup(MEOCORD_MESSAGES, text.key)
  if (!own && english === undefined) return text.fallback ?? text.key
  const found: FoundMessage = own ?? { message: english!, locale: 'en-US' as Locale }
  const params = text.params ?? {}
  return pluralForm(found, params.count).replace(/\{(\w+)}/g, (whole, name: string) => {
    if (!Object.hasOwn(params, name)) return whole
    const value = params[name]
    if (typeof value !== 'object') return String(value)
    if ('list' in value) return own ? listIn(found.locale, value.style, value.list) : value.list.join(value.joiner ?? ', ')
    return renderText(translator, locale, value)
  })
}

/** Renders texts in one locale through one translator: a word or number as it is, a text in the locale's words. */
export function textRenderer(translator: Translator<any> | undefined, locale: TextLocale): (text: TextParam) => string {
  return text => (typeof text !== 'object' ? String(text) : 'list' in text ? text.list.join(text.joiner ?? ', ') : renderText(translator, locale, text))
}

const translators = new WeakMap<object, Translator<any>>()

/** Records the translator of the app a client's interactions and messages come to. */
export function registerClientTranslator(client: object, translator: Translator<any> | undefined): void {
  if (translator) translators.set(client, translator)
  else translators.delete(client)
}

/** The translator of the app a client belongs to, if it has one. */
export function translatorOfClient(client: object | null | undefined): Translator<any> | undefined {
  return client ? translators.get(client) : undefined
}

/** What an interaction is answered in: its user's locale, since MeoCord's answers to it are private. */
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
