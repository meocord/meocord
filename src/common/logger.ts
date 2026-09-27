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
 * Prints timestamped lines to the console, each named with the app and a context, at a level the config can hide.
 *
 * Use it in controllers and services instead of `console`, so the bot's lines share one format and
 * `meocord.config.ts`'s `logLevel`, or `MEOCORD_LOG_LEVEL` for one run, decides which print.
 *
 * @remarks
 * An object argument is printed in full, however deep. A line prints when its level is at or above the threshold:
 * `debug`, then `log` (with `info` and `verbose`), `warn`, `error`.
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

  /** Prints a line at the `log` level, as `log` does. */
  info(...args: any[]): void {
    if (Logger.shows('log')) this.logWithContext('log', args)
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

  /** Prints a line at the `log` level, as `log` does. */
  verbose(...args: any[]): void {
    if (Logger.shows('log')) this.logWithContext('log', args)
  }

  private formatMessage(message: any, logType: string): string {
    if (typeof message === 'object' && message !== null) {
      return inspect(message, {
        showHidden: true,
        depth: null,
        colors: true,
        compact: false,
        showProxy: true,
      })
    }

    return (this.colorMap[logType] || (msg => msg))(message)
  }

  private logWithContext(logLevel: string, messages: any[]): void {
    if (messages.length === 0) return

    // The built bot's own config only: elsewhere dist holds a previous build's, and loading it runs its dotenv import
    const config = isBuiltApplication() ? loadMeoCordConfig() : undefined
    const logType = logLevel.toUpperCase()
    const applyColor = this.colorMap[logType] || (msg => msg)
    const formattedMessages = messages.map(message => this.formatMessage(message, logType))

    const coloredAppName = config?.appName ? applyColor(chalk.bold(`[${config.appName}]`)) : undefined
    const timestamp = chalk.bold(dayjs().format('dddd, MMMM D, YYYY HH:mm:ss [UTC]Z'))
    const coloredLogLevel = applyColor(chalk.bold(`[${logType}]`))
    const coloredContext = this.context ? chalk.yellow.bold(`[${this.context}]`) : ''

    const logTexts = [coloredAppName, timestamp, coloredLogLevel, coloredContext, ...formattedMessages].filter(
      log => !!log,
    )
    console[logLevel](...logTexts)
  }
}
