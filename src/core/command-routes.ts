import { type Interaction } from 'discord.js'
import { commandsNamed, getCommandMap } from '@src/decorator/controller.decorator.js'
import { type CommandMeta } from '@src/interface/command-decorator.interface.js'
import { matchesHandler, resolveCommandPaths } from '@src/util/interaction.util.js'

/** The keys a command is routed by, most specific first: a chat command's full path, then its name; none for anything else. */
export function commandRouteKeys(interaction: Interaction): string[] {
  if (interaction.isChatInputCommand()) return resolveCommandPaths(interaction)
  if (interaction.isContextMenuCommand() || interaction.isPrimaryEntryPointCommand()) return [interaction.commandName]
  return []
}

/**
 * The handler a command reaches among `controllers`, as dispatch routes it: each key in turn, most specific first, so
 * a subcommand's handler beats its command's whatever order the controllers come in, then the first controller whose
 * handler takes the interaction.
 */
export function matchCommandRoute<C extends { prototype: object }>(
  controllers: readonly C[],
  interaction: Interaction,
): { controllerClass: C; meta: CommandMeta } | undefined {
  for (const key of commandRouteKeys(interaction)) {
    for (const controllerClass of controllers) {
      const meta = commandsNamed(getCommandMap(controllerClass.prototype), key).find(each => matchesHandler(each, interaction))
      if (meta) return { controllerClass, meta }
    }
  }
  return undefined
}
