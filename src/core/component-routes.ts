import { type CommandType } from '@src/enum/index.js'
import { type CommandMetadata } from '@src/interface/index.js'
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
  meta: CommandMetadata<string>
  pattern: string
  /** The type of each typed param, such as `int` for `{count:int}`; untyped params are text. */
  types: Record<string, string>
}

/** Two patterns of one component type that can both match a customId. */
export interface ComponentRouteConflict {
  type: CommandType
  patterns: [string, string]
}

/**
 * Every customId-pattern route of the given controllers, most specific first, read from metadata alone.
 * Throws for two handlers whose patterns match the same customIds of one component type; one handler
 * declared under two spellings of a pattern keeps one route.
 */
export function buildComponentRoutes(controllerClasses: readonly ControllerClass[]): ComponentRoute[] {
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
  return routes.sort((a, b) => (b.meta.specificity ?? 0) - (a.meta.specificity ?? 0))
}

/** A component type as an error names it: `button`, `modal submit`, `string select menu`. */
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

/** Pattern pairs that can match one customId, compared only within a component type, as dispatch does. */
export function findComponentRouteConflicts(routes: readonly ComponentRoute[]): ComponentRouteConflict[] {
  const byType = new Map<CommandType, string[]>()
  for (const { meta, pattern } of routes) byType.set(meta.type, [...(byType.get(meta.type) ?? []), pattern])
  return [...byType].flatMap(([type, patterns]) => findAmbiguousRoutes(patterns).map(pair => ({ type, patterns: pair })))
}
