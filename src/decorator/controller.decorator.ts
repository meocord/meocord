import 'reflect-metadata'
import {
  type AutocompleteInteraction,
  Message,
  MessageReaction,
  type OmitPartialGroupDMChannel,
  type PartialMessageReaction,
} from 'discord.js'
import { CommandType, MetadataKey } from '@src/enum/index.js'
import { type CheckedParams, type MessageHandlerOptions, type ReactionHandlerOptions, type ReactionHandlerSettings } from '@src/interface/index.js'
import {
  type AutocompleteMetadata,
  type BuildableCommandType,
  type CommandBuilderBase,
  type CommandBuilderConstructor,
  type CommandInteractionType,
  type CommandMetadata,
} from '@src/interface/command-decorator.interface.js'
import { isCustomIdRouted, matchesCommandType } from '@src/util/interaction.util.js'
import { BUILDER_GUILDS } from '@src/decorator/command-builder.decorator.js'
import { routeSpecificity } from '@src/core/route-specificity.js'
import { choicesOf, isSegmentType, parseSegment } from '@src/core/scalar-types.js'
import { type Route, type RouteParams, type RouteValue, type RouteValues } from '@src/common/route.js'

const COMMAND_METADATA_KEY = Symbol('commands')
const MESSAGE_HANDLER_METADATA_KEY = Symbol('message_handlers')
const REACTION_HANDLER_METADATA_KEY = Symbol('reaction_handlers')
const AUTOCOMPLETE_METADATA_KEY = Symbol('autocomplete_handlers')

/**
 * The class's own handler list, started from a copy of the inherited one, so a subclass's
 * handlers never land in its base class's metadata.
 */
export function ownHandlerList<T>(key: symbol, target: object): T[] {
  return Reflect.getOwnMetadata(key, target) ?? [...(Reflect.getMetadata(key, target) ?? [])]
}

/** The class's own command map, started from a copy of the inherited one, for the same reason. */
function ownCommandMap(target: object): Record<string, CommandMetadata[]> {
  const own: Record<string, CommandMetadata[]> | undefined = Reflect.getOwnMetadata(COMMAND_METADATA_KEY, target)
  if (own) return own

  const inherited: Record<string, CommandMetadata[]> = Reflect.getMetadata(COMMAND_METADATA_KEY, target) ?? {}
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
 * the message and its params, whose declared type is checked against the pattern. The last form comes last
 * so a mismatch is explained against it.
 */
export interface PatternedMessageHandlerDecorator<T, R, Pattern extends string> {
  (target: object, propertyKey: string, descriptor: TypedPropertyDescriptor<() => R>): void
  (target: object, propertyKey: string, descriptor: TypedPropertyDescriptor<(message: T) => R>): void
  <P extends Record<string, any>>(
    target: object,
    propertyKey: string,
    descriptor: TypedPropertyDescriptor<(message: T, params: P) => R> & {
      value?: (message: T, params: CheckedParams<Pattern, P>) => R
    },
  ): void
}

/**
 * Registers a listener for every message not sent by a bot. It runs after the patterned handler the
 * message matched, if any; see the overload taking a pattern for message commands.
 *
 * @example
 * ```typescript
 * @MessageHandler()
 * async handleAnyMessage(message: Message) {
 *   console.log(`Received a message: ${message.content}`)
 * }
 * ```
 */
export function MessageHandler<T extends OmitPartialGroupDMChannel<Message<boolean>>, R extends void | Promise<void>>(): (
  target: object,
  propertyKey: string,
  // A handler may take fewer parameters than dispatch passes; the descriptor type is invariant, so each arity is listed.
  _descriptor: TypedPropertyDescriptor<(message: T) => R> | TypedPropertyDescriptor<() => R>,
) => void
/**
 * Registers a handler for messages matching a pattern, after the prefix `@MeoCord({ messages })`
 * configures.
 *
 * A pattern is matched word by word. A literal word matches itself, in any case unless
 * `caseSensitive` is set. `{name}` captures one word, and words in quotes count as one. `{name...}`
 * captures the rest of the message as typed, at the end. `{name?}` and `{name...?}` are optional, and
 * only optional params follow one; of several, each takes a word only if it fits its type, and the
 * last takes any. `{name:type}` turns the word into a value of the type before any guard runs:
 * `int`, `number`, `bool`, `duration`, `member`, `user`, `role`, `channel`, words such as `on|off`, or
 * a type the app adds, and `{name:type...}` turns each word of the rest into one, as a list. `{--name}`
 * is a flag, `true` when the message gives `--name` after the command; `{--name:type}` takes `--name=value`,
 * required unless `?`. The params arrive as the handler's second argument, where `@Validate`, pipes
 * and `@Cooldown({ by })` see them too, and the params the handler declares are checked against them.
 *
 * A message that names the command, after a prefix or mention, but does not fit its pattern is
 * answered with the command's usage, as a `MessageUsageError` its filters see first.
 *
 * Only the most specific matching pattern runs, across every controller: more literal words first,
 * then a fixed number of words before a rest, then fewer params.
 *
 * @param pattern - The words to match, such as `'roll {sides} {note...?}'`.
 * @param options - The handler's own `prefix`, in place of the app's, or `false` for none;
 *   `caseSensitive`, over the app's; `aliases`, other command words; a `description` for help; and
 *   the `scope` it works in, `'guild'`, `'dm'` or `'any'`.
 *
 * @example
 * ```typescript
 * @MessageHandler('roll {sides:int} {note...?}')
 * async roll(message: Message, { sides, note }: { sides: number; note?: string }) {
 *   await message.reply(`Rolling d${sides}${note ? ` (${note})` : ''}`)
 * }
 *
 * // !mute @ana spam    !m @ana 1h spam
 * @MessageHandler('mute {target:member} {duration:duration?} {reason...?}', {
 *   aliases: ['m'],
 *   description: 'Times a member out, for 10 minutes unless told otherwise.',
 * })
 * async mute(message: Message, { target, duration, reason }: { target: GuildMember; duration?: number; reason?: string }) {
 *   await target.timeout(duration ?? 600_000, reason)
 * }
 *
 * @MessageHandler('hello', { prefix: false })
 * async hello(message: Message) {
 *   await message.reply('Hello! How can I help you?')
 * }
 * ```
 */
export function MessageHandler<
  T extends OmitPartialGroupDMChannel<Message<boolean>>,
  R extends void | Promise<void>,
  const Pattern extends string = string,
>(pattern: Pattern, options?: MessageHandlerOptions): PatternedMessageHandlerDecorator<T, R, Pattern>
export function MessageHandler(pattern?: string, options: MessageHandlerOptions = {}) {
  return function (target: object, propertyKey: string) {
    const handlers = ownHandlerList<MessageHandlerMetadata>(MESSAGE_HANDLER_METADATA_KEY, target)
    // An empty pattern means every message, as no pattern does
    handlers.push({ pattern: pattern || undefined, method: propertyKey.toString(), options })
    Reflect.defineMetadata(MESSAGE_HANDLER_METADATA_KEY, handlers, target)
  }
}

/** A `@ReactionHandler` as the decorator stores it. */
export interface ReactionHandlerMetadata {
  /** The emoji as declared: a name, a custom emoji's id or its `<:name:id>`; `undefined` for every emoji. */
  emoji: string | undefined
  method: string
  settings: ReactionHandlerSettings
}

type ReactionHandlerDecorator<T extends MessageReaction | PartialMessageReaction, R extends void | Promise<void>> = (
  target: object,
  propertyKey: string,
  descriptor:
    | TypedPropertyDescriptor<(reaction: T, options: ReactionHandlerOptions) => R>
    | TypedPropertyDescriptor<(reaction: T) => R>
    | TypedPropertyDescriptor<() => R>,
) => void

/**
 * Registers a handler for reactions added to or removed from a message: those with the given emoji,
 * or every reaction without one. Reactions from bots, the bot's own included, are skipped unless the
 * handler sets `bots: true`.
 *
 * @param emoji - The emoji: the character for a standard emoji; for a custom one its id, the `<:name:id>`
 *   Discord shows for it (`\:party:` in a message), or its name. A name matches every custom emoji of that
 *   name, one from each server; an id matches that emoji alone.
 * @param settings - `bots: true` to also run for reactions from bots.
 *
 * @example
 * ```typescript
 * @ReactionHandler('👍')
 * async handleThumbsUpReaction(reaction: MessageReaction, { user }: ReactionHandlerOptions) {
 *   console.log(`User ${user.username} reacted with 👍`)
 * }
 *
 * // One server's custom emoji, by its id
 * @ReactionHandler('<:party:1234567890123456789>')
 * async celebrate(reaction: MessageReaction) {}
 *
 * @ReactionHandler()
 * async handleAnyReaction(reaction: MessageReaction, { user }: ReactionHandlerOptions) {
 *   console.log(`User ${user.username} reacted with ${reaction.emoji.name}`)
 * }
 *
 * // Every emoji, from users and bots alike
 * @ReactionHandler({ bots: true })
 * async relay(reaction: MessageReaction, { user }: ReactionHandlerOptions) {}
 * ```
 */
export function ReactionHandler<T extends MessageReaction | PartialMessageReaction, R extends void | Promise<void>>(
  emoji?: string,
  settings?: ReactionHandlerSettings,
): ReactionHandlerDecorator<T, R>
export function ReactionHandler<T extends MessageReaction | PartialMessageReaction, R extends void | Promise<void>>(
  settings: ReactionHandlerSettings,
): ReactionHandlerDecorator<T, R>
export function ReactionHandler(
  emojiOrSettings?: string | ReactionHandlerSettings,
  settings: ReactionHandlerSettings = {},
): ReactionHandlerDecorator<MessageReaction | PartialMessageReaction, void | Promise<void>> {
  const [emoji, own] = typeof emojiOrSettings === 'object' ? [undefined, emojiOrSettings] : [emojiOrSettings, settings]
  return function (target: object, propertyKey: string) {
    const handlers = ownHandlerList<ReactionHandlerMetadata>(REACTION_HANDLER_METADATA_KEY, target)
    handlers.push({ emoji, method: propertyKey.toString(), settings: own })
    Reflect.defineMetadata(REACTION_HANDLER_METADATA_KEY, handlers, target)
  }
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
  return Reflect.getMetadata(REACTION_HANDLER_METADATA_KEY, controller) || []
}

/**
 * Retrieves message handlers metadata from a given controller.
 *
 * @param controller - The controller class instance.
 * @returns The message handlers, with their patterns and options.
 */
export function getMessageHandlers(controller: any): MessageHandlerMetadata[] {
  return Reflect.getMetadata(MESSAGE_HANDLER_METADATA_KEY, controller) || []
}

// `{name}`, or `{name:type}` with the type read as far as the brace, so a type no segment can hold is named
const PLACEHOLDER_PATTERN = /\{(\w+)(?::([^}/]*))?}/g

/** The character a parameter will not cross, so one pattern segment maps to one value. */
export const PARAM_SEPARATOR = '/'

/** Escapes a literal stretch of a pattern so only placeholders stay meaningful. */
const escapeLiteral = (literal: string): string => literal.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&')

/**
 * Compiles a pattern into a regex, its parameter names and its specificity. A `{name}` matches up to
 * the next `/`, so a uuid is captured whole and `profile/{uuid}` never overlaps `profile/{uuid}/{id}`;
 * `-`-separated patterns can, which {@link findAmbiguousRoutes} reports at registration.
 */
export function createRegexFromPattern(pattern: string): {
  regex: RegExp
  params: string[]
  types: Record<string, string>
  specificity: number
} {
  const params: string[] = []
  const types: Record<string, string> = {}
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
      throw new Error(
        `Invalid pattern "${pattern}": {${param}} must occupy a whole segment, so it has to be ` +
          `preceded and followed by "${PARAM_SEPARATOR}" or by the ends of the pattern. ` +
          `Write "a${PARAM_SEPARATOR}{${param}}" rather than "a-{${param}}".`,
      )
    }

    if (type !== undefined) {
      if (!isSegmentType(type)) throw new Error(`Invalid pattern "${pattern}": ${segmentTypeProblem(param, type)}`)
      if (choicesOf(type)?.includes('')) {
        throw new Error(`Invalid pattern "${pattern}": {${param}:${type}} lists an empty word to choose from, which no segment can be.`)
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

  // Literal text is the signal: a pattern spelling out more of the id describes it
  // more exactly than one leaving it to a parameter. Fewer parameters breaks a tie
  // between equal-length patterns, so the ranking is total and never falls back to
  // declaration order.
  const specificity = routeSpecificity({
    literals: literalLength,
    params: params.length,
    typed: Object.values(types).reduce((sum, type) => sum + narrowness(type), 0),
  })
  return { regex, params, types, specificity }
}

/** How few values a segment type takes, so a narrower type ranks first: words to choose from, then bool, int, number. */
const narrowness = (type: string): number => (choicesOf(type) ? 4 : type === 'bool' ? 3 : type === 'int' ? 2 : 1)

/** Why a `{name:type}` cannot type a customId segment, which holds text the bot wrote, with no message to read. */
function segmentTypeProblem(param: string, type: string): string {
  const kinds = 'string, int, number, bool, or words to choose from such as {mode:on|off}'
  if (['member', 'user', 'role', 'channel'].includes(type)) {
    return `{${param}:${type}} is a type only a message command reads. A customId holds text: write {${param}} for its ID, and fetch it in the handler.`
  }
  return `{${param}:${type}} names no type a customId can hold. The types are ${kinds}.`
}

/** The keys a select menu's handler gets beside its route's params: its choices. */
type ChoiceKeys<T> = T extends CommandType.SELECT_MENU
  ? 'values'
  : T extends CommandType.USER_SELECT_MENU
    ? 'values' | 'users' | 'members'
    : T extends CommandType.ROLE_SELECT_MENU
      ? 'values' | 'roles'
      : T extends CommandType.CHANNEL_SELECT_MENU
        ? 'values' | 'channels'
        : T extends CommandType.MENTIONABLE_SELECT_MENU
          ? 'values' | 'users' | 'members' | 'roles'
          : never

type RequiredKeys<P> = { [K in keyof P]-?: object extends Pick<P, K> ? never : K }[keyof P]

/** The component types whose handler params are a route's params, and a select menu's choices. */
type RouteCheckedType =
  | CommandType.BUTTON
  | CommandType.SELECT_MENU
  | CommandType.USER_SELECT_MENU
  | CommandType.ROLE_SELECT_MENU
  | CommandType.CHANNEL_SELECT_MENU
  | CommandType.MENTIONABLE_SELECT_MENU

/**
 * Allows the handler when each key its params require is one a call to it gets: a param of its route, or a
 * select menu's choice. Value types are left to `@Validate`. Plain strings, commands, whose params are their
 * options, modals, whose fields are keyed by customId, and params with an index signature, as a handler
 * without them infers, are unchecked.
 */
type RouteAccepts<N, T, P> =
  N extends Route<infer Pattern>
    ? string extends Pattern | keyof P
      ? unknown
      : T extends RouteCheckedType
        ? [Exclude<RequiredKeys<P>, RouteParams<Pattern> | ChoiceKeys<T>>] extends [never]
          ? unknown
          : { "The handler's params name keys its route does not capture": Exclude<RequiredKeys<P>, RouteParams<Pattern> | ChoiceKeys<T>> }
        : unknown
    : unknown

/** The pattern text of a `@Command` name: a route's pattern, or the string itself. */
type PatternOf<N> = N extends Route<infer Pattern> ? Pattern : N extends string ? N : string

/** A pattern's typed params, each with the value its segment gives; an untyped param builds from any `RouteValue`. */
type TypedValues<Pattern extends string> = {
  [K in keyof RouteValues<Pattern> as [RouteValue] extends [RouteValues<Pattern>[K]] ? never : K]: RouteValues<Pattern>[K]
}

/**
 * Allows the handler when each typed customId param it declares takes the value its segment gives, such as a
 * number for `{count:int}`. Untyped params, params with an index signature, and commands are unchecked.
 */
type TypedParamsAccept<N, T, P> = T extends CommandType
  ? string extends PatternOf<N> | keyof P
    ? unknown
    : {
          [K in keyof TypedValues<PatternOf<N>> & keyof P as TypedValues<PatternOf<N>>[K] extends P[K] ? never : K]: TypedValues<PatternOf<N>>[K]
        } extends infer Mismatch
      ? [keyof Mismatch] extends [never]
        ? unknown
        : { "The handler's params give a typed customId param a type its value does not fit": Mismatch }
      : unknown
  : unknown

/**
 * Decorator to register command methods in a controller.
 *
 * @param commandName - What the command is addressed by. Commands registered with
 *   Discord use their name, and a subcommand its full path — `settings notify email`,
 *   parts separated by a space, the way Discord displays it. Components use a customId
 *   pattern, where `{name}` captures one `/`-separated segment, or a {@link Route}
 *   made from one, which also builds the customIds it matches. With a route, each key
 *   the handler's params require must be one of its params, or a select menu's choice.
 * @param builderOrType - A command builder class, or a `CommandType` for a handler that
 *   registers nothing of its own: every component, and every subcommand of a command
 *   whose builder already describes it.
 *
 * @example
 * ```typescript
 * @Command('help', CommandType.SLASH)
 * public async handleHelp(interaction: ChatInputCommandInteraction) {
 *   await interaction.reply('This is the help command!')
 * }
 *
 * @Command('settings notify email', CommandType.SLASH)
 * public async handleNotifyEmail(interaction: ChatInputCommandInteraction, { enabled }) {
 *   await interaction.reply(`Email notifications ${enabled ? 'on' : 'off'}`)
 * }
 *
 * @Command('stats/{id}', CommandType.BUTTON)
 * public async handleStats(interaction: ButtonInteraction, { id }) {
 *   await interaction.reply(`Fetching stats for ID: ${id}`);
 * }
 *
 * const ticket = route('ticket/{id}')
 *
 * @Command(ticket, CommandType.BUTTON)
 * public async handleTicket(interaction: ButtonInteraction, { id }) {
 *   await interaction.reply(`Ticket ${id}`)
 * }
 *
 * @Command('assign/{taskId}', CommandType.USER_SELECT_MENU)
 * public async handleAssign(interaction: UserSelectMenuInteraction, { taskId }) {
 *   await interaction.reply(`Assigned ${interaction.users.size} user(s) to ${taskId}`)
 * }
 * ```
 */
export function Command<
  CBC extends BuildableCommandType,
  T extends CommandBuilderConstructor<CBC> | CommandType,
  N extends string | Route = string,
>(name: N, builderOrType: T) {
  const commandName = typeof name === 'string' ? name : (name as Route).pattern
  return function <P extends Record<string, any>, R extends Promise<void> | void>(
    target: object,
    propertyKey: string,
    _descriptor: (
      | TypedPropertyDescriptor<(interaction: CommandInteractionType<CBC, T>, params: P) => R>
      | TypedPropertyDescriptor<(interaction: CommandInteractionType<CBC, T>) => R>
      | TypedPropertyDescriptor<() => R>
    ) &
      RouteAccepts<N, T, P> &
      TypedParamsAccept<N, T, P>,
  ) {
    const originalMethod = _descriptor.value
    if (!originalMethod) {
      throw new Error(`Missing implementation for method ${propertyKey}`)
    }

    // Wrap original method for interaction type validation
    _descriptor.value = function (interaction, params) {
      if (!matchesCommandType(commandType, interaction)) {
        throw new Error(`Invalid interaction type passed to @Command for method: ${propertyKey}`)
      }

      return originalMethod.apply(this, [interaction, params])
    }

    // This class's own map, inherited routes included
    const commands = ownCommandMap(target)

    let builderInstance: CommandMetadata['builder']
    let commandType: CommandType
    let regex: RegExp | undefined
    let dynamicParams: string[] = []
    let specificity: number | undefined
    let guilds: (string | undefined)[] | undefined

    // Determine command type and builder
    if (typeof builderOrType === 'function') {
      const builderObj = new builderOrType() as CommandBuilderBase
      try {
        builderInstance = builderObj.build(commandName)
      } catch (error) {
        // discord.js builders validate as they are set, and their errors name neither the command nor the field.
        const detail = error instanceof Error ? error.message.split('\n')[0] : String(error)
        throw new Error(
          `${builderOrType.name} could not build "${commandName}": ${detail}. Check its names, descriptions and ` +
            `localizations, which Discord limits to 32 and 100 characters.`,
          { cause: error },
        )
      }
      guilds = Reflect.getMetadata(BUILDER_GUILDS, builderOrType)
      commandType = Reflect.getMetadata(MetadataKey.CommandType, builderOrType) as CommandType
      if (!(commandType in CommandType)) {
        throw new Error(`Metadata for 'commandType' is missing on builder ${builderOrType.name}`)
      }
    } else {
      commandType = builderOrType
    }

    if (isCustomIdRouted(commandType)) {
      const { regex: generatedRegex, params, specificity: patternSpecificity } = createRegexFromPattern(commandName)
      regex = generatedRegex
      dynamicParams = params
      specificity = patternSpecificity
    }

    // Ensure commandName supports multiple entries
    if (!commands[commandName]) {
      commands[commandName] = []
    }

    commands[commandName].push({
      methodName: propertyKey,
      builder: builderInstance,
      type: commandType,
      regex,
      dynamicParams,
      specificity,
      ...(guilds && { guilds }),
    })

    Reflect.defineMetadata(COMMAND_METADATA_KEY, commands, target)
  }
}

/**
 * Retrieves the command map for a given controller.
 *
 * @param controller - The controller class instance.
 * @returns A record containing command metadata indexed by command names.
 */
export function getCommandMap<T extends string>(controller: any): Record<string, CommandMetadata<T>[]> {
  return Reflect.getMetadata(COMMAND_METADATA_KEY, controller)
}

/**
 * Registers an autocomplete handler for an option of a chat input command.
 *
 * Enable it on the option with `setAutocomplete(true)` and answer with `interaction.respond()`.
 *
 * @param commandPath - The command, such as `search` or `settings notify email` for a subcommand.
 * @param optionName - The option to complete. Omit to handle every option, branching on
 *   `interaction.options.getFocused(true)`.
 *
 * @example
 * ```typescript
 * @Autocomplete('search', 'query')
 * async completeQuery(interaction: AutocompleteInteraction) {
 *   const { value } = interaction.options.getFocused(true)
 *   await interaction.respond(this.search(value).map(name => ({ name, value: name })))
 * }
 * ```
 */
export function Autocomplete<R extends void | Promise<void>>(commandPath: string, optionName?: string) {
  return function <P extends Record<string, any>>(
    target: object,
    propertyKey: string,
    _descriptor:
      | TypedPropertyDescriptor<(interaction: AutocompleteInteraction, params: P) => R>
      | TypedPropertyDescriptor<(interaction: AutocompleteInteraction) => R>
      | TypedPropertyDescriptor<() => R>,
  ) {
    const handlers = ownHandlerList<AutocompleteMetadata>(AUTOCOMPLETE_METADATA_KEY, target)
    handlers.push({ commandPath, optionName, methodName: propertyKey.toString() })
    Reflect.defineMetadata(AUTOCOMPLETE_METADATA_KEY, handlers, target)
  }
}

/**
 * Returns a controller's autocomplete handlers, option-specific ones first.
 * @param controller - The controller instance.
 */
export function getAutocompleteHandlers(controller: any): AutocompleteMetadata[] {
  const handlers: AutocompleteMetadata[] = Reflect.getMetadata(AUTOCOMPLETE_METADATA_KEY, controller) || []
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

/** Whether a segment's two readings can both take one value: a literal, text, or a typed param. */
function segmentsOverlap(left: string, right: string): boolean {
  const [a, b] = [segmentParamType(left), segmentParamType(right)]
  if (a === undefined && b === undefined) return left === right
  if (a === undefined || b === undefined) {
    const [type, literal] = a === undefined ? [b!, left] : [a, right]
    return type === '' || parseSegment(type, literal) !== undefined
  }
  if (a === '' || b === '' || a === b) return true
  // Words to choose from overlap another type when one of them is a value of it
  const [wordsA, wordsB] = [choicesOf(a), choicesOf(b)]
  if (wordsA) return wordsA.some(word => parseSegment(b, word) !== undefined)
  if (wordsB) return wordsB.some(word => parseSegment(a, word) !== undefined)
  // Of the scalar types, only a whole number and a number share values
  return (a === 'int' && b === 'number') || (a === 'number' && b === 'int')
}

/**
 * Finds pairs of customId patterns that can both match one id, such as `a/{x}/c` and `a/b/{y}`.
 * @returns Each ambiguous pair once, in the order the patterns were given.
 */
export function findAmbiguousRoutes(patterns: string[]): [string, string][] {
  const segmentsOf = (pattern: string): string[] => pattern.split(PARAM_SEPARATOR)
  const collisions: [string, string][] = []

  for (let i = 0; i < patterns.length; i++) {
    for (let j = i + 1; j < patterns.length; j++) {
      const left = segmentsOf(patterns[i])
      const right = segmentsOf(patterns[j])
      if (left.length !== right.length) continue

      const disjoint = left.some((segment, index) => !segmentsOverlap(segment, right[index]))

      if (!disjoint) collisions.push([patterns[i], patterns[j]])
    }
  }

  return collisions
}
