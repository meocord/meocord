import { chatInputApplicationCommandMention, type Client, Guild, type Interaction, type Message } from 'discord.js'
import { checkPath, commandIdSourceOf } from '@src/core/command-ids.js'
import { appOfClient } from '@src/core/theme-runtime.js'

/** The client behind a target, and its guild, if any. */
function whereShown(target: Interaction | Message | Guild | Client): { client: object; guild?: string } {
  if (target instanceof Guild) return { client: target.client, guild: target.id }
  const { client, guildId } = target as { client?: object; guildId?: string | null }
  return { client: client ?? target, guild: guildId ?? undefined }
}

/**
 * A clickable mention of one of the app's slash commands, a subcommand or a grouped subcommand, as `</settings channel:123>`.
 *
 * It looks the command up where the reader can use it: the guild the target is in first, then the global scope. The
 * IDs come from the bot's own registration, or from one listing of a scope on its first mention, listed again when no
 * scope holds it, at most once a minute per scope; a guild copy registered while the bot runs is used once the global
 * copy no longer resolves, or after a restart, and an ID gone stale because the command was deleted and registered
 * again elsewhere shows as plain `/name` text until then. A scope whose listing fails is skipped for the next, and
 * listed again at most once a minute too. A mention made while the bot registers its commands waits for it.
 * In a testing module's call, it answers from the commands the module's controllers declare, with fixed IDs.
 *
 * @param path - The command's name, then its subcommand group and subcommand, separated by spaces, as a user types it.
 * @param target - Where the mention is shown: an interaction, a message, a guild, or the client.
 * @returns The mention, formatted by discord.js's `chatInputApplicationCommandMention`.
 * @throws RangeError when the path names no slash command of the app's, names a subcommand or group the command
 *   doesn't declare, or stops at a command that has subcommands.
 * @throws Error when the command isn't registered where the target's readers can use it, when no scope holds it and a
 *   scope's listing failed (naming that failure, kept as its `cause`), before the client is ready, or when the target's
 *   client belongs to no MeoCord app.
 *
 * @example
 * ```ts
 * import { type ChatInputCommandInteraction } from 'discord.js'
 * import { commandMention, respond } from 'meocord/common'
 *
 * async function askForChannel(interaction: ChatInputCommandInteraction) {
 *   await respond(interaction).send(`Set a channel first with ${await commandMention('settings channel', interaction)}.`)
 * }
 * ```
 *
 * @group Utilities
 * @category Commands
 * @see {@link https://meocord.dev/docs/4.2/formatting | Formatting}
 */
export async function commandMention(path: string, target: Interaction | Message | Guild | Client): Promise<string> {
  const { client, guild } = whereShown(target)
  const container = appOfClient(client)
  const source = container && commandIdSourceOf(container)
  if (!source) {
    throw new Error(
      'commandMention: the client belongs to no MeoCord app. Mention a command with the client the app runs, or, in a ' +
        "test, from code a testing module's invoke or dispatch runs.",
    )
  }
  const checked = checkPath(path, source.declared())
  const id = await source.idOf(client, guild, checked)
  const [name, group, subcommand] = checked.words
  if (subcommand !== undefined) return chatInputApplicationCommandMention(name, group, subcommand, id)
  if (group !== undefined) return chatInputApplicationCommandMention(name, group, id)
  return chatInputApplicationCommandMention(name, id)
}
