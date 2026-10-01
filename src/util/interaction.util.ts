import {
  ApplicationCommandOptionType,
  type AutocompleteInteraction,
  ButtonInteraction,
  ChannelSelectMenuInteraction,
  ChatInputCommandInteraction,
  type CommandInteractionOption,
  ContextMenuCommandInteraction,
  type Interaction,
  MentionableSelectMenuInteraction,
  MessageComponentInteraction,
  ModalSubmitInteraction,
  PrimaryEntryPointCommandInteraction,
  RoleSelectMenuInteraction,
  StringSelectMenuInteraction,
  UserSelectMenuInteraction,
} from 'discord.js'
import { CommandType } from '@src/enum/controller.enum.js'

/**
 * The discord.js interaction class each command type handles, shared by `@Command`, the dispatcher and
 * `CommandInteractionType`. A `CommandType` without an entry here fails to compile. Their constructors are private
 * in discord.js's typings, so each is typed by what is read of it: its prototype and its name.
 */
const INTERACTION_CLASSES: Record<CommandType, { readonly prototype: object; readonly name: string }> = {
  [CommandType.SLASH]: ChatInputCommandInteraction,
  [CommandType.CONTEXT_MENU]: ContextMenuCommandInteraction,
  [CommandType.PRIMARY_ENTRY_POINT]: PrimaryEntryPointCommandInteraction,
  [CommandType.BUTTON]: ButtonInteraction,
  [CommandType.SELECT_MENU]: StringSelectMenuInteraction,
  [CommandType.USER_SELECT_MENU]: UserSelectMenuInteraction,
  [CommandType.ROLE_SELECT_MENU]: RoleSelectMenuInteraction,
  [CommandType.MENTIONABLE_SELECT_MENU]: MentionableSelectMenuInteraction,
  [CommandType.CHANNEL_SELECT_MENU]: ChannelSelectMenuInteraction,
  [CommandType.MODAL_SUBMIT]: ModalSubmitInteraction,
}

/** The name of the discord.js class a command type's handler takes, such as `ButtonInteraction`. */
export const interactionClassName = (type: CommandType): string => INTERACTION_CLASSES[type]?.name ?? 'an interaction'

/** Command types Discord identifies by a registered name rather than by a customId. */
const NAME_ROUTED_TYPES: ReadonlySet<CommandType> = new Set([
  CommandType.SLASH,
  CommandType.CONTEXT_MENU,
  CommandType.PRIMARY_ENTRY_POINT,
])

/** Whether an interaction is the kind the given command type handles. */
export function matchesCommandType(type: CommandType, interaction: unknown): boolean {
  const handled = INTERACTION_CLASSES[type] as { prototype: object } | undefined
  return handled !== undefined && typeof interaction === 'object' && interaction !== null && handled.prototype.isPrototypeOf(interaction)
}

/**
 * Whether an interaction is one a handler takes: of its command type, and for a context menu, of the kind
 * its builder registers, so a User and a Message command of the same name each reach their own handler.
 */
export function matchesHandler(handler: { type: CommandType; builder?: unknown }, interaction: unknown): boolean {
  if (!matchesCommandType(handler.type, interaction)) return false
  const registered = (handler.builder as { type?: unknown } | undefined)?.type
  return (
    handler.type !== CommandType.CONTEXT_MENU ||
    registered === undefined ||
    (interaction as { commandType?: unknown }).commandType === registered
  )
}

/**
 * Whether a command type is routed by customId pattern: components carry an application-defined
 * customId, while commands are matched by the name Discord registered.
 */
export function isCustomIdRouted(type: CommandType): boolean {
  return !NAME_ROUTED_TYPES.has(type)
}

/** The interactions that carry an application-defined customId. */
export type CustomIdInteraction = Extract<Interaction, { customId: string }>

/** Whether an interaction carries a customId, and so can be routed by pattern. */
export function hasCustomId(interaction: Interaction): interaction is CustomIdInteraction {
  return interaction instanceof MessageComponentInteraction || interaction instanceof ModalSubmitInteraction
}

/** Separates a command from its subcommand group and subcommand in a route key. */
export const COMMAND_PATH_SEPARATOR = ' '

/**
 * The route keys a chat input interaction can be handled by, most specific first:
 * `settings notify email`, then `settings`. Discord names the whole interaction `settings`, so the
 * full path comes first; a group is never skipped, since two groups may share a subcommand name.
 * @returns The keys to look up, most specific first.
 */
export function resolveCommandPaths(interaction: ChatInputCommandInteraction | AutocompleteInteraction): string[] {
  const { commandName } = interaction
  const options = interaction.options as Partial<ChatInputCommandInteraction['options']> | undefined

  // Guarded rather than called directly: `options` is a stub on a hand-built test
  // double, and an interaction whose command has no subcommands still has to route.
  const group = typeof options?.getSubcommandGroup === 'function' ? options.getSubcommandGroup(false) : null
  const sub = typeof options?.getSubcommand === 'function' ? options.getSubcommand(false) : null

  const path = [commandName, group, sub].filter((part): part is string => Boolean(part))
  const full = path.join(COMMAND_PATH_SEPARATOR)

  return full === commandName ? [commandName] : [full, commandName]
}

/** Options that only wrap other options; their values live one level down. */
const NESTING_OPTION_TYPES: ReadonlySet<ApplicationCommandOptionType> = new Set([
  ApplicationCommandOptionType.Subcommand,
  ApplicationCommandOptionType.SubcommandGroup,
])

/**
 * The value a handler receives for one option: the resolved user, role, channel or attachment
 * discord.js attaches, rather than a bare snowflake to re-fetch.
 */
function resolveOptionValue(option: CommandInteractionOption): unknown {
  return option.attachment ?? option.channel ?? option.role ?? option.user ?? option.member ?? option.value
}

/**
 * Flattens an interaction's options into the params record handlers receive, looking through
 * subcommand and group containers, so `/settings notify email true` yields `{ email: true }`.
 * @returns Each supplied option keyed by name, with entity options resolved.
 */
export function resolveOptionParams(
  interaction: ChatInputCommandInteraction | AutocompleteInteraction,
): Record<string, unknown> {
  const data = interaction.options?.data
  if (!Array.isArray(data)) return {}

  const params: Record<string, unknown> = {}

  const walk = (options: readonly CommandInteractionOption[]): void => {
    for (const option of options) {
      if (NESTING_OPTION_TYPES.has(option.type)) {
        walk(option.options ?? [])
        continue
      }
      params[option.name] = resolveOptionValue(option)
    }
  }

  walk(data)
  return params
}

/**
 * The name of the option the user is typing, or undefined when nothing is focused; `getFocused`
 * throws then, and hand-built test doubles lack it entirely.
 */
export function focusedOptionName(interaction: AutocompleteInteraction): string | undefined {
  if (typeof interaction.options?.getFocused !== 'function') return undefined

  try {
    return interaction.options.getFocused(true)?.name
  } catch {
    return undefined
  }
}

/**
 * Identifies an interaction in a log line, by whichever field would have routed it.
 *
 * @param interaction - The interaction that matched no handler.
 */
export function describeInteraction(interaction: Interaction): string {
  // Captured before the narrowing below: the guards cover every member of the union,
  // so by the fallback `interaction` is `never` and nothing can be read off it.
  const { type } = interaction

  if (interaction.isAutocomplete()) {
    const path = resolveCommandPaths(interaction)[0]
    const focused = focusedOptionName(interaction)
    return focused === undefined ? `autocomplete for "${path}"` : `autocomplete for "${path}" option "${focused}"`
  }
  if (interaction.isChatInputCommand()) {
    return `command "${resolveCommandPaths(interaction)[0]}"`
  }
  if (interaction.isContextMenuCommand() || interaction.isPrimaryEntryPointCommand()) {
    return `command "${interaction.commandName}"`
  }
  if (hasCustomId(interaction)) {
    return `customId "${interaction.customId}"`
  }
  return `interaction type ${type}`
}
