import { CommandType } from '@src/enum/index.js'
import {
  buildComponentRoutes,
  type ControllerClass,
  findComponentRouteConflicts,
  matchComponentRoute,
  readCustomId,
} from '@src/core/component-routes.js'
import { isCustomIdRouted } from '@src/util/interaction.util.js'
import { buildMessageRoutes, fitsScope, matchMessageRoute, staticMessageStarts } from '@src/core/message-routes.js'
import { needsGuild } from '@src/core/message-params.js'
import { type MessageCommandOptions, type MessagePrefix } from '@src/interface/index.js'
import { META } from '@src/util/metadata-keys.js'

/**
 * The command types routed by a `customId` pattern: buttons, select menus and modals.
 *
 * @group Testing
 * @category Inspection
 */
export type ComponentCommandType = Exclude<
  CommandType,
  CommandType.SLASH | CommandType.CONTEXT_MENU | CommandType.PRIMARY_ENTRY_POINT
>

/**
 * A message, as {@link resolveRoute} takes it.
 *
 * @group Testing
 * @category Inspection
 */
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
  /**
   * Whether the message is a direct message, where `mention: 'only'` does not apply, and a handler that works only in
   * a server, by its scope or a `member`, `role` or `channel` param in its pattern, is not reached, as dispatch answers
   * it with its usage. A flag of those types is refused only when the message gives it, which this does not read.
   * Without it the message may be from anywhere, and a mention alone starts what it starts in a server.
   */
  dm?: boolean
}

/**
 * The handler a component interaction or a message reaches, as {@link resolveRoute} reports it.
 *
 * @group Testing
 * @category Inspection
 */
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
  /**
   * For a component route, the other patterns of its type that match the `customId` too, in the order they rank
   * behind it: the ones that lost to it. Absent when no other pattern matches. A test reads it; `toEqual` doesn't
   * compare it, so an assertion on the other fields holds either way.
   */
  alsoMatches?: string[]
}

/**
 * Two patterns of one component type that rank equally and can both match a `customId`, as {@link findRouteConflicts}
 * reports them.
 *
 * @group Testing
 * @category Inspection
 */
export interface RouteConflict {
  /** The component type both patterns are declared for. */
  type: ComponentCommandType
  /** The two patterns. */
  patterns: [string, string]
  /**
   * The pattern that runs for the `customId`s both match: the one listed first. A test reads it; `toEqual` doesn't
   * compare it, so an assertion on `type` and `patterns` alone holds.
   */
  runs: string
}

/** The options `@MeoCord` declares on an application class. */
function appOptionsOf(app: ControllerClass): { controllers?: ControllerClass[]; messages?: MessageCommandOptions } {
  const options = Reflect.getMetadata(META.appOptions, app) as { controllers?: ControllerClass[]; messages?: MessageCommandOptions } | undefined
  if (!options) throw new TypeError(`${app.name || 'The given class'} is not decorated with @MeoCord().`)
  return options
}

/** The controllers `@MeoCord({ controllers })` registers on an application class. */
function controllersOf(app: ControllerClass): ControllerClass[] {
  return appOptionsOf(app).controllers ?? []
}

/**
 * Resolves which handler a component's `customId` or a message's content reaches, as dispatch routes it.
 *
 * Use it to check routing alone, in a plain unit test: it reads decorator metadata, with no client, config or
 * container, and runs no guard. To run the handler it reaches, use {@link TestingModule.dispatch}.
 *
 * @remarks
 * It routes across every controller the app registers, most specific pattern first: a component within its type, a
 * message after the app's prefix, and never to a `@MessageHandler()` listener, which runs for every message.
 *
 * @param app - The application class decorated with `@MeoCord`.
 * @param input - The component type and its `customId`, or the message's content with its prefix and the bot's id.
 * @returns The handler that runs, with the params it captures, or `undefined` when no route handles the input.
 * @throws TypeError for a message to an app whose prefix is a function, when no `prefix` is given.
 *
 * @example
 * ```ts
 * import { expect } from 'vitest'
 *
 * @Controller()
 * class ProfileController {
 *   @Command('profile/{uid}', CommandType.BUTTON)
 *   async show(interaction: ButtonInteraction, { uid }: { uid: string }) {
 *     await respond(interaction).send(`Profile ${uid}`)
 *   }
 * }
 * @MeoCord({ controllers: [ProfileController], clientOptions: { intents: [] } })
 * class App {}
 * const route = resolveRoute(App, { type: CommandType.BUTTON, customId: 'profile/8000' })
 * expect([route?.handler, route?.params]).toEqual([ProfileController.prototype.show, { uid: '8000' }])
 * ```
 *
 * @group Testing
 * @category Inspection
 * @see {@link findRouteConflicts}
 * @see {@link https://meocord.dev/docs/4.2/components | Buttons, selects and modals}
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
    // Dispatch answers a route that does not work in a DM with its usage, and never runs it
    if (starts.inGuild === false && (!fitsScope(route.scope, false) || needsGuild(route))) return undefined
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
  // The routes ranked behind it that the customId matches too, which dispatch never reaches for it
  const behind = routes.slice(routes.indexOf(route) + 1)
  const alsoMatches = behind.filter(other => other.meta.type === input.type && readCustomId(other.pattern, other.meta.regex!, input.customId)).map(other => other.pattern)
  const resolved: ResolvedRoute = { controller: route.controllerClass, method, handler: route.controllerClass.prototype[method], params: text, ...(typed && { values: params }) }
  return alsoMatches.length > 0 ? readableOnly(resolved, { alsoMatches }) : resolved
}

/**
 * Finds component patterns that rank equally and can match the same `customId`, which MeoCord otherwise only warns
 * about at startup.
 *
 * Use it in a test to keep the warning from reaching production. Patterns rank segment by segment, a literal before a
 * param and then the narrower type, so two collide only with the same literals and equally narrow params at each
 * position, such as `{action:close|reopen}` and `{step:close|confirm}`, which both take `close`; the one listed
 * first runs. Patterns are compared within a component type.
 *
 * @param app - The application class decorated with `@MeoCord`.
 * @returns Each pair of patterns that rank equally and can match the same `customId`, with its component type.
 *
 * @example
 * ```ts
 * import { expect } from 'vitest'
 *
 * @Controller()
 * class TicketController {
 *   @Command('ticket/{action:close|reopen}', CommandType.BUTTON)
 *   async act(interaction: ButtonInteraction) { await respond(interaction).send('Done.') }
 *   @Command('ticket/{step:close|confirm}', CommandType.BUTTON)
 *   async step(interaction: ButtonInteraction) { await respond(interaction).send('Next.') }
 * }
 * @MeoCord({ controllers: [TicketController], clientOptions: { intents: [] } })
 * class App {}
 * expect(findRouteConflicts(App)).toHaveLength(1)
 * ```
 *
 * @group Testing
 * @category Inspection
 * @see {@link resolveRoute}
 */
export function findRouteConflicts(app: ControllerClass): RouteConflict[] {
  return findComponentRouteConflicts(buildComponentRoutes(controllersOf(app))).map(({ type, patterns, runs }) =>
    readableOnly({ type: type as ComponentCommandType, patterns }, { runs }),
  )
}

/**
 * `target` with `fields` added as properties a test reads but `toEqual` and its kin, which compare enumerable keys,
 * don't see, so an assertion written for the fields it had before still holds.
 */
function readableOnly<T extends object, F extends object>(target: T, fields: F): T & F {
  for (const [key, value] of Object.entries(fields)) Object.defineProperty(target, key, { value, enumerable: false, configurable: true })
  return target as T & F
}
