import { type CommandType } from '@src/enum/index.js'
import { type CommandMeta } from '@src/interface/command-decorator.interface.js'
import { createRegexFromPattern, findAmbiguousRoutes, getCommandMap, patternShape } from '@src/decorator/controller.decorator.js'
import { decodeRouteParams } from '@src/common/route.js'
import { parseSegment } from '@src/core/scalar-types.js'
import { refuse } from '@src/util/refusal.util.js'

export type ControllerClass = new (...args: any[]) => any

/** A customId param as its handler gets it: text, or the value of its type, such as a number for `{count:int}`. */
export type RouteParamValue = string | number | boolean

/** A `@Command` route matched by customId pattern. */
export interface ComponentRoute {
  controllerClass: ControllerClass
  meta: CommandMeta<string>
  pattern: string
  /** The type of each typed param, such as `int` for `{count:int}`; untyped params are text. */
  types: Record<string, string>
}

/** Two patterns of one component type that can both match a customId, the one that runs, and what decides it. */
export interface ComponentRouteConflict {
  type: CommandType
  patterns: [string, string]
  runs: string
  decidedBy: 'specificity' | 'literal' | 'order'
}

/** How equally specific patterns rank: in the order they are listed, or a literal segment first. */
export type RouteTies = 'listed' | 'literalFirst'

/** Each segment of a pattern as literal, `L`, or a param, `P`; compared as text, a literal ranks first. */
const literalMask = (pattern: string): string =>
  pattern
    .split('/')
    .map(segment => (segment.includes('{') ? 'P' : 'L'))
    .join('')

/**
 * Orders two routes as `routeTies` ranks them: the more specific first, and with `'literalFirst'`, between equally
 * specific patterns, the one literal at the first segment where they differ. Patterns of different lengths, which no
 * customId matches both of, are ordered by length only so the order is total. What remains keeps its listing order.
 */
function rank(routeTies: RouteTies): (a: ComponentRoute, b: ComponentRoute) => number {
  return (a, b) => {
    const bySpecificity = (b.meta.specificity ?? 0) - (a.meta.specificity ?? 0)
    if (bySpecificity !== 0 || routeTies === 'listed') return bySpecificity
    const [left, right] = [literalMask(a.pattern), literalMask(b.pattern)]
    if (left.length !== right.length) return left.length - right.length
    return left < right ? -1 : left > right ? 1 : 0
  }
}

/**
 * Every customId-pattern route of the given controllers, most specific first, read from metadata alone.
 * Throws for two handlers whose patterns match the same customIds of one component type; one handler
 * declared under two spellings of a pattern keeps one route.
 */
export function buildComponentRoutes(controllerClasses: readonly ControllerClass[], { routeTies = 'listed' }: { routeTies?: RouteTies } = {}): ComponentRoute[] {
  const routes: ComponentRoute[] = []
  // By component type and pattern shape: the route that shape already has
  const seen = new Map<string, ComponentRoute>()
  for (const controllerClass of controllerClasses) {
    const commandMap = getCommandMap(controllerClass.prototype)
    if (!commandMap) continue
    for (const [pattern, metaArray] of Object.entries(commandMap)) {
      if (!Array.isArray(metaArray)) continue
      for (const meta of metaArray) {
        if (!meta.regex) continue
        const route = { controllerClass, meta, pattern, types: typesOf(pattern) }
        const key = `${meta.type}\0${patternShape(pattern)}`
        const earlier = seen.get(key)
        if (!earlier) {
          seen.set(key, route)
          routes.push(route)
          continue
        }
        // One handler under two spellings, such as 'card/{id}' and 'card/{cardId}', is one route
        if (earlier.controllerClass === controllerClass && earlier.meta.methodName === meta.methodName) continue
        throw refuse(new Error(
          `${earlier.controllerClass.name}.${earlier.meta.methodName}: "${earlier.pattern}" and "${pattern}" in ` +
            `${controllerClass.name}.${meta.methodName} match the same ${typeLabel(meta.type)} customIds, so only one ` +
            `of them could ever run. Change one pattern.`,
        ))
      }
    }
  }
  // A stable sort, so what the ranking leaves tied keeps the order controllers and handlers are listed in
  return routes.sort(rank(routeTies))
}

/**
 * Whether `a` spells out the first segment where it and `b` differ as literal text while `b` leaves it to a
 * parameter, the tie-break between equally specific patterns in the next major version (5.0).
 */
export function literalFirst(a: string, b: string): boolean {
  const [left, right] = [a.split('/'), b.split('/')]
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const leftLiteral = !left[i].includes('{')
    if (leftLiteral !== !right[i].includes('{')) return leftLiteral
  }
  return false
}

/** A component type as an error names it: `button`, `modal submit`, `select menu`. */
const typeLabel = (type: CommandType): string => type.toLowerCase().replaceAll('_', ' ')

/**
 * The route dispatch runs for a customId: the first, in rank order, whose type `acceptsType` allows
 * and whose pattern matches, with the captured params, a typed param as its value. A segment that is not
 * a value of its param's type does not match, so the next route is tried.
 */
export function matchComponentRoute(
  routes: readonly ComponentRoute[],
  acceptsType: (type: CommandType) => boolean,
  customId: string,
): { route: ComponentRoute; params: Record<string, RouteParamValue>; text: Record<string, string> } | undefined {
  for (const route of routes) {
    if (!acceptsType(route.meta.type)) continue
    const read = readCustomIdSegments(route.pattern, route.meta.regex!, customId)
    if (read) return { route, params: read.values, text: read.text }
  }
  return undefined
}

const typesByPattern = new Map<string, Record<string, string>>()

/** The typed params of a customId pattern, read once per pattern. */
function typesOf(pattern: string): Record<string, string> {
  let types = typesByPattern.get(pattern)
  if (!types) typesByPattern.set(pattern, (types = createRegexFromPattern(pattern).types))
  return types
}

/**
 * The params `pattern`, compiled as `regex`, captures from a customId, each typed param as its value:
 * `undefined` when the customId does not match, or a segment is not a value of its param's type.
 */
export function readCustomId(pattern: string, regex: RegExp, customId: string): Record<string, RouteParamValue> | undefined {
  return readCustomIdSegments(pattern, regex, customId)?.values
}

/** {@link readCustomId}'s values, with each param's text as the customId gave it. */
function readCustomIdSegments(
  pattern: string,
  regex: RegExp,
  customId: string,
): { values: Record<string, RouteParamValue>; text: Record<string, string> } | undefined {
  const match = regex.exec(customId)
  if (!match) return undefined
  const text = decodeRouteParams(match.groups)
  const values: Record<string, RouteParamValue> = { ...text }
  for (const [name, type] of Object.entries(typesOf(pattern))) {
    const value = parseSegment(type, text[name]) as RouteParamValue | undefined
    if (value === undefined) return undefined
    values[name] = value
  }
  return { values, text }
}

/**
 * Pattern pairs that can match one customId, compared only within a component type, as dispatch does, each with the
 * pattern that runs, the one ranked first in `routes`, and what decides it under `routeTies`, which ranked them.
 */
export function findComponentRouteConflicts(routes: readonly ComponentRoute[], routeTies: RouteTies = 'listed'): ComponentRouteConflict[] {
  const byType = new Map<CommandType, ComponentRoute[]>()
  for (const route of routes) byType.set(route.meta.type, [...(byType.get(route.meta.type) ?? []), route])
  return [...byType].flatMap(([type, typed]) =>
    findAmbiguousRoutes(typed.map(route => route.pattern)).map(([left, right]) => {
      const [first, second] = [typed.find(route => route.pattern === left)!, typed.find(route => route.pattern === right)!]
      const runs = routes.indexOf(first) < routes.indexOf(second) ? first : second
      const other = runs === first ? second : first
      const decidedBy =
        (runs.meta.specificity ?? 0) !== (other.meta.specificity ?? 0)
          ? 'specificity'
          : routeTies === 'literalFirst' && literalMask(runs.pattern) !== literalMask(other.pattern)
            ? 'literal'
            : 'order'
      return { type, patterns: [left, right] as [string, string], runs: runs.pattern, decidedBy }
    }),
  )
}
