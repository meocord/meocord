import { inspect } from 'node:util'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import timezone from 'dayjs/plugin/timezone.js'
import { loadMeoCordConfig } from '@src/util/meocord-config-loader.util.js'
import { isBuiltApplication } from '@src/util/bundle-entry.util.js'
import chalk from 'chalk'
import { LOG_LEVEL_ENV, LOG_LEVEL_RANK, logThreshold, takeRejectedLogLevel } from '@src/common/log-level.js'

dayjs.extend(utc)
dayjs.extend(timezone)

/**
 * How deep an object argument prints: nested data a bot logs, such as a payload or its settings, shows in full, while
 * a discord.js structure, which reaches its client and every cache, stops at a few hundred lines.
 */
const OBJECT_DEPTH = 4

/** What a value registered with {@link hideInLogs} prints as. */
export const REDACTED = '[redacted]'

/**
 * The shortest value registered: a bot's credential is far longer, and a short value, such as a test's placeholder,
 * would replace ordinary words in every line.
 */
const MIN_HIDDEN_LENGTH = 16

const hiddenValues = new Set<string>()

/**
 * Keeps `value`, such as the bot's credential, out of every line Logger prints from now on, whatever object, string
 * or error carries it: as given, trimmed, and without the `Bot ` or `Bearer ` prefix discord.js strips.
 */
export function hideInLogs(value: string | undefined): void {
  if (typeof value !== 'string') return
  const trimmed = value.trim()
  for (const form of [trimmed, trimmed.replace(/^(Bot|Bearer)\s*/i, '')]) {
    if (form.length >= MIN_HIDDEN_LENGTH) hiddenValues.add(form)
  }
}

/** Forgets every value {@link hideInLogs} registered: for specs. */
export function forgetHiddenValues(): void {
  hiddenValues.clear()
}

const redact = (text: string): string => {
  let out = text
  for (const value of hiddenValues) out = out.replaceAll(value, REDACTED)
  return out
}

/**
 * Prints timestamped lines to the console, each named with the app and a context, at a level the config can hide.
 *
 * Use it in controllers and services instead of `console`, so the bot's lines share one format and
 * `meocord.config.ts`'s `logLevel`, or `MEOCORD_LOG_LEVEL` for one run, decides which print.
 *
 * @remarks
 * A string prints in the level's colour. Any other argument, a Symbol or a BigInt included, is printed as `console.log`
 * prints it, an object four levels deep: its non-enumerable properties stay unprinted, and an error prints its stack,
 * its own properties and its `cause`. The bot's credentials print as
 * `[redacted]` wherever they appear in a line. A line prints when its level is at or above the threshold: `debug`,
 * then `log` (with `info` and `verbose`, tagged `[INFO]` and `[VERBOSE]`), `warn`, `error`. Colour follows chalk:
 * none where the output is no terminal, such as a file or a log collector, unless `FORCE_COLOR` asks for it.
 *
 * @example
 * ```ts
 * @Service()
 * export class ReminderService {
 *   private readonly logger = new Logger(ReminderService.name)
 *
 *   remind(userId: string) {
 *     this.logger.log(`Reminding ${userId}`)
 *   }
 * }
 * ```
 *
 * @group Utilities
 * @see {@link MeoCordConfig}
 */
export class Logger {
  private readonly colorMap: Record<string, (msg: string) => string> = {
    LOG: chalk.green,
    INFO: chalk.cyan,
    VERBOSE: chalk.gray,
    WARN: chalk.yellow,
    ERROR: chalk.red,
    DEBUG: chalk.magenta,
  }

  /** @param context - What the lines are about, shown on each, such as a class's name. */
  constructor(private context?: string) {}

  /**
   * Whether a line of this level prints. An unknown `MEOCORD_LOG_LEVEL` is reported once, whatever the
   * level, since the level it falls back to may hide warnings.
   */
  private static shows(level: 'debug' | 'log' | 'warn' | 'error'): boolean {
    const threshold = logThreshold()
    const rejected = takeRejectedLogLevel()
    if (rejected !== undefined) {
      new Logger('Logger').logWithContext('warn', [
        `${LOG_LEVEL_ENV} is "${rejected}", which is not a log level: use debug, log, warn, error or silent.`,
      ])
    }
    return LOG_LEVEL_RANK[level] >= threshold
  }

  /** Prints a line at the `log` level. */
  log(...args: any[]): void {
    if (Logger.shows('log')) this.logWithContext('log', args)
  }

  /** Prints a line tagged `[INFO]`, shown at the `log` level as `log` is. */
  info(...args: any[]): void {
    if (Logger.shows('log')) this.logWithContext('log', args, 'INFO')
  }

  /** Prints a warning, shown unless the level is `error` or `silent`. */
  warn(...args: any[]): void {
    if (Logger.shows('warn')) this.logWithContext('warn', args)
  }

  /** Prints an error, shown unless the level is `silent`. */
  error(...args: any[]): void {
    if (Logger.shows('error')) this.logWithContext('error', args)
  }

  /** Prints a line at the `debug` level, shown only when the level is `debug`. */
  debug(...args: any[]): void {
    if (Logger.shows('debug')) this.logWithContext('debug', args)
  }

  /** Prints a line tagged `[VERBOSE]`, shown at the `log` level as `log` is. */
  verbose(...args: any[]): void {
    if (Logger.shows('log')) this.logWithContext('log', args, 'VERBOSE')
  }

  private formatMessage(message: unknown, logType: string): string {
    if (typeof message === 'string') return (this.colorMap[logType] || (msg => msg))(message)
    // Anything else as console.log inspects it, so no value, a Symbol included, makes the log call throw. Without
    // non-enumerable properties, which discord.js uses to keep its internals out of logs.
    // In colour only where chalk finds a terminal that shows it, or FORCE_COLOR asks for it, as the text around it is
    return inspect(message, { depth: OBJECT_DEPTH, colors: chalk.level > 0, compact: false })
  }

  private logWithContext(logLevel: string, messages: any[], tag = logLevel.toUpperCase()): void {
    if (messages.length === 0) return

    // The built bot's own config only: elsewhere dist holds a previous build's, and loading it runs its dotenv import
    const config = isBuiltApplication() ? loadMeoCordConfig() : undefined
    hideInLogs(config?.discordToken)
    const logType = tag
    const applyColor = this.colorMap[logType] || (msg => msg)
    const formattedMessages = messages.map(message => this.formatMessage(message, logType))

    const coloredAppName = config?.appName ? applyColor(chalk.bold(`[${config.appName}]`)) : undefined
    const timestamp = chalk.bold(dayjs().format('dddd, MMMM D, YYYY HH:mm:ss [UTC]Z'))
    const coloredLogLevel = applyColor(chalk.bold(`[${logType}]`))
    const coloredContext = this.context ? chalk.yellow.bold(`[${this.context}]`) : ''

    const logTexts = [coloredAppName, timestamp, coloredLogLevel, coloredContext, ...formattedMessages].filter(
      (log): log is string => !!log,
    )
    console[logLevel](...logTexts.map(redact))
  }
}
