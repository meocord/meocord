import { inspect } from 'node:util'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import timezone from 'dayjs/plugin/timezone.js'
import { loadMeoCordConfig } from '@src/util/meocord-config-loader.util.js'
import { isBuiltApplication } from '@src/util/bundle-entry.util.js'
import chalk, { chalkStderr, type ChalkInstance } from 'chalk'
import { LOG_LEVEL_ENV, LOG_LEVEL_RANK, logThreshold, takeRejectedLogLevel } from '@src/common/log-level.js'

dayjs.extend(utc)
dayjs.extend(timezone)

/**
 * How deep an object argument prints: nested data a bot logs, such as a payload or its settings, shows in full, while
 * a discord.js structure, which reaches its client and every cache, stops at a few hundred lines.
 */
const OBJECT_DEPTH = 4

/** The colour of each tag, and of a string printed under it. */
const TAG_COLOURS = {
  LOG: 'green',
  INFO: 'cyan',
  VERBOSE: 'gray',
  WARN: 'yellow',
  ERROR: 'red',
  DEBUG: 'magenta',
} as const satisfies Record<string, keyof ChalkInstance>
const tagColours: Partial<Record<string, (typeof TAG_COLOURS)[keyof typeof TAG_COLOURS]>> = TAG_COLOURS

/**
 * The chalk of the stream a level prints to, whose colour support decides the line's: `console.warn` and
 * `console.error` write to stderr, the others to stdout, and either may be a terminal while the other is a file.
 */
const chalkFor = (logLevel: string): ChalkInstance => (logLevel === 'warn' || logLevel === 'error' ? chalkStderr : chalk)

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
 * or error carries it: trimmed, and without the `Bot ` or `Bearer ` prefix discord.js strips.
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
 * A string prints in its tag's colour. Any other argument, a Symbol or a BigInt included, is printed as `console.log`
 * prints it, an object four levels deep: its non-enumerable properties stay unprinted, and an error prints its stack,
 * its own properties and its `cause`. The bot's credentials print as
 * `[redacted]` wherever they appear in a line. A line prints when its level is at or above the threshold: `debug`,
 * then `log` (with `info` and `verbose`, tagged `[INFO]` and `[VERBOSE]`), `warn`, `error`. Warnings and errors print
 * to stderr and the rest to stdout, each in colour only where its stream is a terminal, so no colour code goes to a file or
 * a log collector, unless `FORCE_COLOR` asks for it.
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

  /**
   * Prints a line at the `log` level.
   *
   * @param args - What to print, separated by spaces.
   */
  log(...args: any[]): void {
    if (Logger.shows('log')) this.logWithContext('log', args)
  }

  /**
   * Prints a line tagged `[INFO]`, shown at the `log` level as `log` is.
   *
   * @param args - What to print, separated by spaces.
   */
  info(...args: any[]): void {
    if (Logger.shows('log')) this.logWithContext('log', args, 'INFO')
  }

  /**
   * Prints a warning, shown unless the level is `error` or `silent`.
   *
   * @param args - What to print, separated by spaces.
   */
  warn(...args: any[]): void {
    if (Logger.shows('warn')) this.logWithContext('warn', args)
  }

  /**
   * Prints an error, shown unless the level is `silent`.
   *
   * @param args - What to print, separated by spaces.
   */
  error(...args: any[]): void {
    if (Logger.shows('error')) this.logWithContext('error', args)
  }

  /**
   * Prints a line at the `debug` level, shown only when the level is `debug`.
   *
   * @param args - What to print, separated by spaces.
   */
  debug(...args: any[]): void {
    if (Logger.shows('debug')) this.logWithContext('debug', args)
  }

  /**
   * Prints a line tagged `[VERBOSE]`, shown at the `log` level as `log` is.
   *
   * @param args - What to print, separated by spaces.
   */
  verbose(...args: any[]): void {
    if (Logger.shows('log')) this.logWithContext('log', args, 'VERBOSE')
  }

  private formatMessage(message: unknown, paint: ChalkInstance, colour: (text: string) => string): string {
    if (typeof message === 'string') return colour(message)
    // Anything else as console.log inspects it, so no value, a Symbol included, makes the log call throw. Without
    // non-enumerable properties, which discord.js uses to keep its internals out of logs.
    // In colour only where the line's stream shows it, or FORCE_COLOR asks for it, as the text around it is
    return inspect(message, { depth: OBJECT_DEPTH, colors: paint.level > 0 })
  }

  private logWithContext(logLevel: string, messages: any[], tag = logLevel.toUpperCase()): void {
    if (messages.length === 0) return

    // The built bot's own config only: elsewhere dist holds a previous build's, and loading it runs its dotenv import
    const config = isBuiltApplication() ? loadMeoCordConfig() : undefined
    hideInLogs(config?.discordToken)
    const paint = chalkFor(logLevel)
    const colourName = tagColours[tag]
    const applyColor = (text: string) => (colourName ? paint[colourName](text) : text)
    const formattedMessages = messages.map(message => this.formatMessage(message, paint, applyColor))

    const coloredAppName = config?.appName ? applyColor(paint.bold(`[${config.appName}]`)) : undefined
    const timestamp = paint.bold(dayjs().format('dddd, MMMM D, YYYY HH:mm:ss [UTC]Z'))
    const coloredLogLevel = applyColor(paint.bold(`[${tag}]`))
    const coloredContext = this.context ? paint.yellow.bold(`[${this.context}]`) : ''

    const logTexts = [coloredAppName, timestamp, coloredLogLevel, coloredContext, ...formattedMessages].filter(
      (log): log is string => !!log,
    )
    console[logLevel](...logTexts.map(redact))
  }
}
