import { type CatalogShape, CATALOGS, type Translator } from '@src/common/translator.js'
import { MEOCORD_MESSAGES } from '@src/common/meocord-messages.js'

interface Leaf { key: string; plural: boolean }

const isPlural = (value: unknown): boolean =>
  typeof value === 'object' && value !== null && typeof (value as { other?: unknown }).other === 'string'

/** Every message key of a catalog, and whether it is a plural. */
function leaves(catalog: CatalogShape, prefix = ''): Leaf[] {
  return Object.entries(catalog).flatMap(([name, value]) => {
    const key = `${prefix}${name}`
    if (typeof value === 'string') return [{ key, plural: false }]
    if (isPlural(value)) return [{ key, plural: true }]
    return leaves(value as CatalogShape, `${key}.`)
  })
}

function at(catalog: CatalogShape, key: string): unknown {
  return key.split('.').reduce<unknown>((current, part) => (current as Record<string, unknown> | undefined)?.[part], catalog)
}

const MEOCORD_KEYS = new Set(leaves(MEOCORD_MESSAGES).map(({ key }) => key))
const isMeoCordKey = (key: string) => key.startsWith('meocord.')

/** The `{name}` placeholders of a message, every form of a plural's, as translating fills them. */
function placeholders(message: unknown): Set<string> {
  const texts = typeof message === 'string' ? [message] : Object.values(message as Record<string, unknown>)
  return new Set(texts.flatMap(text => (typeof text === 'string' ? [...text.matchAll(/\{(\w+)}/g)].map(match => match[1]) : [])))
}

/** A message as a report shows it: the text, or a plural's `other` form. */
const shown = (message: unknown): string => (typeof message === 'string' ? message : String((message as { other: string }).other))

/** The `{params}` a translation uses that the message it translates doesn't take; a plural's `{count}` is taken. */
function strayParams(translation: unknown, original: unknown): string[] {
  const taken = placeholders(original)
  if (isPlural(original)) taken.add('count')
  return [...placeholders(translation)].filter(name => !taken.has(name))
}

/**
 * Checks that every locale translates every message, and throws listing each gap, locale by locale.
 *
 * Use it in a test for a team that wants no fallback in production. It reports the messages a locale lacks, the
 * messages the default catalog doesn't have, the plural forms a language needs but a plural lacks, such as `few` for
 * Russian, and each `{param}` a translation uses that the message it translates doesn't take. It reads the catalogs'
 * own strings, so it checks the params of a catalog from a plain variable or a JSON file too, which the compiler
 * can't.
 *
 * @remarks
 * MeoCord's own texts, a catalog's `meocord` group, fall back to English by design, so only a key MeoCord lacks, and
 * a `{param}` MeoCord's English doesn't take, is reported. With `meocord: true`, every locale other than an English
 * one must translate each of them as well.
 *
 * A translation may leave a param out, as a language can say it without the name, so a missing param isn't
 * reported.
 *
 * @param translator - A translator made by `createTranslator`.
 * @param options.meocord - Whether every locale that is not English must translate each of MeoCord's own texts.
 * @throws Error listing every gap; nothing when the catalogs are complete.
 *
 * @example
 * ```ts
 * import { it } from 'vitest'
 *
 * const t = createTranslator({
 *   default: 'en-US',
 *   locales: { 'en-US': { greet: 'Hello' }, id: { greet: 'Halo' } },
 * })
 * it('translates every message', () => {
 *   expectCompleteCatalog(t)
 * })
 * it("translates MeoCord's own texts too", () => {
 *   expectCompleteCatalog(t, { meocord: true })
 * })
 * ```
 *
 * @group Testing
 * @category Inspection
 * @see {@link createTranslator}
 * @see {@link https://meocord.dev/docs/4.1/localisation | Localisation}
 */
export function expectCompleteCatalog(translator: Translator<any>, options: { meocord?: boolean } = {}): void {
  const catalogs = (translator as unknown as { [CATALOGS]?: Partial<Record<string, CatalogShape>> })[CATALOGS]
  if (!catalogs) throw new Error('expectCompleteCatalog takes a translator made by createTranslator.')

  const defaultCatalog = catalogs[translator.defaultLocale] ?? {}
  const reference = leaves(defaultCatalog).filter(({ key }) => !isMeoCordKey(key))
  const referenceKeys = new Set(reference.map(({ key }) => key))
  const gaps: string[] = []

  for (const locale of translator.locales) {
    const catalog = catalogs[locale] ?? {}
    const problems: string[] = []
    const categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories

    for (const { key, plural } of reference) {
      const message = at(catalog, key)
      if (message === undefined) {
        problems.push(`missing ${key}`)
        continue
      }
      if (plural && isPlural(message)) {
        const missing = categories.filter(category => typeof (message as Record<string, unknown>)[category] !== 'string')
        if (missing.length > 0) problems.push(`${key} lacks ${missing.join(', ')}`)
      }
      const original = at(defaultCatalog, key)
      const stray = locale === translator.defaultLocale ? [] : strayParams(message, original)
      if (stray.length > 0) problems.push(`${key} takes no ${stray.map(name => `{${name}}`).join(', ')} (the default is "${shown(original)}")`)
    }
    if (options.meocord && !locale.startsWith('en-')) {
      for (const key of MEOCORD_KEYS) if (at(catalog, key) === undefined) problems.push(`missing ${key}`)
    }
    for (const { key } of leaves(catalog)) {
      if (isMeoCordKey(key)) {
        if (!MEOCORD_KEYS.has(key)) problems.push(`${key} is not one of MeoCord's texts`)
        else {
          const english = at(MEOCORD_MESSAGES, key)
          const stray = strayParams(at(catalog, key), english)
          if (stray.length > 0) problems.push(`${key} takes no ${stray.map(name => `{${name}}`).join(', ')} (MeoCord's English is "${shown(english)}")`)
        }
      } else if (!referenceKeys.has(key)) problems.push(`${key} is not in the default catalog`)
    }

    if (problems.length > 0) gaps.push(`  ${locale}: ${problems.join('; ')}`)
  }

  if (gaps.length > 0) throw new Error(`The catalogs are incomplete:\n${gaps.join('\n')}`)
}
