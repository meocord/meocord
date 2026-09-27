import { createRegexFromPattern } from '@src/decorator/controller.decorator.js'
import { parseSegment } from '@src/core/scalar-types.js'

/** The longest customId Discord accepts. */
export const MAX_CUSTOM_ID_LENGTH = 100

/** A `{name}` or `{name:type}` param's name. */
type ParamName<S extends string> = S extends `${infer Name}:${string}` ? Name : S

/** A `{name:type}` param's type, `string` for a `{name}`. */
type ParamType<S extends string> = S extends `${string}:${infer Type}` ? Type : 'string'

/** Each param of a pattern, with its name and type. */
type RouteParamSpecs<T extends string> = T extends `${string}{${infer Param}}${infer Rest}`
  ? { name: ParamName<Param>; type: ParamType<Param> } | RouteParamSpecs<Rest>
  : never

/** The words a type such as `open|closed` chooses from, as a union. */
type Choices<T extends string> = T extends `${infer Word}|${infer Rest}` ? Word | Choices<Rest> : T

/** The value a typed customId segment gives its handler: a number, a boolean, or one of the words to choose from. */
type SegmentValue<T extends string> = T extends 'int' | 'number' ? number : T extends 'bool' ? boolean : T extends `${string}|${string}` ? Choices<T> : string

/** The params a pattern names, as a union of their names; `never` for a pattern with none. */
export type RouteParams<T extends string> = RouteParamSpecs<T>['name']

/** A value a route's untyped param takes: its text, or a number or snowflake written as its digits. */
export type RouteValue = string | number | bigint

/**
 * The values a route's `build` takes: one for each of its params, and no others. A typed param takes a value of
 * its type, such as a number for `{count:int}`.
 */
export type RouteValues<T extends string> = {
  [S in RouteParamSpecs<T> as S['name']]: S['type'] extends 'string' ? RouteValue : SegmentValue<S['type']>
}


/**
 * A component's customId pattern, as `route` makes it: pass it to `@Command` in place of the pattern's text,
 * and `build` the customIds that reach it.
 */
export interface Route<T extends string = string> {
  /** The pattern, as written. */
  readonly pattern: T
  /**
   * A customId this route matches, with each param's value in its segment. `/` and `%` in a value are
   * encoded, and the handler receives the value as it was given.
   *
   * @throws TypeError for a missing, empty or unknown value, and RangeError for an id over 100 characters.
   */
  build(...values: [RouteParams<T>] extends [never] ? [] : [values: RouteValues<T>]): string
  /** The pattern, so a route reads as its pattern in a template string. */
  toString(): T
}

const PLACEHOLDER = /\{(\w+)(?::([^}/]*))?}/g

/** Encodes the characters that would end a param's segment, or read as an encoding, in a customId. */
const encodeSegment = (value: string): string => value.replace(/%/g, '%25').replace(/\//g, '%2F')

/**
 * A captured customId param as the handler receives it: `%2F` and `%25`, which `Route.build` writes for
 * `/` and `%`, read back as those characters.
 */
const decodeSegment = (value: string): string =>
  value.replace(/%(25|2F)/gi, (_, code: string) => (code === '25' ? '%' : '/'))

/** Every captured param of a customId, decoded as `decodeSegment` decodes one. */
export function decodeRouteParams(groups: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(groups ?? {}).map(([name, value]) => [name, decodeSegment(value)]))
}

/**
 * Makes a typed route from a customId pattern, so one declaration serves the handler and the ids that
 * reach it. `@Command(route, type)` takes it as it takes the pattern's text, with the same ranking and
 * duplicate rules, and `route.build({ ... })` writes a customId, with each param's value in its segment.
 * A missing or unknown param fails to compile.
 *
 * @param pattern - The customId pattern, where `{name}` captures one `/`-separated segment.
 * @returns A route whose `build` takes a value for each param.
 * @throws When the pattern cannot be read, as `@Command` would throw for it.
 *
 * @example
 * ```ts
 * import { route } from 'meocord/common'
 *
 * export const closeTicket = route('ticket/{id}/close')
 *
 * @Command(closeTicket, CommandType.BUTTON)
 * async close(interaction: ButtonInteraction, { id }: { id: string }) {
 *   await interaction.reply(`Closed ticket ${id}`)
 * }
 *
 * new ButtonBuilder().setCustomId(closeTicket.build({ id: 42 })).setLabel('Close') // 'ticket/42/close'
 * ```
 */
export function route<const T extends string>(pattern: T): Route<T> {
  const { params, types } = createRegexFromPattern(pattern)
  const names = new Set(params)

  const build = (values: Record<string, RouteValue> = {}): string => {
    const unknown = Object.keys(values).filter(name => !names.has(name))
    if (unknown.length > 0) throw new TypeError(`route('${pattern}') has no param ${unknown.map(name => `{${name}}`).join(', ')}.`)
    const id = pattern.replace(PLACEHOLDER, (placeholder, name: string) => {
      const value = values[name]
      if (value === undefined || value === null) throw new TypeError(`route('${pattern}').build() needs a value for ${placeholder}.`)
      const text = String(value)
      if (text === '') throw new TypeError(`route('${pattern}').build() got an empty {${name}}, which no customId segment can hold.`)
      // A typed segment must read back as the value it was built from, or the route could never match it
      if (types[name] && parseSegment(types[name], text) === undefined) {
        throw new TypeError(`route('${pattern}').build() got ${JSON.stringify(value)} for ${placeholder}, which is not a value of its type.`)
      }
      return encodeSegment(text)
    })
    if (id.length > MAX_CUSTOM_ID_LENGTH) {
      throw new RangeError(`route('${pattern}').build() made a customId of ${id.length} characters, over Discord's ${MAX_CUSTOM_ID_LENGTH}: "${id}".`)
    }
    return id
  }

  return Object.freeze({
    pattern,
    build: build as Route<T>['build'],
    toString: () => pattern,
  })
}

