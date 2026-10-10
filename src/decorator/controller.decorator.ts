import 'reflect-metadata'
import {
  ApplicationCommandType,
  type AutocompleteInteraction,
  type ChannelSelectMenuInteraction,
  type MentionableSelectMenuInteraction,
  Message,
  MessageContextMenuCommandInteraction,
  MessageReaction,
  type OmitPartialGroupDMChannel,
  type PartialMessageReaction,
  type RoleSelectMenuInteraction,
  type StringSelectMenuInteraction,
  UserContextMenuCommandInteraction,
  type UserSelectMenuInteraction,
} from 'discord.js'
import { CommandType, MetadataKey } from '@src/enum/index.js'
import { type CheckedParams, type MessageHandlerOptions, type ReactionEvent, type ReactionHandlerSettings } from '@src/interface/index.js'
import { type IsPiped, type Unpiped } from '@src/decorator/piped.js'
import {
  type AutocompleteMeta,
  type BuildableCommandType,
  type CommandBuilderBase,
  type CommandBuilderConstructor,
  type CommandInteractionType,
  type CommandMeta,
} from '@src/interface/command-decorator.interface.js'
import { interactionClassName, isCustomIdRouted, matchesCommandType } from '@src/util/interaction.util.js'
import { warnDeprecatedBehaviour } from '@src/common/deprecation.js'
import { Logger } from '@src/common/logger.js'
import { routeSpecificity } from '@src/core/route-specificity.js'
import { choicesOf, isSegmentType, lookupTable, parseSegment } from '@src/core/scalar-types.js'
import { type Route, type RouteParams, type RouteValue, type RouteValues } from '@src/common/route.js'
import { refuse, refuseOnClass, declaring } from '@src/util/refusal.util.js'
import { describeValue, withArticle } from '@src/util/value.util.js'
import { META, type MetaKey } from '@src/util/metadata-keys.js'

/** What a handler was given in place of its interaction: another interaction's class, or what the value is. */
function givenInstead(value: unknown): string {
  const name = typeof value === 'object' && value !== null ? value.constructor?.name : undefined
  if (name && name !== 'Object') return `, not ${withArticle(name)}`
  return `; it was given ${describeValue(value)}`
}

const logger = new Logger('Command')

/**
 * The class's own handler list, started from a copy of the inherited one, so a subclass's
 * handlers never land in its base class's metadata.
 */
export function ownHandlerList<T>(key: MetaKey, target: object): T[] {
  return Reflect.getOwnMetadata(key, target) ?? [...(Reflect.getMetadata(key, target) ?? [])]
}

/** A route a handler answers, as a warning names it, such as `button "page/{n}"` or `every message`. */
export interface HandlerRoute {
  method: string
  label: string
}

const commandKind = (type: CommandType): string => type.toLowerCase().replaceAll('_', ' ')

const commandRoute = (method: string, type: CommandType, name: string): HandlerRoute => ({ method, label: `${commandKind(type)} "${name}"` })
const messageRoute = (method: string, pattern: string | undefined): HandlerRoute => ({
  method,
  label: pattern ? `message "${pattern}"` : 'every message',
})
const reactionRoute = (method: string, emoji: string | undefined): HandlerRoute => ({
  method,
  label: emoji ? `reaction "${emoji}"` : 'every reaction',
})
const autocompleteRoute = (method: string, commandPath: string, optionName: string | undefined): HandlerRoute => ({
  method,
  label: `autocomplete of ${optionName === undefined ? 'every option' : `"${optionName}"`} in "${commandPath}"`,
})

/** Records a route a class's own decorator declares for a method, which the startup check reads. */
function declareRoute(target: object, declared: HandlerRoute): void {
  const routes: HandlerRoute[] = Reflect.getOwnMetadata(META.declaredRoutes, target) ?? []
  routes.push(declared)
  Reflect.defineMetadata(META.declaredRoutes, routes, target)
}

/** The routes a class's own handler decorators declare, without those it inherits. */
export function getDeclaredRoutes(prototype: object): readonly HandlerRoute[] {
  return Reflect.getOwnMetadata(META.declaredRoutes, prototype) ?? []
}

/** Every route a class's handlers answer, inherited ones included. */
export function getHandlerRoutes(prototype: object): HandlerRoute[] {
  return [
    ...Object.entries(getCommandMap(prototype) ?? {}).flatMap(([name, metas]) => metas.map(meta => commandRoute(meta.methodName, meta.type, name))),
    ...getMessageHandlers(prototype).map(handler => messageRoute(handler.method, handler.pattern)),
    ...getReactionHandlers(prototype).map(handler => reactionRoute(handler.method, handler.emoji)),
    ...getAutocompleteHandlers(prototype).map(handler => autocompleteRoute(handler.methodName, handler.commandPath, handler.optionName)),
  ]
}

/**
 * Adds a handler the class's own decorator declares. One it inherits for the same method and route is replaced where
 * it stands, so the class's own options apply and the routes keep their order.
 */
function addOwnHandler<T>(key: MetaKey, target: object, entry: T, sameRoute: (other: T) => boolean): void {
  const handlers = ownHandlerList<T>(key, target)
  const inherited: T[] = Reflect.getMetadata(key, Object.getPrototypeOf(target) as object) ?? []
  const index = handlers.findIndex(other => inherited.includes(other) && sameRoute(other))
  if (index === -1) handlers.push(entry)
  else handlers[index] = entry
  Reflect.defineMetadata(key, handlers, target)
}

/**
 * Leaves each method the class's own decorators declare only those routes, of every kind, dropping the ones it inherits
 * for it: what `@Controller({ inheritedRoutes: 'replace' })` does once the class's method decorators have run.
 */
export function dropInheritedRoutes(prototype: object): void {
  const redeclared = new Set(getDeclaredRoutes(prototype).map(route => route.method))
  if (redeclared.size === 0) return
  const base = Object.getPrototypeOf(prototype) as object
  // An entry the class takes from its base, for a method it re-declares
  const inheritedFor = (inherited: readonly unknown[], method: (entry: never) => string) => (entry: unknown) =>
    inherited.includes(entry) && redeclared.has(method(entry as never))

  const commands = ownCommandMap(prototype)
  const baseCommands: Record<string, CommandMeta[]> = Reflect.getMetadata(META.commands, base) ?? {}
  for (const [name, metas] of Object.entries(commands)) {
    const kept = metas.filter(meta => !inheritedFor(baseCommands[name] ?? [], (entry: CommandMeta) => entry.methodName)(meta))
    if (kept.length > 0) commands[name] = kept
    else delete commands[name]
  }
  Reflect.defineMetadata(META.commands, commands, prototype)

  const lists: [MetaKey, (entry: never) => string][] = [
    [META.messageHandlers, (entry: MessageHandlerMetadata) => entry.method],
    [META.reactionHandlers, (entry: ReactionHandlerMetadata) => entry.method],
    [META.autocompleteHandlers, (entry: AutocompleteMeta) => entry.methodName],
  ]
  for (const [key, method] of lists) {
    const inherited: unknown[] = Reflect.getMetadata(key, base) ?? []
    Reflect.defineMetadata(key, ownHandlerList<unknown>(key, prototype).filter(entry => !inheritedFor(inherited, method)(entry)), prototype)
  }
}

/** The class's own command map, started from a copy of the inherited one, for the same reason. */
function ownCommandMap(target: object): Record<string, CommandMeta[]> {
  const own: Record<string, CommandMeta[]> | undefined = Reflect.getOwnMetadata(META.commands, target)
  if (own) return own

  const inherited: Record<string, CommandMeta[]> = Reflect.getMetadata(META.commands, target) ?? {}
  return Object.fromEntries(Object.entries(inherited).map(([name, metas]) => [name, [...metas]]))
}

/** A `@MessageHandler` as the decorator stores it. */
export interface MessageHandlerMetadata {
  /** The pattern, or `undefined` for a listener that takes every message. */
  pattern: string | undefined
  method: string
  options: MessageHandlerOptions
}

/**
 * What `@MessageHandler(pattern)` returns: a decorator for a handler taking no arguments, the message, or
 * the message and its params, whose declared type is checked against the pattern. One signature, so a
 * mismatch is explained by {@link MessageHandlerAccepts} alone rather than by every form in turn.
 */
export type PatternedMessageHandlerDecorator<T, R, Pattern extends string> = <F extends (...args: any[]) => R>(
  target: object,
  propertyKey: string,
  descriptor: TypedPropertyDescriptor<F> & MessageHandlerAccepts<Parameters<F>, T, Pattern>,
) => void

/** Whether `A` takes `B` as a method parameter does, in either direction. */
type TakesEither<A, B> = [B] extends [A] ? true : [A] extends [B] ? true : false

/**
 * Allows a handler whose parameters are none, the message, or the message and params the pattern gives; anything
 * else resolves to an object naming what does not fit, which the descriptor then lacks.
 */
type MessageHandlerAccepts<Args extends unknown[], T, Pattern extends string> = Args extends []
  ? unknown
  : Args extends [infer M, ...infer Rest]
    ? TakesEither<M, T> extends false
      ? { "The handler's first parameter is not the message": M }
      : Rest extends []
        ? unknown
        : // A rest parameter of any length after the message takes no params, as a method with one may be called
          number extends Rest['length']
          ? Rest extends [infer P, ...unknown[]]
            ? ParamsAccept<P, Pattern>
            : unknown
          : Rest extends [infer P, ...unknown[]] | [(infer P)?]
            ? [Rest] extends [[unknown, unknown, ...unknown[]]]
              ? { 'A message handler takes the message and its params, and nothing more': Args }
              : ParamsAccept<P, Pattern>
            : { 'A message handler takes the message and its params, and nothing more': Args }
    : unknown

/** Allows params that are an object the pattern's params fit, the second parameter a message handler takes. */
type ParamsAccept<P, Pattern extends string> = NonNullable<P> extends Record<string, any>
  ? ParamsFit<NonNullable<P>, CheckedParams<Pattern, NonNullable<P>>>
  : { "The handler's params are an object of the pattern's params": P }

/** The declared params that do not take what the pattern gives, a key marked `Piped<T>` being left to its pipe. */
type Misfits<P, Given> = {
  [K in keyof Given & keyof P as IsPiped<P[K]> extends true ? never : [Given[K]] extends [P[K]] ? never : K]: Given[K]
}

/**
 * Unknown when the declared params take what the pattern gives, else the keys that do not, with what they get, written
 * out so an editor shows them. Only a key the pattern has, of another type, could be one a pipe produces, so only then
 * does the refusal name `Piped<T>`.
 */
type ParamsFit<P, Given> = [Given] extends [Unpiped<P>]
  ? unknown
  : [Misfits<P, Given>[keyof Misfits<P, Given>]] extends [{ readonly 'not a param of the pattern': unknown }]
    ? {
        "The handler's params do not fit the pattern": {
          [K in keyof Given & keyof P as IsPiped<P[K]> extends true ? never : [Given[K]] extends [P[K]] ? never : K]: Given[K]
        }
      }
    : {
        "The handler's params do not fit the pattern; a key a pipe produces is marked Piped<T>": {
          [K in keyof Given & keyof P as IsPiped<P[K]> extends true ? never : [Given[K]] extends [P[K]] ? never : K]: Given[K]
        }
      }

/**
 * Runs the method it decorates for every message a user sends, whatever it says.
 *
 * Use it for work on all chat, such as logging, auto-moderation or counting activity. For a command a user
 * types, such as `!roll 20`, give `@MessageHandler` a pattern instead.
 *
 * @remarks
 * It runs after the one patterned handler the message matched, if any: a message's handlers run in turn, so a
 * slow command delays its listeners. It never runs for a message from a bot or one with no text. Reading a
 * message's text needs the privileged `MessageContent` intent. Its guards only filter what it takes, so a
 * denial gets no reply.
 *
 * @example
 * ```ts
 * @MessageHandler()
 * async log(message: Message) {
 *   console.log(`${message.author.username}: ${message.content}`)
 * }
 * ```
 *
 * @pipeline handler after every stage the call passed
 * @group Decorators
 * @category Handlers
 * @see {@link ReactionHandler}
 * @see {@link https://meocord.dev/docs/4.2/message-commands | Message commands}
 */
export function MessageHandler<T extends OmitPartialGroupDMChannel<Message<boolean>>, R>(): (
  target: object,
  propertyKey: string,
  // A handler may take fewer parameters than dispatch passes; the descriptor type is invariant, so each arity is listed.
  _descriptor: TypedPropertyDescriptor<(message: T) => R> | TypedPropertyDescriptor<() => R>,
) => void
/**
 * Runs the method it decorates for a message that matches a pattern, such as `!roll 20`, as a message command.
 *
 * Use it for commands users type in chat. Slash commands are usually the better choice for anything new, since
 * Discord shows and checks their options: see {@link Command}. For every message, leave the pattern out.
 *
 * @remarks
 * A pattern is matched word by word, after the app's prefix or a mention: `{name}` captures a word,
 * `{name...}` the rest, `{name?}` an optional word, `{name:type}` a typed value such as a number or a member,
 * and `{--name}` a flag. Only the most specific matching pattern runs, across every controller. A message that
 * names the command but does not fit its pattern gets the command's usage in reply, as a
 * {@link MessageUsageError}. The params the handler declares are checked against the pattern when the code
 * compiles. A subclass that re-declares an inherited handler on the same pattern takes its own options; on another
 * pattern it still answers the inherited one too, which the bot warns about as it starts. In the next major version
 * (5.0) the subclass's own patterns replace the inherited ones.
 *
 * @param pattern - The words to match, such as `'roll {sides:int} {note...?}'`. An empty pattern runs for every
 *   message, as `@MessageHandler()` does, and logs a warning: it is deprecated, and refused in 5.0.
 * @param options - The handler's own start, case, aliases, description and scope; see {@link MessageHandlerOptions}.
 * @throws Error at startup for a pattern that cannot be read, and for two patterns that match the same messages.
 *
 * @example
 * ```ts
 * @MessageHandler('roll {sides:int} {note...?}', { aliases: ['r'] })
 * async roll(message: Message, { sides, note }: { sides: number; note?: string }) {
 *   const result = 1 + Math.floor(Math.random() * sides)
 *   await message.reply(note ? `${result} (${note})` : String(result))
 * }
 * ```
 *
 * @pipeline parse the pattern's words, before the guards
 * @pipeline handler after every stage the call passed
 * @group Decorators
 * @category Handlers
 * @see {@link ParamsOf}
 * @see {@link https://meocord.dev/docs/4.2/message-commands | Message commands}
 */
export function MessageHandler<
  T extends OmitPartialGroupDMChannel<Message<boolean>>,
  R,
  const Pattern extends string = string,
>(pattern: Pattern, options?: MessageHandlerOptions): PatternedMessageHandlerDecorator<T, R, Pattern>
export function MessageHandler(pattern?: string, options: MessageHandlerOptions = {}) {
  return declaring(function (target: object, propertyKey: string) {
    refuseOnClass('@MessageHandler', target, propertyKey)
    // An empty pattern means every message, as no pattern does
    if (pattern === '') {
      warnDeprecatedBehaviour(logger, `@MessageHandler('') on ${target.constructor.name}.${propertyKey}`, 'is refused', '@MessageHandler()')
    }
    const method = propertyKey.toString()
    const declared = { pattern: pattern || undefined, method, options }
    addOwnHandler<MessageHandlerMetadata>(META.messageHandlers, target, declared, other => other.method === method && other.pattern === declared.pattern)
    declareRoute(target, messageRoute(method, declared.pattern))
  })
}

/** A `@ReactionHandler` as the decorator stores it. */
export interface ReactionHandlerMetadata {
  /** The emoji as declared: a name, a custom emoji's id or its `<:name:id>`; `undefined` for every emoji. */
  emoji: string | undefined
  method: string
  settings: ReactionHandlerSettings
}

type ReactionHandlerDecorator<T extends MessageReaction | PartialMessageReaction, R> = (
  target: object,
  propertyKey: string,
  descriptor:
    | TypedPropertyDescriptor<(reaction: T, options: ReactionEvent) => R>
    | TypedPropertyDescriptor<(reaction: T) => R>
    | TypedPropertyDescriptor<() => R>,
) => void

/**
 * Runs the method it decorates when a reaction with an emoji is added to or removed from a message.
 *
 * Use it to act on reactions: a starboard, a poll, a role menu or approving by ✅. Leave the emoji out to run
 * for every reaction. For clicks on a message's buttons, use {@link Command} with a customId.
 *
 * @remarks
 * A standard emoji is its character, such as `'👍'`. A custom emoji is its id or the `<:name:id>` Discord
 * shows, which match that emoji alone, or its name, which matches every custom emoji of that name. Every
 * matching handler runs, with the reaction and its message complete: `reaction.message` is the copy the
 * gateway keeps current, fetched first only when the bot holds it by id alone, and a reaction without its count
 * is fetched too. For data straight from Discord, such as after a reconnect that missed updates, call
 * `reaction.message.fetch()`. Reactions from bots, the bot's own included, are skipped unless `bots: true` is set.
 * A subclass that re-declares an inherited handler on the same emoji takes its own settings; on another it still
 * answers the inherited one too, which the bot warns about as it starts. In the next major version (5.0) the
 * subclass's own emoji replace the inherited ones.
 *
 * @param emoji - The emoji to handle: its character, or a custom emoji's id, `<:name:id>` or name.
 * @param settings - Whether bots' reactions reach it too; see {@link ReactionHandlerSettings}.
 *
 * @example
 * ```ts
 * @ReactionHandler('⭐')
 * async star(reaction: MessageReaction, { user, action }: ReactionEvent) {
 *   if (action === ReactionHandlerAction.ADD) await reaction.message.reply(`${user.username} starred this.`)
 * }
 * ```
 *
 * @pipeline handler after every stage the call passed
 * @group Decorators
 * @category Handlers
 * @see {@link ReactionEvent}
 * @see {@link https://meocord.dev/docs/4.2/reactions | Reactions}
 */
export function ReactionHandler<T extends MessageReaction | PartialMessageReaction, R>(
  emoji?: string,
  settings?: ReactionHandlerSettings,
): ReactionHandlerDecorator<T, R>
/**
 * Runs the method it decorates for every reaction added to or removed from a message, with the settings given, such
 * as `bots: true` to take bots' reactions too.
 *
 * @param settings - Whether bots' reactions reach it too; see {@link ReactionHandlerSettings}.
 */
export function ReactionHandler<T extends MessageReaction | PartialMessageReaction, R>(
  settings: ReactionHandlerSettings,
): ReactionHandlerDecorator<T, R>
export function ReactionHandler(
  emojiOrSettings?: string | ReactionHandlerSettings,
  settings: ReactionHandlerSettings = {},
): ReactionHandlerDecorator<MessageReaction | PartialMessageReaction, unknown> {
  const [emoji, own] = typeof emojiOrSettings === 'object' ? [undefined, emojiOrSettings] : [emojiOrSettings, settings]
  return declaring(function (target: object, propertyKey: string) {
    refuseOnClass('@ReactionHandler', target, propertyKey)
    const method = propertyKey.toString()
    addOwnHandler<ReactionHandlerMetadata>(
      META.reactionHandlers,
      target,
      { emoji, method, settings: own },
      other => other.method === method && other.emoji === emoji,
    )
    declareRoute(target, reactionRoute(method, emoji))
  })
}

/** A custom emoji as Discord writes it in a message: `<:name:id>`, or `<a:name:id>` for an animated one. */
const CUSTOM_EMOJI = /^<a?:\w+:(\d+)>$/

/**
 * Whether a reaction's emoji is the one a handler declared: by id, from a bare id or a `<:name:id>`, or
 * by name, for a standard emoji's character or a custom emoji's name.
 */
export function matchesEmoji(declared: string, emoji: { id?: string | null; name?: string | null }): boolean {
  const id = CUSTOM_EMOJI.exec(declared)?.[1]
  if (id) return emoji.id === id
  return (!!emoji.id && emoji.id === declared) || (!!emoji.name && emoji.name === declared)
}

/**
 * Retrieves reaction handlers metadata from a given controller.
 *
 * @param controller - The controller class instance.
 * @returns The reaction handlers, with their emoji and settings.
 */
export function getReactionHandlers(controller: any): ReactionHandlerMetadata[] {
  return Reflect.getMetadata(META.reactionHandlers, controller) || []
}

/**
 * Retrieves message handlers metadata from a given controller.
 *
 * @param controller - The controller class instance.
 * @returns The message handlers, with their patterns and options.
 */
export function getMessageHandlers(controller: any): MessageHandlerMetadata[] {
  return Reflect.getMetadata(META.messageHandlers, controller) || []
}

// `{name}`, or `{name:type}` with the type read as far as the brace, so a type no segment can hold is named
const PLACEHOLDER_PATTERN = /\{(\w+)(?::([^}/]*))?}/g

/** The character a parameter will not cross, so one pattern segment maps to one value. */
export const PARAM_SEPARATOR = '/'

/** Escapes a literal stretch of a pattern so only placeholders stay meaningful. */
const escapeLiteral = (literal: string): string => literal.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&')

/**
 * Compiles a pattern into a regex, its parameter names, their types and its 4.1 specificity. A `{name}` takes a
 * whole `/`-separated segment, so a uuid is captured whole and `profile/{uuid}` never overlaps
 * `profile/{uuid}/{id}`; a param that shares a segment with literal text is refused.
 */
export function createRegexFromPattern(pattern: string): {
  regex: RegExp
  params: string[]
  types: Record<string, string>
  specificity: number
} {
  const params: string[] = []
  // By the param's own name, so one named like an inherited key, such as `__proto__`, keeps its type
  const types: Record<string, string> = Object.create(null)
  let regexPattern = ''
  let cursor = 0
  let literalLength = 0

  PLACEHOLDER_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = PLACEHOLDER_PATTERN.exec(pattern)) !== null) {
    const [placeholder, param, type] = match
    const literal = pattern.slice(cursor, match.index)
    const after = pattern[match.index + placeholder.length]

    // A parameter has to own its segment. Sharing one with a literal leaves no
    // boundary a sibling pattern can be told apart by, and the resulting overlap has
    // no correct reading -- `profile-{uuid}` and `profile-{uuid}-{id}` both take
    // `profile-a-b`. Registration is the last point where that is still fixable.
    if ((literal !== '' && !literal.endsWith(PARAM_SEPARATOR)) || (after !== undefined && after !== PARAM_SEPARATOR)) {
      throw refuse(new Error(
        `Invalid pattern "${pattern}": {${param}} must occupy a whole segment, so it has to be ` +
          `preceded and followed by "${PARAM_SEPARATOR}" or by the ends of the pattern. ` +
          `Write "a${PARAM_SEPARATOR}{${param}}" rather than "a-{${param}}".`,
      ))
    }

    // A regex group's name, which the engine would refuse with the compiled regex in place of the pattern
    if (params.includes(param)) {
      throw refuse(new Error(`Invalid pattern "${pattern}": {${param}} appears twice; give each param its own name.`))
    }
    if (/^\d/.test(param)) {
      throw refuse(new Error(`Invalid pattern "${pattern}": {${param}} starts with a digit; start a param's name with a letter or _.`))
    }

    if (type !== undefined) {
      if (!isSegmentType(type)) throw refuse(new Error(`Invalid pattern "${pattern}": ${segmentTypeProblem(param, type)}`))
      if (choicesOf(type)?.includes('')) {
        throw refuse(new Error(`Invalid pattern "${pattern}": {${param}:${type}} lists an empty word to choose from, which no segment can be.`))
      }
      if (type !== 'string') types[param] = type
    }

    literalLength += literal.length
    regexPattern += escapeLiteral(literal)
    regexPattern += `(?<${param}>[^${PARAM_SEPARATOR}]+)`
    params.push(param)
    cursor = match.index + placeholder.length
  }

  const trailing = pattern.slice(cursor)
  literalLength += trailing.length
  regexPattern += escapeLiteral(trailing)

  const regex = new RegExp(`^${regexPattern}$`)

  // What 4.1 ranked by, kept for code that reads CommandMeta.specificity; routing ranks segment by segment
  const specificity = routeSpecificity({
    literals: literalLength,
    params: params.length,
    typed: Object.values(types).reduce((sum, type) => sum + (choicesOf(type) ? 4 : type === 'bool' ? 3 : type === 'int' ? 2 : 1), 0),
  })
  return { regex, params, types: lookupTable(types), specificity }
}

/** Why a `{name:type}` cannot type a customId segment, which holds text the bot wrote, with no message to read. */
function segmentTypeProblem(param: string, type: string): string {
  const kinds = 'string, int, number, bool, snowflake, uuid, or words to choose from such as {mode:on|off}'
  if (['member', 'user', 'role', 'channel'].includes(type)) {
    return `{${param}:${type}} is a type only a message command reads. A customId holds text: write {${param}} for its ID, and fetch it in the handler.`
  }
  return `{${param}:${type}} names no type a customId can hold. The types are ${kinds}.`
}

/** What the interaction holds under `K`, as a handler gets it: a discord.js Collection's values as an array. */
type ChoiceOf<I, K extends keyof I> = I[K] extends ReadonlyMap<unknown, infer V> ? V[] : I[K]

/** What a select menu's handler gets beside its route's params: its choices, each as discord.js resolves it. */
type ChoiceTypes<T> = T extends CommandType.SELECT_MENU
  ? { values: ChoiceOf<StringSelectMenuInteraction, 'values'> }
  : T extends CommandType.USER_SELECT_MENU
    ? { [K in 'values' | 'users' | 'members']: ChoiceOf<UserSelectMenuInteraction, K> }
    : T extends CommandType.ROLE_SELECT_MENU
      ? { [K in 'values' | 'roles']: ChoiceOf<RoleSelectMenuInteraction, K> }
      : T extends CommandType.CHANNEL_SELECT_MENU
        ? { [K in 'values' | 'channels']: ChoiceOf<ChannelSelectMenuInteraction, K> }
        : T extends CommandType.MENTIONABLE_SELECT_MENU
          ? { [K in 'values' | 'users' | 'members' | 'roles']: ChoiceOf<MentionableSelectMenuInteraction, K> }
          : Record<never, never>

/** The keys a select menu's handler gets beside its route's params: its choices. */
type ChoiceKeys<T> = keyof ChoiceTypes<T>

type RequiredKeys<P> = { [K in keyof P]-?: object extends Pick<P, K> ? never : K }[keyof P]

/** The component types whose handler params are a route's params, and a select menu's choices. */
type RouteCheckedType =
  | CommandType.BUTTON
  | CommandType.SELECT_MENU
  | CommandType.USER_SELECT_MENU
  | CommandType.ROLE_SELECT_MENU
  | CommandType.CHANNEL_SELECT_MENU
  | CommandType.MENTIONABLE_SELECT_MENU

/** Either kind of context menu interaction, which a context menu command's handler is typed with. */
type ContextMenuInteraction = UserContextMenuCommandInteraction | MessageContextMenuCommandInteraction

/**
 * The handler a command's interaction type allows. A context menu handler whose builder's kind the compiler cannot
 * tell is checked as a method's parameter is, so it may declare one kind, which startup checks against the builder;
 * every other handler, a context menu one whose builder's `setType()` names its kind included, takes exactly its type.
 */
type Handles<I, Args extends unknown[], R> = [I] extends [ContextMenuInteraction]
  ? [ContextMenuInteraction] extends [I]
    ? { handle(interaction: I, ...args: Args): R }['handle']
    : (interaction: I, ...args: Args) => R
  : (interaction: I, ...args: Args) => R

/** The pattern text of a `@Command` name: a route's pattern, or the string itself. */
type PatternOf<N> = N extends Route<infer Pattern> ? Pattern : N extends string ? N : string

/**
 * Allows the handler when each key its params require is one a call to it gets: a param of its pattern, a
 * `route()`'s or a plain string's, or a select menu's choice. Commands, whose params are their options, modals,
 * whose fields are keyed by customId, and params with an index signature, as a handler without them infers, are
 * unchecked.
 */
type RouteAccepts<N, T, P> = string extends PatternOf<N> | keyof P
  ? unknown
  : T extends RouteCheckedType
    ? [Exclude<RequiredKeys<P>, RouteParams<PatternOf<N>> | ChoiceKeys<T>>] extends [never]
      ? unknown
      : { "The handler's params name keys its pattern does not capture": Exclude<RequiredKeys<P>, RouteParams<PatternOf<N>> | ChoiceKeys<T>> }
    : unknown

/** A readonly array as the array it reads, so `readonly Role[]` is compared as `Role[]`. */
type AsArray<T> = T extends readonly (infer E)[] ? E[] : T

/**
 * Allows the handler when each select menu choice it declares can hold what discord.js gives: the type itself, a
 * wider one, or one of a union, such as `GuildMember[]` for members that may be raw API members outside a cached
 * server. A type no choice can have, such as `values: number`, is refused. One marked `Piped<T>`, which a pipe
 * produces, is left to the pipe.
 */
type ChoicesAccept<N, T, P> = string extends keyof P
  ? unknown
  : {
        // A route param of a choice's name takes its place, as the handler's input gives the param
        [K in Exclude<keyof ChoiceTypes<T>, RouteParams<PatternOf<N>>> & keyof P as IsPiped<P[K]> extends true
          ? never
          : ChoiceTypes<T>[K] extends P[K]
            ? never
            : AsArray<NonNullable<P[K]>> extends ChoiceTypes<T>[K]
              ? never
              : K]: ChoiceTypes<T>[K]
      } extends infer Mismatch
    ? [keyof Mismatch] extends [never]
      ? unknown
      : { "The handler's params give a select menu's choices a type their values do not fit; a key a pipe produces is marked Piped<T>": Mismatch }
    : unknown

/** A pattern's typed params, each with the value its segment gives; an untyped param builds from any `RouteValue`. */
type TypedValues<Pattern extends string> = {
  [K in keyof RouteValues<Pattern> as [RouteValue] extends [RouteValues<Pattern>[K]] ? never : K]: RouteValues<Pattern>[K]
}

/**
 * Allows the handler when each typed customId param it declares takes the value its segment gives, such as a
 * number for `{count:int}`. Untyped params, params marked `Piped<T>`, params with an index signature, and commands
 * are unchecked.
 */
type TypedParamsAccept<N, T, P> = T extends CommandType
  ? string extends PatternOf<N> | keyof P
    ? unknown
    : {
          [K in keyof TypedValues<PatternOf<N>> & keyof P as IsPiped<P[K]> extends true
            ? never
            : TypedValues<PatternOf<N>>[K] extends P[K]
              ? never
              : K]: TypedValues<PatternOf<N>>[K]
        } extends infer Mismatch
      ? [keyof Mismatch] extends [never]
        ? unknown
        : { "The handler's params give a typed customId param a type its value does not fit; a key a pipe produces is marked Piped<T>": Mismatch }
      : unknown
  : unknown

/**
 * Routes a command, a component or a modal submission to the method it decorates.
 *
 * Use it for each interaction a controller handles: a slash or context menu command by its name or
 * subcommand path, and a button, select menu or modal by its customId pattern or a `route()`. For an
 * option's suggestions, use {@link Autocomplete}; for a message command, `@MessageHandler`.
 *
 * @remarks
 * A subcommand's path is its parts separated by a space, as Discord shows it: `settings notify email`. In a
 * customId pattern, `{name}` captures one `/`-separated segment into the handler's params. When the code compiles,
 * the keys the handler's params require are checked against the pattern or route, a typed segment's value against
 * its type, and a select menu's choices, such as `values: string[]`, against what discord.js gives; a key a pipe
 * produces is declared `Piped<T>`, and left to the pipe. Two component handlers of one type whose patterns match
 * exactly the same ids stop the bot at startup. Patterns that both match an id rank segment by segment, left to
 * right: at the first segment one spells out as literal text and the other leaves to a param, the literal one runs,
 * so `profile/me/{section}` takes `profile/me/edit` from `profile/{userId}/edit`; between patterns that leaves tied,
 * the narrower type at the first param where they differ. Two still tied are warned about as the bot starts, and the
 * one listed first runs. A context menu handler receives the kind its builder's `setType()` names, and one
 * declaring the other kind fails to compile; when the compiler cannot tell the kind, `@Command` checks the parameter
 * type it emits as it applies. A subclass that re-declares an inherited handler on the same name or pattern takes its
 * own builder and options; on another it still answers the inherited one too, which the bot warns about as it
 * starts. In the next major version (5.0) the subclass's own declarations replace the inherited ones.
 *
 * @param name - The command's name or subcommand path, or a component's customId pattern or route.
 * @param builderOrType - A command builder class, which registers the command with Discord, or a
 *   `CommandType` for a handler that registers nothing: a component, or a subcommand its command's builder
 *   describes.
 * @throws Error when the builder throws as it is made or as it builds, naming the handler, the builder and the
 *   command, and on a subcommand path saying the builder of the path's command describes it; and, as the decorator
 *   applies, when the method has no implementation, the builder is not a `@CommandBuilder`, a context menu handler
 *   declares the other kind than its builder registers, or a customId pattern cannot be read.
 *
 * @example
 * ```ts
 * @Command('help', CommandType.SLASH)
 * async help(interaction: ChatInputCommandInteraction) {
 *   await respond(interaction).send('Here is how to use me.')
 * }
 *
 * @Command('stats/{id}', CommandType.BUTTON)
 * async stats(interaction: ButtonInteraction, { id }: { id: string }) {
 *   await respond(interaction).send(`Stats for ${id}.`)
 * }
 * ```
 *
 * @pipeline handler after every stage the call passed
 * @group Decorators
 * @category Handlers
 * @see {@link CommandBuilder}
 * @see {@link route}
 * @see {@link https://meocord.dev/docs/4.2/slash-commands | Slash commands}
 * @see {@link https://meocord.dev/docs/4.2/components | Buttons, selects and modals}
 */
export function Command<
  CBC extends BuildableCommandType,
  T extends CommandBuilderConstructor<CBC> | CommandType,
  N extends string | Route = string,
>(name: N, builderOrType: T) {
  const commandName = typeof name === 'string' ? name : (name as Route).pattern
  return declaring(function <P extends Record<string, any>, R>(
    target: object,
    propertyKey: string,
    _descriptor: (
      | TypedPropertyDescriptor<Handles<CommandInteractionType<CBC, T>, [params: P], R>>
      | TypedPropertyDescriptor<Handles<CommandInteractionType<CBC, T>, [], R>>
      | TypedPropertyDescriptor<() => R>
    ) &
      RouteAccepts<N, T, P> &
      TypedParamsAccept<N, T, P> &
      ChoicesAccept<N, T, P>,
  ) {
    refuseOnClass('@Command', target, propertyKey)
    const originalMethod = _descriptor.value
    if (!originalMethod) {
      throw refuse(new Error(`${target.constructor.name}.${propertyKey}: @Command is on something with no implementation.`))
    }

    // Wrap original method for interaction type validation
    const declaredAs = typeof builderOrType === 'function' ? builderOrType.name : `CommandType.${builderOrType}`
    _descriptor.value = function (interaction, params) {
      if (!matchesCommandType(commandType, interaction)) {
        throw new Error(
          `${target.constructor.name}.${propertyKey}: @Command('${commandName}', ${declaredAs}) takes ` +
            `${interactionClassName(commandType)}${givenInstead(interaction)}.`,
        )
      }

      return (originalMethod as (...args: unknown[]) => R).apply(this, [interaction, params])
    }

    // This class's own map, inherited routes included
    const commands = ownCommandMap(target)

    let builderInstance: CommandMeta['builder']
    let commandType: CommandType
    let regex: RegExp | undefined
    let dynamicParams: string[] = []
    let specificity: number | undefined
    let guilds: (string | undefined)[] | undefined

    // Determine command type and builder
    if (typeof builderOrType === 'function') {
      const where = `${target.constructor.name}.${propertyKey}`
      // A subcommand is part of its command's builder, which belongs on the command's own name
      const subcommandPath =
        Reflect.getMetadata(META.commandType, builderOrType) === CommandType.SLASH && commandName.includes(' ')
      const command = commandName.split(' ')[0]
      const declareInstead =
        `Declare the handler with @Command('${commandName}', CommandType.SLASH), and give the builder to ` +
        `@Command('${command}').`
      // One sentence of the error, without its own full stop, as the refusal ends with one
      const detailOf = (error: unknown) => (error instanceof Error ? error.message.split('\n')[0] : String(error)).replace(/\.$/, '')
      let builderObj: CommandBuilderBase
      try {
        builderObj = new builderOrType() as CommandBuilderBase
      } catch (error) {
        throw refuse(new Error(`${where}: ${builderOrType.name} could not be made for "${commandName}": ${detailOf(error)}.`, { cause: error }))
      }
      try {
        builderInstance = builderObj.build(commandName)
      } catch (error) {
        const detail = detailOf(error)
        if (subcommandPath) {
          throw refuse(new Error(
            `${where}: the builder ${builderOrType.name} is declared on "${commandName}", which is a subcommand path: the ` +
              `builder of its command, "${command}", describes it, and building it from the path failed (${detail}). ` +
              declareInstead,
            { cause: error },
          ))
        }
        // discord.js builders validate as they are set, and their errors name neither the command nor the field.
        throw refuse(new Error(
          `${where}: ${builderOrType.name} could not build "${commandName}": ${detail}. Check its names, descriptions and ` +
            `localizations, which Discord limits to 32 and 100 characters.`,
          { cause: error },
        ))
      }
      // A builder that names its command itself still works on the path, registered once with its command
      if (subcommandPath) {
        logger.warn(
          `${where}: the builder ${builderOrType.name} is declared on "${commandName}", which is a subcommand path; the ` +
            `builder of its command, "${command}", describes it. ${declareInstead}`,
        )
      }
      guilds = Reflect.getMetadata(META.builderGuilds, builderOrType)
      commandType = Reflect.getMetadata(META.commandType, builderOrType) as CommandType
      if (!(commandType in CommandType)) {
        throw refuse(new Error(`${where}: the builder ${builderOrType.name} is not decorated with @CommandBuilder, so there is no command type to register.`))
      }
      if (commandType === CommandType.CONTEXT_MENU) {
        assertContextMenuKind(target, propertyKey, builderOrType.name, commandName, builderInstance)
      }
    } else {
      commandType = builderOrType
    }

    if (isCustomIdRouted(commandType)) {
      let pattern: ReturnType<typeof createRegexFromPattern>
      try {
        pattern = createRegexFromPattern(commandName)
      } catch (error) {
        throw refuse(new Error(`${target.constructor.name}.${propertyKey}: ${(error as Error).message}`, { cause: error }))
      }
      regex = pattern.regex
      dynamicParams = pattern.params
      specificity = pattern.specificity
    }

    const declared: CommandMeta = {
      methodName: propertyKey,
      builder: builderInstance,
      ...(typeof builderOrType === 'function' && { builderClass: builderOrType as abstract new (...args: any[]) => unknown }),
      type: commandType,
      regex,
      dynamicParams,
      specificity,
      ...(guilds && { guilds }),
    }
    // One the class inherits for this method and route is replaced where it stands, so this one's options apply
    const metas = (commands[commandName] ??= [])
    const inherited: CommandMeta[] = getCommandMap(Object.getPrototypeOf(target) as object)?.[commandName] ?? []
    const replaced = metas.findIndex(meta => inherited.includes(meta) && meta.methodName === propertyKey && meta.type === commandType)
    if (replaced === -1) metas.push(declared)
    else metas[replaced] = declared

    Reflect.defineMetadata(META.commands, commands, target)
    declareRoute(target, commandRoute(propertyKey, commandType, commandName))
  })
}

/** The interaction class Discord sends for each context menu kind. */
const CONTEXT_MENU_INTERACTIONS = new Map<unknown, { kind: ApplicationCommandType; name: string }>([
  [UserContextMenuCommandInteraction, { kind: ApplicationCommandType.User, name: 'user' }],
  [MessageContextMenuCommandInteraction, { kind: ApplicationCommandType.Message, name: 'message' }],
])

/**
 * Refuses a context menu handler that declares the other kind's interaction than its builder registers, read from
 * the decorator metadata an app emits. A handler typed with the union, or without that metadata, is not checked.
 */
function assertContextMenuKind(target: object, propertyKey: string, builderName: string, commandName: string, built: unknown): void {
  const declared = CONTEXT_MENU_INTERACTIONS.get((Reflect.getMetadata(MetadataKey.ParamTypes, target, propertyKey) as unknown[] | undefined)?.[0])
  const registered = (built as { type?: ApplicationCommandType } | undefined)?.type
  if (!declared || registered === undefined || declared.kind === registered) return
  const kind = registered === ApplicationCommandType.User ? 'user' : 'message'
  throw refuse(new Error(
    `${target.constructor.name}.${propertyKey}: it takes a ${declared.name} context menu interaction, but ${builderName} ` +
      `registers "${commandName}" as a ${kind} context menu command. Declare the handler's interaction as the kind the ` +
      `builder's setType() names.`,
  ))
}

/**
 * Retrieves the command map for a given controller.
 *
 * @param controller - The controller class instance.
 * @returns A record containing command metadata indexed by command names.
 */
export function getCommandMap<T extends string>(controller: any): Record<string, CommandMeta<T>[]> {
  return Reflect.getMetadata(META.commands, controller)
}

/**
 * Suggests values for an option of a chat input command as the user types.
 *
 * Use it for an option with more possible values than a fixed list of choices holds, such as a search over
 * your own data. Enable it on the option with `setAutocomplete(true)` in the command's builder.
 *
 * @remarks
 * Answer with discord.js's `interaction.respond(choices)`, at most 25, within three seconds. The handler runs its
 * guards, the global ones, its class's and its own, and its filters, but no interceptors; a guard must not answer,
 * and returning `false` closes the menu with an empty list. The bot warns as it starts about a handler Discord never
 * asks, such as one for an option registered without autocomplete, and about one that completes what an earlier
 * handler already does, since only the first runs; the next major version (5.0) refuses to start with either. A
 * subclass that re-declares an inherited handler on another command path or option still completes the inherited one
 * too, which the bot warns about as it starts. In the next major version (5.0) the subclass's own declarations
 * replace the inherited ones.
 *
 * @param commandPath - The command, such as `search`, or a subcommand's path, such as `settings notify email`.
 * @param optionName - The option to complete. Leave it out to handle every option, branching on
 *   `interaction.options.getFocused(true)`.
 * @typeParam _R - Not used: the handler's return type is inferred. It is kept so `@Autocomplete<void>(…)` still
 *   compiles, and goes in 5.0.
 *
 * @example
 * ```ts
 * @Autocomplete('fruit', 'name')
 * async completeFruit(interaction: AutocompleteInteraction) {
 *   const { value } = interaction.options.getFocused(true)
 *   const names = ['apple', 'banana', 'cherry'].filter(name => name.startsWith(value))
 *   await interaction.respond(names.map(name => ({ name, value: name })))
 * }
 * ```
 *
 * @pipeline handler after the guards, with no interceptors
 * @group Decorators
 * @category Handlers
 * @see {@link Command}
 * @see {@link https://meocord.dev/docs/4.2/autocomplete | Autocomplete}
 */
export function Autocomplete<_R = unknown>(commandPath: string, optionName?: string) {
  return declaring(function <P extends Record<string, any>, R>(
    target: object,
    propertyKey: string,
    _descriptor:
      | TypedPropertyDescriptor<(interaction: AutocompleteInteraction, params: P) => R>
      | TypedPropertyDescriptor<(interaction: AutocompleteInteraction) => R>
      | TypedPropertyDescriptor<() => R>,
  ) {
    refuseOnClass('@Autocomplete', target, propertyKey)
    const methodName = propertyKey.toString()
    addOwnHandler<AutocompleteMeta>(
      META.autocompleteHandlers,
      target,
      { commandPath, optionName, methodName },
      other => other.methodName === methodName && other.commandPath === commandPath && other.optionName === optionName,
    )
    declareRoute(target, autocompleteRoute(methodName, commandPath, optionName))
  })
}

/**
 * Returns a controller's autocomplete handlers, option-specific ones first.
 * @param controller - The controller instance.
 */
export function getAutocompleteHandlers(controller: any): AutocompleteMeta[] {
  const handlers: AutocompleteMeta[] = Reflect.getMetadata(META.autocompleteHandlers, controller) || []
  return [...handlers].sort((a, b) => Number(Boolean(b.optionName)) - Number(Boolean(a.optionName)))
}

/** A segment type as patterns compare it: `''` for text, choices in one order. */
const typeKey = (type: string | undefined): string =>
  type === undefined || type === 'string' ? '' : (choicesOf(type)?.slice().sort().join('|') ?? type)

/**
 * A pattern with its param names blanked and its types kept, so two patterns that match the same customIds
 * read the same, and a typed param and a text one do not.
 */
export function patternShape(pattern: string): string {
  return pattern.replace(PLACEHOLDER_PATTERN, (_, _name: string, type?: string) => (typeKey(type) ? `{:${typeKey(type)}}` : '{}'))
}

/** The type of a segment that is a param, `''` for text; `undefined` for a literal segment. */
function segmentParamType(segment: string): string | undefined {
  const match = new RegExp(`^${PLACEHOLDER_PATTERN.source}$`).exec(segment)
  return match ? typeKey(match[2]) : undefined
}

/**
 * How few values a segment type takes, so a narrower type ranks first: words to choose from, then bool, uuid,
 * snowflake, int, number, and text last. A snowflake is narrower than a number, which takes all its values.
 */
const NARROWNESS: Readonly<Record<string, number | undefined>> = lookupTable({ bool: 5, uuid: 4, snowflake: 3, int: 2, number: 1, '': 0 })
const narrowness = (type: string): number => (choicesOf(type) ? 6 : NARROWNESS[type]!)

/**
 * How narrow a pattern segment that is a param, `{name}` or `{name:type}`, is: from `0` for text to `4` for words to
 * choose from. `undefined` for a segment of literal text.
 */
export function paramNarrowness(segment: string): number | undefined {
  const type = segmentParamType(segment)
  return type === undefined ? undefined : narrowness(type)
}

/** A value of each scalar segment type: an int, a bool, a snowflake and a uuid; text takes any. */
const SAMPLE_VALUES = ['1', 'true', '10000000000000000', '00000000-0000-0000-0000-000000000000']

/** A value both readings of a segment take: a literal, text, or a typed param; `undefined` when they share none. */
function sharedValue(left: string, right: string): string | undefined {
  const [a, b] = [segmentParamType(left), segmentParamType(right)]
  const takes = (type: string | undefined, segment: string, value: string): boolean =>
    type === undefined ? segment === value : type === '' || parseSegment(type, value) !== undefined
  // Every type takes one of these when it takes anything another reading takes: a literal, a listed word, or a value
  // of each scalar type
  const candidates = [
    ...(a === undefined ? [left] : []),
    ...(b === undefined ? [right] : []),
    ...(choicesOf(a ?? '') ?? []),
    ...(choicesOf(b ?? '') ?? []),
    ...SAMPLE_VALUES,
  ]
  return candidates.find(value => takes(a, left, value) && takes(b, right, value))
}

/**
 * A customId both patterns match, such as `ticket/1/close` for `ticket/{id}/close` and `ticket/{n:int}/close`;
 * `undefined` when no id matches both.
 */
export function sharedCustomId(left: string, right: string): string | undefined {
  const [a, b] = [left.split(PARAM_SEPARATOR), right.split(PARAM_SEPARATOR)]
  if (a.length !== b.length) return undefined
  const values = a.map((segment, index) => sharedValue(segment, b[index]))
  return values.every(value => value !== undefined) ? values.join(PARAM_SEPARATOR) : undefined
}
