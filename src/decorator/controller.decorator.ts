import 'reflect-metadata'
import {
  ApplicationCommandType,
  type AutocompleteInteraction,
  Message,
  MessageContextMenuCommandInteraction,
  MessageReaction,
  type OmitPartialGroupDMChannel,
  type PartialMessageReaction,
  UserContextMenuCommandInteraction,
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
import { Logger } from '@src/common/logger.js'
import { routeSpecificity } from '@src/core/route-specificity.js'
import { choicesOf, isSegmentType, parseSegment } from '@src/core/scalar-types.js'
import { type Route, type RouteParams, type RouteValue, type RouteValues } from '@src/common/route.js'
import { refuse } from '@src/util/refusal.util.js'

const COMMAND_METADATA_KEY = Symbol('commands')
const MESSAGE_HANDLER_METADATA_KEY = Symbol('message_handlers')
const REACTION_HANDLER_METADATA_KEY = Symbol('reaction_handlers')
const AUTOCOMPLETE_METADATA_KEY = Symbol('autocomplete_handlers')

const logger = new Logger('Command')

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
 * Runs the method it decorates for every message a user sends, whatever it says.
 *
 * Use it for work on all chat, such as logging, auto-moderation or counting activity. For a command a user
 * types, such as `!roll 20`, give `@MessageHandler` a pattern instead.
 *
 * @remarks
 * It runs after the one patterned handler the message matched, if any, and never for a message from a bot or
 * one with no text. Reading a message's text needs the privileged `MessageContent` intent. Its guards only
 * filter what it takes, so a denial gets no reply.
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
 * @see {@link https://meocord.dev/docs/4.1/message-commands | Message commands}
 */
export function MessageHandler<T extends OmitPartialGroupDMChannel<Message<boolean>>, R extends void | Promise<void>>(): (
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
 * compiles.
 *
 * @param pattern - The words to match, such as `'roll {sides:int} {note...?}'`.
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
 * @see {@link https://meocord.dev/docs/4.1/message-commands | Message commands}
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
 * Runs the method it decorates when a reaction with an emoji is added to or removed from a message.
 *
 * Use it to act on reactions: a starboard, a poll, a role menu or approving by ✅. Leave the emoji out to run
 * for every reaction. For clicks on a message's buttons, use {@link Command} with a customId.
 *
 * @remarks
 * A standard emoji is its character, such as `'👍'`. A custom emoji is its id or the `<:name:id>` Discord
 * shows, which match that emoji alone, or its name, which matches every custom emoji of that name. Every
 * matching handler runs, and the reacted-to message is fetched first, so it is complete. Reactions from bots,
 * the bot's own included, are skipped unless `bots: true` is set.
 *
 * @param emoji - The emoji to handle: its character, or a custom emoji's id, `<:name:id>` or name.
 * @param settings - Whether bots' reactions reach it too; see {@link ReactionHandlerSettings}.
 *
 * @example
 * ```ts
 * @ReactionHandler('⭐')
 * async star(reaction: MessageReaction, { user, action }: ReactionHandlerOptions) {
 *   if (action === ReactionHandlerAction.ADD) await reaction.message.reply(`${user.username} starred this.`)
 * }
 * ```
 *
 * @pipeline handler after every stage the call passed
 * @group Decorators
 * @category Handlers
 * @see {@link ReactionHandlerOptions}
 * @see {@link https://meocord.dev/docs/4.1/reactions | Reactions}
 */
export function ReactionHandler<T extends MessageReaction | PartialMessageReaction, R extends void | Promise<void>>(
  emoji?: string,
  settings?: ReactionHandlerSettings,
): ReactionHandlerDecorator<T, R>
/**
 * Runs the method it decorates for every reaction added to or removed from a message, with the settings given, such
 * as `bots: true` to take bots' reactions too.
 *
 * @param settings - Whether bots' reactions reach it too; see {@link ReactionHandlerSettings}.
 */
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
      throw refuse(new Error(
        `Invalid pattern "${pattern}": {${param}} must occupy a whole segment, so it has to be ` +
          `preceded and followed by "${PARAM_SEPARATOR}" or by the ends of the pattern. ` +
          `Write "a${PARAM_SEPARATOR}{${param}}" rather than "a-{${param}}".`,
      ))
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
 * Routes a command, a component or a modal submission to the method it decorates.
 *
 * Use it for each interaction a controller handles: a slash or context menu command by its name or
 * subcommand path, and a button, select menu or modal by its customId pattern or a `route()`. For an
 * option's suggestions, use {@link Autocomplete}; for a message command, `@MessageHandler`.
 *
 * @remarks
 * A subcommand's path is its parts separated by a space, as Discord shows it: `settings notify email`. In a
 * customId pattern, `{name}` captures one `/`-separated segment into the handler's params; with a route, the
 * keys the handler's params require are checked against it when the code compiles. Two component handlers of
 * one type whose patterns match the same ids stop the bot at startup. A context menu handler receives the kind its
 * builder's `setType()` names, and one declaring the other kind fails to compile; when the compiler cannot tell the
 * kind, the bot checks it as it starts.
 *
 * @param name - The command's name or subcommand path, or a component's customId pattern or route.
 * @param builderOrType - A command builder class, which registers the command with Discord, or a
 *   `CommandType` for a handler that registers nothing: a component, or a subcommand its command's builder
 *   describes.
 * @throws Error when the builder throws, naming the builder and the command, and on a subcommand path the handler,
 *   since the builder of the path's command describes it.
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
 * @see {@link https://meocord.dev/docs/4.1/slash-commands | Slash commands}
 * @see {@link https://meocord.dev/docs/4.1/components | Buttons, selects and modals}
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
      | TypedPropertyDescriptor<Handles<CommandInteractionType<CBC, T>, [params: P], R>>
      | TypedPropertyDescriptor<Handles<CommandInteractionType<CBC, T>, [], R>>
      | TypedPropertyDescriptor<() => R>
    ) &
      RouteAccepts<N, T, P> &
      TypedParamsAccept<N, T, P>,
  ) {
    const originalMethod = _descriptor.value
    if (!originalMethod) {
      throw refuse(new Error(`Missing implementation for method ${propertyKey}`))
    }

    // Wrap original method for interaction type validation
    _descriptor.value = function (interaction, params) {
      if (!matchesCommandType(commandType, interaction)) {
        throw new Error(`Invalid interaction type passed to @Command for method: ${propertyKey}`)
      }

      return (originalMethod as (...args: unknown[]) => R).apply(this, [interaction, params])
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
      const where = `${target.constructor.name}.${propertyKey}`
      // A subcommand is part of its command's builder, which belongs on the command's own name
      const subcommandPath =
        Reflect.getMetadata(MetadataKey.CommandType, builderOrType) === CommandType.SLASH && commandName.includes(' ')
      const command = commandName.split(' ')[0]
      const declareInstead =
        `Declare the handler with @Command('${commandName}', CommandType.SLASH), and give the builder to ` +
        `@Command('${command}').`
      const builderObj = new builderOrType() as CommandBuilderBase
      try {
        builderInstance = builderObj.build(commandName)
      } catch (error) {
        const detail = error instanceof Error ? error.message.split('\n')[0] : String(error)
        if (subcommandPath) {
          throw refuse(new Error(
            `${where} declares the builder ${builderOrType.name} on "${commandName}", which is a subcommand path: the ` +
              `builder of its command, "${command}", describes it, and building it from the path failed (${detail}). ` +
              declareInstead,
            { cause: error },
          ))
        }
        // discord.js builders validate as they are set, and their errors name neither the command nor the field.
        throw refuse(new Error(
          `${builderOrType.name} could not build "${commandName}": ${detail}. Check its names, descriptions and ` +
            `localizations, which Discord limits to 32 and 100 characters.`,
          { cause: error },
        ))
      }
      // A builder that names its command itself still works on the path, registered once with its command
      if (subcommandPath) {
        logger.warn(
          `${where} declares the builder ${builderOrType.name} on "${commandName}", which is a subcommand path; the ` +
            `builder of its command, "${command}", describes it. ${declareInstead}`,
        )
      }
      guilds = Reflect.getMetadata(BUILDER_GUILDS, builderOrType)
      commandType = Reflect.getMetadata(MetadataKey.CommandType, builderOrType) as CommandType
      if (!(commandType in CommandType)) {
        throw refuse(new Error(`Metadata for 'commandType' is missing on builder ${builderOrType.name}`))
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
      const { regex: generatedRegex, params, specificity: patternSpecificity } = pattern
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
      ...(typeof builderOrType === 'function' && { builderClass: builderOrType as abstract new (...args: any[]) => unknown }),
      type: commandType,
      regex,
      dynamicParams,
      specificity,
      ...(guilds && { guilds }),
    })

    Reflect.defineMetadata(COMMAND_METADATA_KEY, commands, target)
  }
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
  const declared = CONTEXT_MENU_INTERACTIONS.get((Reflect.getMetadata('design:paramtypes', target, propertyKey) as unknown[] | undefined)?.[0])
  const registered = (built as { type?: ApplicationCommandType } | undefined)?.type
  if (!declared || registered === undefined || declared.kind === registered) return
  const kind = registered === ApplicationCommandType.User ? 'user' : 'message'
  throw refuse(new Error(
    `${target.constructor.name}.${propertyKey} takes a ${declared.name} context menu interaction, but ${builderName} ` +
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
export function getCommandMap<T extends string>(controller: any): Record<string, CommandMetadata<T>[]> {
  return Reflect.getMetadata(COMMAND_METADATA_KEY, controller)
}

/**
 * Suggests values for an option of a chat input command as the user types.
 *
 * Use it for an option with more possible values than a fixed list of choices holds, such as a search over
 * your own data. Enable it on the option with `setAutocomplete(true)` in the command's builder.
 *
 * @remarks
 * Answer with discord.js's `interaction.respond(choices)`, at most 25, within three seconds. The handler runs
 * its class and global guards and its filters, but no interceptors; a guard must not answer, and returning
 * `false` closes the menu with an empty list.
 *
 * @param commandPath - The command, such as `search`, or a subcommand's path, such as `settings notify email`.
 * @param optionName - The option to complete. Leave it out to handle every option, branching on
 *   `interaction.options.getFocused(true)`.
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
 * @see {@link https://meocord.dev/docs/4.1/autocomplete | Autocomplete}
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
