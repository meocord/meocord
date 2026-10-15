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
  // Each run of digits splits only one way, so refusing a word takes time linear in its length
  if (!(whole ? /^[+-]?\d+$/ : /^[+-]?(\d+(?:\.\d*)?|\.\d+)(e[+-]?\d+)?$/i).test(word)) return undefined
  const value = Number(word)
  return Number.isFinite(value) && (!whole || Number.isSafeInteger(value)) ? value : undefined
}

/** `yes`, `no`, `true`, `false`, `on` or `off`, in any case, as a boolean. */
export const bool = (word: string): boolean | undefined => BOOLEANS[word.toLowerCase()]

/**
 * A length of time written as amounts and units, such as `90s`, `2h30m` or `1.5d`, in milliseconds: `undefined` for one
 * too long to add up.
 */
export function duration(word: string): number | undefined {
  // Sticky: each part starts where the last ended, so the scan stops at the first that doesn't and reads each part once
  const parts = word.toLowerCase().match(/(\d+(?:\.\d+)?)(ms|s|m|h|d|w)/gy)
  if (!parts || parts.join('') !== word.toLowerCase()) return undefined
  const total = parts.reduce((sum, part) => {
    const [, amount, unit] = /^(\d+(?:\.\d+)?)(ms|s|m|h|d|w)$/.exec(part)!
    return sum + Number(amount) * UNIT_MS[unit]!
  }, 0)
  // Too long to add up, as number() refuses a value past the largest number
  return Number.isFinite(total) ? total : undefined
}

/** The largest snowflake: Discord's IDs are unsigned 64-bit integers. */
const MAX_SNOWFLAKE = 2n ** 64n - 1n

/** The fewest and most digits a snowflake has, and the words of that many digits, with no leading zero. */
const SNOWFLAKE_DIGITS = { min: 17, max: 20 }
const SNOWFLAKE = new RegExp(`^[1-9]\\d{${SNOWFLAKE_DIGITS.min - 1},${SNOWFLAKE_DIGITS.max - 1}}$`)

/**
 * A Discord ID, kept as its text: 17 to 20 digits, no leading zero, up to the largest 64-bit value. An ID's top 42 bits
 * are milliseconds since 2015-01-01, so every ID made from 2015-01-28 on has 17 digits or more, and none is a safe
 * integer.
 */
export const snowflake = (word: string): string | undefined => (SNOWFLAKE.test(word) && BigInt(word) <= MAX_SNOWFLAKE ? word : undefined)

/** A UUID's canonical 8-4-4-4-12 form, 36 characters with its dashes. */
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i
const UUID_LENGTH = 36

/** A UUID in its canonical 8-4-4-4-12 form, in either case, kept as written. */
export const uuid = (word: string): string | undefined => (UUID.test(word) ? word : undefined)

/** The words a type such as `on|off` chooses from, or `undefined` for any other type. */
export const choicesOf = (type: string): string[] | undefined => (type.includes('|') ? type.split('|') : undefined)

/** The shortest segment of any type: one character. */
const SHORTEST_SEGMENT = 1

/**
 * The types a component's customId segment can take: each parsed from the segment alone, with no request, and the
 * fewest characters a segment of it has, which the check for a pattern no customId can match counts.
 */
const SEGMENT_TYPES: Readonly<Record<string, { parse: (segment: string) => unknown; shortest: number } | undefined>> = lookupTable({
  string: { parse: (segment: string) => segment, shortest: SHORTEST_SEGMENT },
  int: { parse: (segment: string) => number(segment, true), shortest: SHORTEST_SEGMENT },
  number: { parse: (segment: string) => number(segment, false), shortest: SHORTEST_SEGMENT },
  bool: { parse: bool, shortest: Math.min(...Object.keys(BOOLEANS).map(word => word.length)) },
  snowflake: { parse: snowflake, shortest: SNOWFLAKE_DIGITS.min },
  uuid: { parse: uuid, shortest: UUID_LENGTH },
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
  return SEGMENT_TYPES[type]!.parse(segment)
}

/** The fewest characters a customId segment of `type` has: words to choose from count their shortest word. */
export function shortestSegment(type: string): number {
  const choices = choicesOf(type)
  if (choices) return Math.min(...choices.map(word => word.length))
  return SEGMENT_TYPES[type]?.shortest ?? SHORTEST_SEGMENT
}
