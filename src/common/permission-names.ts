import { BaseInteraction, type Interaction, type Locale, Message, PermissionFlagsBits, type PermissionResolvable, PermissionsBitField } from 'discord.js'
import { MEOCORD_MESSAGES } from '@src/common/meocord-messages.js'
import { interactionLocale, listIn, messageLocale, renderTextIn, type TextLocale, translatorOfClient } from '@src/common/meocord-text.js'
import { type Translator } from '@src/common/translator.js'

/** The words a list of labels is joined with: `and` or `or`, in the language of the labels. */
const JOINS = { and: 'conjunction', or: 'disjunction' } as const

/** The labels' language when MeoCord's English gives them. */
const ENGLISH = 'en-US'

/**
 * The flag name each bit is labelled by: the one MeoCord has a label for, so `1 << 30` reads by its current name and
 * not the deprecated one, or else the last discord.js gives that bit, as discord.js adds a new name after the old.
 */
const FLAG_NAMES: ReadonlyMap<bigint, string> = (() => {
  const names = new Map<bigint, string>()
  for (const [name, bit] of Object.entries(PermissionFlagsBits)) {
    if (!Object.hasOwn(MEOCORD_MESSAGES.meocord.permissions, names.get(bit) ?? '')) names.set(bit, name)
  }
  return names
})()

/**
 * How {@link permissionNames} writes the labels.
 *
 * @group Types
 */
export interface PermissionNamesOptions {
  /** Joins the labels into one sentence part with the language's `and` or `or`, such as "A, B, and C". */
  join?: keyof typeof JOINS
  /** The translator, for a `Locale` target or to use another than the target's app's. */
  t?: Translator<any>
}

type PermissionTarget = Interaction | Message | Locale | `${Locale}`

/**
 * The permissions as a server owner reads them in Discord's role settings, such as `Ban Members` for `BanMembers`, in
 * the language of the user or server they are for.
 *
 * Use it to say which permission a guard or a bot lacks. Labels come in bit order, one per bit: a bit with two flag
 * names, as `1 << 30` has, gives one. A bit with no label gives its flag name, and a bit discord.js has no name for
 * gives `Unknown permission (1 << n)`, so none is left out.
 *
 * An interaction's labels are in its user's locale and a message's in its server's, through its app's translator; a
 * `Locale` names the language, with `options.t` as the translator. Without a translator or a target they are MeoCord's
 * English. The labels are MeoCord's texts in `meocord.permissions`, by flag name, which an app's catalog translates.
 *
 * Some of Discord's labels hold commas, such as `Kick, Approve, and Reject Members`, and `join` lists them as they are:
 * `KickMembers` and `BanMembers` read `Kick, Approve, and Reject Members and Ban Members`.
 *
 * @param permissions - What discord.js reads as permissions: a `PermissionsBitField`, a bigint, a flag name or an array.
 * @param target - The interaction or message the labels are for, or a locale.
 * @param options - `join`, which joins the labels into one string, and the translator.
 * @returns The labels joined as a list in their language.
 * @throws RangeError when `permissions` names a flag discord.js doesn't know, as discord.js throws.
 *
 * @example
 * ```ts
 * declare const interaction: ChatInputCommandInteraction
 *
 * const missing = interaction.memberPermissions?.missing([PermissionFlagsBits.ManageMessages, PermissionFlagsBits.BanMembers]) ?? []
 * if (missing.length > 0) throw new GuardDeniedError(`You need ${permissionNames(missing, interaction, { join: 'and' })}.`)
 * // 'You need Ban Members and Manage Messages.'
 * ```
 *
 * @group Utilities
 * @category Localisation
 * @see {@link https://meocord.dev/docs/4.3/formatting | Formatting}
 * @see {@link https://meocord.dev/docs/4.3/localisation | Localisation}
 */
export function permissionNames(
  permissions: PermissionResolvable,
  target: PermissionTarget | undefined,
  options: PermissionNamesOptions & { join: keyof typeof JOINS },
): string
/**
 * The permissions as a server owner reads them in Discord's role settings, a label per bit in bit order, in the language
 * of the user or server they are for: read as the signature with `join` reads them.
 *
 * @param permissions - What discord.js reads as permissions: a `PermissionsBitField`, a bigint, a flag name or an array.
 * @param target - The interaction or message the labels are for, or a locale.
 * @param options - The translator.
 * @returns A label per bit.
 * @throws RangeError when `permissions` names a flag discord.js doesn't know, as discord.js throws.
 *
 * @example
 * ```ts
 * permissionNames(['ManageMessages', 'BanMembers']) // ['Ban Members', 'Manage Messages']
 * ```
 *
 * @group Utilities
 * @category Localisation
 * @see {@link https://meocord.dev/docs/4.3/formatting | Formatting}
 * @see {@link https://meocord.dev/docs/4.3/localisation | Localisation}
 */
export function permissionNames(permissions: PermissionResolvable, target?: PermissionTarget, options?: PermissionNamesOptions & { join?: undefined }): string[]
export function permissionNames(permissions: PermissionResolvable, target?: PermissionTarget, options: PermissionNamesOptions = {}): string | string[] {
  const field = new PermissionsBitField(permissions).bitfield
  const isTarget = target instanceof BaseInteraction || target instanceof Message
  const translator = options.t ?? (isTarget ? translatorOfClient(target.client) : undefined)
  const locale: TextLocale = target instanceof BaseInteraction ? interactionLocale(target) : target instanceof Message ? messageLocale(target) : target

  const labels: { text: string; locale?: string }[] = []
  for (let index = 0n, bit = 1n; bit <= field; index++, bit <<= 1n) {
    if ((field & bit) === 0n) continue
    const name = FLAG_NAMES.get(bit)
    labels.push(
      name === undefined
        ? renderTextIn(translator, locale, { key: 'meocord.permissions.unknown', params: { bit: String(index) } })
        : renderTextIn(translator, locale, { key: `meocord.permissions.${name}`, fallback: name }),
    )
  }
  const texts = labels.map(label => label.text)
  if (options.join === undefined) return texts
  if (!Object.hasOwn(JOINS, options.join)) throw new RangeError(`permissionNames' join is and or or, not ${String(options.join)}.`)
  // The labels' own language, so a list of English labels in a translated reply reads as English does
  const language = labels.find(label => label.locale !== undefined)?.locale ?? ENGLISH
  return listIn(language, texts, JOINS[options.join])
}
