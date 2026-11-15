import { ApplicationCommandType, Routes } from 'discord.js'
import { getCommandMap } from '@src/decorator/controller.decorator.js'
import { localizationProblems } from '@src/core/command-localizations.js'
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

/** What registration logs through. */
export interface RegistrationLogger {
  log(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
  debug(...args: unknown[]): void
}

/** Drops what it is told: for reading commands a check has already logged about. */
export const SILENT_LOGGER: RegistrationLogger = { log: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined }

/** `global`, or the id of a guild. */
export type RegistrationScope = 'global' | { guild: string }

/** A scope as a key: `global`, or `guild-` and the guild's id. */
export const scopeKey = (scope: RegistrationScope): string => (scope === 'global' ? 'global' : `guild-${scope.guild}`)

/** The route that lists, or bulk updates, the application's commands in a scope. */
export const routeFor = (applicationId: string, scope: RegistrationScope) =>
  scope === 'global' ? Routes.applicationCommands(applicationId) : Routes.applicationGuildCommands(applicationId, scope.guild)

/**
 * Every command the controllers declare, read from their prototypes: nothing is constructed.
 *
 * @returns The commands, or `undefined` when a builder cannot be serialised or a localization would be rejected.
 *   Registration then sends nothing, since a bulk update without that command would delete it from Discord.
 */
export function collectCommands(
  controllerClasses: (new (...args: any[]) => any)[],
  logger: RegistrationLogger,
): CollectedCommand[] | undefined {
  // Keyed by type and name: Discord treats that pair as one command, so a user and a message context
  // menu may share a name, and a command split across methods sends its builder once.
  const byKey = new Map<string, { builderClass: unknown; command: CollectedCommand }>()
  const broken: string[] = []
  const unlocalizable: string[] = []

  for (const controllerClass of controllerClasses) {
    const commandMap = getCommandMap(controllerClass.prototype) ?? {}

    for (const commandName in commandMap) {
      for (const { builder, builderClass, type, guilds } of commandMap[commandName]) {
        if (!(type in CommandType) || !builder) continue

        let body: CollectedCommand['body']
        try {
          body = serialise(builder)
        } catch (error) {
          broken.push(`"${commandName}" (${error instanceof Error ? error.message : String(error)})`)
          continue
        }

        const key = registrationKey(body, commandName)
        const existing = byKey.get(key)

        if (existing === undefined) {
          const name = typeof body.name === 'string' ? body.name : commandName
          unlocalizable.push(...localizationProblems(name, body))
          const builderName = (builderClass as { name?: unknown } | undefined)?.name
          byKey.set(key, {
            builderClass: builderClass ?? builder,
            command: { name, body, ...(guilds && { guilds }), ...(typeof builderName === 'string' && builderName && { builder: builderName }) },
          })
        } else if (existing.builderClass !== (builderClass ?? builder)) {
          // Refused when the app is created; kept for a caller that collects commands on its own, never thrown
          logger.warn(
            `Command "${existing.command.name}" is built more than once for the same application command type; ` +
              `only the first builder is registered. Two builders of one type cannot both own a name, so declare ` +
              `the builder on a single @Command and give the others the plain CommandType.`,
          )
        }
      }
    }
  }

  if (broken.length > 0) {
    logger.error(
      `No commands were registered: ${broken.length} builder(s) could not be serialised: ${broken.join(', ')}. ` +
        `Registering the rest would remove these from Discord.`,
    )
    return undefined
  }

  if (unlocalizable.length > 0) {
    logger.error(
      `No commands were registered: Discord would reject ${unlocalizable.length} localization(s):\n` +
        unlocalizable.map(problem => `  ${problem}`).join('\n'),
    )
    return undefined
  }

  return [...byKey.values()].map(({ command }) => command)
}
