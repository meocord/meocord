import {
  type ActivityOptions,
  ApplicationCommandType,
  type AutocompleteInteraction,
  type CacheType,
  Client,
  type Interaction,
  Message,
  MessageFlagsBitField,
  MessageReaction,
  type PartialMessageReaction,
  SlashCommandBuilder,
} from 'discord.js'
import { type Container } from 'inversify'
import { Logger } from '@src/common/index.js'
import { hideInLogs } from '@src/common/logger.js'
import {
  getAutocompleteHandlers,
  getCommandMap,
  getMessageHandlers,
  getReactionHandlers,
  PARAM_SEPARATOR,
} from '@src/decorator/controller.decorator.js'
import { sample } from 'lodash-es'
import { EmbedUtil } from '@src/util/index.js'
import {
  describeInteraction,
  focusedOptionName,
  hasCustomId,
  matchesCommandType,
  resolveCommandPaths,
  resolveOptionParams,
} from '@src/util/interaction.util.js'
import { CommandType } from '@src/enum/index.js'
import { ReactionHandlerAction } from '@src/enum/controller.enum.js'
import { type ReactionHandlerOptions } from '@src/interface/index.js'
import { type AutocompleteMetadata, type CommandMetadata } from '@src/interface/command-decorator.interface.js'
import Table from 'cli-table3'
import {
  buildComponentRoutes,
  type ComponentRoute,
  findComponentRouteConflicts,
  matchComponentRoute,
} from '@src/core/component-routes.js'

interface AutocompleteRoute {
  controllerClass: new (...args: any[]) => any
  meta: AutocompleteMetadata
}

/** What Discord assumes a command body is when it carries no type of its own. */
const DEFAULT_APPLICATION_COMMAND_TYPE = ApplicationCommandType.ChatInput

/**
 * The body a builder registers, which is what Discord sees.
 *
 * Read from the built payload rather than from the `@Command` arguments: a builder is
 * free to describe the command differently from the strings it was handed.
 */
function payloadOf(builder: NonNullable<CommandMetadata['builder']>): { name?: unknown; type?: unknown } {
  try {
    return typeof (builder as { toJSON?: () => unknown }).toJSON === 'function'
      ? ((builder as { toJSON: () => unknown }).toJSON() as { name?: unknown; type?: unknown })
      : (builder as { name?: unknown; type?: unknown })
  } catch {
    // A builder missing a required field throws from toJSON. Surfacing that is the
    // registration call's job, where it is reported against the command Discord
    // rejected -- deduplication should not be what turns it into a startup crash.
    return {}
  }
}

/** The name a builder registers under. */
function commandNameOf(builder: NonNullable<CommandMetadata['builder']>): string | undefined {
  const { name } = payloadOf(builder)

  return typeof name === 'string' ? name : undefined
}

/**
 * The application command type a builder registers as.
 *
 * A slash builder may leave the field out, so an absent type is read as the chat input
 * one Discord would infer — which keeps untyped slash builders colliding with each
 * other rather than each claiming a key of its own.
 */
function commandTypeOf(builder: NonNullable<CommandMetadata['builder']>): ApplicationCommandType {
  const { type } = payloadOf(builder)

  return typeof type === 'number' ? type : DEFAULT_APPLICATION_COMMAND_TYPE
}

/**
 * The identity Discord gives a command.
 *
 * The numeric type leads, so the two halves can never be read apart wrongly: everything
 * before the first separator is the type, everything after it is the name.
 */
function registrationKey(builder: NonNullable<CommandMetadata['builder']>, fallbackName: string): string {
  return `${commandTypeOf(builder)}:${commandNameOf(builder) ?? fallbackName}`
}

export class MeoCordApp {
  private readonly logger = new Logger(MeoCordApp.name)
  private readonly bot: Client
  private isShuttingDown = false
  private activityInterval: ReturnType<typeof setInterval> | null = null
  private controllerInstancesCache = new Map<any, any>()

  constructor(
    private readonly controllerClasses: (new (...args: any[]) => any)[],
    private readonly container: Container,
    private readonly discordClient: Client,
    private discordToken: string,
    private activities?: ActivityOptions[],
  ) {
    // First, so nothing logged from here on, before login or after, prints it
    hideInLogs(discordToken)
    this.bot = this.discordClient
    process.on('SIGINT', () => this.gracefulShutdown())
    process.on('SIGTERM', () => this.gracefulShutdown())
  }

  /**
   * Runs an event handler so its failure is logged against the event instead of surfacing as an
   * unhandled rejection, which would terminate the whole bot.
   */
  private async runListener(event: string, run: () => Promise<void>): Promise<void> {
    try {
      await run()
    } catch (error) {
      this.logger.error(`Unhandled error while handling "${event}":`, error)
    }
  }

  /**
   * Rotates the bot's activity.
   *
   * Guarded separately from {@link runListener}: this runs on a timer rather than an
   * event, and a throw from a timer callback is an uncaught exception no listener
   * wrapper can reach.
   */
  private updateActivity(): void {
    try {
      this.bot.user?.setActivity(sample(this.activities))
    } catch (error) {
      this.logger.error('Could not update the bot activity:', error)
    }
  }

  private getInstance(controllerClass: new (...args: any[]) => any): any {
    if (!this.controllerInstancesCache.has(controllerClass)) {
      this.controllerInstancesCache.set(controllerClass, this.container.get(controllerClass))
    }
    return this.controllerInstancesCache.get(controllerClass)
  }

  /** Whether a failed login set the process exit code, so a later successful one knows to clear it. */
  private static failedLoginSetExitCode = false

  /**
   * Registers the Discord event handlers and logs the bot in.
   *
   * If the login fails, the process exit code is set to `1` before the promise rejects, so the
   * process exits non-zero even when the caller catches the error to log it. A later `start()`
   * that logs in clears that code again.
   *
   * @returns A promise that resolves once the bot is logged in.
   * @throws The login error, such as an invalid token or Discord being unreachable.
   *
   * @example
   * ```ts
   * const app = MeoCordFactory.create(App)
   * await app.start()
   * ```
   */
  async start() {
    this.logger.log('Starting bot...')

    this.bot.on('clientReady', () =>
      this.runListener('clientReady', async () => {
        this.activityInterval = setInterval(() => this.updateActivity(), 10000)
        await this.registerCommands()
      }),
    )

    this.bot.on('interactionCreate', interaction =>
      this.runListener('interactionCreate', () => this.handleInteraction(interaction)),
    )

    this.bot.on('messageCreate', message => this.runListener('messageCreate', () => this.handleMessage(message)))

    this.bot.on('messageReactionAdd', (reaction, user) =>
      this.runListener('messageReactionAdd', () =>
        this.handleReaction(reaction, { user, action: ReactionHandlerAction.ADD }),
      ),
    )

    this.bot.on('messageReactionRemove', (reaction, user) =>
      this.runListener('messageReactionRemove', () =>
        this.handleReaction(reaction, { user, action: ReactionHandlerAction.REMOVE }),
      ),
    )

    try {
      await this.bot.login(this.discordToken)
    } catch (error) {
      if (process.exitCode === undefined || process.exitCode === 0) {
        process.exitCode = 1
        MeoCordApp.failedLoginSetExitCode = true
      }
      throw error
    }
    if (MeoCordApp.failedLoginSetExitCode && process.exitCode === 1) {
      process.exitCode = undefined
      MeoCordApp.failedLoginSetExitCode = false
    }
    this.logger.log('Bot is online!')
  }

  async registerCommands() {
    // Keyed by type and name: Discord treats that pair as one command, so a user and a message context
    // menu may share a name, and a command split across methods sends its builder once.
    const buildersByCommand = new Map<string, NonNullable<CommandMetadata['builder']>>()

    for (const controllerClass of this.controllerClasses) {
      const instance = this.getInstance(controllerClass)
      const commandMap = getCommandMap(instance)

      for (const commandName in commandMap) {
        const commandMetadataArray = commandMap[commandName]

        if (!Array.isArray(commandMetadataArray)) continue

        for (const { builder, type } of commandMetadataArray) {
          if (!(type in CommandType) || !builder) continue

          const key = registrationKey(builder, commandName)
          const existing = buildersByCommand.get(key)

          if (existing === undefined) {
            buildersByCommand.set(key, builder)
          } else if (existing !== builder) {
            this.logger.warn(
              `Command "${commandNameOf(builder) ?? commandName}" is built more than once for the same ` +
                `application command type; only the first builder is registered. Two builders of one type ` +
                `cannot both own a name, so declare the builder on a single @Command and give the others ` +
                `the plain CommandType.`,
            )
          }
        }
      }
    }

    const builders = [...buildersByCommand.values()]

    try {
      if (this.bot.application) {
        await this.bot.application.commands.set(builders)
        const table = new Table({
          head: ['Name', 'Type', 'Sub-commands'],
          colWidths: [null, null, 30],
          wordWrap: true,
        })

        for (const builder of builders) {
          const json = typeof (builder as any).toJSON === 'function' ? (builder as any).toJSON() : (builder as any)
          const typeName =
            json?.type === 1
              ? 'SlashCommand'
              : json?.type === 2
                ? 'UserContextMenu'
                : json?.type === 3
                  ? 'MessageContextMenu'
                  : json?.type === 4
                    ? 'PrimaryEntryPoint'
                    : builder instanceof SlashCommandBuilder
                      ? 'SlashCommand'
                      : 'Command'
          const name = json?.name || (builder as any).name
          const subCommands =
            Array.isArray(json?.options) && json.options.length
              ? json.options.map((opt: any) => opt.name).join(', ')
              : ''

          table.push([name, typeName, subCommands])
        }

        this.logger.log(`Registered ${builders.length} bot commands:\n${table.toString()}`)
      }
    } catch (error) {
      this.logger.error('Error during command registration:', error)
    }
  }

  /**
   * Every pattern-matched route, most specific first, built once. The ordering lets
   * `gi-profile/summary/{ownerId}/{uid}` win over `gi-profile/{uuid}/{uid}` regardless of registration order.
   */
  private componentRoutes?: ComponentRoute[]

  private getComponentRoutes(): ComponentRoute[] {
    if (this.componentRoutes) return this.componentRoutes

    const routes = buildComponentRoutes(this.controllerClasses)
    this.reportAmbiguousRoutes(routes)
    this.componentRoutes = routes
    return routes
  }

  /**
   * Warns rather than throws: an app whose patterns overlap boots and works, and refusing to start
   * would turn a latent mis-route into an outage.
   */
  private reportAmbiguousRoutes(routes: ComponentRoute[]): void {
    const conflicts = findComponentRouteConflicts(routes)
    if (conflicts.length === 0) return

    this.logger.warn(
      `${conflicts.length} pattern pair(s) can match the same customId, so which one runs is decided by ` +
        `ranking rather than by the ids themselves:\n` +
        conflicts.map(({ patterns: [left, right] }) => `  "${left}"  vs  "${right}"`).join('\n') +
        `\nA parameter stops at "${PARAM_SEPARATOR}", so separating these segments with it makes them distinct.`,
    )
  }

  /**
   * Every `@Autocomplete` handler, option-specific ones first. Cached, since autocomplete runs on
   * every keystroke.
   */
  private autocompleteRoutes?: AutocompleteRoute[]

  private getAutocompleteRoutes(): AutocompleteRoute[] {
    if (this.autocompleteRoutes) return this.autocompleteRoutes

    const routes: AutocompleteRoute[] = []
    for (const controllerClass of this.controllerClasses) {
      for (const meta of getAutocompleteHandlers(this.getInstance(controllerClass))) {
        routes.push({ controllerClass, meta })
      }
    }

    routes.sort((a, b) => Number(Boolean(b.meta.optionName)) - Number(Boolean(a.meta.optionName)))
    this.autocompleteRoutes = routes
    return routes
  }

  /**
   * Dispatches an interaction, reporting a failure before the handler, such as resolving the
   * controller, to the user and the log as well.
   */
  private async handleInteraction(interaction: Interaction<CacheType>): Promise<void> {
    try {
      await this.dispatchInteraction(interaction)
    } catch (error) {
      this.logger.error(`Error dispatching ${describeInteraction(interaction)}:`, error)

      // Autocomplete has no reply to fall back on; closing its window is the only
      // thing that stops the client showing a loading state until it times out.
      if (interaction.isAutocomplete()) {
        await this.respondEmpty(interaction)
        return
      }

      await this.replyWithError(interaction, 'An error occurred while executing the command.')
    }
  }

  private async dispatchInteraction(interaction: Interaction<CacheType>) {
    // Autocomplete first, and on its own path: it is answered with `respond()` rather
    // than a reply, it has no customId to route on, and the "Command not found!" reply
    // the other paths end in cannot be sent to it at all.
    if (interaction.isAutocomplete()) {
      await this.handleAutocomplete(interaction)
      return
    }

    // Component interactions route on a pattern, so they go through the ranked table.
    // Commands match their registered name exactly and cannot overlap.
    if (hasCustomId(interaction)) {
      const customId = interaction.customId
      // The component type as well as the pattern: a button and a select menu may share a customId shape.
      const matched = matchComponentRoute(this.getComponentRoutes(), type => matchesCommandType(type, interaction), customId)
      if (matched) {
        const { route, params } = matched
        ;(interaction as Interaction & { dynamicParams: Record<string, string> }).dynamicParams = params
        await this.executeCommand(this.getInstance(route.controllerClass), route.meta, interaction, customId)
        return
      }
    }

    // Paths are walked outside the controller loop so the full subcommand path always
    // beats the bare command name, whatever order the controllers were registered in.
    for (const path of this.resolveNameRoutes(interaction)) {
      for (const controllerClass of this.controllerClasses) {
        const controllerInstance = this.getInstance(controllerClass)
        const commandMap = getCommandMap(controllerInstance)
        const commandMetadata = commandMap?.[path]?.find(meta => matchesCommandType(meta.type, interaction))
        if (!commandMetadata) continue

        await this.executeCommand(controllerInstance, commandMetadata, interaction, path)
        return
      }
    }

    // Log what actually failed to match. The user's "Command not found!" says nothing
    // about which id was unroutable, so a control that is emitted but never routed --
    // a customId whose value broke its pattern, or a handler nobody wrote -- stays
    // invisible until somebody reports the dead button.
    this.logger.warn(
      `No handler matched ${describeInteraction(interaction)}. Check that a @Command pattern is ` +
        `declared for it and that its controller is registered.`,
    )

    await this.replyWithError(interaction, 'Command not found!')
  }

  /**
   * The names a command interaction can be handled under, most specific first.
   *
   * Empty for anything that is not a registered command, which is how a component
   * whose customId matched no pattern falls through to the unmatched warning instead
   * of being looked up under a name it does not have.
   */
  private resolveNameRoutes(interaction: Interaction<CacheType>): string[] {
    if (interaction.isChatInputCommand()) return resolveCommandPaths(interaction)
    if (interaction.isContextMenuCommand() || interaction.isPrimaryEntryPointCommand()) {
      return [interaction.commandName]
    }
    return []
  }

  /**
   * Answers an autocomplete interaction from the `@Autocomplete` handler that claims it. An unclaimed
   * option gets an empty list and a warning, rather than a menu stuck loading until Discord times out.
   */
  private async handleAutocomplete(interaction: AutocompleteInteraction<CacheType>): Promise<void> {
    const focusedName = focusedOptionName(interaction)

    for (const path of resolveCommandPaths(interaction)) {
      for (const { controllerClass, meta } of this.getAutocompleteRoutes()) {
        if (meta.commandPath !== path) continue
        if (meta.optionName !== undefined && meta.optionName !== focusedName) continue

        try {
          const controllerInstance = this.getInstance(controllerClass)
          this.logger.log('[AUTOCOMPLETE]', `[${path}]`, `[${meta.methodName}]`)
          await controllerInstance[meta.methodName](interaction, resolveOptionParams(interaction))
        } catch (error) {
          this.logger.error(`Error handling ${describeInteraction(interaction)}:`, error)
          await this.respondEmpty(interaction)
        }
        return
      }
    }

    this.logger.warn(
      `No handler matched ${describeInteraction(interaction)}. Declare an @Autocomplete handler for it, ` +
        `or drop setAutocomplete(true) from the option.`,
    )
    await this.respondEmpty(interaction)
  }

  /** Closes an autocomplete window that nothing else answered. */
  private async respondEmpty(interaction: AutocompleteInteraction<CacheType>): Promise<void> {
    if (interaction.responded) return
    try {
      await interaction.respond([])
    } catch (error) {
      // The three-second window may already have closed, which is not actionable.
      this.logger.debug(`Could not close autocomplete window: ${String(error)}`)
    }
  }

  /**
   * Runs a resolved command, shared by both dispatch paths so a pattern-matched
   * component and a named slash command behave identically once the route is chosen.
   */
  private async executeCommand(
    controllerInstance: Record<string, (...args: unknown[]) => Promise<void>>,
    commandMetadata: CommandMetadata<string>,
    interaction: Interaction<CacheType>,
    commandIdentifier: string | undefined,
  ): Promise<void> {
    const { methodName, type } = commandMetadata

    // No interaction-type check here: both callers pick the route with
    // `matchesCommandType` before getting this far, and `@Command` re-checks the
    // interaction on the way into the handler.
    try {
      this.logger.log('[INTERACTION]', `[${type}]`, `[${methodName}]`)

      let dynamicParams: Record<string, unknown> = {}

      if (interaction.isChatInputCommand()) {
        dynamicParams = resolveOptionParams(interaction)
      } else if (hasCustomId(interaction)) {
        dynamicParams = (interaction as Interaction & { dynamicParams?: Record<string, string> }).dynamicParams ?? {}
      }

      await controllerInstance[methodName](interaction, dynamicParams)
    } catch (error) {
      this.logger.error(`Error executing command "${commandIdentifier}":`, error)
      await this.replyWithError(interaction, 'An error occurred while executing the command.')
    }
  }

  /**
   * Tells the user something went wrong, if the interaction can still take a reply. Never throws, since
   * a handler that already replied would otherwise turn one error into two.
   */
  private async replyWithError(interaction: Interaction<CacheType>, message: string): Promise<void> {
    if (!interaction.isRepliable() || interaction.replied || interaction.deferred) return

    try {
      const embed = EmbedUtil.createErrorEmbed(message)
      await interaction.reply({ embeds: [embed], flags: MessageFlagsBitField.Flags.Ephemeral })
    } catch (error) {
      // Unknown or already-acknowledged interaction; the user cannot be told anything.
      this.logger.debug(`Could not deliver the error reply: ${String(error)}`)
    }
  }

  private async handleMessage(message: Message) {
    if (message.author.bot || !message.content?.trim()) return

    const messageContent = message.content.trim()

    const relevantControllers = this.controllerClasses.filter(controllerClass => {
      const instance = this.getInstance(controllerClass)
      const messageHandlers = getMessageHandlers(instance)
      return messageHandlers.some(handler => !handler.keyword || handler.keyword === messageContent)
    })

    for (const controllerClass of relevantControllers) {
      const controllerInstance = this.getInstance(controllerClass)

      let messageHandlers = getMessageHandlers(controllerInstance)

      messageHandlers = messageHandlers.sort((a, b) => {
        if (a.keyword && !b.keyword) return -1
        if (!a.keyword && b.keyword) return 1
        return 0
      })

      for (const handler of messageHandlers) {
        const { keyword, method } = handler

        if (!keyword || keyword === messageContent) {
          try {
            await controllerInstance[method](message)
          } catch (error) {
            this.logger.error(`Error handling message "${messageContent}" for method "${method}":`, error)
          }
        }
      }
    }
  }

  private async handleReaction(
    reaction: MessageReaction | PartialMessageReaction,
    { user, action }: ReactionHandlerOptions,
  ) {
    // A reaction arrives for messages the bot may no longer be able to read -- deleted,
    // or in a channel it lost access to -- and `fetch` rejects for all of them. That is
    // an ordinary outcome rather than a fault, so the reaction is skipped quietly.
    try {
      await reaction.message.fetch()
    } catch (error) {
      this.logger.debug(`Skipping a reaction whose message could not be fetched: ${String(error)}`)
      return
    }

    const relevantControllers = this.controllerClasses.filter(controllerClass => {
      const instance = this.getInstance(controllerClass)
      const reactionHandlers = getReactionHandlers(instance)
      return reactionHandlers.some(handler => !handler.emoji || handler.emoji === reaction.emoji.name)
    })

    for (const controllerClass of relevantControllers) {
      const controllerInstance = this.getInstance(controllerClass)

      let reactionHandlers = getReactionHandlers(controllerInstance)

      reactionHandlers = reactionHandlers.sort((a, b) => {
        if (a.emoji && !b.emoji) return -1
        if (!a.emoji && b.emoji) return 1
        return 0
      })

      for (const handler of reactionHandlers) {
        const { emoji, method } = handler

        if (!emoji || emoji === reaction.emoji.name) {
          try {
            await controllerInstance[method](reaction, { user, action })
          } catch (error) {
            this.logger.error(`Error handling reaction "${reaction.emoji.name}" for method "${method}":`, error)
          }
        }
      }
    }
  }

  private async gracefulShutdown() {
    if (this.isShuttingDown) {
      process.exit(1)
    }

    if (this.bot) {
      try {
        this.isShuttingDown = true
        this.logger.log('Shutting down bot...')
        if (this.activityInterval) clearInterval(this.activityInterval)
        this.bot.removeAllListeners()
        await this.bot.destroy()
        this.logger.log('Bot has shut down')
        process.exit(0)
      } catch (error) {
        this.logger.error('Error during shutdown:', error)
        process.exit(1)
      }
    }
  }
}
