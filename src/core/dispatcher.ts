import {
  type AutocompleteInteraction,
  type CacheType,
  type Interaction,
  type Message,
  type MessageReaction,
  type PartialMessageReaction,
  type PartialUser,
  type User,
} from 'discord.js'
import { type Container } from 'inversify'
import { type Logger } from '@src/common/logger.js'
import {
  getAutocompleteHandlers,
  getMessageHandlers,
  getReactionHandlers,
  matchesEmoji,
  type ReactionHandlerMetadata,
} from '@src/decorator/controller.decorator.js'
import {
  describeInteraction,
  focusedOptionName,
  hasCustomId,
  matchesCommandType,
  resolveCommandPaths,
  resolveOptionParams,
} from '@src/util/interaction.util.js'
import { type MessageCommandOptions, type ReactionEvent } from '@src/interface/index.js'
import { type AutocompleteMeta, type CommandMeta } from '@src/interface/command-decorator.interface.js'
import {
  buildComponentRoutes,
  type ComponentRoute,
  matchComponentRoute,
  type RouteParamValue,
  type RouteTies,
} from '@src/core/component-routes.js'
import {
  appPresenterOf,
  globalStagesOf,
  handleUnroutedError,
  type HandlerOutcome,
  observeUnclaimed,
  type RunOptions,
  runHandler,
  runInAppTheme,
} from '@src/core/handler-pipeline.js'
import { computeMessageHelp, helpInvocation, helpWords, isListable, matchHelpRequest, renderMessageHelp, splitReply } from '@src/core/message-help.js'
import { messageLocale, textRenderer } from '@src/common/meocord-text.js'
import { logFailedSend } from '@src/common/response/send-failure.js'
import { Translator } from '@src/common/translator.js'
import { useTheme } from '@src/core/theme-scope.js'
import { closeAutocomplete, type Fallback, noteInvocation } from '@src/core/fallback.js'
import { handlerInput } from '@src/core/handler-input.js'
import { matchCommandRoute } from '@src/core/command-routes.js'
import { runGuards } from '@src/core/guard-runner.js'
import { HandlerRegistry, shareMessageRoutes } from '@src/core/handler-registry.js'
import {
  buildMessageRoutes,
  commandWordsOf,
  matchMessageCommand,
  matchMessageSubcommands,
  matchMessageRoute,
  type MessageRoute,
  type MessageStarts,
  messageStarts,
  messageStartsFor,
  usesAppPrefix,
} from '@src/core/message-routes.js'
import { messageCommandHooks, subcommandUsageError } from '@src/core/message-params.js'
import { CommandNotFoundError } from '@src/common/errors.js'
import { existingResponse } from '@src/common/response/response-state.js'
import { stopOnStartupErrors } from '@src/util/refusal.util.js'

/**
 * How long a component or modal submission no route takes is left to the client's other listeners, such as a
 * collector, before MeoCord answers that no handler matched: well inside Discord's three seconds, which the answer
 * still needs.
 */
export const UNROUTED_COMPONENT_GRACE_MS = 1_500

/** The client listeners MeoCord adds for dispatch, which do not count as another listener that may answer. */
const ownListeners = new WeakSet<object>()

/** Marks `listener` as MeoCord's own dispatch listener, and returns it. */
export function ownInteractionListener<F extends (...args: never[]) => unknown>(listener: F): F {
  ownListeners.add(listener)
  return listener
}

/** Whether a listener other than MeoCord's own takes the client's interactions, as a collector's does. */
function othersListening(client: unknown): boolean {
  const { listeners } = (client ?? {}) as { listeners?: unknown }
  if (typeof listeners !== 'function') return false
  const taken: unknown = listeners.call(client, 'interactionCreate')
  return Array.isArray(taken) && taken.some(listener => !ownListeners.has(listener as object))
}

/** Whether the interaction has been answered or acknowledged, through `respond()` or discord.js directly. */
function answered(interaction: Interaction): boolean {
  const state = existingResponse(interaction)?.state
  if (state && state !== 'unanswered') return true
  return 'replied' in interaction && (interaction.replied || interaction.deferred)
}

type ControllerClass = new (...args: any[]) => any

interface AutocompleteRoute {
  controllerClass: ControllerClass
  meta: AutocompleteMeta
}

/** Told what one dispatched call did: each handler it ran, as it settled, and each error that reached the fallback. */
export interface DispatchRecorder {
  settled(controller: ControllerClass, method: string, outcome: HandlerOutcome): void
  unhandled(error: unknown): void
}

/** What a dispatcher routes over and how it answers. */
export interface DispatcherOptions {
  container: Container
  controllerClasses: readonly ControllerClass[]
  messageOptions?: MessageCommandOptions
  logger: Logger
  /** Answers an error no filter handles. */
  fallback: Fallback
  /** The bot's own user id, for a mention where a prefix goes and for telling its own reactions apart. */
  botUserId: (event: { client?: { user?: { id?: unknown } | null } }) => string | undefined
  /** Whether to warn, once per handler, about an interaction a handler left unanswered. */
  warnUnanswered?: boolean
  /** Whether a slow message handler is named, unless `messages.slowHandlerWarning` says; on unless given. */
  warnSlowMessageHandlers?: boolean
  /** Waits for the observers before a call settles, as the testing module does. */
  awaitObservers?: boolean
  /** How equally specific customId patterns rank; the app's `routeTies`. */
  routeTies?: RouteTies
}

/** A handler of a message, by name, and how to run it in a call. */
interface MessageRun {
  name: string
  run: (call: Call) => Promise<boolean>
}

/** How long a message's handler may take, with others waiting after it, before it is named as slow. */
const SLOW_HANDLER_MS = 5000

/** One dispatched call: when it arrived, the fallback that answers it, and who is told what it did. */
interface Call {
  startedAt?: number
  fallback: Fallback
  record?: DispatchRecorder
}

/**
 * Routes interactions, messages and reactions to the handlers that take them, as the bot does, and runs
 * each through its pipeline. The app and the testing module share it, so a test routes exactly as the bot.
 */
export class Dispatcher {
  private readonly container: Container
  private readonly controllerClasses: readonly ControllerClass[]
  private readonly messageOptions: MessageCommandOptions
  private readonly logger: Logger
  private readonly fallback: Fallback
  private readonly controllerInstancesCache = new Map<ControllerClass, any>()

  /** Every patterned `@MessageHandler`, most specific first. */
  private readonly messageRoutes: MessageRoute[]

  /** Every `@MessageHandler()` without a pattern, in controller order. */
  private readonly messageListeners: { controllerClass: ControllerClass; method: string }[]

  constructor(private readonly options: DispatcherOptions) {
    this.container = options.container
    this.controllerClasses = options.controllerClasses
    this.messageOptions = options.messageOptions ?? {}
    this.logger = options.logger
    this.fallback = options.fallback
    // Built now, so a pattern that cannot be read or two that match the same messages stop the bot before login
    this.messageRoutes = buildMessageRoutes([...this.controllerClasses], this.messageOptions)
    // A pattern refused while create() reports every startup error ends its checks here, before any warning
    stopOnStartupErrors()
    // The app's own help command reads this table too, so it lists the commands dispatch reaches
    if (this.container.isBound(HandlerRegistry)) shareMessageRoutes(this.container.get(HandlerRegistry), this.messageRoutes)
    this.warnUnreachableHelp()
    this.messageListeners = this.controllerClasses.flatMap(controllerClass =>
      getMessageHandlers(controllerClass.prototype)
        .filter(handler => handler.pattern === undefined)
        .map(({ method }) => ({ controllerClass, method })),
    )
  }

  /**
   * Warns when `messages.help` is on but never answers: a handler of the app's that the help message itself
   * reaches, which always runs instead, or no start at all, when the app has no prefix and takes no mention.
   */
  private warnUnreachableHelp(): void {
    const words = helpWords(this.messageOptions.help)
    if (words.length === 0) return
    const { prefix, mention } = this.messageOptions
    // The help message as it would be sent, alone and asking about a command: after each of the app's own
    // prefixes, and after a mention of the bot
    const bot = '0'
    const prefixes = typeof prefix === 'function' || prefix === undefined ? [] : [prefix].flat().filter(candidate => candidate !== '')
    const starts: MessageStarts = { prefixes: mention === 'only' ? [] : prefixes, mention: mention ? bot : undefined, bot }
    const texts = [...starts.prefixes, ...(mention ? [`<@${bot}> `] : [])].flatMap(start => words.flatMap(word => [start + word, `${start}${word} topic`]))
    if (texts.length === 0 && typeof prefix !== 'function') {
      this.logger.warn('messages.help is on, but the app has no prefix and takes no mention, so no message can ask for help.')
    }
    const taken = new Set<MessageRoute>()
    for (const text of texts) {
      const route = matchMessageRoute(this.messageRoutes, text, starts)?.route ?? matchMessageCommand(this.messageRoutes, text, starts)?.route
      if (!route || taken.has(route)) continue
      taken.add(route)
      // The placeholder mention reads as the bot's, not as an id no one has
      const shown = text.replace(`<@${bot}> `, '@bot ')
      this.logger.warn(
        `messages.help is on, but ${route.controllerClass.name}.${route.method} (${JSON.stringify(route.pattern)}) takes "${shown}", ` +
          `which runs it instead, so the built-in help never answers. Turn help off, or give the handler another word.`,
      )
    }
  }

  /** The call for one event: the fallback, told of each error that reaches it when there is a recorder. */
  private callFor(record: DispatchRecorder | undefined, startedAt?: number): Call {
    const fallback: Fallback = record
      ? async (error, context) => {
          record.unhandled(error)
          return this.fallback(error, context)
        }
      : this.fallback
    return { startedAt, fallback, record }
  }

  private getInstance(controllerClass: ControllerClass): any {
    if (!this.controllerInstancesCache.has(controllerClass)) {
      this.controllerInstancesCache.set(controllerClass, this.container.get(controllerClass))
    }
    return this.controllerInstancesCache.get(controllerClass)
  }

  /**
   * Every pattern-matched route, most specific first, built once, as the app is created. The ordering lets
   * `gi-profile/summary/{uid}` win over `gi-profile/{uuid}/{uid}` regardless of registration order.
   */
  private componentRoutes?: ComponentRoute[]

  /** The component routes, built on first use; the app calls it as it is created. */
  getComponentRoutes(): ComponentRoute[] {
    return (this.componentRoutes ??= buildComponentRoutes([...this.controllerClasses], { routeTies: this.options.routeTies }))
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
   * Dispatches an interaction. A failure outside any handler, such as no route matching or resolving
   * the controller, goes to the global filters, then the fallback.
   */
  async interaction(interaction: Interaction<CacheType>, record?: DispatchRecorder): Promise<void> {
    // From the moment it arrives, so an observer's duration includes routing
    const call = this.callFor(record, performance.now())
    try {
      await this.dispatchInteraction(interaction, call)
    } catch (error) {
      await handleUnroutedError(this.container, [interaction], error, this.runOptions(call))
    }
  }

  private async dispatchInteraction(interaction: Interaction<CacheType>, call: Call) {
    // Autocomplete first, and on its own path: it is answered with `respond()` rather
    // than a reply, it has no customId to route on, and the "Command not found!" reply
    // the other paths end in cannot be sent to it at all.
    if (interaction.isAutocomplete()) {
      await this.handleAutocomplete(interaction, call)
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
        ;(interaction as Interaction & { dynamicParams: Record<string, RouteParamValue> }).dynamicParams = params
        await this.executeCommand(this.getInstance(route.controllerClass), route.meta, interaction, call)
        return
      }
    }

    // The same match a test's invoke checks a handler against, so the two cannot disagree
    const command = matchCommandRoute(this.controllerClasses, interaction)
    if (command) {
      await this.executeCommand(this.getInstance(command.controllerClass), command.meta, interaction, call)
      return
    }

    // A component or modal no route takes may be a collector's: with another listener on the client, it has the
    // grace to answer, and MeoCord says no handler matched only if nothing did
    if (hasCustomId(interaction) && othersListening(interaction.client)) {
      await new Promise(resolve => setTimeout(resolve, UNROUTED_COMPONENT_GRACE_MS))
      // Another listener's to report: MeoCord neither answered nor failed it, so the observers are not told
      if (answered(interaction)) {
        this.logger.debug(`No handler matched ${describeInteraction(interaction)}; another listener answered it.`)
        return
      }
    }

    // Log what actually failed to match. The user's "Command not found!" says nothing
    // about which id was unroutable, so a control that is emitted but never routed --
    // a customId whose value broke its pattern, or a handler nobody wrote -- stays
    // invisible until somebody reports the dead button.
    throw new CommandNotFoundError(
      `No handler matched ${describeInteraction(interaction)}. Check that a @Command pattern is ` +
        `declared for it and that its controller is registered.`,
    )
  }

  /**
   * Answers an autocomplete interaction from the `@Autocomplete` handler that claims it. An unclaimed
   * option gets an empty list and a warning, rather than a menu stuck loading until Discord times out.
   */
  private async handleAutocomplete(interaction: AutocompleteInteraction<CacheType>, call: Call): Promise<void> {
    const focusedName = focusedOptionName(interaction)

    for (const path of resolveCommandPaths(interaction)) {
      for (const { controllerClass, meta } of this.getAutocompleteRoutes()) {
        if (meta.commandPath !== path) continue
        if (meta.optionName !== undefined && meta.optionName !== focusedName) continue

        const controllerInstance = this.getInstance(controllerClass)
        this.logger.log('[AUTOCOMPLETE]', `[${path}]`, `[${meta.methodName}]`)
        const params = resolveOptionParams(interaction)
        const ran = await this.invokeHandler(controllerInstance, meta.methodName, [interaction, params], call)
        if (!ran) await closeAutocomplete(interaction, this.logger)
        return
      }
    }

    this.logger.warn(
      `No handler matched ${describeInteraction(interaction)}. Declare an @Autocomplete handler for it, ` +
        `or drop setAutocomplete(true) from the option.`,
    )
    await closeAutocomplete(interaction, this.logger)
    await observeUnclaimed(this.container, [interaction], this.runOptions(call))
  }

  /** Handler and name pairs already warned about, so a collision warns once, not on every submit or selection. */
  private readonly warnedCollisions = new Set<string>()

  /** Warns, in development, that a modal field or select menu choice is hidden by a customId param of the same name. */
  private warnCollisions(methodName: string, names: string[]): void {
    if (process.env.NODE_ENV !== 'development') return

    for (const name of names) {
      const key = `${methodName}:${name}`
      if (this.warnedCollisions.has(key)) continue
      this.warnedCollisions.add(key)
      this.logger.warn(
        `"${name}" is both a customId param and a modal field or select menu choice of ${methodName}; the handler receives the customId ` +
          `param. Rename one to receive both.`,
      )
    }
  }

  /**
   * Runs a resolved command, shared by both dispatch paths so a pattern-matched
   * component and a named slash command behave identically once the route is chosen.
   */
  private async executeCommand(
    controllerInstance: Record<string, (...args: unknown[]) => Promise<void>>,
    commandMetadata: CommandMeta<string>,
    interaction: Interaction<CacheType>,
    call: Call,
  ): Promise<void> {
    const { methodName, type } = commandMetadata

    // No interaction-type check here: both callers pick the route with
    // `matchesCommandType` before getting this far, and `@Command` re-checks the
    // interaction on the way into the handler.
    this.logger.log('[INTERACTION]', `[${type}]`, `[${methodName}]`)

    const routeParams = (interaction as Interaction & { dynamicParams?: Record<string, RouteParamValue> }).dynamicParams
    const { params, collisions } = handlerInput(interaction, routeParams)
    this.warnCollisions(methodName, collisions)

    await this.invokeHandler(controllerInstance, methodName, [interaction, params], call)
  }

  /** The pipeline options every run of a call shares. */
  private runOptions({ fallback, startedAt }: Call): RunOptions {
    return { fallback, startedAt, awaitObservers: this.options.awaitObservers }
  }

  /**
   * Runs a handler through its pipeline, with the fallback answering any error no filter handles, and
   * says whether the handler ran. Its guard wrappers let this call through, so each guard runs once.
   */
  private async invokeHandler(
    instance: Record<string, (...args: unknown[]) => unknown>,
    methodName: string,
    args: unknown[],
    call: Call,
    hooks: Pick<RunOptions, 'parseArgs' | 'fetchArgs'> = {},
  ): Promise<boolean> {
    const handler = `${instance.constructor.name}.${methodName}`
    const onUnanswered: RunOptions['onUnanswered'] = this.options.warnUnanswered
      ? (phase, returnedBy) => this.warnUnansweredOnce(handler, phase, returnedBy && { name: returnedBy.interceptor.name, handlerStarted: returnedBy.handlerStarted })
      : undefined
    const outcome = await runHandler(this.container, instance, methodName, args, { ...this.runOptions(call), onUnanswered, ...hooks })
    call.record?.settled(instance.constructor as ControllerClass, methodName, outcome)
    return outcome.ran
  }

  /** The handlers already warned about, so each is named once however often it runs. */
  private readonly warnedUnanswered = new Set<string>()

  /**
   * Warns, once per handler, that it left its interaction unanswered or deferred without a follow-up, or that
   * `interceptor` returned before the handler ran or finished, and the call ended so.
   */
  private warnUnansweredOnce(
    handler: string,
    phase: 'unanswered' | 'deferred',
    interceptor?: { name: string; handlerStarted: boolean },
  ): void {
    if (this.warnedUnanswered.has(handler)) return
    this.warnedUnanswered.add(handler)
    const returned = interceptor && `${handler}: its interceptor ${interceptor.name} returned before the handler ${interceptor.handlerStarted ? 'finished' : 'ran'}`
    const what = interceptor
      ? phase === 'unanswered'
        ? `${returned}, without answering the interaction, so the user saw "The application did not respond". Answer it ` +
          `in ${interceptor.name}, or await next.handle().`
        : interceptor.handlerStarted
          ? `${returned}, and the deferred interaction had no follow-up when the call ended, so @Defer's lock was ` +
            `released while the user still saw it thinking. Follow up in ${interceptor.name} with respond(interaction).send(), ` +
            'or await next.handle().'
          : `${returned}, and the deferred interaction was never followed up, so the user saw it thinking until Discord ` +
            `gave up. Follow up in ${interceptor.name} with respond(interaction).send(), or await next.handle().`
      : phase === 'unanswered'
        ? `${handler} finished without answering its interaction, so the user saw "The application did not respond". ` +
          'Answer it with respond(interaction).send(), or acknowledge it first with @Defer().'
        : `${handler} deferred its interaction and never followed up, so the user saw it thinking until Discord gave up. ` +
          'Follow up with respond(interaction).send().'
    this.logger.warn(`${what} Shown once per handler; @MeoCord({ warnUnanswered: false }) turns it off.`)
  }

  /**
   * Runs the most specific patterned handler the message matches, then every listener. Its typed params are read
   * before its guards and fetched after them; a message that names a command but does not fit its pattern gets its
   * usage through that handler's filters. A bare parent's unguarded subcommands' usage, once the app's guards allow
   * it, and a failure to read the prefixes, go through the global filters, then the fallback; the listeners still run.
   */
  async message(message: Message, record?: DispatchRecorder): Promise<void> {
    if (message.author.bot || !message.content?.trim()) return
    const call = this.callFor(record)

    let target: { route: MessageRoute; params: Record<string, string>; start: string; given?: number } | undefined
    try {
      if (this.messageRoutes.length > 0) {
        const starts = await messageStartsFor(this.messageRoutes, this.messageOptions, message, this.options.botUserId(message))
        target = matchMessageRoute(this.messageRoutes, message.content, starts)
        if (!target) {
          const named = matchMessageCommand(this.messageRoutes, message.content, starts)
          if (named) target = { ...named, params: {} }
        }
        // No handler took it: the built-in help, then a parent with no handler of its own, which lists its
        // subcommands. Both run only the app's guards, so a handler a guard of its own protects is left out
        const answered = !target && (await this.answerHelp(message, usesAppPrefix(this.messageRoutes) ? starts : undefined))
        const listing = target || answered ? undefined : matchMessageSubcommands(this.messageRoutes, message.content, starts, isListable)
        if (listing && (await this.appGuardsAllow(message))) throw subcommandUsageError(listing)
      } else await this.answerHelp(message)
    } catch (error) {
      await handleUnroutedError(this.container, [message], error, this.runOptions(call))
    }
    // The matched handler, then every listener, each resolved from the container only as it starts
    const runs: MessageRun[] = []
    if (target) {
      const { route, params, start, given } = target
      noteInvocation(message, `${start}${commandWordsOf(route.tokens).join(' ')}`)
      const hooks = messageCommandHooks(route, params, message, start, given, this.messageOptions.types)
      runs.push({
        name: `${route.controllerClass.name}.${route.method}`,
        run: at => this.invokeHandler(this.getInstance(route.controllerClass), route.method, [message, params], at, hooks),
      })
    }
    for (const { controllerClass, method } of this.messageListeners) {
      runs.push({
        name: `${controllerClass.name}.${method}`,
        run: at => this.invokeHandler(this.getInstance(controllerClass), method, [message], at),
      })
    }
    if (this.messageOptions.handlers === 'concurrent') await this.runTogether(runs, call)
    else await this.runInTurn(runs, call)
  }

  /** Runs a message's handlers one after another, warning once about one that held the rest back for long. */
  private async runInTurn(runs: readonly MessageRun[], call: Call): Promise<void> {
    const warn = this.messageOptions.slowHandlerWarning ?? this.options.warnSlowMessageHandlers ?? true
    for (const [index, { name, run }] of runs.entries()) {
      const started = performance.now()
      await run(call)
      const waiting = runs.length - 1 - index
      if (warn && waiting > 0) this.warnSlowOnce(name, performance.now() - started, waiting)
    }
  }

  /**
   * Starts a message's handlers together and settles once all have. Each is reported as settled in the order the
   * handlers are listed, whichever settles first, and a call that rejects, rejects this once every one has settled.
   */
  private async runTogether(runs: readonly MessageRun[], call: Call): Promise<void> {
    const { record } = call
    const reports = runs.map(() => [] as Parameters<DispatchRecorder['settled']>[])
    const results = await Promise.allSettled(
      runs.map(({ run }, index) =>
        run(record ? { ...call, record: { settled: (...report) => reports[index].push(report), unhandled: error => record.unhandled(error) } } : call),
      ),
    )
    for (const report of reports.flat()) record?.settled(...report)
    const failed = results.find(result => result.status === 'rejected')
    if (failed) throw failed.reason
  }

  /** The message handlers already warned about as slow, so each is named once. */
  private readonly warnedSlow = new Set<string>()

  /** Warns, once per handler, that it took `SLOW_HANDLER_MS` or longer with `waiting` handlers held back behind it. */
  private warnSlowOnce(name: string, took: number, waiting: number): void {
    if (took < SLOW_HANDLER_MS || this.warnedSlow.has(name)) return
    this.warnedSlow.add(name)
    const held = waiting === 1 ? 'the listener after it' : `the ${waiting} listeners after it`
    this.logger.warn(
      `${name} took ${(took / 1000).toFixed(1)} s on a message, and held back ${held}. ` +
        "@MeoCord({ messages: { handlers: 'concurrent' } }) runs them side by side; messages: { slowHandlerWarning: false } turns this off.",
    )
  }

  /**
   * Answers a message that asks the built-in help, when `messages.help` is on and no handler took the message:
   * through the presenter's `messageHelp` when it has one, else in plain text, once the app's guards allow it.
   * `known` is the message's starts when they hold the app's prefixes already. Whether it answered, or a
   * guard refused the request.
   */
  private async answerHelp(message: Message, known?: MessageStarts): Promise<boolean> {
    const words = helpWords(this.messageOptions.help)
    if (words.length === 0) return false
    const starts = known ?? (await messageStarts(this.messageOptions, message, this.options.botUserId(message)))
    const request = matchHelpRequest(message.content, starts, words, this.messageOptions.caseSensitive ?? false)
    if (!request) return false
    if (!(await this.appGuardsAllow(message))) return true
    // In the server's language, as the channel reads it, or the default in a DM
    const render = textRenderer(this.container.isBound(Translator) ? this.container.get(Translator) : undefined, messageLocale(message))
    const help = computeMessageHelp(
      this.messageRoutes,
      { ...request, starts, invocation: helpInvocation(request.start, this.messageOptions.help) },
      this.messageOptions.types,
      render,
    )
    await runInAppTheme(this.container, [message], async () => {
      const presenter = appPresenterOf(this.container)
      const written = presenter?.messageHelp ? await presenter.messageHelp(help, message) : this.helpText(renderMessageHelp(help, render))
      const replies = typeof written === 'string' ? splitReply(written).map(content => ({ content })) : [written]
      try {
        for (const reply of replies) await message.reply({ allowedMentions: { repliedUser: false, parse: [] }, ...reply })
      } catch (failure) {
        logFailedSend(this.logger, 'answer a help request', failure)
      }
    })
    return true
  }

  /**
   * Whether the app's guards let a message no handler takes be answered, as the built-in help or a parent's
   * list of subcommands is. A guard that throws refuses it as it would a command, through the global filters.
   */
  private appGuardsAllow(message: Message): Promise<boolean> {
    return runGuards(globalStagesOf(this.container).guards, { container: this.container, args: [message], type: 'message' })
  }

  /** The built-in help's text, begun with the theme's info emoji when `replyEmoji` is on, as usage replies begin with its warning. */
  private helpText(text: string): string {
    return this.messageOptions.replyEmoji ? `${useTheme().emojis.info} ${text}` : text
  }

  /**
   * Runs the reaction's handlers, controller by controller, those for its emoji before those for every
   * emoji. A reaction from a bot, the bot's own included, runs only handlers that set `bots: true`.
   */
  async reaction(
    reaction: MessageReaction | PartialMessageReaction,
    { user, action }: ReactionEvent,
    record?: DispatchRecorder,
  ): Promise<void> {
    const call = this.callFor(record)
    const forEmoji = (handler: ReactionHandlerMetadata) => !handler.emoji || matchesEmoji(handler.emoji, reaction.emoji)
    const matching = this.controllerClasses
      .map(controllerClass => ({
        controllerClass,
        // Handlers for this emoji first, then those for every emoji
        handlers: getReactionHandlers(this.getInstance(controllerClass))
          .filter(forEmoji)
          .sort((a, b) => Number(!a.emoji) - Number(!b.emoji)),
      }))
      .filter(({ handlers }) => handlers.length > 0)
    if (matching.length === 0) return

    // Only asked when a matching handler leaves bots out, since a partial user costs a fetch
    const fromBot = matching.some(({ handlers }) => handlers.some(handler => !handler.settings.bots))
      ? await this.isBot(user, reaction)
      : undefined
    // A user that could not be fetched is not known to be a person, so it reaches only those that take bots
    const botsOnly = fromBot !== false && fromBot !== undefined
    const runs = matching
      .map(({ controllerClass, handlers }) => ({
        controllerClass,
        handlers: botsOnly ? handlers.filter(handler => handler.settings.bots) : handlers,
      }))
      .filter(({ handlers }) => handlers.length > 0)
    if (runs.length === 0) return

    // A message the gateway keeps whole is read from the cache; only a partial one, known by its id alone, is
    // fetched, and a partial reaction, which fetching fetches its message for. A message the bot can no longer
    // read -- deleted, or in a channel it lost access to -- fails that fetch, an ordinary outcome rather than a
    // fault, so the reaction is skipped quietly.
    try {
      if (reaction.partial) await reaction.fetch()
      else if (reaction.message.partial) await reaction.message.fetch()
    } catch (error) {
      this.logger.debug(`Skipping a reaction whose message could not be fetched: ${String(error)}`)
      return
    }

    for (const { controllerClass, handlers } of runs) {
      const controllerInstance = this.getInstance(controllerClass)
      for (const { method } of handlers) {
        await this.invokeHandler(controllerInstance, method, [reaction, { user, action }], call)
      }
    }
  }

  /**
   * Whether a user is a bot: the bot itself, or a user discord.js knows to be one. A partial user is
   * fetched first; `null` when that fails.
   */
  private async isBot(user: User | PartialUser, reaction: MessageReaction | PartialMessageReaction): Promise<boolean | null> {
    if (user.id === this.options.botUserId(reaction)) return true
    if (typeof user.bot === 'boolean') return user.bot
    try {
      return (await user.fetch()).bot
    } catch (error) {
      this.logger.debug(`Skipping a reaction whose user could not be fetched: ${String(error)}`)
      return null
    }
  }
}
