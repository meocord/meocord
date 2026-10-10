import { fetchRecommendedShardCount, REST, Routes, type Shard, ShardingManager, type ShardingManagerOptions } from 'discord.js'
import { type ChildProcess } from 'node:child_process'
import { Logger } from '@src/common/index.js'
import { hideInLogs } from '@src/common/logger.js'
import { MemoryCooldownStore } from '@src/common/cooldown-store.js'
import { answerCooldown } from '@src/common/sharded-cooldown-store.js'
import { registerCommands, type RegistrationRest } from '@src/core/command-registration.js'
import { type MeoCordApplication } from '@src/interface/index.js'
import { SHUTDOWN_MARGIN_MS, shutdownTimeoutOf } from '@src/util/shutdown-timeout.util.js'
import { type MeoCordConfig } from '@src/interface/index.js'
import { bundleEntry } from '@src/util/bundle-entry.util.js'
import { FORCE_REGISTER_ENV } from '@src/util/registration-mode.util.js'
import { isShardMessage, REFUSED_CODE, type ShardMessage } from '@src/core/shard-messages.js'
import { isRefusedToken, tokenMessage } from '@src/core/login-failure.js'
import { onDevRunnerStop, tellDevRunner, underDevRunner } from '@src/util/dev-runner.util.js'
import { stopRequests } from '@src/util/stop-request.util.js'


/** How long the manager waits for a shard to become ready before spawning the next. */
export const SHARD_READY_TIMEOUT_MS = 30_000
/** The pause between spawning two shards, as Discord's identify rate limit asks. */
export const SHARD_SPAWN_DELAY_MS = 5_500
/** The first respawn delay, doubled for each exit in a row. */
export const RESPAWN_BASE_MS = 1_000
/** The longest respawn delay. */
export const RESPAWN_CAP_MS = 60_000
/** How long a shard must stay up before its respawn delay starts from the beginning again. */
export const RESPAWN_RESET_MS = 5 * 60_000

/** What the manager needs from its environment; tests replace the parts that start processes or exit. */
export interface ShardManagerOptions {
  controllerClasses: (new (...args: any[]) => unknown)[]
  token: string
  config: MeoCordConfig
  createManager?: (file: string, options: ShardingManagerOptions) => ShardingManager
  createRest?: (token: string) => RegistrationRest
  recommendedShardCount?: (token: string) => Promise<number>
  exit?: (code: number) => void
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

interface ShardState {
  attempts: number
  spawnedAt: number
  timer?: ReturnType<typeof setTimeout>
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/**
 * Runs a bot in process sharding: registers its commands once, spawns one process per shard from the built bundle,
 * restarts a shard that exits, and stops them all on SIGINT or SIGTERM, a stop from `meocord start --dev`, or a shard's
 * `stop()`.
 */
export class ShardManager implements MeoCordApplication {
  private readonly logger = new Logger('ShardManager')
  private readonly shards = new Map<Shard, ShardState>()
  /** Every shard's cooldown calls, for an app whose store is ShardedCooldownStore. */
  private readonly cooldowns = new MemoryCooldownStore()
  private stopping = false
  private fatal = false
  private readonly exit: (code: number) => void
  private readonly sleep: (ms: number) => Promise<void>
  private readonly now: () => number
  private readonly stopRequest: ReturnType<typeof stopRequests>
  /** How long each shard has to shut down, before the manager's margin: read, and warned about, once. */
  private readonly shutdownTimeout: number
  /**
   * Whether `meocord start --dev` runs the manager, decided before discord.js's ShardingManager, which writes the
   * variable that marks a shard into this process too.
   */
  private readonly devRunner = underDevRunner(false)

  constructor(private readonly options: ShardManagerOptions) {
    // The manager holds the credential for its shards and logs their failures, without an app of its own to register it
    hideInLogs(options.token)
    this.exit = options.exit ?? (code => process.exit(code))
    this.sleep = options.sleep ?? sleep
    this.now = options.now ?? (() => Date.now())
    this.stopRequest = stopRequests(this.now)
    this.shutdownTimeout = shutdownTimeoutOf(options.config.shutdownTimeout, message => this.logger.warn(message))
  }

  /**
   * Registers the commands, then spawns every shard in turn, waiting for each to be ready. Resolves
   * once each has been spawned; a shard that fails is restarted in the background.
   */
  async start(): Promise<void> {
    if (this.shuttingDown) throw new Error('This app was stopped; use MeoCordFactory.create to make a new one.')
    // Once: a second call, at once or later, waits for the first rather than registering and spawning again
    return (this.starting ??= this.startOnce())
  }

  /** The start under way or done, which a later call waits for. */
  private starting?: Promise<void>

  private async startOnce(): Promise<void> {
    const { token, config } = this.options
    if (!token?.trim()) {
      this.logger.error(tokenMessage(token))
      return this.exitForLogin()
    }
    // First, so a bot that cannot spawn a shard registers no commands and asks Discord nothing
    const file = bundleEntry()
    if (!file) {
      this.logger.error('Could not find the built bundle to start the shards from. Start the bot with its file, such as `node dist/main.js`.')
      return this.exit(1)
    }
    this.logger.log('Starting shards in separate processes...')
    if (!(await this.register())) return this.exitForLogin()

    process.on('SIGINT', () => void this.stopAndExit())
    process.on('SIGTERM', () => void this.stopAndExit())
    // How `meocord start --dev` stops the bot to restart it; no stop request of the user's, whose first Ctrl+C joins it
    onDevRunnerStop(() => void this.exitAfterShutdown(), false)

    let total: number
    try {
      const shards = config.sharding?.shards ?? 'auto'
      total = shards === 'auto' ? await (this.options.recommendedShardCount ?? fetchRecommendedShardCount)(token) : shards
    } catch (error) {
      if (isRefusedToken(error)) {
        this.logger.error(tokenMessage(token))
        this.logger.debug('Asking for the shard count failed:', error)
      } else {
        this.logger.error('Could not ask Discord how many shards to run; check discordToken:', error)
      }
      return this.exitForLogin()
    }

    const manager = (this.options.createManager ?? ((path, opts) => new ShardingManager(path, opts)))(file, {
      token,
      totalShards: total,
      // discord.js refuses a call to every shard unless shardList counts the shards; createShard leaves it 'auto'
      shardList: [...Array(total).keys()],
      mode: 'process',
      execArgv: process.execArgv,
      respawn: false,
    })

    for (let id = 0; id < total && !this.stopping && !this.fatal; id++) {
      const shard = manager.createShard(id)
      this.watch(shard)
      await this.spawn(shard)
      if (id < total - 1) await this.sleep(SHARD_SPAWN_DELAY_MS)
    }
  }

  /**
   * Registers the commands over REST, once for every shard. A failure is logged, a token Discord refused included; it
   * starts no shard, and `start()` is what goes on without the commands or stops for a refused token.
   */
  async registerCommands(): Promise<void> {
    await this.register()
  }

  /** Registers the commands, resolving `false` when Discord refused the token. */
  private async register(): Promise<boolean> {
    const { token, config, controllerClasses } = this.options
    if (config.commands?.register === false) {
      this.logger.log('Command registration is off (commands.register: false); run `meocord register` to register.')
      return true
    }

    try {
      const rest = this.options.createRest?.(token) ?? new REST().setToken(token)
      const applicationId = ((await rest.get(Routes.currentApplication())) as { id: string }).id
      await registerCommands({
        rest,
        applicationId,
        controllerClasses,
        logger: this.logger,
        config: config.commands,
        development: process.env.NODE_ENV === 'development',
        force: process.env[FORCE_REGISTER_ENV] === '1',
      })
    } catch (error) {
      if (isRefusedToken(error)) {
        this.logger.error(tokenMessage(token))
        this.logger.debug('Registering the commands failed:', error)
        return false
      }
      this.logger.error('Could not register the commands; starting the shards anyway:', error)
    }
    return true
  }

  private watch(shard: Shard): void {
    this.shards.set(shard, { attempts: 0, spawnedAt: 0 })
    shard.on('message', (message: unknown) => {
      if (answerCooldown(this.cooldowns, message, reply => shard.send(reply).catch(() => undefined))) return
      if (isShardMessage(message) && message.meocord === 'fatal') this.stopForFatal(shard, message)
      if (isShardMessage(message) && message.meocord === 'stop') void this.stop()
    })
    shard.on('death', child => this.handleDeath(shard, child as ChildProcess))
  }

  /** Spawns a shard and waits for it to be ready; a failure is logged, and its exit restarts it. */
  private async spawn(shard: Shard): Promise<void> {
    const state = this.shards.get(shard)!
    state.spawnedAt = this.now()
    try {
      await shard.spawn(SHARD_READY_TIMEOUT_MS)
    } catch (error) {
      // A shard that exited is reported, and restarted, by its death
      const died = (error as { code?: unknown } | null)?.code === 'ShardingReadyDied'
      if (!this.stopping && !this.fatal && !died) this.logger.warn(`Shard ${shard.id} did not become ready:`, error)
    }
  }

  private handleDeath(shard: Shard, child: ChildProcess | undefined): void {
    if (this.stopping || this.fatal) return
    const state = this.shards.get(shard)!
    if (this.now() - state.spawnedAt >= RESPAWN_RESET_MS) state.attempts = 0
    const delay = Math.min(RESPAWN_BASE_MS * 2 ** state.attempts, RESPAWN_CAP_MS)
    state.attempts++

    this.logger.warn(`Shard ${shard.id} exited with code ${child?.exitCode ?? 'unknown'}; restarting it in ${delay} ms.`)
    state.timer = setTimeout(() => {
      state.timer = undefined
      if (!this.stopping && !this.fatal) void this.spawn(shard)
    }, delay)
  }

  /**
   * A shard that cannot log in never will, and an app MeoCord refuses is refused in every shard: stop every shard and
   * exit non-zero instead of restarting.
   */
  private stopForFatal(shard: Shard, message: Extract<ShardMessage, { meocord: 'fatal' }>): void {
    if (this.fatal) return
    this.fatal = true
    this.killAll()
    // A refusal names what is wrong and where, and how to fix it, on lines of its own; it is no failed login
    if (message.code === REFUSED_CODE) {
      this.logger.error(`Shard ${shard.id} cannot start; stopping every shard.\n${message.message}`)
      return this.exit(1)
    }
    this.logger.error(
      `Shard ${shard.id} cannot log in (${message.code}): ${message.message} Stopping every shard; fix the configuration ` +
        'and start again.',
    )
    void this.exitForLogin()
  }

  /** Exits 1 for a bot that could not log in, telling `meocord start --dev` first, which then waits for a change. */
  private exitForLogin(): void | Promise<void> {
    if (!this.devRunner) return this.exit(1)
    // Set first, so the process exits 1 even if it ends while the message is still on its way
    process.exitCode = 1
    return tellDevRunner({ meocord: 'login-failed' }, false).then(() => this.exit(1))
  }

  /**
   * Asks every shard to shut down through its own hooks, waits for them up to the shutdown timeout plus a margin, and
   * kills any left, without ending the manager's process; one killed sets `process.exitCode` to 1, unless a code is
   * set. A call after the first waits for it.
   */
  async stop(): Promise<void> {
    // As a signal's shutdown exits 1 for a shard that had to be killed, a code another failure set aside
    if (!(await this.shutDown()) && !process.exitCode) process.exitCode = 1
  }

  /**
   * Stops every shard as {@link stop} does, then exits: 0 when every shard stopped, 1 when one had to be killed.
   * SIGINT and SIGTERM call it. A call within `REPEAT_SIGNAL_WINDOW_MS` of the first is the same request; one after it
   * kills them all at once.
   */
  async stopAndExit(): Promise<void> {
    const request = this.stopRequest()
    if (request === 'duplicate') return
    if (request === 'repeat') {
      this.logger.warn('Stopping every shard now.')
      this.killAll()
      return this.exit(1)
    }
    return this.exitAfterShutdown()
  }

  /** The exit after the shutdown, once however many stops ask for it. */
  private exiting?: Promise<void>

  private exitAfterShutdown(): Promise<void> {
    return (this.exiting ??= this.shutDown().then(stopped => this.exit(stopped ? 0 : 1)))
  }

  /** The shutdown under way or done, which a later stop waits for: whether every shard stopped on its own. */
  private shuttingDown?: Promise<boolean>

  private shutDown(): Promise<boolean> {
    return (this.shuttingDown ??= this.shutDownShards())
  }

  private async shutDownShards(): Promise<boolean> {
    this.stopping = true
    this.logger.log('Shutting down the shards...')

    const live = [...this.shards.keys()].filter(shard => shard.process)
    for (const state of this.shards.values()) clearTimeout(state.timer)

    const exited = Promise.all(live.map(shard => new Promise<void>(resolve => shard.once('death', () => resolve()))))
    for (const shard of live) {
      // A shard that cannot receive the request cannot shut down cleanly, so it is stopped outright
      shard.send({ meocord: 'shutdown' } satisfies ShardMessage).catch(() => {
        if (shard.process) shard.kill()
      })
    }

    const wait = this.shutdownTimeout + SHUTDOWN_MARGIN_MS
    let timer: ReturnType<typeof setTimeout> | undefined
    const timedOut = new Promise<'timeout'>(resolve => {
      timer = setTimeout(() => resolve('timeout'), wait)
    })
    const outcome = await Promise.race([exited, timedOut])
    clearTimeout(timer)

    if (outcome === 'timeout') {
      this.logger.warn(`Some shards did not stop within ${wait} ms; killing them.`)
      this.killAll()
      return false
    }
    this.logger.log('Every shard has shut down')
    return true
  }

  private killAll(): void {
    for (const [shard, state] of this.shards) {
      clearTimeout(state.timer)
      if (shard.process) shard.kill()
    }
  }
}
