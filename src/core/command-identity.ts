import { ApplicationCommandType } from 'discord.js'
import { CommandType } from '@src/enum/index.js'
import { type CommandMeta } from '@src/interface/command-decorator.interface.js'

/** One command as it is sent, with the guilds its builder restricts it to. */
export interface CollectedCommand {
  name: string
  body: { name?: unknown; type?: unknown; options?: unknown }
  guilds?: (string | undefined)[]
  /** The name of the builder class it came from, for a message about its `guilds`. */
  builder?: string
}

type Builder = NonNullable<CommandMeta['builder']>

/** What Discord assumes a command body is when it carries no type of its own. */
export const DEFAULT_APPLICATION_COMMAND_TYPE = ApplicationCommandType.ChatInput

/** The body a builder registers, which is what Discord sees; throws when the builder is incomplete. */
export function serialise(builder: Builder): CollectedCommand['body'] {
  return typeof (builder as { toJSON?: () => unknown }).toJSON === 'function'
    ? ((builder as { toJSON: () => unknown }).toJSON() as CollectedCommand['body'])
    : (builder as CollectedCommand['body'])
}

/** The application command types Discord sends a handler of each name-routed type. */
export const SENT_AS: Partial<Record<CommandType, readonly ApplicationCommandType[]>> = {
  [CommandType.SLASH]: [ApplicationCommandType.ChatInput],
  [CommandType.CONTEXT_MENU]: [ApplicationCommandType.User, ApplicationCommandType.Message],
  [CommandType.PRIMARY_ENTRY_POINT]: [ApplicationCommandType.PrimaryEntryPoint],
}

/** The command a handler's name is registered as: a slash command's first word, any other's whole name. */
export function commandNameOf(type: CommandType, name: string): string {
  return type === CommandType.SLASH ? name.split(' ')[0] : name
}

/**
 * The identity Discord gives a command. The numeric type leads, so the halves never read apart
 * wrongly; an absent type is the chat input one Discord infers, so untyped slash builders collide.
 */
export function registrationKey(body: CollectedCommand['body'], fallbackName: string): string {
  const type = typeof body.type === 'number' ? body.type : DEFAULT_APPLICATION_COMMAND_TYPE
  return `${type}:${typeof body.name === 'string' ? body.name : fallbackName}`
}
