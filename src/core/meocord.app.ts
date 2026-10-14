import {
  type ActivityOptions,
  Client,
  type Interaction,
  Message,
  REST,
  Routes,
} from 'discord.js'
import { type Container, type ServiceIdentifier } from 'inversify'
import { type EventEmitter } from 'node:events'
import { Logger } from '@src/common/index.js'
import { hideInLogs } from '@src/common/logger.js'
import {
  getMessageHandlers,
  getReactionHandlers,
} from '@src/decorator/controller.decorator.js'
import { messageDecorator, reactionDecorator } from '@src/core/command-conflicts.js'


import { ReactionHandlerAction } from '@src/enum/controller.enum.js'
import { type MessageCommandOptions } from '@src/interface/index.js'


import { globalStagesOf, runHandler } from '@src/core/handler-pipeline.js'
import { createFallback, type Fallback, replyWithUserError } from '@src/core/fallback.js'
import { claimCooldownNotice, claimStoreDownNotice } from '@src/core/cooldown-runner.js'


import { stageClass, stageTypes } from '@src/core/stage-scope.js'
import {
  eventRequirements,
  messageHandlerRequirements,
  missingRequirementWarnings,
  REACTION_HANDLER_REQUIREMENTS,
  type RequiringHandler,
} from '@src/core/event-requirements.js'
import { type LifecycleUnit } from '@src/core/lifecycle-order.js'
import { type EventSource } from '@src/core/event-sources.js'
import { waitForCooldownStore } from '@src/core/cooldown-runner.js'
import { type LifecycleEntry, lifecycleEntry, ReadyPass, runReadyHooks, runShutdownSequence } from '@src/core/lifecycle-hooks.js'
import { RunningCalls } from '@src/core/running-calls.js'
import { type StartupControl } from '@src/core/providers.js'
import { type MeoCordApplication } from '@src/interface/index.js'
import { processState } from '@src/core/process-state.js'
import { onDevRunnerStop, tellDevRunner } from '@src/util/dev-runner.util.js'
import { explainLoginFailure, type FatalLoginCode, fatalLoginCode, isRefusedToken, tokenMessage } from '@src/core/login-failure.js'
import { markExplained } from '@src/common/explained-error.js'
import { warnDeprecatedBehaviour } from '@src/common/deprecation.js'
import { GuardDeniedError, UserError } from '@src/common/errors.js'
import { managerGone } from '@src/util/sharding-mode.util.js'
import { endFailedShard, tellManager } from '@src/core/shard-exit.js'
import { isShardMessage } from '@src/core/shard-messages.js'
import { claimAmbientAppTheme, releaseAmbientAppTheme } from '@src/core/theme-runtime.js'
import { registerCommands } from '@src/core/command-registration.js'
import { undoFailedLogin } from '@src/core/failed-login.js'
import { Dispatcher, ownInteractionListener } from '@src/core/dispatcher.js'
import { deliverUncachedDmReactions } from '@src/core/dm-reactions.js'
import { loadMeoCordConfig } from '@src/util/meocord-config-loader.util.js'
import { FORCE_REGISTER_ENV, isRegisterOnly, REGISTER_GUILD_ENV, registersAsDevelopment } from '@src/util/registration-mode.util.js'
import { shutdownTimeoutOf } from '@src/util/shutdown-timeout.util.js'
import { escapeForLog } from '@src/util/user-text.util.js'

/** How long an `onReady` hook runs before a warning says the hooks after it are waiting. */
export const SLOW_READY_HOOK_MS = 10_000


const { runningApps } = processState

/**
 * Shuts every started app down and exits, with the code set when the shutdown began or 0, and 1 if an app failed to
 * close. Signals call it, and in a shard its manager's request or its going. A call within `REPEAT_SIGNAL_WINDOW_MS` of the first is the
 * same request; one after it forces exit 1, except in a shard, whose manager forces it.
 */
export async function shutdownAndExit(shard: boolean): Promise<void> {
  const request = processState.stopRequest()
  if (request !== 'first') {
    // A shard hears Ctrl+C both directly and from its manager, which owns forcing it; so it waits
    if (request === 'duplicate' || shard) return
    process.exit(1)
    return
  }
  return shutDown()
}

/** The one shutdown of the process, however many ask for it: a stop request joins one already under way. */
function shutDown(): Promise<void> {
  processState.shuttingDown ??= (async () => {
    // A clean stop keeps a code already set, such as the 1 a failed login set, so a supervisor still sees it. Read as
    // the shutdown begins: a code main.ts sets as it hears of the stop is the stop's, not a failure.
    const exitCode = Number(process.exitCode ?? 0) || 0
    const closed = await Promise.all([...runningApps].map(close => close()))
    process.exit(closed.every(Boolean) ? exitCode : 1)
  })()
  return processState.shuttingDown
}

/** The errors {@link stoppedBeforeOnline} made, which end a start without being its failure. */
const stops = new WeakSet<Error>()

/** What `start()` rejects with when shutdown begins before the bot came online, which shutdown has logged. */
function stoppedBeforeOnline(): Error {
  const error = new Error('The bot was stopped before it came online.')
  markExplained(error)
  stops.add(error)
  return error
}

/** What the app's starts make, which a stop or a failed start shuts down, and how a failed start is undone. */
export interface StartAttempt {
  /** The tokens of the lifecycle units the container has constructed. */
  readonly constructed: Set<unknown>
  /** The tokens of values the app gave as they are, which exist before any start, so a failed one leaves them open. */
  readonly given: ReadonlySet<unknown>
  /** Marks where a start begins, so a failed one can drop what it made. */
  begin(): void
  /** Drops what the start since `begin()` made, so a retry makes it afresh. */
  drop(): void
}

/** One pair of signal listeners for the process, however many apps it starts, for the role the first decided. */
function installSignalHandlers(shard: boolean): void {
  if (processState.signalHandlersInstalled) return
  processState.signalHandlersInstalled = true
  process.on('SIGINT', () => void shutdownAndExit(shard))
  process.on('SIGTERM', () => void shutdownAndExit(shard))
  // How `meocord start --dev` stops the application to restart it, a signal being no graceful stop on Windows. It is
  // not the user's stop request: their first Ctrl+C during it joins this shutdown, and only a repeat forces exit 1.
  onDevRunnerStop(() => void shutDown(), shard)

  // A shard stops when its manager asks, or when the manager is gone and cannot ask
  if (shard) {
    process.on('message', message => {
      if (isShardMessage(message) && message.meocord === 'shutdown') void shutdownAndExit(shard)
    })
    process.on('disconnect', () => void shutdownAndExit(shard))
  }
}

/** Tells the manager a shard cannot log in, and why, and waits until the message is sent. */
async function reportFatalLogin(shard: boolean, code: FatalLoginCode, reason: string): Promise<void> {
  if (shard) await tellManager({ meocord: 'fatal', code, message: reason })
}

/** How a shutdown warning names an interaction still being handled: by its command, or a component's customId. */
function interactionLabel(interaction: Interaction): string {
  if ('commandName' in interaction) return `interaction "/${escapeForLog(interaction.commandName)}"`
  if ('customId' in interaction) return `interaction "${escapeForLog(interaction.customId)}"`
  return '"interactionCreate"'
}

export class MeoCordApp implements MeoCordApplication {
  private readonly logger = new Logger(MeoCordApp.name)
  private readonly fallback: Fallback = createFallback(this.logger, () => this.messageOptions, {
    cooldownNotice: refusal => claimCooldownNotice(this.container, refusal),
    storeDownNotice: who => claimStoreDownNotice(this.container, who),
  })
  private readonly bot: Client
  private activityInterval: ReturnType<typeof setInterval> | null = null
  /** Where the activities' rotation is: the index of the next one shown. */
  private nextActivity = 0

  constructor(
    private readonly controllerClasses: (new (...args: any[]) => any)[],
    private readonly container: Container,
    private readonly discordClient: Client,
    private discordToken: string,
    private activities?: ActivityOptions[],
    /** The instances whose `@On` and `@Once` handlers run, read once the providers are made. */
    private readonly eventSources: () => readonly EventSource[] = () => [],
    shutdownTimeout?: number,
    private readonly startup?: (control: StartupControl) => Promise<void>,
    lifecycleUnits?: LifecycleUnit[],
    private readonly messageOptions: MessageCommandOptions = {},
    warnUnanswered = false,
    /** Whether a manager spawned this process, as `MeoCordFactory.create` decided before anything could change it. */
    private readonly shard = false,
    /** What each start makes; without one, as an app built by hand in a spec, nothing is shut down before ready. */
    private readonly attempt?: StartAttempt,
  ) {
    // First, so nothing logged from here on, before login or after, prints it
    hideInLogs(discordToken)
    this.lifecycleUnits = lifecycleUnits ?? []
    this.bot = this.discordClient
    // Built now, so a pattern that cannot be read or two that match the same messages or customIds stop the bot as it
    // is created, before start() attaches anything
    this.dispatcher = new Dispatcher({
      container,
      controllerClasses,
      messageOptions,
      logger: this.logger,
      fallback: this.fallback,
      botUserId: () => this.bot.user?.id,
      warnUnanswered,
    })
    this.dispatcher.getComponentRoutes()
    // Read through the config's own check: a bot started without the CLI loads its config unchecked
    this.shutdownTimeout = shutdownTimeoutOf(shutdownTimeout, message => this.logger.warn(message))
  }

  /** Everything whose lifecycle hooks run, classes and provided values, in dependency order. */
  private readonly lifecycleUnits: LifecycleUnit[]

  /** Routes interactions, messages and reactions to their handlers. */
  private readonly dispatcher: Dispatcher

  /** Whether shutdown has begun, so the ready hooks start no more. */
  private closing = false

  /** How long shutdown waits for the `onShutdown` hooks, from `shutdownTimeout` in the config. */
  private readonly shutdownTimeout: number

  /** The tokens of the units whose `onReady` the ready pass has settled, or found they have none. */
  private readonly readySettled = new Set<unknown>()

  /**
   * Closes the app once, however many stops and signals ask: whether the client was destroyed cleanly. The app stays
   * among the running ones until the close settles, so a signal or a manager's request meanwhile waits for it.
   */
  private readonly close = (): Promise<boolean> =>
    (this.stopped ??= this.closeClient().finally(() => runningApps.delete(this.close)))

  /** The stop under way or done, which a later stop waits for. */
  private stopped?: Promise<boolean>

  /** Ends a `start()` whose login is still in flight when shutdown begins; unset outside the login. */
  private abortLogin?: () => void

  /**
   * Runs an event handler so its failure is logged against the event instead of surfacing as an
   * unhandled rejection, which would terminate the whole bot.
   */
  private async runListener(event: string, run: () => Promise<void>, label = `"${event}"`): Promise<void> {
    const handle = async () => {
      try {
        await run()
      } catch (error) {
        this.logger.error(`Unhandled error while handling "${event}":`, error)
      }
    }
    // A call, which shutdown waits for before the onShutdown hooks; the ready listener's work is not one
    await (event === 'clientReady' ? handle() : this.calls.run(label, handle))
  }

  /** The calls under way, which shutdown waits for, less one that asked the app to stop. */
  private readonly calls = new RunningCalls()

  /** The ready hooks' pass, whose `onReady` in progress shutdown waits for, less one that asked the app to stop. */
  private readonly readyPass = new ReadyPass()

  /** Settles once the cooldown store's `onReady` has, which calls wait for before asking it. */
  private storeReady?: PromiseWithResolvers<void>

  /**
   * Shows the next of the app's activities, in the order listed, starting again after the last. Guarded apart from
   * {@link runListener}: it runs on a timer, where a throw would be an uncaught exception.
   */
  private updateActivity(): void {
    try {
      const activities = this.activities ?? []
      this.bot.user?.setActivity(activities[this.nextActivity++ % activities.length])
    } catch (error) {
      this.logger.error('Could not update the bot activity:', error)
    }
  }

  /**
   * Logs the bot in, as {@link MeoCordApplication.start} describes. The providers, services and event handlers are set
   * up once, or again after a provider's factory failed; a retry after a failed login reuses them.
   */
  async start(): Promise<void> {
    if (isRegisterOnly()) return this.registerOnly()
    if (this.stopped) throw new Error('This app was stopped; use MeoCordFactory.create to make a new one.')
    if (this.online) return
    this.starting ??= this.startOnce()
      .catch(async error => {
        // A failed start leaves the running apps, so a signal later stops only the apps that run; a stopped start stays
        // until its close settles
        if (!this.closing) {
          runningApps.delete(this.close)
          await this.undoStart()
        }
        // A shard ends, for its manager to restart, or to stop all if told it is fatal; a stopped start is the stop's
        if (this.shard && !this.closing) endFailedShard(error)
        throw error
      })
      .finally(() => (this.starting = undefined))
    return this.starting
  }

  /**
   * Stops the bot, as {@link MeoCordApplication.stop} describes. In a shard it asks the manager to stop every shard,
   * which then asks this one too, so the process ends. A client that fails to close sets `process.exitCode` to 1,
   * unless a code is already set.
   */
  async stop(): Promise<void> {
    // A handler or an onReady awaiting stop() would otherwise hold up the shutdown that waits for it
    this.calls.excuseCurrent()
    this.readyPass.excuseCurrent()
    if (this.shard) await tellManager({ meocord: 'stop' })
    // As a signal's shutdown exits 1 for a client that failed to close, a code another failure set aside
    if (!(await this.close()) && !process.exitCode) process.exitCode = 1
  }

  /**
   * Shuts down what a failed start made, by the rule a stop follows, and drops it from the container, so the process
   * holds nothing of it open and a retry makes it afresh.
   */
  private async undoStart(): Promise<void> {
    if (!this.attempt || !this.begun) return
    this.begun = false
    const { given, constructed } = this.attempt
    const entries = this.shutdownEntries().filter(({ token }) => !given.has(token))
    // A value the app gave stays constructed, so a stop with no retry still closes it
    for (const token of constructed) if (!given.has(token)) constructed.delete(token)
    this.readySettled.clear()
    this.attempt.drop()
    this.made = false
    // Nothing came online, so no call runs and no listener needs removing
    await runShutdownSequence(this.container, () => entries, {
      drainCalls: () => this.calls.settled(),
      timeoutMs: this.shutdownTimeout,
      hookFailed: (name, error) => this.logger.error(`onShutdown failed in ${name}:`, error),
      warn: message => this.logger.warn(message),
    })
  }

  /** Whether a start has marked where it began and not been undone, so a failed one drops what it made exactly once. */
  private begun = false

  /** The `start()` under way, which a concurrent call waits for. */
  private starting?: Promise<void>

  /** Whether this start's providers and services are made; a failed start drops them, so a retry makes them again. */
  private made = false

  /** Whether the Discord event handlers are attached, once for the app: they resolve what they run as each event comes. */
  private attached = false

  /** Whether the bot logged in, after which `start()` has nothing to do. */
  private online = false

  private async startOnce(): Promise<void> {
    this.logger.log('Starting bot...')
    // Before the providers are made, so a signal, or a shard's manager, can stop a start that is slow to come online
    runningApps.add(this.close)
    installSignalHandlers(this.shard)
    // A shard whose manager is already gone has no one to answer to, and nothing would stop it later
    if (this.shard && managerGone()) void shutdownAndExit(this.shard)
    // A bot runs one app, whose theme code outside any call reads, its providers' factories included; claimed for
    // each start, as a failed one gives it up
    claimAmbientAppTheme(this.container)
    if (!this.made) {
      this.attempt?.begin()
      this.begun = true
      // Kept while it runs, so a stop meanwhile waits for it
      this.preparing = this.prepare()
      try {
        await this.preparing
      } finally {
        this.preparing = undefined
      }
      this.made = true
    }
    if (!this.attached) {
      this.attachHandlers()
      this.attached = true
    }
    if (this.loginFailed) {
      warnDeprecatedBehaviour(this.logger, 'Retrying start() after a failed login', 'rejects', 'MeoCordFactory.create to make a new app')
      undoFailedLogin(this.bot)
    }
    await this.login()
  }

  /** Whether a login of this app failed, so a retry restores the client discord.js destroyed. */
  private loginFailed = false

  /** The providers and services being made, which a stop waits for; unset outside it. */
  private preparing?: Promise<void>

  /** The provider factory the startup awaits, by its token's name, for a stop that outlasts it to name. */
  private pendingProvider?: string

  /** Makes the provided values and listed services. */
  private async prepare(): Promise<void> {
    // Every provided value is made before anything that injects it is resolved, and before login
    if (this.startup) {
      try {
        await this.startup({ stopped: () => this.closing, pending: name => (this.pendingProvider = name) })
      } catch (error) {
        releaseAmbientAppTheme(this.container)
        if (process.exitCode === undefined || process.exitCode === 0) {
          process.exitCode = 1
          processState.startFailureSetExitCode = true
        }
        throw error
      }
    }
    // A stop that came while the providers were being made has waited for them, and the startup made no more after it;
    // nothing is attached or logged in
    if (this.closing) throw stoppedBeforeOnline()

    // Calls wait for the store's onReady, which may connect it, before asking it
    if (this.lifecycleUnits.some(unit => unit.cooldownStore)) {
      this.storeReady = Promise.withResolvers<void>()
      waitForCooldownStore(this.container, this.storeReady.promise)
    }
  }

  /** Attaches the Discord event handlers. */
  private attachHandlers(): void {
    this.bot.on('clientReady', readyClient =>
      this.runListener('clientReady', async () => {
        // Only for activities the app listed: without them, a status it sets itself stays as it set it
        if (this.activities?.length) {
          this.updateActivity()
          this.activityInterval ??= setInterval(() => this.updateActivity(), 10000)
        }
        // Started before registration and not waited on by it, so a slow or failed registration never holds them up
        const readyHooks = this.runReadyHooks((readyClient ?? this.bot) as Client<true>)
        // With process sharding, the manager registers once for every shard
        if (!this.shard) await this.registerCommands()
        await readyHooks
      }),
    )

    this.bot.on(
      'interactionCreate',
      ownInteractionListener(interaction =>
        this.runListener('interactionCreate', () => this.dispatcher.interaction(interaction), interactionLabel(interaction)),
      ),
    )

    this.bot.on('messageCreate', message => this.runListener('messageCreate', () => this.dispatcher.message(message)))

    this.bot.on('messageReactionAdd', (reaction, user) =>
      this.runListener('messageReactionAdd', () =>
        this.dispatcher.reaction(reaction, { user, action: ReactionHandlerAction.ADD }),
      ),
    )

    this.bot.on('messageReactionRemove', (reaction, user) =>
      this.runListener('messageReactionRemove', () =>
        this.dispatcher.reaction(reaction, { user, action: ReactionHandlerAction.REMOVE }),
      ),
    )
    // discord.js drops a reaction in a DM channel it has not cached; this fetches the channel and delivers it
    deliverUncachedDmReactions(this.bot, this.logger)

    const sources = this.eventSources()
    this.attachEventHandlers(sources)
    this.warnAboutMissingRequirements(sources)
    this.noteGlobalStagesOnEvents(sources)
  }

  /** Logs the bot in, setting the exit code when that fails and clearing it when a later attempt succeeds. */
  private async login(): Promise<void> {
    // Checked here as well, after the last await before the login: from here to setting abortLogin runs in one turn,
    // so a stop either comes before and ends the start, or comes after and ends the login
    if (this.closing) throw stoppedBeforeOnline()
    const login = this.bot.login(this.discordToken)
    const stopped = new Promise<never>((_, reject) => {
      this.abortLogin = () => {
        // discord.js's destroy() never settles during the gateway handshake, so the client is closed once login has
        login.then(() => this.bot.destroy()).catch(() => undefined)
        reject(stoppedBeforeOnline())
      }
    })
    try {
      await Promise.race([login, stopped])
    } catch (error) {
      if (this.closing) throw error
      // A bot that never came online is not the app whose theme is read outside calls
      releaseAmbientAppTheme(this.container)
      const fatal = fatalLoginCode(error)
      // Read only for a failure that needs them: a hand-built client in a test may have no options
      const explanation = fatal && explainLoginFailure(fatal, this.bot.options?.intents, this.discordToken)
      if (explanation) {
        // The explanation is what to act on, and the stack only for debugging. A shard's manager logs it instead.
        if (!this.shard) this.logger.error(explanation)
        this.logger.debug('Login failed:', error)
        markExplained(error)
      }
      if (fatal) await reportFatalLogin(this.shard, fatal, explanation ?? (error instanceof Error ? error.message : String(error)))
      if (process.exitCode === undefined || process.exitCode === 0) {
        process.exitCode = 1
        processState.startFailureSetExitCode = true
      }
      await tellDevRunner({ meocord: 'login-failed' }, this.shard)
      processState.toldDevRunnerLoginFailed = true
      this.loginFailed = true
      throw error
    } finally {
      this.abortLogin = undefined
    }
    // A shutdown that began as the login completed has the client to close; the bot is not reported online
    if (this.closing) throw stoppedBeforeOnline()
    // 0 rather than undefined, which Bun ignores
    if (processState.startFailureSetExitCode && process.exitCode === 1) {
      process.exitCode = 0
      processState.startFailureSetExitCode = false
    }
    if (processState.toldDevRunnerLoginFailed) {
      processState.toldDevRunnerLoginFailed = false
      await tellDevRunner({ meocord: 'online' }, this.shard)
    }
    this.online = true
    this.logger.log('Bot is online!')
  }

  /**
   * Registers the application's commands with Discord, where `meocord.config.ts`'s `commands` says. Runs once the bot
   * is ready, except in a shard, whose manager registers. Called before the bot is online, it logs a warning and
   * registers nothing, as the application comes from the login. It never throws: a failure is logged and the bot stays
   * online.
   */
  async registerCommands(): Promise<void> {
    // discord.js sets the application when the gateway's READY arrives
    const applicationId = this.bot.application?.id
    if (!applicationId) {
      this.logger.warn(
        'registerCommands() registers nothing before the bot is online, as Discord names the application at login. ' +
          'The bot registers once it is online; to register without logging in, run `meocord register`.',
      )
      return
    }

    const config = loadMeoCordConfig()?.commands
    if (config?.register === false) {
      this.logger.log('Command registration is off (commands.register: false); run `meocord register` to register.')
      return
    }

    await registerCommands({
      rest: this.bot.rest,
      applicationId,
      controllerClasses: this.controllerClasses,
      logger: this.logger,
      config,
      development: registersAsDevelopment(),
      force: process.env[FORCE_REGISTER_ENV] === '1',
    })
  }

  /**
   * Registers the commands over REST without logging in, as `meocord register` asks, and exits: `0`
   * when every scope registered, `1` otherwise.
   */
  private async registerOnly(): Promise<never> {
    if (!this.discordToken?.trim()) {
      this.logger.error(tokenMessage(this.discordToken))
      process.exit(1)
    }
    const rest = new REST().setToken(this.discordToken)
    let applicationId: string

    try {
      applicationId = ((await rest.get(Routes.currentApplication())) as { id: string }).id
    } catch (error) {
      if (isRefusedToken(error)) {
        this.logger.error(tokenMessage(this.discordToken))
        this.logger.debug('Reading the application failed:', error)
      } else {
        this.logger.error('Could not read the application the token belongs to; check discordToken:', error)
      }
      process.exit(1)
    }

    const registered = await registerCommands({
      rest,
      applicationId,
      controllerClasses: this.controllerClasses,
      logger: this.logger,
      config: loadMeoCordConfig()?.commands,
      development: registersAsDevelopment(),
      onlyGuild: process.env[REGISTER_GUILD_ENV],
      force: true,
    })
    process.exit(registered ? 0 : 1)
  }

  /**
   * Adds a client listener for every `@On` and `@Once` handler on each instance whose lifecycle hooks run, in lifecycle
   * order, each event run on the instance the container holds. Each call is isolated: an error is logged against the
   * event and the handler, and the next listener still runs.
   */
  private attachEventHandlers(sources: readonly EventSource[]): void {
    for (const source of sources) {
      const { name } = source.cls
      for (const { event, method, once } of source.handlers) {
        const logError = (error: unknown) => this.logger.error(`Error handling event "${event}" in ${name}.${method}:`, error)
        // An error no filter handles is logged, with the handler. A guard denying an event only filters which
        // events the handler takes, and a UserError is meant for the sender of the event's message, if it has one
        const fallback: Fallback = async (error, context) => {
          const where = `event "${event}" in ${name}.${method}`
          if (error instanceof GuardDeniedError) this.logger.debug(`Denied ${where}: ${escapeForLog(error.message)}`)
          else if (error instanceof UserError) {
            this.logger.debug(`Refused ${where}: ${escapeForLog(error.message)}`)
            // The newest message the event carries: an edit's new message, not its old one
            const message = [...context.getArgs()].reverse().find((arg): arg is Message => arg instanceof Message)
            if (message) return replyWithUserError(message, error, this.logger, this.messageOptions?.replyEmoji)
          } else logError(error)
          return undefined
        }
        const label = `@${once ? 'Once' : 'On'}('${event}') in ${name}.${method}`
        // A call, as a dispatched one is, which shutdown waits for
        const listener = (...args: unknown[]) =>
          this.calls.run(label, async () => {
            try {
              const instance = source.resolve()
              if (instance) await runHandler(this.container, instance, method, args, { fallback, type: 'event' })
            } catch (error) {
              // Only resolving the instance can fail here; the pipeline hands every other error to the fallback
              logError(error)
            }
          })
        if (once) this.bot.once(event, listener)
        else this.bot.on(event, listener)
      }
    }
  }

  /**
   * Says, once per stage, which global guards and interceptors declare no `types` and so also run
   * before `@On` and `@Once` handlers, when the app has any.
   */
  private noteGlobalStagesOnEvents(sources: readonly EventSource[]): void {
    if (sources.length === 0) return

    const { guards, interceptors } = globalStagesOf(this.container)
    for (const [label, decorator, entries] of [
      ['guard', 'Guard', guards],
      ['interceptor', 'Interceptor', interceptors],
    ] as const) {
      for (const entry of entries) {
        if (stageTypes(entry)) continue
        this.logger.info(
          `Global ${label} ${stageClass(entry).name} also runs on gateway events; declare ` +
            `@${decorator}({ types: [...] }) to limit it.`,
        )
      }
    }
  }

  /**
   * Warns about handlers whose events the client options will not deliver, once per missing intent or partial. Only a
   * controller's message and reaction handlers are counted, as only those run.
   */
  private warnAboutMissingRequirements(sources: readonly EventSource[]): void {
    const options = this.bot.options
    if (!options?.intents) return

    const handlers: RequiringHandler[] = []
    for (const { cls, handlers: events } of sources) {
      for (const { event, method, once } of events) {
        handlers.push({ label: `@${once ? 'Once' : 'On'}('${event}') in ${cls.name}.${method}`, requirements: eventRequirements(event) })
      }
    }
    for (const controller of this.controllerClasses) {
      const prototype = controller.prototype as object
      for (const handler of getMessageHandlers(prototype)) {
        handlers.push({
          label: `${messageDecorator(handler.pattern)} in ${controller.name}.${handler.method}`,
          requirements: messageHandlerRequirements(handler, this.messageOptions ?? {}),
        })
      }
      for (const { emoji, method } of getReactionHandlers(prototype)) {
        handlers.push({ label: `${reactionDecorator(emoji)} in ${controller.name}.${method}`, requirements: REACTION_HANDLER_REQUIREMENTS })
      }
    }

    for (const warning of missingRequirementWarnings(options, handlers)) this.logger.warn(warning)
  }

  /**
   * Resolves every lifecycle unit, provided values and the cooldown store included, and runs their `onReady` hooks one
   * at a time, in dependency order. A failure is logged and the next one still runs, with a warning for each hook
   * whose dependencies failed. Once shutdown begins, no further hook starts.
   */
  private async runReadyHooks(client: Client<true>): Promise<void> {
    await this.readyPass.run(() => runReadyHooks(
      this.container,
      this.lifecycleUnits,
      client,
      { primary: client.shard ? client.shard.ids.includes(0) : true },
      {
        resolveFailed: (unit, error) => this.logger.error(`Could not resolve ${unit.name} to run its lifecycle hooks:`, error),
        hookFailed: (unit, error) => this.logger.error(`onReady failed in ${unit.name}:`, error),
        dependsOnFailed: (unit, failed) =>
          this.logger.warn(`Running onReady in ${unit.name} although it depends on ${failed.map(({ name }) => name).join(', ')}, which failed.`),
        slow: unit => this.logger.warn(`onReady in ${unit.name} has run for over ${SLOW_READY_HOOK_MS} ms; the hooks after it are waiting.`),
      },
      // Shutdown has begun: the client is going away, so no further hook starts
      {
        stopped: () => this.closing,
        slowAfterMs: SLOW_READY_HOOK_MS,
        settled: unit => {
          this.readySettled.add(unit.token)
          if (unit.cooldownStore) this.storeReady?.resolve()
        },
        runOnReady: this.readyPass.runOnReady,
      },
    ))
    // Also when shutdown stopped the hooks before the store's, so no call waits on it
    this.storeReady?.resolve()
  }

  /**
   * The units a shutdown closes: each one the container constructed whose `onReady`, and that of every unit it depends
   * on, has settled or doesn't exist, in dependency order. A unit whose `onReady` never ran gets no `onShutdown`, so a
   * hook that undoes `onReady` never runs without it, and neither does anything that depends on it.
   */
  private shutdownEntries(): LifecycleEntry[] {
    const units = new Set(this.lifecycleUnits.map(({ token }) => token))
    const closes = new Set<unknown>()
    const entries: LifecycleEntry[] = []
    for (const unit of this.lifecycleUnits) {
      if (!this.attempt?.constructed.has(unit.token)) continue
      // Already made, so this returns the instance; a provided value may be anything, null included
      const instance = (this.container.get(unit.token as ServiceIdentifier) as LifecycleEntry['instance'] | null) ?? {}
      const ready = typeof instance.onReady !== 'function' || this.readySettled.has(unit.token)
      if (!ready || unit.dependencies.some(dependency => units.has(dependency) && !closes.has(dependency))) continue
      closes.add(unit.token)
      entries.push(lifecycleEntry(unit, instance))
    }
    return entries
  }

  /** Runs the `onShutdown` hooks through the shutdown sequence, within the configured `shutdownTimeout`. */
  private async runShutdownHooks(): Promise<void> {
    // Read once the onReady in progress settled
    await runShutdownSequence(this.container, () => this.shutdownEntries(), {
      // No new call starts once the listeners are gone; an error the client emits meanwhile still has its listeners
      drainCalls: () => {
        const emitter: EventEmitter = this.bot
        for (const event of emitter.eventNames()) if (event !== 'error') emitter.removeAllListeners(event)
        return this.calls.settled()
      },
      drainAlways: true,
      runningCalls: () => this.calls.running(),
      readyPass: this.readyPass,
      timeoutMs: this.shutdownTimeout,
      hookFailed: (name, error) => this.logger.error(`onShutdown failed in ${name}:`, error),
      warn: message => this.logger.warn(message),
    })
  }

  /**
   * Runs the shutdown hooks, if the ready hooks ran, then destroys the client; a stop during login ends the login.
   *
   * @returns Whether the client closed cleanly, which an ended login counts as, and the startup it waited for, if any,
   * did not fail.
   */
  private async closeClient(): Promise<boolean> {
    this.closing = true
    try {
      return await this.shutDownClient()
    } finally {
      // Given up last, so the calls under way and the onShutdown hooks still read the app's theme
      releaseAmbientAppTheme(this.container)
    }
  }

  /**
   * Waits for the startup under way to stop making providers and services, at most `shutdownTimeout`; past it, warns
   * with the factory it still awaits, which then makes nothing more.
   *
   * @returns Whether the startup failed meanwhile, as a provider's factory that rejects does, rather than stopping.
   */
  private async waitForStartup(preparing: Promise<void>): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const outlasted = new Promise<'outlasted'>(resolve => {
      timer = setTimeout(() => resolve('outlasted'), this.shutdownTimeout)
    })
    const settled = preparing.then(
      () => 'stopped' as const,
      (error: unknown) => (error instanceof Error && stops.has(error) ? 'stopped' : 'failed'),
    )
    const outcome = await Promise.race([settled, outlasted])
    clearTimeout(timer)
    if (outcome === 'outlasted') {
      const what = this.pendingProvider ? `the factory providing ${this.pendingProvider}` : 'its providers'
      this.logger.warn(`The startup still waits for ${what} after ${this.shutdownTimeout} ms; shutting down without it.`)
    }
    return outcome === 'failed'
  }

  private async shutDownClient(): Promise<boolean> {
    this.logger.log('Shutting down bot...')
    // So nothing is made after the bot has shut down; a factory that fails meanwhile is a failure of the stop too
    const startupFailed = this.preparing !== undefined && (await this.waitForStartup(this.preparing))

    // Nothing came online, so no onReady ran; the listeners go first, so none of them runs, then what the start made
    // without an onReady to wait for shuts down
    if (this.abortLogin) {
      this.logger.log('The bot was still logging in, so it stops without coming online')
      this.bot.removeAllListeners()
      this.abortLogin()
      await this.runShutdownHooks()
      this.logger.log('Bot has shut down')
      return true
    }

    if (this.activityInterval) clearInterval(this.activityInterval)

    // The calls drain on every shutdown, and the onReady in progress settles first
    await this.runShutdownHooks()

    try {
      this.bot.removeAllListeners()
      await this.bot.destroy()
      this.logger.log('Bot has shut down')
      return !startupFailed
    } catch (error) {
      this.logger.error('Error during shutdown:', error)
      return false
    }
  }
}
