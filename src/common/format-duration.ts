import { BaseInteraction, type Interaction, type Locale, Message } from 'discord.js'
import { interactionLocale, joinList, messageLocale, renderText, type TextLocale, translatorOfClient } from '@src/common/meocord-text.js'
import { type Translator } from '@src/common/translator.js'
import { UNIT_MS } from '@src/core/scalar-types.js'

/**
 * A unit {@link formatDuration} writes, as a `{x:duration}` param reads it.
 *
 * @group Types
 */
export type DurationUnit = 'w' | 'd' | 'h' | 'm' | 's' | 'ms'

/** The units, largest first, each with the name of its texts under `meocord.duration`. */
const UNITS = [
  ['w', 'week'],
  ['d', 'day'],
  ['h', 'hour'],
  ['m', 'minute'],
  ['s', 'second'],
  ['ms', 'millisecond'],
] as const satisfies readonly (readonly [DurationUnit, string])[]

const ROUNDING = { down: Math.floor, up: Math.ceil, nearest: Math.round } as const

const STYLES = ['narrow', 'long', 'param'] as const

/** The text that joins a long duration's units, which a catalog translates for its locale. */
const JOINER_KEY = 'meocord.duration.joiner'

/**
 * How {@link formatDuration} writes a duration.
 *
 * @group Types
 */
export interface FormatDurationOptions {
  /** How many units to show, largest first: 2 unless given, `Infinity` for every unit down to `smallest`. */
  units?: number
  /** The largest unit shown: `'d'` unless given, so ten days read `10d`. */
  largest?: DurationUnit
  /** The smallest unit shown: `'s'` unless given, so 1500 ms reads `1s`. */
  smallest?: DurationUnit
  /** How the value is rounded at the smallest unit shown: `'down'` unless given. */
  round?: keyof typeof ROUNDING
  /**
   * `'narrow'` (the default) writes `1h 5m`; `'long'` writes `1 hour, 5 minutes`, joined as the locale's catalog joins
   * them; `'param'` writes `1h5m`, which a `{x:duration}` param reads back, never translated, for a value up to
   * `Number.MAX_SAFE_INTEGER`.
   */
  style?: (typeof STYLES)[number]
  /** The translator, for a `Locale` target or to use another than the target's app's. */
  t?: Translator<any>
}

const unitIndex = (name: string, unit: unknown): number => {
  const index = UNITS.findIndex(([short]) => short === unit)
  if (index < 0) throw new RangeError(`formatDuration's ${name} is one of ${UNITS.map(([short]) => short).join(', ')}, not ${String(unit)}.`)
  return index
}

/**
 * Writes a length of time for people, such as `1h 5m` or `1 hour, 5 minutes`, in the language of the user or server
 * it is for.
 *
 * It shows `units` units, largest first: the largest the value reaches, up to `largest`, and the ones below it down to
 * `smallest`. The value is rounded to a whole number of the smallest unit shown; when rounding lifts it into a larger
 * unit, the units are chosen again, so 3,599,500 ms rounded up reads `1h`, not `59m 60s`. A unit whose count is 0 is
 * left out; a value that rounds to 0 reads `0s`, in `smallest`.
 *
 * An interaction's text is in its user's locale and a message's in its server's, through its app's translator; a
 * `Locale` names the language, with `options.t` as the translator. Without a translator or a target the text is
 * MeoCord's English. The unit words are MeoCord's texts in `meocord.duration`, which an app's catalog translates.
 *
 * @param ms - The duration in milliseconds: a finite number, at least 0.
 * @param target - The interaction or message the text is for, or a locale.
 * @param options - How many units, which units, the rounding, the style and the translator.
 * @returns The duration in words.
 * @throws RangeError when `ms` is negative, `NaN` or infinite, or past `Number.MAX_SAFE_INTEGER` in the `param`
 *   style, `units` isn't a whole number of at least 1 or `Infinity`, a unit isn't one of `w`, `d`, `h`, `m`, `s` and
 *   `ms`, or `smallest` is larger than `largest`.
 *
 * @example
 * ```ts
 * declare const interaction: ChatInputCommandInteraction
 *
 * formatDuration(3_900_000) // '1h 5m'
 * formatDuration(3_900_000, undefined, { style: 'long' }) // '1 hour, 5 minutes'
 * formatDuration(3_900_000, interaction) // in the interaction's language, through the app's translator
 * formatDuration(5_400_000, undefined, { style: 'param' }) // '1h30m', which {x:duration} reads back as 5400000
 * ```
 *
 * @group Utilities
 * @category Localisation
 * @see {@link https://meocord.dev/docs/4.2/formatting | Formatting}
 * @see {@link https://meocord.dev/docs/4.2/localisation | Localisation}
 */
export function formatDuration(ms: number, target?: Interaction | Message | Locale | `${Locale}`, options: FormatDurationOptions = {}): string {
  const { units = 2, largest = 'd', smallest = 's', round = 'down', style = 'narrow' } = options
  if (!Number.isFinite(ms) || ms < 0) throw new RangeError(`formatDuration takes a finite number of milliseconds of at least 0, not ${ms}.`)
  if (!(units >= 1 && (Number.isInteger(units) || units === Infinity))) {
    throw new RangeError(`formatDuration's units is a whole number of at least 1, or Infinity, not ${units}.`)
  }
  const high = unitIndex('largest', largest)
  const low = unitIndex('smallest', smallest)
  if (low < high) throw new RangeError(`formatDuration's smallest unit, ${smallest}, is larger than its largest, ${largest}.`)
  if (!Object.hasOwn(ROUNDING, round)) throw new RangeError(`formatDuration's round is down, up or nearest, not ${String(round)}.`)
  if (!STYLES.includes(style)) throw new RangeError(`formatDuration's style is narrow, long or param, not ${String(style)}.`)
  // Past it a count may print as 1e+21 or lose digits, and the text would not read back as the value
  if (style === 'param' && ms > Number.MAX_SAFE_INTEGER) {
    throw new RangeError(`formatDuration's param style writes at most Number.MAX_SAFE_INTEGER milliseconds, to be read back exactly, not ${ms}.`)
  }

  const span = (value: number) => {
    let top = high
    while (top < low && value < UNIT_MS[UNITS[top][0]]!) top++
    return { top, bottom: Math.min(low, top + units - 1) }
  }
  const rounded = (value: number, bottom: number) => ROUNDING[round](value / UNIT_MS[UNITS[bottom][0]]!) * UNIT_MS[UNITS[bottom][0]]!
  let { top, bottom } = span(ms)
  let value = rounded(ms, bottom)
  // Rounding lifted the value into a larger unit: the units are chosen again for it, which leaves it whole
  if (span(value).top !== top) {
    ;({ top, bottom } = span(value))
    value = rounded(value, bottom)
  }

  const counts: (readonly [number, number])[] = []
  for (let index = top, rest = value; index <= bottom; index++) {
    const size = UNIT_MS[UNITS[index][0]]!
    const count = Math.floor(rest / size)
    rest -= count * size
    if (count > 0) counts.push([index, count])
  }
  if (counts.length === 0) counts.push([bottom, 0])

  if (style === 'param') return counts.map(([index, count]) => `${count}${UNITS[index][0]}`).join('')
  const isTarget = target instanceof BaseInteraction || target instanceof Message
  const translator = options.t ?? (isTarget ? translatorOfClient(target.client) : undefined)
  const locale: TextLocale = target instanceof BaseInteraction ? interactionLocale(target) : target instanceof Message ? messageLocale(target) : target
  const words = counts.map(([index, count]) =>
    renderText(translator, locale, { key: `meocord.duration.${UNITS[index][1]}${style === 'long' ? 'Long' : ''}`, params: { count } }),
  )
  if (style === 'narrow') return words.join(' ')
  return joinList(translator, locale, { list: words, style: 'unit', joinerKey: JOINER_KEY })
}
