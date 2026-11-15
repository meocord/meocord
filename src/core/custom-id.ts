import { parseSegment } from '@src/core/scalar-types.js'

/** A customId param as its handler gets it: text, or the value of its type, such as a number for `{count:int}`. */
export type RouteParamValue = string | number | boolean

/** Encodes the characters that would end a param's segment, or read as an encoding, in a customId. */
export const encodeSegment = (value: string): string => value.replace(/%/g, '%25').replace(/\//g, '%2F')

/**
 * A captured customId param as the handler receives it: `%2F` and `%25`, which `Route.build` writes for
 * `/` and `%`, read back as those characters.
 */
const decodeSegment = (value: string): string => value.replace(/%(25|2F)/gi, (_, code: string) => (code === '25' ? '%' : '/'))

/** Every captured param of a customId, decoded as `decodeSegment` decodes one. */
function decodeRouteParams(groups: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(groups ?? {}).map(([name, value]) => [name, decodeSegment(value)]))
}

/**
 * The params a pattern, compiled as `regex` with its typed params' `types`, captures from a customId, each typed param
 * as its value: `undefined` when the customId does not match, or a segment is not a value of its param's type.
 * Dispatch, `resolveRoute` and `Route.match` all read a customId through it, each with the pattern it compiled.
 */
export function readCustomId(types: Record<string, string>, regex: RegExp, customId: string): Record<string, RouteParamValue> | undefined {
  return readCustomIdSegments(types, regex, customId)?.values
}

/** {@link readCustomId}'s values, with each param's text as the customId gave it. */
export function readCustomIdSegments(
  types: Record<string, string>,
  regex: RegExp,
  customId: string,
): { values: Record<string, RouteParamValue>; text: Record<string, string> } | undefined {
  const match = regex.exec(customId)
  if (!match) return undefined
  const text = decodeRouteParams(match.groups)
  const values: Record<string, RouteParamValue> = { ...text }
  for (const [name, type] of Object.entries(types)) {
    const value = parseSegment(type, text[name]) as RouteParamValue | undefined
    if (value === undefined) return undefined
    values[name] = value
  }
  return { values, text }
}
