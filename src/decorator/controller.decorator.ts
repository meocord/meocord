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
import { type Route, type RouteParams } from '@src/common/route.js'

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

const PLACEHOLDER_PATTERN = /\{(\w+)}/g

/** The character a parameter will not cross, so one pattern segment maps to one value. */
export const PARAM_SEPARATOR = '/'

/** Escapes a literal stretch of a pattern so only placeholders stay meaningful. */
const escapeLiteral = (literal: string): string => literal.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&')

/**
 * Compiles a pattern into a regex, its parameter names and its specificity. A `{name}` matches up to
 * the next `/`, so a uuid is captured whole and `profile/{uuid}` never overlaps `profile/{uuid}/{id}`;
 * `-`-separated patterns can, which {@link findAmbiguousRoutes} reports at registration.
 */
export function createRegexFromPattern(pattern: string): { regex: RegExp; params: string[]; specificity: number } {
  const params: string[] = []
  let regexPattern = ''
  let cursor = 0
  let literalLength = 0

  PLACEHOLDER_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = PLACEHOLDER_PATTERN.exec(pattern)) !== null) {
    const [placeholder, param] = match
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
  const specificity = routeSpecificity({ literals: literalLength, params: params.length })
  return { regex, params, specificity }
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
 * one type whose patterns match the same ids stop the bot at startup.
 *
 * @param name - The command's name or subcommand path, or a component's customId pattern or route.
 * @param builderOrType - A command builder class, which registers the command with Discord, or a
 *   `CommandType` for a handler that registers nothing: a component, or a subcommand its command's builder
 *   describes.
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
 * @see {@link https://meocord.dev/docs/latest/command-types | Command types}
 * @see {@link https://meocord.dev/docs/latest/component-routing | Component routing}
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
      RouteAccepts<N, T, P>,
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
 * @see {@link https://meocord.dev/docs/latest/autocomplete | Autocomplete}
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

/** A pattern with its param names blanked, so two patterns that match the same customIds read the same. */
export function patternShape(pattern: string): string {
  return pattern.replace(PLACEHOLDER_PATTERN, '{}')
}

/**
 * Finds pairs of customId patterns that can both match one id, such as `a/{x}/c` and `a/b/{y}`.
 * @returns Each ambiguous pair once, in the order the patterns were given.
 */
export function findAmbiguousRoutes(patterns: string[]): [string, string][] {
  const isParam = (segment: string): boolean => PLACEHOLDER_PATTERN.test(segment)
  const segmentsOf = (pattern: string): string[] => pattern.split(PARAM_SEPARATOR)
  const collisions: [string, string][] = []

  for (let i = 0; i < patterns.length; i++) {
    for (let j = i + 1; j < patterns.length; j++) {
      const left = segmentsOf(patterns[i])
      const right = segmentsOf(patterns[j])
      if (left.length !== right.length) continue

      const disjoint = left.some((segment, index) => {
        PLACEHOLDER_PATTERN.lastIndex = 0
        const leftIsParam = isParam(segment)
        PLACEHOLDER_PATTERN.lastIndex = 0
        const rightIsParam = isParam(right[index])
        return !leftIsParam && !rightIsParam && segment !== right[index]
      })

      if (!disjoint) collisions.push([patterns[i], patterns[j]])
    }
  }

  return collisions
}
