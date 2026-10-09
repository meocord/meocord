/** The scalar param types a message command's words and a component's customId segments share. */

/**
 * A table looked up by words a message, a customId or a pattern supplies. It has no prototype, so a name every object
 * inherits, such as `constructor`, is none of its keys.
 */
export function lookupTable<T extends object>(entries: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null) as T, entries))
}

const BOOLEANS: Readonly<Record<string, boolean | undefined>> = lookupTable({ yes: true, true: true, on: true, no: false, false: false, off: false })

const UNIT_MS: Readonly<Record<string, number | undefined>> = lookupTable({ ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 })

/** A number written in full, `whole` for an integer: `undefined` for anything else. */
export function number(word: string, whole: boolean): number | undefined {
  if (!(whole ? /^[+-]?\d+$/ : /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i).test(word)) return undefined
  const value = Number(word)
  return Number.isFinite(value) && (!whole || Number.isSafeInteger(value)) ? value : undefined
}

/** `yes`, `no`, `true`, `false`, `on` or `off`, in any case, as a boolean. */
export const bool = (word: string): boolean | undefined => BOOLEANS[word.toLowerCase()]

/** A length of time written as amounts and units, such as `90s`, `2h30m` or `1.5d`, in milliseconds. */
export function duration(word: string): number | undefined {
  const parts = word.toLowerCase().match(/(\d+(?:\.\d+)?)(ms|s|m|h|d|w)/g)
  if (!parts || parts.join('') !== word.toLowerCase()) return undefined
  return parts.reduce((total, part) => {
    const [, amount, unit] = /^(\d+(?:\.\d+)?)(ms|s|m|h|d|w)$/.exec(part)!
    return total + Number(amount) * UNIT_MS[unit]!
  }, 0)
}

/** The largest snowflake: Discord's IDs are unsigned 64-bit integers. */
const MAX_SNOWFLAKE = 2n ** 64n - 1n

/**
 * A Discord ID, kept as its text: 17 to 20 digits up to the largest 64-bit value. An ID's top 42 bits are milliseconds
 * since 2015-01-01, so every ID made from 2015-01-28 on has 17 digits or more, and none is a safe integer.
 */
export const snowflake = (word: string): string | undefined => (/^\d{17,20}$/.test(word) && BigInt(word) <= MAX_SNOWFLAKE ? word : undefined)

/** A UUID in its canonical 8-4-4-4-12 form, in either case, kept as written. */
export const uuid = (word: string): string | undefined =>
  /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(word) ? word : undefined

/** The words a type such as `on|off` chooses from, or `undefined` for any other type. */
export const choicesOf = (type: string): string[] | undefined => (type.includes('|') ? type.split('|') : undefined)

/** The types a component's customId segment can take: each parsed from the segment alone, with no request. */
const SEGMENT_TYPES: Readonly<Record<string, ((segment: string) => unknown) | undefined>> = lookupTable({
  string: (segment: string) => segment,
  int: (segment: string) => number(segment, true),
  number: (segment: string) => number(segment, false),
  bool,
  snowflake,
  uuid,
})

/**
 * Whether `type` can type a customId segment: `string`, `int`, `number`, `bool`, `snowflake`, `uuid`, or words to
 * choose from.
 */
export const isSegmentType = (type: string): boolean => type in SEGMENT_TYPES || choicesOf(type) !== undefined

/** A customId segment as its type's value, words to choose from compared as written: `undefined` when it is not one. */
export function parseSegment(type: string, segment: string): unknown {
  const choices = choicesOf(type)
  if (choices) return choices.includes(segment) ? segment : undefined
  return SEGMENT_TYPES[type]!(segment)
}
