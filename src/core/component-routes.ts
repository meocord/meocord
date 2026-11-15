import { type CommandType } from '@src/enum/index.js'
import { type CommandMeta } from '@src/interface/command-decorator.interface.js'
import { createRegexFromPattern, getCommandMap, paramNarrowness, patternShape, sharedCustomId } from '@src/decorator/controller.decorator.js'
import { readCustomIdSegments, type RouteParamValue } from '@src/core/custom-id.js'
import { refuse } from '@src/util/refusal.util.js'

export type ControllerClass = new (...args: any[]) => any

/** A `@Command` route matched by customId pattern. */
export interface ComponentRoute {
  controllerClass: ControllerClass
  meta: CommandMeta<string>
  pattern: string
  /** The type of each typed param, such as `int` for `{count:int}`; untyped params are text. */
  types: Record<string, string>
}

/** Two patterns of one component type that rank equally and both match a customId, the one that runs, and such an id. */
export interface ComponentRouteConflict {
  type: CommandType
  patterns: [string, string]
  runs: string
  customId: string
}

/**
 * How a pattern ranks, one character per segment twice over: `L` for literal text or `P` for a param, then how narrow
 * each param is, the narrowest as the lowest digit. Two keys of one length compare as text: literal before param at
 * the first segment where they differ, then the narrower type.
 */
function rankKey(pattern: string): string {
  const narrowness = pattern.split('/').map(paramNarrowness)
  const kinds = narrowness.map(rank => (rank === undefined ? 'L' : 'P')).join('')
  return `${kinds}/${narrowness.map(rank => String(rank === undefined ? 0 : 9 - rank)).join('')}`
}

/**
 * Orders two routes as dispatch tries them. Left to right, the first segment one pattern spells out as literal text
 * while the other leaves it to a param ranks the literal one first: `a/{x}` before `{x}/abcd`, `profile/me/{section}`
 * before `profile/{userId}/edit`. Between patterns that leaves tied, the first param where one type is narrower ranks
 * it first: words to choose from, then `bool`, `uuid`, `snowflake`, `int`, `number`, then text. Patterns of different
 * segment counts, which no customId matches both of, are ordered by count only so the order is total; component
 * patterns have no catch-all param. What remains tied keeps its listing order.
 */
function rank(keys: Map<ComponentRoute, string>): (a: ComponentRoute, b: ComponentRoute) => number {
  return (a, b) => {
    const [left, right] = [keys.get(a)!, keys.get(b)!]
    if (left.length !== right.length) return left.length - right.length
    return left < right ? -1 : left > right ? 1 : 0
  }
}

/**
 * Every customId-pattern route of the given controllers, in the order dispatch tries them, read from metadata alone.
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
        const route = { controllerClass, meta, pattern, types: createRegexFromPattern(pattern).types }
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
  return routes.sort(rank(new Map(routes.map(route => [route, rankKey(route.pattern)]))))
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
    const read = readCustomIdSegments(route.types, route.meta.regex!, customId)
    if (read) return { route, params: read.values, text: read.text }
  }
  return undefined
}

/**
 * Pattern pairs of one component type that the ranking leaves tied and that can match one customId, each with the
 * pattern that runs, the one ranked first in `routes`, and an id both match. Only patterns of one rank key, read
 * together, can tie, so each group is compared within itself.
 */
export function findComponentRouteConflicts(routes: readonly ComponentRoute[]): ComponentRouteConflict[] {
  const groups = new Map<string, ComponentRoute[]>()
  for (const route of routes) {
    // The literal text and each param's narrowness: patterns that differ in either rank apart or match no id in common
    const key = `${route.meta.type}\0${route.pattern.split('/').map(segment => paramNarrowness(segment) ?? `=${segment}`).join('\0')}`
    groups.set(key, [...(groups.get(key) ?? []), route])
  }
  const conflicts: ComponentRouteConflict[] = []
  for (const group of groups.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const customId = sharedCustomId(group[i].pattern, group[j].pattern)
        if (customId === undefined) continue
        const patterns: [string, string] = [group[i].pattern, group[j].pattern]
        conflicts.push({ type: group[i].meta.type, patterns, runs: group[i].pattern, customId })
      }
    }
  }
  return conflicts
}
