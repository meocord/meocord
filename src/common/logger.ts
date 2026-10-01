import { inspect } from 'node:util'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import timezone from 'dayjs/plugin/timezone.js'
import { loadMeoCordConfig } from '@src/util/meocord-config-loader.util.js'
import chalk from 'chalk'

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

export class Logger {
  private readonly colorMap: Record<string, (msg: string) => string> = {
    LOG: chalk.green,
    INFO: chalk.cyan,
    WARN: chalk.yellow,
    ERROR: chalk.red,
    DEBUG: chalk.magenta,
  }

  constructor(private context?: string) {}

  log(...args: any[]): void {
    this.logWithContext('log', args)
  }

  info(...args: any[]): void {
    this.logWithContext('log', args)
  }

  warn(...args: any[]): void {
    this.logWithContext('warn', args)
  }

  error(...args: any[]): void {
    this.logWithContext('error', args)
  }

  debug(...args: any[]): void {
    this.logWithContext('debug', args)
  }

  verbose(...args: any[]): void {
    this.logWithContext('log', args)
  }

  private formatMessage(message: any, logType: string): string {
    if (typeof message === 'object' && message !== null) {
      // As console.log inspects: without non-enumerable properties, which discord.js uses to keep its internals out of logs
      return inspect(message, { depth: OBJECT_DEPTH, colors: true, compact: false })
    }

    return (this.colorMap[logType] || (msg => msg))(message)
  }

  private logWithContext(logLevel: string, messages: any[]): void {
    if (messages.length === 0) return

    const config = loadMeoCordConfig()
    hideInLogs(config?.discordToken)
    const logType = logLevel.toUpperCase()
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
