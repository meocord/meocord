import {
  type ActivityOptions,
  Client,
  Message,
  REST,
  Routes,
} from 'discord.js'
import { type Container } from 'inversify'
import { Logger } from '@src/common/index.js'
import { hideInLogs } from '@src/common/logger.js'
import {
  getMessageHandlers,
  getReactionHandlers,
} from '@src/decorator/controller.decorator.js'
import { sample } from 'lodash-es'


import { ReactionHandlerAction } from '@src/enum/controller.enum.js'
import { type MessageCommandOptions } from '@src/interface/index.js'


import { globalStagesOf, runHandler } from '@src/core/handler-pipeline.js'
import { createFallback, type Fallback, replyWithUserError } from '@src/core/fallback.js'
import { claimCooldownNotice } from '@src/core/cooldown-runner.js'


import { stageClass, stageTypes } from '@src/core/stage-scope.js'
import { getEventHandlers } from '@src/decorator/event.decorator.js'
import {
  eventRequirements,
  messageHandlerRequirements,
  missingRequirementWarnings,
  REACTION_HANDLER_REQUIREMENTS,
  type RequiringHandler,
} from '@src/core/event-requirements.js'
import { classUnits, type LifecycleUnit } from '@src/core/lifecycle-order.js'
import { waitForCooldownStore } from '@src/core/cooldown-runner.js'
import { type LifecycleEntry, runReadyHooks, runShutdownHooks } from '@src/core/lifecycle-hooks.js'
import { type MeoCordApplication } from '@src/interface/index.js'
import { stopRequests } from '@src/util/stop-request.util.js'
import { tellDevRunner } from '@src/util/dev-runner.util.js'
import { explainLoginFailure, type FatalLoginCode, fatalLoginCode, isRefusedToken, tokenMessage } from '@src/core/login-failure.js'
import { markExplained } from '@src/common/explained-error.js'
import { warnDeprecatedBehaviour } from '@src/common/deprecation.js'
import { GuardDeniedError, UserError } from '@src/common/errors.js'
import { isShardProcess, managerGone } from '@src/util/sharding-mode.util.js'
import { endFailedShard, tellManager } from '@src/core/shard-exit.js'
import { isShardMessage } from '@src/core/shard-messages.js'
import { releaseAmbientAppTheme } from '@src/core/theme-runtime.js'
import { registerCommands } from '@src/core/command-registration.js'
import { undoFailedLogin } from '@src/core/failed-login.js'
import { Dispatcher, ownInteractionListener } from '@src/core/dispatcher.js'
import { loadMeoCordConfig } from '@src/util/meocord-config-loader.util.js'
import { FORCE_REGISTER_ENV, isRegisterOnly, REGISTER_GUILD_ENV } from '@src/util/registration-mode.util.js'
import { DEFAULT_SHUTDOWN_TIMEOUT_MS } from '@src/util/shutdown-timeout.util.js'
import { escapeForLog } from '@src/util/user-text.util.js'

/** How long an `onReady` hook runs before a warning says the hooks after it are waiting. */
export const SLOW_READY_HOOK_MS = 10_000

type LifecycleClass = new (...args: any[]) => any

/** A resolved controller, service or provided value, with its name for logs. */
/** Closes each started app: runs its shutdown hooks and destroys its client, resolving `false` on failure. */
const runningApps = new Set<() => Promise<boolean>>()
const stopRequest = stopRequests()
let signalHandlersInstalled = false

/**
 * Shuts every started app down and exits: `onShutdown` hooks under the configured `shutdownTimeout`,
 * then `destroy()`, then exit 0, or 1 if a client failed to close. SIGINT and SIGTERM call it, and so
 * does a shard its manager tells to stop. A call within `REPEAT_SIGNAL_WINDOW_MS` of the first is the
 * same request; one after it forces exit 1.
 */
export async function shutdownAndExit(): Promise<void> {
  const request = stopRequest()
  if (request !== 'first') {
    // A shard hears Ctrl+C both directly and from its manager, which owns forcing it; so it waits
    if (request === 'duplicate' || isShardProcess()) return
    process.exit(1)
    return
  }

  const closed = await Promise.all([...runningApps].map(close => close()))
  // A clean stop keeps a code already set, such as the 1 a failed login set, so a supervisor still sees it
  process.exit(closed.every(Boolean) ? Number(process.exitCode ?? 0) || 0 : 1)
}

/** What `start()` rejects with when shutdown begins before the bot came online, which shutdown has logged. */
function stoppedBeforeOnline(): Error {
  const error = new Error('The bot was stopped before it came online.')
  markExplained(error)
  return error
}

/** One pair of signal listeners for the process, however many apps it starts. */
function installSignalHandlers(): void {
  if (signalHandlersInstalled) return
  signalHandlersInstalled = true
  process.on('SIGINT', () => void shutdownAndExit())
  process.on('SIGTERM', () => void shutdownAndExit())

  // A shard stops when its manager asks, or when the manager is gone and cannot ask
  if (isShardProcess()) {
    process.on('message', message => {
      if (isShardMessage(message) && message.meocord === 'shutdown') void shutdownAndExit()
    })
    process.on('disconnect', () => void shutdownAndExit())
  }
}

/** Tells the manager a shard cannot log in, and why, and waits until the message is sent. */
async function reportFatalLogin(code: FatalLoginCode, reason: string): Promise<void> {
  if (isShardProcess()) await tellManager({ meocord: 'fatal', code, message: reason })
}

export class MeoCordApp implements MeoCordApplication {
  private readonly logger = new Logger(MeoCordApp.name)
  private readonly fallback: Fallback = createFallback(this.logger, () => this.messageOptions, {
    cooldownNotice: refusal => claimCooldownNotice(this.container, refusal),
  })
  private readonly bot: Client
  private activityInterval: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly controllerClasses: (new (...args: any[]) => any)[],
    private readonly container: Container,
    private readonly discordClient: Client,
    private discordToken: string,
    private activities?: ActivityOptions[],
    private readonly lifecycleClasses: LifecycleClass[] = [],
    shutdownTimeout?: number,
    private readonly startup?: () => Promise<void>,
    lifecycleUnits?: LifecycleUnit[],
    private readonly messageOptions: MessageCommandOptions = {},
    warnUnanswered = false,
  ) {
    // First, so nothing logged from here on, before login or after, prints it
    hideInLogs(discordToken)
    this.lifecycleUnits = lifecycleUnits ?? classUnits(container, lifecycleClasses)
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
    this.shutdownTimeout =
      typeof shutdownTimeout === 'number' && shutdownTimeout >= 0 ? shutdownTimeout : DEFAULT_SHUTDOWN_TIMEOUT_MS
  }

  /** Everything whose lifecycle hooks run, classes and provided values, in dependency order. */
  private readonly lifecycleUnits: LifecycleUnit[]

  /** Routes interactions, messages and reactions to their handlers. */
  private readonly dispatcher: Dispatcher

  /** Whether shutdown has begun, so the ready hooks start no more. */
  private closing = false

  /** How long shutdown waits for the `onShutdown` hooks, from `shutdownTimeout` in the config. */
  private readonly shutdownTimeout: number

  /** The resolved instances whose hooks ran at ready, so shutdown calls the same ones; `undefined` before ready. */
  private lifecycleEntries?: LifecycleEntry[]

  /** Closes the app once, however many stops and signals ask: whether the client was destroyed cleanly. */
  private readonly close = (): Promise<boolean> => (this.stopped ??= this.closeClient())

  /** The stop under way or done, which a later stop waits for. */
  private stopped?: Promise<boolean>

  /** Ends a `start()` whose login is still in flight when shutdown begins; unset outside the login. */
  private abortLogin?: () => void

  /**
   * Runs an event handler so its failure is logged against the event instead of surfacing as an
   * unhandled rejection, which would terminate the whole bot.
   */
  private async runListener(event: string, run: () => Promise<void>): Promise<void> {
    const handled = (async () => {
      try {
        await run()
      } catch (error) {
        this.logger.error(`Unhandled error while handling "${event}":`, error)
      }
    })()
    // A call, which the cooldown store outlasts at shutdown; the ready listener only runs the hooks
    if (event !== 'clientReady') {
      this.calls.add(handled)
      void handled.then(() => this.calls.delete(handled))
    }
    await handled
  }

  /** The calls under way, each settling once its handling has. */
  private readonly calls = new Set<Promise<void>>()

  /** Settles once the cooldown store's `onReady` has, which calls wait for before asking it. */
  private storeReady?: PromiseWithResolvers<void>

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

  /** Whether a failed login set the process exit code, so a later successful one knows to clear it. */
  private static failedLoginSetExitCode = false

  /** Whether `meocord start --dev` was told the bot could not log in, so a later login tells it the bot is online. */
  private static toldDevRunnerLoginFailed = false

  /**
   * Resolves the app's providers, makes its listed services, registers the Discord event handlers
   * and logs the bot in.
   *
   * If a provider's factory or the login fails, the process exit code is set to `1` before the
   * promise rejects, so the process exits non-zero even when the caller catches the error to log it.
   * A later `start()` that logs in clears that code again. A shard whose start fails exits 1 once the rejection is
   * handled, so its manager restarts it.
   *
   * The providers, services and event handlers are set up once: a `start()` after a failed one logs in
   * again with them, a call while one is under way waits for it, and a call once the bot is online
   * does nothing.
   *
   * Retrying `start()` after a failed login is deprecated; in the next major version (5.0) it rejects. Use
   * `MeoCordFactory.create` to make a new app instead. A retry after a provider's factory failed stays supported:
   * no login ran, so there is nothing to undo.
   *
   * @returns A promise that resolves once the bot is logged in.
   * @throws The error of a factory that failed, already logged and naming its token, or the login
   *   error, such as an invalid token or Discord being unreachable. A start that `stop()` ends rejects with "The bot
   *   was stopped before it came online.", and a start of an app already stopped with "This app was stopped".
   *   Use `MeoCordFactory.create` to make a new one.
   *
   * @example
   * ```ts
   * const app = MeoCordFactory.create(App)
   * await app.start()
   * ```
   */
  async start(): Promise<void> {
    if (isRegisterOnly()) return this.registerOnly()
    if (this.stopped) throw new Error('This app was stopped; use MeoCordFactory.create to make a new one.')
    if (this.online) return
    this.starting ??= this.startOnce()
      .catch(error => {
        // Its manager restarts a shard once it exits; a start a stop ended is the stop's to finish
        if (isShardProcess() && !this.closing) endFailedShard(error)
        throw error
      })
      .finally(() => (this.starting = undefined))
    return this.starting
  }

  /**
   * Stops the bot without ending the process: runs the `onShutdown` hooks under the configured `shutdownTimeout`, then
   * closes the client. A stop while the bot logs in ends the login, and that `start()` rejects. A call after the first
   * waits for it, and a stopped app does not start again.
   *
   * @returns A promise that resolves once the bot is stopped. It never rejects: a failure to close the client is
   *   logged.
   *
   * @example
   * ```ts
   * await app.stop()
   * ```
   */
  async stop(): Promise<void> {
    await this.close()
  }

  /** The `start()` under way, which a concurrent call waits for. */
  private starting?: Promise<void>

  /** Whether the providers, services and event handlers are set up, which a retry after a failed login reuses. */
  private prepared = false

  /** Whether the bot logged in, after which `start()` has nothing to do. */
  private online = false

  private async startOnce(): Promise<void> {
    this.logger.log('Starting bot...')
    // Before the providers are made, so a signal, or a shard's manager, can stop a start that is slow to come online
    runningApps.add(this.close)
    installSignalHandlers()
    // A shard whose manager is already gone has no one to answer to, and nothing would stop it later
    if (isShardProcess() && managerGone()) void shutdownAndExit()
    if (!this.prepared) {
      await this.prepare()
      this.prepared = true
    }
    if (this.loginFailed) {
      warnDeprecatedBehaviour(this.logger, 'Retrying start() after a failed login', 'rejects', 'MeoCordFactory.create to make a new app')
      undoFailedLogin(this.bot)
    }
    await this.login()
  }

  /** Whether a login of this app failed, so a retry restores the client discord.js destroyed. */
  private loginFailed = false

  /** Makes the provided values and listed services, and attaches the Discord event handlers. */
  private async prepare(): Promise<void> {
    // Every provided value is made before anything that injects it is resolved, and before login
    if (this.startup) {
      try {
        await this.startup()
      } catch (error) {
        releaseAmbientAppTheme(this.container)
        if (process.exitCode === undefined || process.exitCode === 0) {
          process.exitCode = 1
          MeoCordApp.failedLoginSetExitCode = true
        }
        throw error
      }
    }
    // A stop that came while the providers were being made has nothing to close: nothing is attached or logged in
    if (this.closing) throw stoppedBeforeOnline()

    // Calls wait for the store's onReady, which may connect it, before asking it
    if (this.lifecycleUnits.some(unit => unit.cooldownStore)) {
      this.storeReady = Promise.withResolvers<void>()
      waitForCooldownStore(this.container, this.storeReady.promise)
    }

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
        if (!isShardProcess()) await this.registerCommands()
        await readyHooks
      }),
    )

    this.bot.on(
      'interactionCreate',
      ownInteractionListener(interaction => this.runListener('interactionCreate', () => this.dispatcher.interaction(interaction))),
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

    this.attachEventHandlers()
    this.warnAboutMissingRequirements()
    this.noteGlobalStagesOnEvents()
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
      runningApps.delete(this.close)
      // A bot that never came online is not the app whose theme is read outside calls
      releaseAmbientAppTheme(this.container)
      const fatal = fatalLoginCode(error)
      // Read only for a failure that needs them: a hand-built client in a test may have no options
      const explanation = fatal && explainLoginFailure(fatal, this.bot.options?.intents, this.discordToken)
      if (explanation) {
        // The explanation is what to act on, and the stack only for debugging. A shard's manager logs it instead.
        if (!isShardProcess()) this.logger.error(explanation)
        this.logger.debug('Login failed:', error)
        markExplained(error)
      }
      if (fatal) await reportFatalLogin(fatal, explanation ?? (error instanceof Error ? error.message : String(error)))
      if (process.exitCode === undefined || process.exitCode === 0) {
        process.exitCode = 1
        MeoCordApp.failedLoginSetExitCode = true
      }
      await tellDevRunner({ meocord: 'login-failed' })
      MeoCordApp.toldDevRunnerLoginFailed = true
      this.loginFailed = true
      throw error
    } finally {
      this.abortLogin = undefined
    }
    // A shutdown that began as the login completed has the client to close; the bot is not reported online
    if (this.closing) throw stoppedBeforeOnline()
    // 0 rather than undefined, which Bun ignores
    if (MeoCordApp.failedLoginSetExitCode && process.exitCode === 1) {
      process.exitCode = 0
      MeoCordApp.failedLoginSetExitCode = false
    }
    if (MeoCordApp.toldDevRunnerLoginFailed) {
      MeoCordApp.toldDevRunnerLoginFailed = false
      await tellDevRunner({ meocord: 'online' })
    }
    this.online = true
    this.logger.log('Bot is online!')
  }

  /**
   * Registers the application's commands with Discord, where `meocord.config.ts`'s `commands` says.
   *
   * Runs once the bot is ready. It never throws: a failure is logged and the bot stays online.
   */
  async registerCommands(): Promise<void> {
    const applicationId = this.bot.application?.id
    if (!applicationId) return

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
      development: process.env.NODE_ENV === 'development',
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
      development: process.env.NODE_ENV === 'development',
      onlyGuild: process.env[REGISTER_GUILD_ENV],
      force: true,
    })
    process.exit(registered ? 0 : 1)
  }

  /**
   * Adds a client listener for every `@On` and `@Once` handler on the app's controllers and services.
   * The instance is resolved when the first event arrives, and each call is isolated: an error is
   * logged against the event and the handler, and the next listener still runs.
   */
  private attachEventHandlers(): void {
    for (const lifecycleClass of this.lifecycleClasses) {
      for (const { event, method, once } of getEventHandlers(lifecycleClass.prototype)) {
        const logError = (error: unknown) =>
          this.logger.error(`Error handling event "${event}" in ${lifecycleClass.name}.${method}:`, error)
        // An error no filter handles is logged, with the handler. A guard denying an event only filters which
        // events the handler takes, and a UserError is meant for the sender of the event's message, if it has one
        const fallback: Fallback = async (error, context) => {
          const where = `event "${event}" in ${lifecycleClass.name}.${method}`
          if (error instanceof GuardDeniedError) this.logger.debug(`Denied ${where}: ${escapeForLog(error.message)}`)
          else if (error instanceof UserError) {
            this.logger.debug(`Refused ${where}: ${escapeForLog(error.message)}`)
            // The newest message the event carries: an edit's new message, not its old one
            const message = [...context.getArgs()].reverse().find((arg): arg is Message => arg instanceof Message)
            if (message) return replyWithUserError(message, error, this.logger, this.messageOptions?.replyEmoji)
          } else logError(error)
          return undefined
        }
        const listener = async (...args: unknown[]) => {
          try {
            const instance = this.container.get(lifecycleClass)
            await runHandler(this.container, instance, method, args, { fallback, type: 'event' })
          } catch (error) {
            // Only resolving the instance can fail here; the pipeline hands every other error to the fallback
            logError(error)
          }
        }
        if (once) this.bot.once(event, listener)
        else this.bot.on(event, listener)
      }
    }
  }

  /**
   * Says, once per stage, which global guards and interceptors declare no `types` and so also run
   * before `@On` and `@Once` handlers, when the app has any.
   */
  private noteGlobalStagesOnEvents(): void {
    if (!this.lifecycleClasses.some(cls => getEventHandlers(cls.prototype).length > 0)) return

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

  /** Warns about handlers whose events the client options will not deliver, once per missing intent or partial. */
  private warnAboutMissingRequirements(): void {
    const options = this.bot.options
    if (!options?.intents) return

    const handlers: RequiringHandler[] = []
    for (const lifecycleClass of this.lifecycleClasses) {
      const prototype = lifecycleClass.prototype
      for (const { event, method, once } of getEventHandlers(prototype)) {
        handlers.push({
          label: `@${once ? 'Once' : 'On'}('${event}') in ${lifecycleClass.name}.${method}`,
          requirements: eventRequirements(event),
        })
      }
      for (const handler of getMessageHandlers(prototype)) {
        const decorator = handler.pattern === undefined ? '@MessageHandler()' : `@MessageHandler('${handler.pattern}')`
        handlers.push({
          label: `${decorator} in ${lifecycleClass.name}.${handler.method}`,
          requirements: messageHandlerRequirements(handler, this.messageOptions ?? {}),
        })
      }
      for (const { emoji, method } of getReactionHandlers(prototype)) {
        const decorator = emoji === undefined ? '@ReactionHandler()' : `@ReactionHandler('${emoji}')`
        handlers.push({ label: `${decorator} in ${lifecycleClass.name}.${method}`, requirements: REACTION_HANDLER_REQUIREMENTS })
      }
    }

    for (const warning of missingRequirementWarnings(options, handlers)) this.logger.warn(warning)
  }

  /**
   * Resolves every bound controller and service and runs their `onReady` hooks one at a time, in
   * dependency order. A hook that throws is logged and the next one still runs, with a warning for
   * each hook whose dependencies' hooks failed. Once shutdown begins, no further hook starts.
   */
  private async runReadyHooks(client: Client<true>): Promise<void> {
    const entries: LifecycleEntry[] = []
    this.lifecycleEntries = entries
    await runReadyHooks(
      this.container,
      this.lifecycleUnits,
      client,
      { primary: client.shard ? client.shard.ids.includes(0) : true },
      entries,
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
        settled: unit => unit.cooldownStore && this.storeReady?.resolve(),
      },
    )
    // Also when shutdown stopped the hooks before the store's, so no call waits on it
    this.storeReady?.resolve()
  }

  /**
   * Runs the `onShutdown` hooks one at a time in reverse dependency order, each isolated, the cooldown store's
   * last, once no call is left that may ask it, and stops waiting once the whole sequence has run for the
   * configured `shutdownTimeout`.
   */
  private async runShutdownHooks(entries: LifecycleEntry[]): Promise<void> {
    const failed = (name: string, error: unknown) => this.logger.error(`onShutdown failed in ${name}:`, error)
    const hooks = (async () => {
      await runShutdownHooks(
        entries.filter(entry => !entry.cooldownStore),
        failed,
      )
      const store = entries.filter(entry => entry.cooldownStore)
      if (store.length === 0) return
      // The store shuts down after the last call that may ask it: no new one starts, and those under way finish
      this.bot.removeAllListeners()
      await Promise.all(this.calls)
      await runShutdownHooks(store, failed)
    })()

    let timer: ReturnType<typeof setTimeout> | undefined
    const timedOut = new Promise<'timeout'>(resolve => {
      timer = setTimeout(() => resolve('timeout'), this.shutdownTimeout)
    })
    try {
      if ((await Promise.race([hooks, timedOut])) === 'timeout') {
        this.logger.warn(`onShutdown hooks did not finish within ${this.shutdownTimeout} ms; shutting down anyway.`)
      }
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Runs the shutdown hooks, if the ready hooks ran, then destroys the client.
   *
   * @returns Whether the client was destroyed cleanly.
   */
  private async closeClient(): Promise<boolean> {
    this.closing = true
    runningApps.delete(this.close)
    releaseAmbientAppTheme(this.container)
    this.logger.log('Shutting down bot...')

    // Nothing came online, so there are no hooks to undo; the listeners go first, so none of them runs
    if (this.abortLogin) {
      this.logger.log('The bot was still logging in, so it stops without coming online')
      this.bot.removeAllListeners()
      this.abortLogin()
      this.logger.log('Bot has shut down')
      return true
    }

    if (this.activityInterval) clearInterval(this.activityInterval)

    // A login that failed never ran onReady, so there is nothing for onShutdown to undo
    if (this.lifecycleEntries) await this.runShutdownHooks(this.lifecycleEntries)

    try {
      this.bot.removeAllListeners()
      await this.bot.destroy()
      this.logger.log('Bot has shut down')
      return true
    } catch (error) {
      this.logger.error('Error during shutdown:', error)
      return false
    }
  }
}
