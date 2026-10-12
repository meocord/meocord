import 'reflect-metadata'
import { type BuildableCommandType, type CommandBuilderBase } from '@src/interface/command-decorator.interface.js'
import { makeInjectable } from '@src/util/injectable.util.js'
import { type CommandBuilderOptions } from '@src/interface/index.js'
import { META } from '@src/util/metadata-keys.js'
import { deprecatedOnMethod, declaring } from '@src/util/refusal.util.js'
import { Logger } from '@src/common/logger.js'

const logger = new Logger('CommandBuilder')

/** The nearest base class of `target` that gives `guilds`, which `target` inherits when it gives none. */
function guildsBase(target: object): { name: string } | undefined {
  for (let base = Object.getPrototypeOf(target); base && base !== Function.prototype; base = Object.getPrototypeOf(base)) {
    if (Reflect.hasOwnMetadata(META.builderGuilds, base)) return base
  }
  return undefined
}

/**
 * Marks a class as a command's builder, which describes the command MeoCord registers with Discord.
 *
 * Use it for each slash or context menu command, and pass the class to `@Command` in place of a
 * `CommandType`. A subcommand handler, or a component's, takes a `CommandType` instead and registers nothing.
 *
 * @remarks
 * `build(commandName)` returns the discord.js builder, named with the name `@Command` gives. The options are
 * read when the class is decorated, after `meocord.config.ts` has loaded `.env`, so they can name environment
 * values.
 *
 * @param commandType - The type of command the class builds.
 * @param options - Where the command is registered, in place of the configured scope.
 *
 * @example
 * ```ts
 * @CommandBuilder(CommandType.SLASH)
 * export class PingCommandBuilder implements CommandBuilderBase {
 *   build(commandName: string): SlashCommandBuilder {
 *     return new SlashCommandBuilder().setName(commandName).setDescription('Replies with pong')
 *   }
 * }
 * ```
 *
 * @group Decorators
 * @category Handlers
 * @see {@link Command}
 * @see {@link https://meocord.dev/docs/4.2/slash-commands | Slash commands}
 */
export function CommandBuilder<T extends BuildableCommandType>(commandType: T, options: CommandBuilderOptions = {}) {
  return declaring(function (target: new () => CommandBuilderBase<T>, propertyKey?: string | symbol) {
    if (deprecatedOnMethod('@CommandBuilder', target, propertyKey)) return
    makeInjectable(target)

    // Define the command type metadata for the target class
    Reflect.defineMetadata(
      META.commandType,
      commandType,
      target as unknown as CommandBuilderBase<T> & { commandType: string },
    )

    if (options.guilds) Reflect.defineMetadata(META.builderGuilds, [...options.guilds], target)
    else {
      const base = guildsBase(target)
      if (base) {
        logger.warn(
          `${target.name} gives no guilds and inherits ${base.name}'s; declare guilds on ${target.name} to keep them. ` +
            'The next major version (5.0) registers it in the configured scope.',
        )
      }
    }
  })
}
