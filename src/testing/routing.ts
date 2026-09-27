import { CommandType, MetadataKey } from '@src/enum/index.js'
import {
  buildComponentRoutes,
  type ControllerClass,
  findComponentRouteConflicts,
  matchComponentRoute,
} from '@src/core/component-routes.js'
import { isCustomIdRouted } from '@src/util/interaction.util.js'
import { buildMessageRoutes, matchMessageRoute, staticMessageStarts } from '@src/core/message-routes.js'
import { type MessageCommandOptions, type MessagePrefix } from '@src/interface/index.js'

/** The command types routed by customId pattern: buttons, select menus and modals. */
export type ComponentCommandType = Exclude<
  CommandType,
  CommandType.SLASH | CommandType.CONTEXT_MENU | CommandType.PRIMARY_ENTRY_POINT
>

/** A message, for {@link resolveRoute}. */
export interface MessageToResolve {
  /** The message's text, prefix included. */
  content: string
  /**
   * The prefix this message has, for an app that reads prefixes from a function; ignored otherwise
   * unless given, when it stands in for the app's.
   */
  prefix?: MessagePrefix
  /** The bot's user id, so a mention of it counts as a start when the app accepts one. */
  botId?: string
}

/** The handler a component interaction or a message reaches. */
export interface ResolvedRoute {
  /** The controller class declaring the handler. */
  controller: ControllerClass
  /** The name of the handler method. */
  method: string
  /**
   * The handler method itself, for assertions that survive renaming it:
   * `expect(route?.handler).toBe(ProfileController.prototype.showProfile)`.
   */
  handler: (...args: any[]) => unknown
  /**
   * The text the pattern's params captured. A message's typed params are left as their words: dispatch and
   * `invoke` resolve them against the message's guild.
   */
  params: Record<string, string>
  /**
   * The params as the handler receives them, for a component route with a typed param: each typed param as its
   * value, such as a number for `{count:int}`, and the others as their text. Absent for any other route, whose
   * handler receives `params`.
   */
  values?: Record<string, string | number | boolean>
}

/** Two patterns of one component type that can both match a customId. */
export interface RouteConflict {
  type: ComponentCommandType
  patterns: [string, string]
}

/** The options `@MeoCord` declares on an application class. */
function appOptionsOf(app: ControllerClass): { controllers?: ControllerClass[]; messages?: MessageCommandOptions } {
  const options = Reflect.getMetadata(MetadataKey.AppOptions, app) as
    | { controllers?: ControllerClass[]; messages?: MessageCommandOptions }
    | undefined
  if (!options) throw new TypeError(`${app.name || 'The given class'} is not decorated with @MeoCord().`)
  return options
}

/** The controllers `@MeoCord({ controllers })` registers on an application class. */
function controllersOf(app: ControllerClass): ControllerClass[] {
  return appOptionsOf(app).controllers ?? []
}

/**
 * Resolves which handler a component's customId or a message's content reaches, the way dispatch
 * does: across every controller the application registers, most specific pattern first. A
 * component is matched within its type; a message after the prefix `@MeoCord({ messages })`
 * configures, and never to a `@MessageHandler()` listener, which runs for every message.
 *
 * Reads decorator metadata only, so it runs in a plain unit test with no Discord client, config
 * or container. It checks routing alone: guards are not run, and whether the controller's
 * dependencies are bound is for `MeoCordTestingModule` to test.
 *
 * @param app - The application class decorated with `@MeoCord`.
 * @param input - The component type and the customId it carries, or the message's `content`, with
 *   the `prefix` it has when the app reads prefixes from a function, and the `botId` a mention names.
 * @returns The handler that runs, or `undefined` when no route handles the input.
 * @throws TypeError for a message to an app whose prefix is a function, when no `prefix` is given.
 *
 * @example
 * ```ts
 * const route = resolveRoute(App, { type: CommandType.BUTTON, customId: 'profile/111/8000' })
 * expect(route?.handler).toBe(ProfileController.prototype.showProfile)
 * expect(route?.params).toEqual({ ownerId: '111', uid: '8000' })
 *
 * expect(resolveRoute(App, { content: '!roll 20 for luck' })?.params).toEqual({ sides: '20', note: 'for luck' })
 * ```
 */
export function resolveRoute(
  app: ControllerClass,
  input: { type: ComponentCommandType; customId: string } | MessageToResolve,
): ResolvedRoute | undefined {
  if ('content' in input) {
    const { messages = {} } = appOptionsOf(app)
    const starts = staticMessageStarts(app, messages, input)
    const matched = matchMessageRoute(buildMessageRoutes(controllersOf(app), messages), input.content, starts)
    if (!matched) return undefined
    const { route, params } = matched
    return { controller: route.controllerClass, method: route.method, handler: route.controllerClass.prototype[route.method], params }
  }

  if (!isCustomIdRouted(input.type)) {
    throw new TypeError(`${input.type} commands are routed by name, not by customId.`)
  }
  const routes = buildComponentRoutes(controllersOf(app))
  const matched = matchComponentRoute(routes, type => type === input.type, input.customId)
  if (!matched) return undefined
  const { route, params, text } = matched
  const method = route.meta.methodName
  const typed = Object.keys(route.types).length > 0
  return { controller: route.controllerClass, method, handler: route.controllerClass.prototype[method], params: text, ...(typed && { values: params }) }
}

/**
 * Finds component patterns that can match the same customId, which MeoCord otherwise only warns
 * about at startup. Patterns are compared within a component type, as dispatch does.
 *
 * @param app - The application class decorated with `@MeoCord`.
 * @returns Each conflicting pattern pair, with its component type.
 *
 * @example
 * ```ts
 * expect(findRouteConflicts(App)).toEqual([])
 * ```
 */
export function findRouteConflicts(app: ControllerClass): RouteConflict[] {
  return findComponentRouteConflicts(buildComponentRoutes(controllersOf(app))) as RouteConflict[]
}
