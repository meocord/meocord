import {
  ButtonInteraction,
  ChannelSelectMenuInteraction,
  ChatInputCommandInteraction,
  ContextMenuCommandBuilder,
  MentionableSelectMenuInteraction,
  MessageContextMenuCommandInteraction,
  ModalSubmitInteraction,
  PrimaryEntryPointCommandInteraction,
  type RESTPostAPIPrimaryEntryPointApplicationCommandJSONBody,
  RoleSelectMenuInteraction,
  SlashCommandBuilder,
  StringSelectMenuInteraction,
  UserContextMenuCommandInteraction,
  UserSelectMenuInteraction,
  type SlashCommandOptionsOnlyBuilder,
  type SlashCommandSubcommandsOnlyBuilder,
} from 'discord.js'
import { CommandType } from '@src/enum/index.js'
import { type ContextMenuInteractionOf } from '@src/interface/context-menu-kind.js'

/**
 * The command types registered with Discord, which take a builder: slash, context menu and entry point commands.
 *
 * Components have nothing to register: they are addressed by a customId the app makes up.
 *
 * @group Types
 * @see {@link CommandBuilder}
 */
export type BuildableCommandType = CommandType.SLASH | CommandType.CONTEXT_MENU | CommandType.PRIMARY_ENTRY_POINT

/**
 * The body an entry point command is registered with.
 *
 * `description` is added back on top of the discord-api-types body: that type omits it
 * from every non-chat-input command, but the API accepts one for entry point commands
 * — Discord's own default activity command ships with it set.
 *
 * @group Types
 * @see {@link CommandBuildResult}
 */
export type PrimaryEntryPointCommandData = RESTPostAPIPrimaryEntryPointApplicationCommandJSONBody & {
  description?: string
}

/**
 * What a builder's `build()` returns for its command type.
 *
 * A `SlashCommandBuilder` for `SLASH`, in any of the narrowed forms chaining options or subcommands produces; a
 * `ContextMenuCommandBuilder` for `CONTEXT_MENU`; and the raw REST body for `PRIMARY_ENTRY_POINT`, which
 * discord.js has no builder for.
 *
 * @group Types
 * @see {@link CommandBuilderBase}
 */
export type CommandBuildResult<T extends BuildableCommandType> = T extends CommandType.SLASH
  ? SlashCommandBuilder | SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandsOnlyBuilder
  : T extends CommandType.CONTEXT_MENU
    ? ContextMenuCommandBuilder
    : T extends CommandType.PRIMARY_ENTRY_POINT
      ? PrimaryEntryPointCommandData
      : never

/**
 * What a command builder implements: `build`, which describes the command to register.
 *
 * Implement it on a class marked with {@link CommandBuilder}.
 *
 * @group Types
 * @see {@link CommandBuilder}
 */
export interface CommandBuilderBase<T extends BuildableCommandType = BuildableCommandType> {
  /**
   * Builds the command structure using the specified command name.
   *
   * @param commandName - The name of the command.
   * @returns A builder instance, or a raw command body for entry point commands.
   */
  build: (commandName: string) => CommandBuildResult<T>
}

/**
 * A command builder class, as `@Command` takes it.
 *
 * @group Types
 * @see {@link Command}
 */
export type CommandBuilderConstructor<T extends BuildableCommandType> = new () => CommandBuilderBase<T>

/**
 * What `@Command` records about a handler method: its route, its type and its builder.
 *
 * @internal
 */
export interface CommandMeta<T extends string = string> {
  /** The handler method's name. */
  methodName: string
  /** What the command's builder built, which is registered with Discord; `undefined` for a handler with a `CommandType`. */
  builder: ReturnType<CommandBuilderBase['build']> | undefined
  /** The builder class that built it, which tells one builder serving a command and its subcommands from two. */
  builderClass?: abstract new (...args: any[]) => unknown
  /** The kind of interaction the handler takes. */
  type: CommandType
  /** The pattern a component's customId is matched with; `undefined` for a command, matched by its name. */
  regex?: RegExp
  /** The params a component's customId pattern captures, in the order they appear. */
  dynamicParams?: T[]
  /**
   * How specific this pattern is, as 4.1 ranked patterns: more literal text first.
   *
   * @deprecated Since 4.2, and removed in the next major version (5.0). Internal: nothing replaces it. Component routing
   * ranks patterns segment by segment and no longer reads it.
   */
  specificity?: number
  /** The builder's own `guilds` option, when it has one. */
  guilds?: (string | undefined)[]
}

/**
 * What `@Autocomplete` records about a handler method: the command and option it completes.
 *
 * @internal
 */
export interface AutocompleteMeta {
  /** The command path the handler serves, e.g. `settings` or `settings notify email`. */
  commandPath: string
  /** The option it completes, or `undefined` to complete every option of that command. */
  optionName?: string
  /** The handler method's name. */
  methodName: string
}

/**
 * What `@Command` records about a handler method.
 *
 * @deprecated Since 4.1, and removed in the next major version (5.0). Internal: nothing replaces it. No public type
 * or function takes or returns it.
 *
 * @internal
 */
export type CommandMetadata<T extends string = string> = CommandMeta<T>

/**
 * What `@Autocomplete` records about a handler method.
 *
 * @deprecated Since 4.1, and removed in the next major version (5.0). Internal: nothing replaces it. No public type
 * or function takes or returns it.
 *
 * @internal
 */
export type AutocompleteMetadata = AutocompleteMeta

/** The interaction class each non-buildable command type hands to its handler. */
interface ComponentInteractionMap {
  [CommandType.BUTTON]: ButtonInteraction
  [CommandType.SELECT_MENU]: StringSelectMenuInteraction
  [CommandType.USER_SELECT_MENU]: UserSelectMenuInteraction
  [CommandType.ROLE_SELECT_MENU]: RoleSelectMenuInteraction
  [CommandType.MENTIONABLE_SELECT_MENU]: MentionableSelectMenuInteraction
  [CommandType.CHANNEL_SELECT_MENU]: ChannelSelectMenuInteraction
  [CommandType.MODAL_SUBMIT]: ModalSubmitInteraction
  [CommandType.SLASH]: ChatInputCommandInteraction
  [CommandType.CONTEXT_MENU]: UserContextMenuCommandInteraction | MessageContextMenuCommandInteraction
  [CommandType.PRIMARY_ENTRY_POINT]: PrimaryEntryPointCommandInteraction
}

/**
 * The interaction a `@Command` handler receives, from its builder or its `CommandType`.
 *
 * @group Types
 * @see {@link Command}
 */
export type CommandInteractionType<
  CBC extends BuildableCommandType,
  T extends CommandBuilderConstructor<CBC> | CommandType,
> =
  T extends CommandBuilderConstructor<CommandType.SLASH>
    ? ChatInputCommandInteraction
    : T extends CommandBuilderConstructor<CommandType.CONTEXT_MENU>
      ? ContextMenuInteractionOf<ReturnType<InstanceType<T>['build']>>
      : T extends CommandBuilderConstructor<CommandType.PRIMARY_ENTRY_POINT>
        ? PrimaryEntryPointCommandInteraction
        : T extends keyof ComponentInteractionMap
          ? ComponentInteractionMap[T]
          : never
